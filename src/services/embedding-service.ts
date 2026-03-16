/**
 * Embedding Service
 * 
 * Generates text embeddings using Google Gemini's embedding model.
 * Used for knowledge base chunk embeddings and query embeddings for RAG retrieval.
 * 
 * Model: gemini-embedding-001
 * - Default 3072 dims, we use 768 for storage efficiency
 * - Supports task types: RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY
 * - Multilingual (Hindi, English, etc.)
 * - Free tier: 1500 requests/min
 */

import { GoogleGenAI } from '@google/genai';
import { createLogger } from '../utils/logger';

const logger = createLogger('embedding-service');

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;
const MAX_BATCH_SIZE = 100; // Gemini supports up to 100 texts per batch
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required for embeddings');
    }
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

/**
 * Generate an embedding for a single text (for queries).
 * Uses RETRIEVAL_QUERY task type for optimal search performance.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const client = getClient();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      });

      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
        throw new Error('Empty embedding returned from Gemini');
      }

      return values;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES && (errMsg.includes('429') || errMsg.includes('503') || errMsg.includes('RESOURCE_EXHAUSTED'))) {
        logger.warn('Embedding rate limited, retrying', { attempt, error: errMsg });
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Embedding failed after max retries');
}

/**
 * Generate embeddings for multiple texts (for document chunks).
 * Uses RETRIEVAL_DOCUMENT task type for optimal indexing.
 * Automatically batches if more than MAX_BATCH_SIZE texts.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getClient();
  const allEmbeddings: number[][] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch,
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBEDDING_DIMENSIONS,
          },
        });

        const embeddings = response.embeddings;
        if (!embeddings || embeddings.length !== batch.length) {
          throw new Error(`Expected ${batch.length} embeddings, got ${embeddings?.length || 0}`);
        }

        for (const emb of embeddings) {
          if (!emb.values || emb.values.length === 0) {
            throw new Error('Empty embedding in batch response');
          }
          allEmbeddings.push(emb.values);
        }

        logger.debug('Embedded batch', {
          batchIndex: Math.floor(i / MAX_BATCH_SIZE),
          batchSize: batch.length,
          dimensions: embeddings[0].values?.length,
        });

        break; // success
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (attempt < MAX_RETRIES && (errMsg.includes('429') || errMsg.includes('503') || errMsg.includes('RESOURCE_EXHAUSTED'))) {
          logger.warn('Embedding batch rate limited, retrying', { attempt, batchIndex: Math.floor(i / MAX_BATCH_SIZE), error: errMsg });
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw error;
      }
    }
  }

  return allEmbeddings;
}

/**
 * Get the embedding model name and dimensions (for storing in DB).
 */
export function getEmbeddingConfig() {
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
