/**
 * Structured Logger
 * Production-grade logging with Pino
 */

import pino from 'pino';
import { Logger, LogContext } from '../types';

export interface LoggerConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  pretty: boolean;
  redactPaths?: string[];
}

const defaultConfig: LoggerConfig = {
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  redactPaths: [
    'config.credentials.apiKey',
    'config.credentials.apiSecret',
    'sttConfig.credentials.apiKey',
    'llmConfig.credentials.apiKey',
    'ttsConfig.credentials.apiKey'
  ]
};

export function createLogger(
  name: string,
  config: Partial<LoggerConfig> = {}
): Logger {
  const mergedConfig = { ...defaultConfig, ...config };
  
  const transport = mergedConfig.pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    : undefined;

  const pinoLogger = pino({
    name,
    level: mergedConfig.level,
    transport,
    redact: {
      paths: mergedConfig.redactPaths || [],
      censor: '[REDACTED]'
    },
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        service: bindings.name,
        env: process.env.NODE_ENV || 'development'
      })
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });

  return wrapPinoLogger(pinoLogger);
}

function wrapPinoLogger(pinoLogger: pino.Logger): Logger {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (data) {
        pinoLogger.debug(data, msg);
      } else {
        pinoLogger.debug(msg);
      }
    },
    info: (msg: string, data?: Record<string, unknown>) => {
      if (data) {
        pinoLogger.info(data, msg);
      } else {
        pinoLogger.info(msg);
      }
    },
    warn: (msg: string, data?: Record<string, unknown>) => {
      if (data) {
        pinoLogger.warn(data, msg);
      } else {
        pinoLogger.warn(msg);
      }
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      if (data) {
        pinoLogger.error(data, msg);
      } else {
        pinoLogger.error(msg);
      }
    },
    child: (bindings: Record<string, unknown>) => {
      return wrapPinoLogger(pinoLogger.child(bindings));
    }
  };
}

/**
 * Metrics collector for observability
 */
export interface MetricsCollector {
  recordLatency(operation: string, latencyMs: number, labels?: Record<string, string>): void;
  recordCounter(name: string, value: number, labels?: Record<string, string>): void;
  recordGauge(name: string, value: number, labels?: Record<string, string>): void;
}

export class InMemoryMetrics implements MetricsCollector {
  private latencies: Map<string, number[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();

  recordLatency(operation: string, latencyMs: number, labels?: Record<string, string>): void {
    const key = this.buildKey(operation, labels);
    const existing = this.latencies.get(key) || [];
    existing.push(latencyMs);
    
    // Keep only last 1000 samples
    if (existing.length > 1000) {
      existing.shift();
    }
    
    this.latencies.set(key, existing);
  }

  recordCounter(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const existing = this.counters.get(key) || 0;
    this.counters.set(key, existing + value);
  }

  recordGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  getStats(): MetricsSnapshot {
    const latencyStats: Record<string, LatencyStats> = {};
    
    for (const [key, values] of this.latencies) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        latencyStats[key] = {
          count: values.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)]
        };
      }
    }

    return {
      latencies: latencyStats,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges)
    };
  }

  reset(): void {
    this.latencies.clear();
    this.counters.clear();
    this.gauges.clear();
  }

  private buildKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  latencies: Record<string, LatencyStats>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

/**
 * Cost tracker for per-call cost estimation
 */
export class CostTracker {
  private costs: Map<string, ProviderCost> = new Map();

  constructor() {
    this.initializeDefaultCosts();
  }

  private initializeDefaultCosts(): void {
    // Approximate costs per unit (prices may vary)
    this.costs.set('sarvam_stt', { 
      perMinute: 0.008, // INR per minute
      currency: 'INR' 
    });
    this.costs.set('sarvam_tts', { 
      perCharacter: 0.00004, // INR per character
      currency: 'INR' 
    });
    this.costs.set('reverie_tts', { 
      perCharacter: 0.00005, 
      currency: 'INR' 
    });
    this.costs.set('gemini_flash', { 
      perInputToken: 0.000075, // USD per 1K tokens
      perOutputToken: 0.0003,
      currency: 'USD' 
    });
    this.costs.set('google_stt', { 
      perMinute: 0.016, 
      currency: 'USD' 
    });
    this.costs.set('google_tts', { 
      perCharacter: 0.000004, 
      currency: 'USD' 
    });
  }

  estimateSTTCost(provider: string, durationSeconds: number): number {
    const cost = this.costs.get(`${provider}_stt`);
    if (!cost?.perMinute) return 0;
    return (durationSeconds / 60) * cost.perMinute;
  }

  estimateTTSCost(provider: string, characterCount: number): number {
    const cost = this.costs.get(`${provider}_tts`);
    if (!cost?.perCharacter) return 0;
    return characterCount * cost.perCharacter;
  }

  estimateLLMCost(
    provider: string, 
    inputTokens: number, 
    outputTokens: number
  ): number {
    const cost = this.costs.get(`${provider}_flash`) || this.costs.get(provider);
    if (!cost) return 0;
    
    let total = 0;
    if (cost.perInputToken) {
      total += (inputTokens / 1000) * cost.perInputToken;
    }
    if (cost.perOutputToken) {
      total += (outputTokens / 1000) * cost.perOutputToken;
    }
    return total;
  }

  setProviderCost(provider: string, cost: ProviderCost): void {
    this.costs.set(provider, cost);
  }
}

export interface ProviderCost {
  perMinute?: number;
  perCharacter?: number;
  perInputToken?: number;
  perOutputToken?: number;
  currency: string;
}

export default createLogger;
