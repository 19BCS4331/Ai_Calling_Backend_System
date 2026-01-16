/**
 * Cashfree Payment Provider
 * 
 * Handles Cashfree payment links and webhooks using the official SDK.
 * Alternative payment provider for Indian customers.
 * 
 * Uses: cashfree-pg SDK v5+
 * Docs: https://github.com/cashfree/cashfree-pg-sdk-nodejs
 */

import crypto from 'crypto';
import * as CashfreePG from 'cashfree-pg';
import {
  PaymentProviderInterface,
  PaymentProvider,
  CreateCheckoutRequest,
  CheckoutSession,
  PaymentSubscription,
  PortalSession,
  WebhookEvent,
  WebhookEventType
} from './types';
import { supabaseAdmin } from '../db';
import { getPlanById } from '../plans';
import { createLogger } from '../../utils/logger';

const logger = createLogger('payments-cashfree');

// API version for Cashfree SDK
const CASHFREE_API_VERSION = '2023-08-01';

// Type-safe access to Cashfree SDK (handles incomplete TS definitions)
const Cashfree = CashfreePG.Cashfree as any;

export class CashfreeProvider implements PaymentProviderInterface {
  readonly provider: PaymentProvider = 'cashfree';
  private secretKey: string;

  constructor(
    appId: string,
    secretKey: string,
    environment: 'TEST' | 'PRODUCTION' = 'TEST'
  ) {
    this.secretKey = secretKey;
    
    // Initialize Cashfree SDK using static configuration
    Cashfree.XClientId = appId;
    Cashfree.XClientSecret = secretKey;
    Cashfree.XEnvironment = environment === 'PRODUCTION' 
      ? Cashfree.Environment.PRODUCTION 
      : Cashfree.Environment.SANDBOX;
    
    logger.info('Cashfree SDK initialized', { environment });
  }

  /**
   * Create a Cashfree payment link for subscription.
   * Uses the official SDK's PGCreateLink method.
   */
  async createCheckoutSession(request: CreateCheckoutRequest): Promise<CheckoutSession> {
    // Get plan details
    const plan = await getPlanById(request.plan_id);
    if (!plan) {
      throw new Error(`Plan not found: ${request.plan_id}`);
    }

    // Calculate amount in INR (Cashfree expects amount as number, not paise)
    const amountINR = request.billing_interval === 'yearly'
      ? plan.price_yearly_cents / 100
      : plan.price_monthly_cents / 100;

    // Get or create Cashfree customer
    const customerId = await this.getOrCreateCustomer(
      request.organization_id,
      request.customer_email
    );

    // Generate unique link ID
    const linkId = `link_${request.organization_id.substring(0, 8)}_${Date.now()}`;

    // Expiry time (24 hours from now) in ISO format
    const expiryTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create payment link request using SDK format
    const createLinkRequest = {
      link_id: linkId,
      link_amount: amountINR,
      link_currency: 'INR',
      link_purpose: `${plan.slug} subscription (${request.billing_interval})`,
      customer_details: {
        customer_id: customerId,
        customer_email: request.customer_email || undefined,
        customer_phone: '9999999999' // Required by Cashfree
      },
      link_meta: {
        return_url: request.success_url,
        notify_url: process.env.CASHFREE_WEBHOOK_URL || undefined
      },
      link_notes: {
        organization_id: request.organization_id,
        plan_id: request.plan_id,
        billing_interval: request.billing_interval
      },
      link_auto_reminders: true,
      link_expiry_time: expiryTime,
      link_notify: {
        send_sms: false,
        send_email: !!request.customer_email
      }
    };

    try {
      // Use SDK to create payment link (v<5 API pattern with version)
      const response = await Cashfree.PGCreateLink(CASHFREE_API_VERSION, createLinkRequest);
      const link = response.data;

      logger.info('Cashfree payment link created via SDK', {
        linkId: link.link_id,
        cfLinkId: link.cf_link_id,
        organizationId: request.organization_id,
        planId: request.plan_id,
        amount: amountINR
      });

      return {
        id: link.link_id,
        provider: 'cashfree',
        url: link.link_url,
        expires_at: new Date(link.link_expiry_time || expiryTime)
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      logger.error('Failed to create Cashfree payment link', {
        error: err.response?.data?.message || String(error),
        linkId
      });
      throw new Error(`Cashfree payment link creation failed: ${err.response?.data?.message || String(error)}`);
    }
  }

  /**
   * Get subscription details.
   * Note: Cashfree uses payment links, not true subscriptions.
   * We track subscription state in our database.
   */
  async getSubscription(subscriptionId: string): Promise<PaymentSubscription | null> {
    // Cashfree doesn't have native subscriptions like Stripe
    // We manage subscription state in our database
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('cashfree_subscription_id', subscriptionId)
      .single();

    if (!sub) {
      return null;
    }

    return {
      id: sub.id,
      provider: 'cashfree',
      provider_subscription_id: subscriptionId,
      provider_customer_id: sub.organization_id, // Use org ID as customer
      status: sub.status as PaymentSubscription['status'],
      plan_id: sub.plan_id,
      billing_interval: sub.billing_interval,
      current_period_start: new Date(sub.current_period_start),
      current_period_end: new Date(sub.current_period_end),
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at) : null
    };
  }

