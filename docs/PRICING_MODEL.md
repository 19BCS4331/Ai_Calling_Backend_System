# Pricing Model Documentation

## Overview

Our AI Voice Agent platform uses a **credit-based trial → PAYG → subscription** pricing model designed to maximize user acquisition while maintaining healthy margins.

---

## Pricing Tiers

### 1. Trial Plan (Free)
- **Price**: $0/month
- **Credit**: $5.00 (500 cents)
- **Duration**: 14 days or until credit exhausted
- **Rate**: $0.12/min effective
- **Features**:
  - 1 agent
  - 1 concurrent call
  - Basic analytics
  - ~41 minutes of testing
- **Auto-converts to**: PAYG when credit runs out

### 2. Pay-as-you-Go (PAYG)
- **Price**: $0/month (no commitment)
- **Rate**: $0.15/min
- **Features**:
  - 2 agents
  - 1 concurrent call
  - API access
  - Basic analytics
- **Best for**: Low-volume users, testing

### 3. Starter Plan
- **Price**: $49/month ($47/month if paid yearly)
- **Included**: 400 minutes
- **Effective Rate**: $0.1225/min
- **Overage**: $0.14/min
- **Features**:
  - 3 agents
  - 2 concurrent calls
  - Advanced analytics
  - API access
  - 14-day history
- **Best for**: Small teams

### 4. Growth Plan
- **Price**: $199/month ($191/month if paid yearly)
- **Included**: 2000 minutes
- **Effective Rate**: $0.10/min
- **Overage**: $0.12/min
- **Features**:
  - 10 agents
  - 5 concurrent calls
  - Advanced analytics
  - Webhooks
  - API access
  - 30-day history
- **Best for**: Growing businesses

### 5. Scale Plan
- **Price**: $499/month ($479/month if paid yearly)
- **Included**: 6000 minutes
- **Effective Rate**: $0.083/min
- **Overage**: $0.10/min
- **Features**:
  - Unlimited agents
  - 20 concurrent calls
  - Advanced analytics
  - Webhooks
  - API access
  - Voice cloning
  - Priority support
  - 90-day history
- **Best for**: High-volume operations

### 6. Enterprise Plan
- **Price**: Custom
- **Included**: Custom
- **Rate**: Negotiated (typically $0.08/min)
- **Features**:
  - Everything in Scale
  - Custom integrations
  - SLA guarantees
  - Dedicated support
  - 365-day history
- **Best for**: Large organizations

---

## Cost Structure

### Internal Costs (per minute)
| Component | Provider | Cost/min |
|-----------|----------|----------|
| STT | Sarvam | ~$0.005 |
| TTS | Cartesia | ~$0.015 |
| LLM | Gemini 2.5 Flash (with caching) | ~$0.006 |
| **Total** | | **~$0.026** |

### Margin Analysis (per 1000 minutes)
| Plan | Revenue | Cost | Margin | Margin % |
|------|---------|------|--------|----------|
| Trial | $120 | $26 | $94 | 78% |
| PAYG | $150 | $26 | $124 | 83% |
| Starter | $122.50 | $26 | $96.50 | 79% |
| Growth | $100 | $26 | $74 | 74% |
| Scale | $83 | $26 | $57 | 69% |
| Enterprise | $80 | $26 | $54 | 68% |

---

## Competitive Positioning

| Platform | Rate/min | Our Advantage |
|----------|----------|---------------|
| **VAPI** | $0.05 + providers (~$0.15) | Similar pricing, better India support |
| **Retell** | $0.17-0.22 | **20% cheaper** |
| **Bland AI** | $0.09-0.12 | Slightly higher, more features |
| **Ours (PAYG)** | **$0.15** | Competitive + Sarvam for Indian languages |

---

## Database Schema

### New Columns

#### `plans` table:
```sql
included_credit_cents INTEGER DEFAULT 0
is_credit_based BOOLEAN DEFAULT FALSE
```

#### `subscriptions` table:
```sql
credit_balance_cents INTEGER DEFAULT 0
credit_used_cents INTEGER DEFAULT 0
```

#### `calls` table:
```sql
cost_user_cents DECIMAL(10,4) DEFAULT 0  -- User-facing cost
llm_cached_tokens INTEGER DEFAULT 0       -- Cached tokens for transparency
```

### Views

#### `v_organization_billing`:
Provides billing summary including:
- Current plan details
- Credit balance (for trial users)
- Minutes used in current period
- Total charged in current period

---

## User Flow

### New User Journey

