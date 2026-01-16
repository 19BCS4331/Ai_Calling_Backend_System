/**
 * Webhook Handler
 * 
 * Processes payment webhooks from all providers.
 * Updates subscriptions and records payments.
 */

import { Router, Request, Response } from 'express';
import {
  WebhookEvent,
  PaymentProvider
} from './types';
import { createStripeProvider, StripeProvider } from './stripe';
import { createRazorpayProvider, RazorpayProvider } from './razorpay';
import { createCashfreeProvider, CashfreeProvider } from './cashfree';
import { supabaseAdmin } from '../db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('payments-webhook');

type Provider = StripeProvider | RazorpayProvider | CashfreeProvider;

/**
 * Get provider instance by name.
 */
function getProvider(name: PaymentProvider): Provider | null {
  switch (name) {
    case 'stripe':
      return createStripeProvider();
    case 'razorpay':
      return createRazorpayProvider();
    case 'cashfree':
      return createCashfreeProvider();
    default:
      return null;
  }
}

/**
 * Process a webhook event and update database accordingly.
 */
async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  logger.info('Processing webhook event', {
    provider: event.provider,
    type: event.type,
    organizationId: event.organization_id
  });

  switch (event.type) {
    case 'subscription.created':
      await handleSubscriptionCreated(event);
      break;
    case 'subscription.updated':
    case 'subscription.renewed':
      await handleSubscriptionUpdated(event);
      break;
    case 'subscription.canceled':
      await handleSubscriptionCanceled(event);
      break;
    case 'subscription.paused':
      await handleSubscriptionPaused(event);
      break;
    case 'subscription.resumed':
      await handleSubscriptionResumed(event);
      break;
    case 'payment.succeeded':
      await handlePaymentSucceeded(event);
      break;
    case 'payment.failed':
      await handlePaymentFailed(event);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(event);
      break;
    default:
      logger.debug('Unhandled webhook event type', { type: event.type });
  }
}

/**
 * Handle subscription created event.
 */
async function handleSubscriptionCreated(event: WebhookEvent): Promise<void> {
  if (!event.organization_id) {
    logger.warn('Subscription created without organization_id', { eventId: event.id });
    return;
  }

  const provider = getProvider(event.provider);
  if (!provider || !event.subscription_id) return;

  const subscription = await provider.getSubscription(event.subscription_id);
  if (!subscription) return;

  // Create or update subscription in database
  const subscriptionData = {
    organization_id: event.organization_id,
    plan_id: subscription.plan_id,
    status: subscription.status,
    billing_interval: subscription.billing_interval,
    current_period_start: subscription.current_period_start.toISOString(),
    current_period_end: subscription.current_period_end.toISOString(),
    [`${event.provider}_subscription_id`]: subscription.provider_subscription_id
  };

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(subscriptionData, {
      onConflict: 'organization_id'
    });

  if (error) {
    logger.error('Failed to create subscription', { error: error.message });
  } else {
    logger.info('Subscription created in database', {
      organizationId: event.organization_id,
      provider: event.provider
    });
  }
}

/**
 * Handle subscription updated event.
 */
async function handleSubscriptionUpdated(event: WebhookEvent): Promise<void> {
  if (!event.organization_id || !event.subscription_id) return;

  const provider = getProvider(event.provider);
  if (!provider) return;

  const subscription = await provider.getSubscription(event.subscription_id);
  if (!subscription) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: subscription.status,
      current_period_start: subscription.current_period_start.toISOString(),
      current_period_end: subscription.current_period_end.toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end
    })
    .eq('organization_id', event.organization_id);

  logger.info('Subscription updated', {
    organizationId: event.organization_id,
    status: subscription.status
  });
}

/**
 * Handle subscription canceled event.
 */
async function handleSubscriptionCanceled(event: WebhookEvent): Promise<void> {
  if (!event.organization_id) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString()
    })
    .eq('organization_id', event.organization_id);

  logger.info('Subscription canceled', {
    organizationId: event.organization_id
  });
}

/**
 * Handle subscription paused event.
 */