  /**
   * Cancel a subscription.
   * Since Cashfree doesn't have native subscriptions, we just update our database.
   */
  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    const updates: Record<string, unknown> = {
      cancel_at_period_end: !immediately
    };

    if (immediately) {
      updates.status = 'canceled';
      updates.canceled_at = new Date().toISOString();
    }

    await supabaseAdmin
      .from('subscriptions')
      .update(updates)
      .eq('cashfree_subscription_id', subscriptionId);

    logger.info('Cashfree subscription canceled', { subscriptionId, immediately });
  }

  /**
   * Resume a subscription.
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    await supabaseAdmin
      .from('subscriptions')
      .update({
        cancel_at_period_end: false,
        status: 'active'
      })
      .eq('cashfree_subscription_id', subscriptionId);

    logger.info('Cashfree subscription resumed', { subscriptionId });
  }

  /**
   * Create a customer portal session.
   * Cashfree doesn't have a portal, return dashboard link.
   */
  async createPortalSession(_customerId: string, returnUrl: string): Promise<PortalSession> {
    return {
      url: returnUrl + '?message=manage_in_dashboard',
      expires_at: new Date(Date.now() + 30 * 60 * 1000)
    };
  }

  /**
   * Verify webhook signature.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    const timestamp = signature.split(',')[0]?.split('=')[1] || '';
    const receivedSignature = signature.split(',')[1]?.split('=')[1] || '';

    const signatureData = timestamp + payload.toString();
    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(signatureData)
      .digest('base64');

    return receivedSignature === expectedSignature;
  }

  /**
   * Parse and normalize webhook event.
   */
  parseWebhookEvent(payload: string | Buffer, _signature: string): WebhookEvent {
    const event = JSON.parse(payload.toString());

    const eventType = this.mapEventType(event.type);
    const organizationId = event.data?.link?.link_notes?.organization_id || 
                          event.data?.order?.order_meta?.organization_id || null;

    return {
      id: event.data?.link?.link_id || event.data?.order?.order_id || `cf_${Date.now()}`,
      provider: 'cashfree',
      type: eventType,
      organization_id: organizationId,
      subscription_id: null, // Cashfree doesn't have subscription IDs
      data: event.data || {},
      raw_event: event,
      received_at: new Date()
    };
  }

  // ===========================================
  // Private Helpers
  // ===========================================

  private async getOrCreateCustomer(
    organizationId: string,
    email?: string
  ): Promise<string> {
    // Check if org already has a Cashfree customer
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('cashfree_customer_id, name, billing_email')
      .eq('id', organizationId)
      .single();

    if (org?.cashfree_customer_id) {
      return org.cashfree_customer_id;
    }

    // For Cashfree, we use the organization ID as the customer ID
    // since they don't have a separate customer management API
    const customerId = `cust_${organizationId.substring(0, 20)}`;

    // Save customer ID to org
    await supabaseAdmin
      .from('organizations')
      .update({ cashfree_customer_id: customerId })
      .eq('id', organizationId);

    logger.info('Created Cashfree customer', { customerId, organizationId });

    return customerId;
  }

  private mapEventType(cashfreeEvent: string): WebhookEventType {
    const mapping: Record<string, WebhookEventType> = {
      'PAYMENT_LINK_EVENT': 'payment.succeeded',
      'PAYMENT_SUCCESS_WEBHOOK': 'payment.succeeded',
      'PAYMENT_FAILED_WEBHOOK': 'payment.failed',
      'REFUND_STATUS_WEBHOOK': 'payment.refunded'
    };

    return mapping[cashfreeEvent] || 'payment.succeeded';
  }
}

/**
 * Create Cashfree provider from environment.
 */
export function createCashfreeProvider(): CashfreeProvider | null {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    logger.warn('Cashfree not configured - missing credentials');
    return null;
  }

  return new CashfreeProvider(
    appId,
    secretKey,
    (process.env.CASHFREE_ENV as 'TEST' | 'PRODUCTION') || 'TEST'
  );
}