```
1. Sign up → Auto-assigned "Trial" plan
   ├─ Receives $5.00 credit (500 cents)
   └─ 14-day trial period starts

2. Make calls
   ├─ Each call deducts: ceil(duration_min) × $0.12
   └─ Credit balance decreases

3. Credit exhausted OR trial expires
   ├─ Auto-switch to "PAYG" plan
   ├─ Prompt for payment method
   └─ Future calls charged at $0.15/min

4. User can upgrade anytime
   └─ Choose Starter/Growth/Scale based on volume
```

### Credit Deduction Logic

```typescript
// For credit-based plans (trial)
const billedMinutes = Math.ceil(durationSeconds / 60);
const cost = billedMinutes × plan.overage_rate_cents;

// Deduct from balance
await supabase.rpc('deduct_credit', {
  p_subscription_id: subscription.id,
  p_amount_cents: cost
});

// If balance <= 0, auto-switch to PAYG
```

---

## Implementation Details

### Backend Changes

1. **`call-persistence.ts`**:
   - Added `calculateUserCost()` function
   - Stores both `cost_total_cents` (internal) and `cost_user_cents` (user-facing)
   - Automatically deducts from credit balance for trial users

2. **`calls.ts`**:
   - Updated `getCallStats()` to return `total_user_cost_cents`
   - Frontend now displays user costs, not internal costs

3. **Database Functions**:
   - `calculate_user_cost()`: Calculate cost based on plan rate
   - `deduct_credit()`: Deduct from subscription credit balance
   - `create_trial_subscription()`: Auto-create trial for new orgs

### Frontend Changes

1. **`Calls.tsx`**:
   - Displays `cost_user_cents` instead of `cost_total_cents`
   - Shows user-facing costs in stats

2. **`CreditBalance.tsx`** (new):
   - Shows remaining credit for trial users
   - Progress bar with usage visualization
   - Warning when balance is low (<$1)
   - Upgrade CTA

3. **`Overview.tsx`**:
   - Integrated `CreditBalance` component
   - Visible only for trial users

---

## Migrations

Run in order:

```bash
# 1. Disable cost trigger (prevents overwriting)
psql < supabase/migrations/008_disable_cost_trigger.sql

# 2. Add cached tokens column
psql < supabase/migrations/009_add_cached_tokens_column.sql

# 3. Add cache cost columns to providers
psql < supabase/migrations/010_add_cache_cost_columns.sql

# 4. Update pricing model
psql < supabase/migrations/011_update_pricing_model.sql

# 5. Initialize trial subscriptions
psql < supabase/migrations/012_initialize_trial_subscriptions.sql
```

---

## Testing

### Verify Pricing Calculations

```typescript
// Example: 49-second call on Trial plan
const durationSeconds = 49;
const billedMinutes = Math.ceil(49 / 60); // = 1 minute
const trialRate = 12; // cents per minute
const userCost = 1 × 12; // = 12 cents ($0.12)

// Internal cost (with caching)
const internalCost = 2.34; // cents (~$0.023)

// Margin
const margin = 12 - 2.34; // = 9.66 cents (80.5% margin)
```

### Test Credit Deduction

```sql
-- Check credit balance
SELECT credit_balance_cents, credit_used_cents 
FROM subscriptions 
WHERE organization_id = 'your-org-id';

-- After a 1-minute call on trial (should deduct 12 cents)
-- Balance: 500 → 488
-- Used: 0 → 12
```

---

## Monitoring

### Key Metrics to Track

1. **Trial Conversion Rate**: % of trial users who upgrade
2. **Average Trial Usage**: How much credit users consume
3. **PAYG → Subscription Conversion**: % who upgrade from PAYG
4. **Margin per Plan**: Ensure margins stay healthy
5. **Credit Exhaustion Time**: How long trial credit lasts

### Dashboard Queries

```sql
-- Trial users with low balance
SELECT o.name, s.credit_balance_cents
FROM organizations o
JOIN subscriptions s ON o.id = s.organization_id
JOIN plans p ON s.plan_id = p.id
WHERE p.slug = 'trial' AND s.credit_balance_cents < 100;

-- Revenue by plan (last 30 days)
SELECT p.name, SUM(c.cost_user_cents) / 100 as revenue_usd
FROM calls c
JOIN organizations o ON c.organization_id = o.id
JOIN subscriptions s ON o.id = s.organization_id
JOIN plans p ON s.plan_id = p.id
WHERE c.started_at >= NOW() - INTERVAL '30 days'
GROUP BY p.name;
```

---

## Future Enhancements

1. **Auto-upgrade suggestions**: Notify users when they'd save money on a subscription
2. **Usage alerts**: Email when 80% of credit/minutes consumed
3. **Annual billing discount**: Offer 20% off for annual plans
4. **Add-ons**: Premium voices, extra concurrency, extended history
5. **Referral credits**: Give $10 credit for successful referrals

---

## Support

For pricing questions or custom enterprise plans, contact: sales@yourcompany.com
