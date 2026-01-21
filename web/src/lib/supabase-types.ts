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

// ============================================
// Tool Types
// ============================================

export type ToolType = 'function' | 'api_request' | 'mcp' | 'builtin';
export type ToolStatus = 'active' | 'inactive' | 'error';
export type McpTransport = 'sse' | 'stdio' | 'websocket';

// Authentication Types (shared between API Request and MCP)
export type AuthType = 'none' | 'bearer' | 'api_key' | 'basic' | 'oauth2' | 'hmac';

export interface BearerAuthConfig {
  token: string;
}

export interface ApiKeyAuthConfig {
  key: string;
  header_name: string;  // Default: X-API-Key
  location: 'header' | 'query';  // Default: header
}

export interface BasicAuthConfig {
  username: string;
  password: string;
}

export interface OAuth2AuthConfig {
  client_id: string;
  client_secret: string;
  token_url: string;
  scope?: string;
}

export interface HmacAuthConfig {
  secret_key: string;
  algorithm: 'sha256' | 'sha512';
  header_name: string;  // e.g., X-Signature
  timestamp_header?: string;  // e.g., X-Timestamp
}

export type AuthConfig = BearerAuthConfig | ApiKeyAuthConfig | BasicAuthConfig | OAuth2AuthConfig | HmacAuthConfig | Record<string, never>;

// Key-Value pair for headers
export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

// Body parameter types for visual builder
export type ParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface BodyParameter {
  id: string;
  key: string;
  type: ParameterType;
  description?: string;
  required: boolean;
  default_value?: any;
  enum_values?: string[];  // For string enums
  items_type?: ParameterType;  // For array items
  properties?: BodyParameter[];  // For nested objects
}

// Built-in tool types
export type BuiltinToolType = 
  | 'end_call' 
  | 'transfer_call' 
  | 'dial_keypad' 
  | 'hold_call' 
  | 'record_call' 
  | 'send_sms' 
  | 'get_call_info'
  | 'send_email'
  | 'schedule_callback';

export interface BuiltinConfigField {
  key: string;
  label: string;
  type: 'text' | 'phone' | 'url' | 'email' | 'boolean' | 'select' | 'number';
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  description?: string;
  default_value?: any;
}

export interface BuiltinToolDefinition {
  type: BuiltinToolType;
  name: string;
  description: string;
  icon: string;
  configFields: BuiltinConfigField[];
}

export interface ToolMessages {
  request_start?: string | null;
  request_complete?: string | null;
  request_failed?: string | null;
  request_delayed?: string | null;
}

export interface ToolRetryConfig {
  max_retries: number;
  retry_delay_ms: number;
}

export interface Tool {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  type: ToolType;
  status: ToolStatus;
  
  // API Request (formerly function) tool config
  function_server_url: string | null;
  function_method: string;
  function_timeout_ms: number;
  function_headers: Record<string, string>;
  function_parameters: Record<string, any>;
  function_auth_type: AuthType;
  function_auth_config: Record<string, any>;
  function_body_type: 'json' | 'form' | 'raw';
  
  // MCP tool config
  mcp_server_url: string | null;
  mcp_transport: McpTransport;
  mcp_timeout_ms: number;
  mcp_auth_type: AuthType;
  mcp_auth_config: Record<string, any>;
  mcp_settings: Record<string, any>;
  
  // Builtin tool config
  builtin_type: BuiltinToolType | null;
  builtin_config: Record<string, any>;
  builtin_custom_name: string | null;
  builtin_custom_description: string | null;
  
  // Messages
  messages: ToolMessages;
  
  // Advanced settings
  async_mode: boolean;
  retry_config: ToolRetryConfig;
  
  // Validation
  last_validated_at: string | null;
  validation_error: string | null;
  
  // Metadata
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CreateToolRequest {
  name: string;
  slug?: string;
  description?: string;
  type: ToolType;
  
  // API Request (formerly function) tool config
  function_server_url?: string;
  function_method?: string;
  function_timeout_ms?: number;
  function_headers?: Record<string, string>;
  function_parameters?: Record<string, any>;
  function_auth_type?: AuthType;
  function_auth_config?: Record<string, any>;
  function_body_type?: 'json' | 'form' | 'raw';
  
  // MCP tool config
  mcp_server_url?: string;
  mcp_transport?: McpTransport;
  mcp_timeout_ms?: number;
  mcp_auth_type?: AuthType;
  mcp_auth_config?: Record<string, any>;
  mcp_settings?: Record<string, any>;
  
  // Builtin tool config
  builtin_type?: BuiltinToolType;
  builtin_config?: Record<string, any>;
  builtin_custom_name?: string;
  builtin_custom_description?: string;
  
  // Messages
  messages?: ToolMessages;
  
  // Advanced settings
  async_mode?: boolean;
  retry_config?: ToolRetryConfig;
}

export interface UpdateToolRequest extends Partial<CreateToolRequest> {
  status?: ToolStatus;
}

export interface AgentTool {
  id: string;
  agent_id: string;
  tool_id: string;
  config_overrides: Record<string, any>;
  messages_overrides: ToolMessages;
  sort_order: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentToolWithDetails extends AgentTool {
  tool: Tool;
}

export interface CreateAgentToolRequest {
  agent_id: string;
  tool_id: string;
  config_overrides?: Record<string, any>;
  messages_overrides?: ToolMessages;
  sort_order?: number;
  is_enabled?: boolean;
}

export interface UpdateAgentToolRequest {
  config_overrides?: Record<string, any>;
  messages_overrides?: ToolMessages;
  sort_order?: number;
  is_enabled?: boolean;
}

export interface ToolExecution {
  id: string;
  organization_id: string;
  agent_id: string | null;
  tool_id: string | null;
  call_id: string | null;
  tool_name: string;
  tool_type: ToolType;
  input_parameters: Record<string, any> | null;
  output_result: Record<string, any> | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: 'pending' | 'success' | 'error' | 'timeout';
  error_message: string | null;
  metadata: Record<string, any>;
  created_at: string;
}
