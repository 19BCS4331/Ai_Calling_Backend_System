/**
 * Razorpay Payment Provider
 * 
 * Handles Razorpay subscriptions and webhooks.
 * Primary payment provider for Indian customers.
 */

import crypto from 'crypto';
import axios from 'axios';
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

const logger = createLogger('payments-razorpay');

const RAZORPAY_API_URL = 'https://api.razorpay.com/v1';

export class RazorpayProvider implements PaymentProviderInterface {
  readonly provider: PaymentProvider = 'razorpay';
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;

  constructor(keyId: string, keySecret: string, webhookSecret?: string) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret || '';
  }

  private get authHeader(): string {
    return Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
  }

  /**
   * Create a Razorpay subscription.
   * Note: Razorpay doesn't have hosted checkout like Stripe.
   * We create a subscription and return a payment link.
   */
  async createCheckoutSession(request: CreateCheckoutRequest): Promise<CheckoutSession> {
    // Get plan details
    const plan = await getPlanById(request.plan_id);
    if (!plan) {
      throw new Error(`Plan not found: ${request.plan_id}`);
    }

    // Calculate amount in paise (INR smallest unit)
    const amountPaise = request.billing_interval === 'yearly'
      ? plan.price_yearly_cents // Already in cents, 1 cent ≈ 0.83 paise
      : plan.price_monthly_cents;

    // Get or create Razorpay customer
    const customerId = await this.getOrCreateCustomer(
      request.organization_id,
      request.customer_email
    );

    // Create plan in Razorpay if not exists
    const razorpayPlanId = await this.getOrCreatePlan(plan, request.billing_interval);

    // Create subscription
    const response = await axios.post(
      `${RAZORPAY_API_URL}/subscriptions`,
      {
        plan_id: razorpayPlanId,
        customer_id: customerId,
        total_count: request.billing_interval === 'yearly' ? 1 : 12,
        quantity: 1,
        customer_notify: 1,
        notes: {
          organization_id: request.organization_id,
          plan_id: request.plan_id
        }
      },
      {
        headers: {
          Authorization: `Basic ${this.authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const subscription = response.data;

    logger.info('Razorpay subscription created', {
      subscriptionId: subscription.id,
      organizationId: request.organization_id,
      planId: request.plan_id
    });

    return {
      id: subscription.id,
      provider: 'razorpay',
      url: subscription.short_url,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };
  }

  /**
   * Get subscription details from Razorpay.
   */
  async getSubscription(subscriptionId: string): Promise<PaymentSubscription | null> {
    try {
      const response = await axios.get(
        `${RAZORPAY_API_URL}/subscriptions/${subscriptionId}`,
        {
          headers: {
            Authorization: `Basic ${this.authHeader}`
          }
        }
      );

      const sub = response.data;

      return {
        id: sub.id,
        provider: 'razorpay',
        provider_subscription_id: sub.id,
        provider_customer_id: sub.customer_id,
        status: this.mapSubscriptionStatus(sub.status),
        plan_id: sub.notes?.plan_id || '',
        billing_interval: sub.total_count === 1 ? 'yearly' : 'monthly',
        current_period_start: new Date(sub.current_start * 1000),
        current_period_end: new Date(sub.current_end * 1000),
        cancel_at_period_end: sub.status === 'pending_cancellation',
        canceled_at: sub.ended_at ? new Date(sub.ended_at * 1000) : null
      };
    } catch (error) {
      logger.error('Failed to get Razorpay subscription', { subscriptionId, error });
      return null;
    }
  }

  /**
   * Cancel a subscription.
   */
  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    await axios.post(
      `${RAZORPAY_API_URL}/subscriptions/${subscriptionId}/cancel`,
      {
        cancel_at_cycle_end: !immediately
      },
      {
        headers: {
          Authorization: `Basic ${this.authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('Razorpay subscription canceled', { subscriptionId, immediately });
  }

  /**
   * Resume a paused subscription.
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    await axios.post(
      `${RAZORPAY_API_URL}/subscriptions/${subscriptionId}/resume`,
      {},
      {
        headers: {
          Authorization: `Basic ${this.authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('Razorpay subscription resumed', { subscriptionId });
  }

  /**
   * Create a customer portal session.
   * Note: Razorpay doesn't have a native portal, return dashboard link.
   */
  async createPortalSession(_customerId: string, returnUrl: string): Promise<PortalSession> {
    // Razorpay doesn't have a self-service portal like Stripe
    // Return the return URL with a message
    return {
      url: returnUrl + '?message=manage_in_dashboard',
      expires_at: new Date(Date.now() + 30 * 60 * 1000)
    };
  }

  /**
   * Verify webhook signature.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('Razorpay webhook secret not configured');
      return true; // Allow if not configured (dev mode)
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Parse and normalize webhook event.
   */
  parseWebhookEvent(payload: string | Buffer, _signature: string): WebhookEvent {
    const event = JSON.parse(payload.toString());

    const eventType = this.mapEventType(event.event);
    const organizationId = event.payload?.subscription?.entity?.notes?.organization_id || null;
    const subscriptionId = event.payload?.subscription?.entity?.id || null;

    return {
      id: event.event + '_' + Date.now(),
      provider: 'razorpay',
      type: eventType,
      organization_id: organizationId,
      subscription_id: subscriptionId,
      data: event.payload || {},
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
    // Check if org already has a Razorpay customer
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('razorpay_customer_id, name, billing_email')
      .eq('id', organizationId)
      .single();

    if (org?.razorpay_customer_id) {
      return org.razorpay_customer_id;
    }

    // Create new customer
    const response = await axios.post(
      `${RAZORPAY_API_URL}/customers`,
      {
        name: org?.name || 'Customer',
        email: email || org?.billing_email,
        notes: {
          organization_id: organizationId
        }
      },
      {
        headers: {
          Authorization: `Basic ${this.authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const customerId = response.data.id;

    // Save customer ID to org
    await supabaseAdmin
      .from('organizations')
      .update({ razorpay_customer_id: customerId })
      .eq('id', organizationId);

    logger.info('Created Razorpay customer', { customerId, organizationId });

    return customerId;
  }

  private async getOrCreatePlan(
    plan: { id: string; slug: string; price_monthly_cents: number; price_yearly_cents: number },
    interval: 'monthly' | 'yearly'
  ): Promise<string> {
    // For simplicity, create plan ID based on our plan + interval
    const planId = `plan_${plan.slug}_${interval}`;
    
    try {
      // Try to get existing plan
      await axios.get(`${RAZORPAY_API_URL}/plans/${planId}`, {
        headers: { Authorization: `Basic ${this.authHeader}` }
      });
      return planId;
    } catch {
      // Plan doesn't exist, create it
      const amount = interval === 'yearly' ? plan.price_yearly_cents : plan.price_monthly_cents;
      
      const response = await axios.post(
        `${RAZORPAY_API_URL}/plans`,
        {
          period: interval === 'yearly' ? 'yearly' : 'monthly',
          interval: 1,
          item: {
            name: `${plan.slug} (${interval})`,
            amount: amount, // In paise
            currency: 'INR'
          },
          notes: {
            plan_id: plan.id,
            interval
          }
        },
        {
          headers: {
            Authorization: `Basic ${this.authHeader}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.id;
    }
  }

  private mapSubscriptionStatus(status: string): PaymentSubscription['status'] {
    switch (status) {
      case 'active':
        return 'active';
      case 'pending':
      case 'created':
        return 'trialing';
      case 'halted':
        return 'past_due';
      case 'cancelled':
      case 'completed':
        return 'canceled';
      case 'paused':
        return 'paused';
      default:
        return 'active';
    }
  }

  private mapEventType(razorpayEvent: string): WebhookEventType {
    const mapping: Record<string, WebhookEventType> = {
      'subscription.activated': 'subscription.created',
      'subscription.charged': 'subscription.renewed',
      'subscription.updated': 'subscription.updated',
      'subscription.cancelled': 'subscription.canceled',
      'subscription.paused': 'subscription.paused',
      'subscription.resumed': 'subscription.resumed',
      'payment.captured': 'payment.succeeded',
      'payment.failed': 'payment.failed',
      'refund.created': 'payment.refunded',
      'invoice.paid': 'invoice.paid'
    };

    return mapping[razorpayEvent] || 'subscription.updated';
  }
}

/**
 * Create Razorpay provider from environment.
 */
export function createRazorpayProvider(): RazorpayProvider | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    logger.warn('Razorpay not configured - missing credentials');
    return null;
  }

  return new RazorpayProvider(keyId, keySecret, process.env.RAZORPAY_WEBHOOK_SECRET);
}