async function handleSubscriptionPaused(event: WebhookEvent): Promise<void> {
  if (!event.organization_id) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'paused' })
    .eq('organization_id', event.organization_id);

  logger.info('Subscription paused', {
    organizationId: event.organization_id
  });
}

/**
 * Handle subscription resumed event.
 */
async function handleSubscriptionResumed(event: WebhookEvent): Promise<void> {
  if (!event.organization_id) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'active',
      cancel_at_period_end: false
    })
    .eq('organization_id', event.organization_id);

  logger.info('Subscription resumed', {
    organizationId: event.organization_id
  });
}

/**
 * Handle payment succeeded event.
 */
async function handlePaymentSucceeded(event: WebhookEvent): Promise<void> {
  logger.info('Payment succeeded', {
    organizationId: event.organization_id,
    provider: event.provider
  });

  // Record payment in audit log
  if (event.organization_id) {
    await supabaseAdmin
      .from('audit_logs')
      .insert({
        organization_id: event.organization_id,
        action: 'payment.succeeded',
        resource_type: 'payment',
        resource_id: event.id,
        changes: event.data,
        ip_address: '0.0.0.0'
      });
  }
}

/**
 * Handle payment failed event.
 */
async function handlePaymentFailed(event: WebhookEvent): Promise<void> {
  logger.warn('Payment failed', {
    organizationId: event.organization_id,
    provider: event.provider
  });

  if (event.organization_id) {
    // Update subscription status to past_due
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('organization_id', event.organization_id);

    // Record in audit log
    await supabaseAdmin
      .from('audit_logs')
      .insert({
        organization_id: event.organization_id,
        action: 'payment.failed',
        resource_type: 'payment',
        resource_id: event.id,
        changes: event.data,
        ip_address: '0.0.0.0'
      });
  }
}

/**
 * Handle invoice paid event.
 */
async function handleInvoicePaid(event: WebhookEvent): Promise<void> {
  logger.info('Invoice paid', {
    organizationId: event.organization_id,
    provider: event.provider
  });

  // Could create invoice record here if needed
}

/**
 * Create webhook router for all payment providers.
 */
export function createWebhookRouter(): Router {
  const router = Router();

  // Stripe webhook
  router.post('/stripe', async (req: Request, res: Response) => {
    try {
      const provider = createStripeProvider();
      if (!provider) {
        res.status(500).json({ error: 'Stripe not configured' });
        return;
      }

      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({ error: 'Missing signature' });
        return;
      }

      const event = provider.parseWebhookEvent(req.body, signature);
      await processWebhookEvent(event);

      res.json({ received: true });
    } catch (error) {
      logger.error('Stripe webhook error', { error });
      res.status(400).json({ error: 'Webhook error' });
    }
  });

  // Razorpay webhook
  router.post('/razorpay', async (req: Request, res: Response) => {
    try {
      const provider = createRazorpayProvider();
      if (!provider) {
        res.status(500).json({ error: 'Razorpay not configured' });
        return;
      }

      const signature = req.headers['x-razorpay-signature'] as string;
      const payload = JSON.stringify(req.body);

      if (!provider.verifyWebhookSignature(payload, signature)) {
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }

      const event = provider.parseWebhookEvent(payload, signature);
      await processWebhookEvent(event);

      res.json({ received: true });
    } catch (error) {
      logger.error('Razorpay webhook error', { error });
      res.status(400).json({ error: 'Webhook error' });
    }
  });

  // Cashfree webhook
  router.post('/cashfree', async (req: Request, res: Response) => {
    try {
      const provider = createCashfreeProvider();
      if (!provider) {
        res.status(500).json({ error: 'Cashfree not configured' });
        return;
      }

      const signature = req.headers['x-cashfree-signature'] as string;
      const payload = JSON.stringify(req.body);

      if (signature && !provider.verifyWebhookSignature(payload, signature)) {
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }

      const event = provider.parseWebhookEvent(payload, signature || '');
      await processWebhookEvent(event);

      res.json({ received: true });
    } catch (error) {
      logger.error('Cashfree webhook error', { error });
      res.status(400).json({ error: 'Webhook error' });
    }
  });

  return router;
}

export default createWebhookRouter;
