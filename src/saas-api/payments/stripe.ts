/**
 * Stripe Payment Provider
 * 
 * Handles Stripe checkout, subscriptions, and webhooks.
 * Primary payment provider for international customers.
 */

import Stripe from 'stripe';
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

const logger = createLogger('payments-stripe');

export class StripeProvider implements PaymentProviderInterface {
  readonly provider: PaymentProvider = 'stripe';
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia'
    });
    this.webhookSecret = webhookSecret;
  }

  /**
   * Create a Stripe Checkout session for subscription.
   */
  async createCheckoutSession(request: CreateCheckoutRequest): Promise<CheckoutSession> {
    // Get plan details
    const plan = await getPlanById(request.plan_id);
    if (!plan) {
      throw new Error(`Plan not found: ${request.plan_id}`);
    }

    // Get price ID based on interval
    const priceId = request.billing_interval === 'yearly'
      ? plan.stripe_price_id_yearly
      : plan.stripe_price_id_monthly;

    if (!priceId) {
      throw new Error(`Stripe price ID not configured for plan: ${plan.slug}`);
    }

    // Get or create Stripe customer
    const customerId = await this.getOrCreateCustomer(
      request.organization_id,
      request.customer_email
    );

    // Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: request.success_url,
      cancel_url: request.cancel_url,
      metadata: {
        organization_id: request.organization_id,
        plan_id: request.plan_id,
        ...request.metadata
      },
      subscription_data: {
        metadata: {
          organization_id: request.organization_id,
          plan_id: request.plan_id
        }
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: {
        enabled: true
      }
    });

    logger.info('Stripe checkout session created', {
      sessionId: session.id,
      organizationId: request.organization_id,
      planId: request.plan_id
    });

    return {
      id: session.id,
      provider: 'stripe',
      url: session.url!,
      expires_at: new Date(session.expires_at * 1000)
    };
  }

  /**
   * Get subscription details from Stripe.
   */
  async getSubscription(subscriptionId: string): Promise<PaymentSubscription | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

      return {
        id: subscription.id,
        provider: 'stripe',
        provider_subscription_id: subscription.id,
        provider_customer_id: subscription.customer as string,
        status: this.mapSubscriptionStatus(subscription.status),
        plan_id: subscription.metadata.plan_id || '',
        billing_interval: subscription.items.data[0]?.price?.recurring?.interval === 'year' 
          ? 'yearly' 
          : 'monthly',
        current_period_start: new Date(subscription.current_period_start * 1000),
        current_period_end: new Date(subscription.current_period_end * 1000),
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at 
          ? new Date(subscription.canceled_at * 1000) 
          : null
      };
    } catch (error) {
      logger.error('Failed to get Stripe subscription', { subscriptionId, error });
      return null;
    }
  }

  /**
   * Cancel a subscription.
   */
  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    if (immediately) {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } else {
      await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
      });
    }

    logger.info('Stripe subscription canceled', { subscriptionId, immediately });
  }

  /**
   * Resume a paused/canceled subscription.
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    });

    logger.info('Stripe subscription resumed', { subscriptionId });
  }

  /**
   * Create a customer portal session.
   */
  async createPortalSession(customerId: string, returnUrl: string): Promise<PortalSession> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });

    return {
      url: session.url,
      expires_at: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    };
  }

  /**
   * Verify webhook signature.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    try {
      this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse and normalize webhook event.
   */
  parseWebhookEvent(payload: string | Buffer, signature: string): WebhookEvent {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret
    );

    const eventType = this.mapEventType(event.type);
    const organizationId = this.extractOrganizationId(event);
    const subscriptionId = this.extractSubscriptionId(event);

    return {
      id: event.id,
      provider: 'stripe',
      type: eventType,
      organization_id: organizationId,
      subscription_id: subscriptionId,
      data: event.data.object as unknown as Record<string, unknown>,
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
    // Check if org already has a Stripe customer
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('stripe_customer_id, name, billing_email')
      .eq('id', organizationId)
      .single();

    if (org?.stripe_customer_id) {
      return org.stripe_customer_id;
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      email: email || org?.billing_email || undefined,
      name: org?.name || undefined,
      metadata: {
        organization_id: organizationId
      }
    });

    // Save customer ID to org
    await supabaseAdmin
      .from('organizations')
      .update({ stripe_customer_id: customer.id })
      .eq('id', organizationId);

    logger.info('Created Stripe customer', { 
      customerId: customer.id, 
      organizationId 
    });

    return customer.id;
  }

  private mapSubscriptionStatus(
    status: Stripe.Subscription.Status
  ): PaymentSubscription['status'] {
    switch (status) {
      case 'active':
        return 'active';
      case 'trialing':
        return 'trialing';
      case 'past_due':
        return 'past_due';
      case 'canceled':
        return 'canceled';
      case 'paused':
        return 'paused';
      default:
        return 'active';
    }
  }

  private mapEventType(stripeType: string): WebhookEventType {
    const mapping: Record<string, WebhookEventType> = {
      'customer.subscription.created': 'subscription.created',
      'customer.subscription.updated': 'subscription.updated',
      'customer.subscription.deleted': 'subscription.canceled',
      'customer.subscription.paused': 'subscription.paused',
      'customer.subscription.resumed': 'subscription.resumed',
      'invoice.paid': 'invoice.paid',
      'invoice.payment_failed': 'invoice.payment_failed',
      'invoice.created': 'invoice.created',
      'payment_intent.succeeded': 'payment.succeeded',
      'payment_intent.payment_failed': 'payment.failed',
      'charge.refunded': 'payment.refunded'
    };

    return mapping[stripeType] || 'subscription.updated';
  }

  private extractOrganizationId(event: Stripe.Event): string | null {
    const obj = event.data.object as unknown as Record<string, unknown>;
    
    // Check metadata first
    if (obj.metadata && typeof obj.metadata === 'object') {
      const metadata = obj.metadata as Record<string, string>;
      if (metadata.organization_id) {
        return metadata.organization_id;
      }
    }

    // For subscriptions, check subscription metadata
    if (obj.subscription && typeof obj.subscription === 'string') {
      // Would need to fetch subscription to get metadata
      // For now, return null and handle in webhook processor
    }

    return null;
  }

  private extractSubscriptionId(event: Stripe.Event): string | null {
    const obj = event.data.object as unknown as Record<string, unknown>;
    
    if (obj.id && event.type.startsWith('customer.subscription')) {
      return obj.id as string;
    }

    if (obj.subscription && typeof obj.subscription === 'string') {
      return obj.subscription;
    }

    return null;
  }
}

/**
 * Create Stripe provider from environment.
 */
export function createStripeProvider(): StripeProvider | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey) {
    logger.warn('Stripe not configured - missing STRIPE_SECRET_KEY');
    return null;
  }

  return new StripeProvider(secretKey, webhookSecret || '');
}
