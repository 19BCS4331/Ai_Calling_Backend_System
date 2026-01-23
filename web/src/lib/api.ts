const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const SAAS_API_URL = import.meta.env.VITE_SAAS_API_URL || 'http://localhost:3001';

export interface ApiError {
  error: string;
  status: number;
}

// SaaS API Types
export interface Plan {
  id: string;
  slug: string;
  name: string;
  tier: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  included_minutes: number;
  max_concurrent_calls: number;
  max_agents: number;
  max_phone_numbers: number;
  overage_rate_cents: number;
  features: string[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan_id: string;
  billing_email?: string;
  created_at: string;
}

export interface UsageSummary {
  current_period: {
    start_date: string;
    end_date: string;
  };
  minutes_used: number;
  minutes_included: number;
  minutes_remaining: number;
  overage_minutes: number;
  estimated_overage_cost_cents: number;
  active_calls: number;
  max_concurrent_calls: number;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  system_prompt?: string;
  created_at: string;
}

export interface Call {
  id: string;
  agent_id: string;
  direction: 'inbound' | 'outbound' | 'web';
  status: string;
  from_number?: string;
  to_number?: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  cost_total_cents?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw { error: error.error || 'Request failed', status: response.status } as ApiError;
  }
  return response.json();
}

export const api = {
  async get<T>(endpoint: string, apiKey?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers });
    return handleResponse<T>(response);
  },

  async post<T>(endpoint: string, data?: unknown, apiKey?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(endpoint: string, apiKey?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers,
    });
    return handleResponse<T>(response);
  },
};

export const endpoints = {
  health: '/health',
  metrics: '/metrics',
  sessions: '/api/v1/sessions',
  session: (id: string) => `/api/v1/sessions/${id}`,
  tools: '/api/v1/tools',
  mcpClients: '/api/v1/mcp/clients',
  mcpClient: (name: string) => `/api/v1/mcp/clients/${name}`,
  telephonyCall: '/api/v1/telephony/call',
};

// SaaS API client
export const saasApi = {
  async get<T>(endpoint: string, token?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(`${SAAS_API_URL}${endpoint}`, { headers });
    return handleResponse<T>(response);
  },

  async post<T>(endpoint: string, data?: unknown, token?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(`${SAAS_API_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async put<T>(endpoint: string, data?: unknown, token?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(`${SAAS_API_URL}${endpoint}`, {
      method: 'PUT',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(endpoint: string, token?: string): Promise<T> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(`${SAAS_API_URL}${endpoint}`, {
      method: 'DELETE',
      headers,
    });
    return handleResponse<T>(response);
  },
};

// SaaS API endpoints
export const saasEndpoints = {
  // Public
  health: '/health',
  plans: '/api/v1/plans',
  
  // Auth
  authMe: '/api/v1/auth/me',
  
  // Organizations
  orgs: '/api/v1/orgs',
  org: (orgId: string) => `/api/v1/orgs/${orgId}`,
  
  // Agents
  agents: (orgId: string) => `/api/v1/orgs/${orgId}/agents`,
  agent: (orgId: string, agentId: string) => `/api/v1/orgs/${orgId}/agents/${agentId}`,
  
  // Calls
  calls: (orgId: string) => `/api/v1/orgs/${orgId}/calls`,
  call: (orgId: string, callId: string) => `/api/v1/orgs/${orgId}/calls/${callId}`,
  startSession: (orgId: string) => `/api/v1/orgs/${orgId}/calls/start-session`,
  endSession: (orgId: string, callId: string) => `/api/v1/orgs/${orgId}/calls/${callId}/end-session`,
  
  // Usage
  usage: (orgId: string) => `/api/v1/orgs/${orgId}/usage`,
  usageHistory: (orgId: string) => `/api/v1/orgs/${orgId}/usage/history`,
  
  // Billing
  subscription: (orgId: string) => `/api/v1/orgs/${orgId}/subscription`,
  
  // Payments
  checkout: (orgId: string) => `/api/v1/orgs/${orgId}/payments/checkout`,
  portal: (orgId: string) => `/api/v1/orgs/${orgId}/payments/portal`,
  
  // Telephony
  telephonyStatus: (orgId: string) => `/api/v1/orgs/${orgId}/telephony/plivo/status`,
  telephonyConnect: (orgId: string) => `/api/v1/orgs/${orgId}/telephony/plivo/connect`,
  telephonyDisconnect: (orgId: string) => `/api/v1/orgs/${orgId}/telephony/plivo/disconnect`,
  
  // Phone Numbers
  phoneNumbers: (orgId: string) => `/api/v1/orgs/${orgId}/phone-numbers`,
  phoneNumbersSync: (orgId: string) => `/api/v1/orgs/${orgId}/phone-numbers/sync`,
  phoneNumberLink: (orgId: string, numberId: string) => `/api/v1/orgs/${orgId}/phone-numbers/${numberId}/link`,
};
