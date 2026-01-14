const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface ApiError {
  error: string;
  status: number;
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
