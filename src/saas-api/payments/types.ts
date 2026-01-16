/**
 * Payment Types
 * 
 * Shared types for payment gateway integrations.
 */

export type PaymentProvider = 'stripe' | 'razorpay' | 'cashfree';

export type PaymentStatus = 
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'refunded';

export type WebhookEventType =
  // Subscription events
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.renewed'
  // Payment events
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  // Invoice events
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed';

/**
 * Unified checkout session request.
 */
export interface CreateCheckoutRequest {
  organization_id: string;
  plan_id: string;
  billing_interval: 'monthly' | 'yearly';
  success_url: string;
  cancel_url: string;
  customer_email?: string;
  metadata?: Record<string, string>;
}

/**
 * Unified checkout session response.
 */
export interface CheckoutSession {
  id: string;
  provider: PaymentProvider;
  url: string;
  expires_at: Date;
}

/**
 * Unified subscription object.
 */
export interface PaymentSubscription {
  id: string;
  provider: PaymentProvider;
  provider_subscription_id: string;
  provider_customer_id: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  plan_id: string;
  billing_interval: 'monthly' | 'yearly';
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
}

/**
 * Unified payment/invoice object.
 */
export interface Payment {
  id: string;
  provider: PaymentProvider;
  provider_payment_id: string;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  description: string | null;
  invoice_url: string | null;
  paid_at: Date | null;
  metadata: Record<string, unknown>;
}

/**
 * Webhook event payload (normalized).
 */
export interface WebhookEvent {
  id: string;
  provider: PaymentProvider;
  type: WebhookEventType;
  organization_id: string | null;
  subscription_id: string | null;
  data: Record<string, unknown>;
  raw_event: unknown;
  received_at: Date;
}

/**
 * Customer portal session.
 */
export interface PortalSession {
  url: string;
  expires_at: Date;
}

/**
 * Payment provider interface.
 * All providers must implement this interface.
 */
export interface PaymentProviderInterface {
  readonly provider: PaymentProvider;
  
  // Checkout
  createCheckoutSession(request: CreateCheckoutRequest): Promise<CheckoutSession>;
  
  // Subscriptions
  getSubscription(subscriptionId: string): Promise<PaymentSubscription | null>;
  cancelSubscription(subscriptionId: string, immediately?: boolean): Promise<void>;
  resumeSubscription(subscriptionId: string): Promise<void>;
  
  // Customer portal
  createPortalSession(customerId: string, returnUrl: string): Promise<PortalSession>;
  
  // Webhooks
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
  parseWebhookEvent(payload: string | Buffer, signature: string): WebhookEvent;
}

/**
 * Payment configuration.
 */
export interface PaymentConfig {
  stripe?: {
    secretKey: string;
    publishableKey: string;
    webhookSecret: string;
  };
  razorpay?: {
    keyId: string;
    keySecret: string;
    webhookSecret?: string;
  };
  cashfree?: {
    appId: string;
    secretKey: string;
    apiVersion: string;
    environment: 'TEST' | 'PRODUCTION';
  };
}

/**
 * Load payment configuration from environment.
 */
export function loadPaymentConfig(): PaymentConfig {
  const config: PaymentConfig = {};

  // Stripe
  if (process.env.STRIPE_SECRET_KEY) {
    config.stripe = {
      secretKey: process.env.STRIPE_SECRET_KEY,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
    };
  }

  // Razorpay
  if (process.env.RAZORPAY_KEY_ID) {
    config.razorpay = {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET || '',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET
    };
  }

  // Cashfree
  if (process.env.CASHFREE_APP_ID) {
    config.cashfree = {
      appId: process.env.CASHFREE_APP_ID,
      secretKey: process.env.CASHFREE_SECRET_KEY || '',
      apiVersion: process.env.CASHFREE_API_VERSION || '2023-08-01',
      environment: (process.env.CASHFREE_ENV as 'TEST' | 'PRODUCTION') || 'TEST'
    };
  }

  return config;
}
