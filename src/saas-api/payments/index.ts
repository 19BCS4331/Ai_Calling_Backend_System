/**
 * Payments Module
 * 
 * Unified payment gateway integration for Stripe, Razorpay, and Cashfree.
 */

// Types
export * from './types';

// Providers
export { StripeProvider, createStripeProvider } from './stripe';
export { RazorpayProvider, createRazorpayProvider } from './razorpay';
export { CashfreeProvider, createCashfreeProvider } from './cashfree';

// Webhook Handler
export { createWebhookRouter } from './webhook-handler';

// ===========================================
// Payment Manager
// ===========================================

import {
  PaymentProvider,
  PaymentProviderInterface,
  CreateCheckoutRequest,
  CheckoutSession,
  PaymentSubscription,
  PortalSession,
  loadPaymentConfig
} from './types';
import { createStripeProvider } from './stripe';
import { createRazorpayProvider } from './razorpay';
import { createCashfreeProvider } from './cashfree';
import { createLogger } from '../../utils/logger';

const logger = createLogger('payments');

/**
 * Payment Manager
 * 
 * Provides a unified interface to all payment providers.
 * Automatically selects the best provider based on configuration and region.
 */
export class PaymentManager {
  private providers: Map<PaymentProvider, PaymentProviderInterface> = new Map();
  private defaultProvider: PaymentProvider | null = null;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const config = loadPaymentConfig();

    // Initialize Stripe
    if (config.stripe?.secretKey) {
      const stripe = createStripeProvider();
      if (stripe) {
        this.providers.set('stripe', stripe);
        this.defaultProvider = 'stripe';
        logger.info('Stripe provider initialized');
      }
    }

    // Initialize Razorpay
    if (config.razorpay?.keyId) {
      const razorpay = createRazorpayProvider();
      if (razorpay) {
        this.providers.set('razorpay', razorpay);
        // Prefer Razorpay as default for India
        if (!this.defaultProvider) {
          this.defaultProvider = 'razorpay';
        }
        logger.info('Razorpay provider initialized');
      }
    }

    // Initialize Cashfree
    if (config.cashfree?.appId) {
      const cashfree = createCashfreeProvider();
      if (cashfree) {
        this.providers.set('cashfree', cashfree);
        if (!this.defaultProvider) {
          this.defaultProvider = 'cashfree';
        }
        logger.info('Cashfree provider initialized');
      }
    }

    if (this.providers.size === 0) {
      logger.warn('No payment providers configured');
    } else {
      logger.info(`Payment manager initialized with ${this.providers.size} provider(s)`, {
        default: this.defaultProvider
      });
    }
  }

  /**
   * Get available providers.
   */
  getAvailableProviders(): PaymentProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get a specific provider.
   */
  getProvider(name: PaymentProvider): PaymentProviderInterface | null {
    return this.providers.get(name) || null;
  }

  /**
   * Get the default provider.
   */
  getDefaultProvider(): PaymentProviderInterface | null {
    if (!this.defaultProvider) return null;
    return this.providers.get(this.defaultProvider) || null;
  }

  /**
   * Select the best provider for a given currency/region.
   */
  selectProvider(currency: string = 'USD'): PaymentProviderInterface | null {
    // Use Razorpay or Cashfree for INR
    if (currency === 'INR') {
      if (this.providers.has('razorpay')) {
        return this.providers.get('razorpay')!;
      }
      if (this.providers.has('cashfree')) {
        return this.providers.get('cashfree')!;
      }
    }

    // Use Stripe for international
    if (this.providers.has('stripe')) {
      return this.providers.get('stripe')!;
    }

    // Fallback to default
    return this.getDefaultProvider();
  }

  /**
   * Create a checkout session using the best provider.
   */
  async createCheckout(
    request: CreateCheckoutRequest,
    preferredProvider?: PaymentProvider
  ): Promise<CheckoutSession> {
    let provider: PaymentProviderInterface | null = null;

    if (preferredProvider) {
      provider = this.providers.get(preferredProvider) || null;
    }

    if (!provider) {
      // Try to determine based on org currency
      provider = this.getDefaultProvider();
    }

    if (!provider) {
      throw new Error('No payment provider available');
    }

    return provider.createCheckoutSession(request);
  }

  /**
   * Get subscription from any provider.
   */
  async getSubscription(
    provider: PaymentProvider,
    subscriptionId: string
  ): Promise<PaymentSubscription | null> {
    const p = this.providers.get(provider);
    if (!p) return null;
    return p.getSubscription(subscriptionId);
  }

  /**
   * Cancel subscription.
   */
  async cancelSubscription(
    provider: PaymentProvider,
    subscriptionId: string,
    immediately = false
  ): Promise<void> {
    const p = this.providers.get(provider);
    if (!p) throw new Error(`Provider ${provider} not configured`);
    await p.cancelSubscription(subscriptionId, immediately);
  }

  /**
   * Create customer portal session.
   */
  async createPortalSession(
    provider: PaymentProvider,
    customerId: string,
    returnUrl: string
  ): Promise<PortalSession> {
    const p = this.providers.get(provider);
    if (!p) throw new Error(`Provider ${provider} not configured`);
    return p.createPortalSession(customerId, returnUrl);
  }
}

// Singleton instance
let paymentManager: PaymentManager | null = null;

/**
 * Get the global payment manager instance.
 */
export function getPaymentManager(): PaymentManager {
  if (!paymentManager) {
    paymentManager = new PaymentManager();
  }
  return paymentManager;
}
