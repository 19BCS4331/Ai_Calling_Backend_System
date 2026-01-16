export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          phone: string | null;
          timezone: string;
          locale: string;
          email_verified: boolean;
          last_sign_in_at: string | null;
          metadata: Record<string, any>;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          owner_id: string;
          billing_email: string | null;
          stripe_customer_id: string | null;
          razorpay_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member' | 'viewer';
          created_at: string;
        };
      };
      plans: {
        Row: {
          id: string;
          name: string;
          tier: 'free' | 'starter' | 'growth' | 'scale' | 'enterprise';
          price_monthly_cents: number;
          price_yearly_cents: number;
          included_minutes: number;
          max_concurrent_calls: number;
          overage_rate_cents: number;
          features: Record<string, any>;
          created_at: string;
          updated_at: string;
        };
      };
      subscriptions: {
        Row: {
          id: string;
          organization_id: string;
          plan_id: string;
          status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | 'incomplete';
          current_period_start: string;
          current_period_end: string;
          billing_cycle: 'monthly' | 'yearly';
          cancel_at_period_end: boolean;
          stripe_subscription_id: string | null;
          razorpay_subscription_id: string | null;
          custom_price_cents: number | null;
          custom_included_minutes: number | null;
          custom_overage_rate_cents: number | null;
          created_at: string;
          updated_at: string;
        };
      };
      agents: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          description: string | null;
          status: 'draft' | 'active' | 'paused' | 'archived';
          system_prompt: string | null;
          stt_provider: string;
          stt_config: Record<string, any>;
          tts_provider: string;
          tts_config: Record<string, any>;
          llm_provider: string;
          llm_config: Record<string, any>;
          voice_id: string | null;
          language: string;
          first_message: string | null;
          end_call_phrases: string[];
          interruption_sensitivity: number;
          silence_timeout_ms: number;
          max_call_duration_seconds: number;
          tools_config: Record<string, any>[];
          version: number;
          published_version: number | null;
          metadata: Record<string, any>;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: Omit<Database['public']['Tables']['agents']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['agents']['Insert']>;
      };
      calls: {
        Row: {
          id: string;
          organization_id: string;
          agent_id: string | null;
          phone_number_id: string | null;
          direction: 'inbound' | 'outbound' | 'web';
          status: 'queued' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'busy' | 'no_answer' | 'canceled';
          from_number: string | null;
          to_number: string | null;
          duration_seconds: number | null;
          recording_url: string | null;
          cost_telephony_cents: number;
          cost_stt_cents: number;
          cost_tts_cents: number;
          cost_llm_cents: number;
          metadata: Record<string, any>;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      usage_daily_summary: {
        Row: {
          id: string;
          organization_id: string;
          date: string;
          total_calls: number;
          total_minutes: number;
          total_cost_cents: number;
          successful_calls: number;
          failed_calls: number;
          created_at: string;
        };
      };
    };
    Views: {
      v_organization_current_usage: {
        Row: {
          organization_id: string;
          period_start: string;
          period_end: string;
          total_minutes: number;
          total_calls: number;
          total_cost_cents: number;
        };
      };
    };
  };
}

// Agent Types
export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface Agent {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: AgentStatus;
  system_prompt: string | null;
  stt_provider: string;
  stt_config: Record<string, any>;
  tts_provider: string;
  tts_config: Record<string, any>;
  llm_provider: string;
  llm_config: Record<string, any>;
  voice_id: string | null;
  language: string;
  first_message: string | null;
  end_call_phrases: string[];
  interruption_sensitivity: number;
  silence_timeout_ms: number;
  max_call_duration_seconds: number;
  tools_config: Record<string, any>[];
  version: number;
  published_version: number | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CreateAgentRequest {
  name: string;
  slug?: string;
  description?: string;
  system_prompt?: string;
  stt_provider?: string;
  stt_config?: Record<string, any>;
  tts_provider?: string;
  tts_config?: Record<string, any>;
  llm_provider?: string;
  llm_config?: Record<string, any>;
  voice_id?: string;
  language?: string;
  first_message?: string;
  end_call_phrases?: string[];
  interruption_sensitivity?: number;
  silence_timeout_ms?: number;
  max_call_duration_seconds?: number;
  tools_config?: Record<string, any>[];
}

export interface UpdateAgentRequest extends Partial<CreateAgentRequest> {
  status?: AgentStatus;
}

export interface AgentStats {
  total_calls: number;
  total_minutes: number;
  avg_duration_seconds: number;
  avg_latency_ms: number | null;
}

export interface AgentVersion {
  id: string;
  agent_id: string;
  version: number;
  config_snapshot: Record<string, any>;
  change_summary: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
}
