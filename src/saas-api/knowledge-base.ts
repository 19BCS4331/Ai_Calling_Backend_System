/**
 * Knowledge Base Module
 * 
 * CRUD operations for knowledge bases, sources, and chunks.
 * Handles document ingestion pipeline: upload → parse → chunk → embed → store.
 * 
 * Source types:
 * - document: PDF, DOCX, TXT, CSV uploaded to Supabase Storage
 * - url: Website URL to scrape
 * - text: Plain text pasted by user
 */

import { supabaseAdmin } from './db';
import { OrgContext } from './types';
import { embedDocuments, embedQuery, getEmbeddingConfig } from '../services/embedding-service';
import { chunkText, estimateTokens } from '../services/chunking-service';
import { createLogger } from '../utils/logger';

const logger = createLogger('knowledge-base');

// =============================================
// Types
// =============================================

export interface KnowledgeBase {
  id: string;
  organization_id: string;
  agent_id: string | null;
  name: string;
  description: string | null;
  status: 'processing' | 'ready' | 'error';
  embedding_model: string;
  embedding_dimensions: number;
  chunk_count: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface KBSource {
  id: string;
  knowledge_base_id: string;
  source_type: 'document' | 'url' | 'text';
  name: string;
  url: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  content_hash: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error_message: string | null;
  chunk_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KBChunk {
  id: string;
  knowledge_base_id: string;
  source_id: string;
  content: string;
  chunk_index: number;
  token_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SearchResult {
  chunk_id: string;
  content: string;
  similarity: number;
  source_name: string;
  source_type: string;
  metadata: Record<string, unknown>;
}

export interface CreateKBRequest {
  name: string;
  description?: string;
  agent_id?: string;
}

export interface AddTextSourceRequest {
  name: string;
  content: string;
}

export interface AddURLSourceRequest {
  name: string;
  url: string;
}

// =============================================
// Knowledge Base CRUD
// =============================================

export async function createKnowledgeBase(
  ctx: OrgContext,
  data: CreateKBRequest
): Promise<KnowledgeBase> {
  const config = getEmbeddingConfig();

  const { data: kb, error } = await supabaseAdmin
    .from('knowledge_bases')
    .insert({
      organization_id: ctx.organization.id,
      agent_id: data.agent_id || null,
      name: data.name,
      description: data.description || null,
      embedding_model: config.model,
      embedding_dimensions: config.dimensions,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create knowledge base: ${error.message}`);

  logger.info('Knowledge base created', { id: kb.id, name: kb.name, orgId: ctx.organization.id });
  return kb as KnowledgeBase;
}

export async function getKnowledgeBase(
  ctx: OrgContext,
  kbId: string
): Promise<KnowledgeBase | null> {
  const { data, error } = await supabaseAdmin
    .from('knowledge_bases')
    .select()
    .eq('id', kbId)
    .eq('organization_id', ctx.organization.id)
    .single();

  if (error) return null;
  return data as KnowledgeBase;
}

export async function listKnowledgeBases(
  ctx: OrgContext,
  agentId?: string
): Promise<KnowledgeBase[]> {
  let query = supabaseAdmin
    .from('knowledge_bases')
    .select()
    .eq('organization_id', ctx.organization.id)
    .order('created_at', { ascending: false });

  if (agentId) {
    query = query.eq('agent_id', agentId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list knowledge bases: ${error.message}`);
  return (data || []) as KnowledgeBase[];
}

export async function updateKnowledgeBase(
  ctx: OrgContext,
  kbId: string,
  updates: { name?: string; description?: string; agent_id?: string | null }
): Promise<KnowledgeBase> {
  const { data, error } = await supabaseAdmin
    .from('knowledge_bases')
    .update(updates)
    .eq('id', kbId)
    .eq('organization_id', ctx.organization.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update knowledge base: ${error.message}`);
  return data as KnowledgeBase;
}

export async function deleteKnowledgeBase(
  ctx: OrgContext,
  kbId: string
): Promise<void> {
  // Delete associated files from storage
  const { data: sources } = await supabaseAdmin
    .from('kb_sources')
    .select('file_path')
    .eq('knowledge_base_id', kbId);

  if (sources) {
    const filePaths = sources
      .map(s => s.file_path)
      .filter((p): p is string => !!p);

    if (filePaths.length > 0) {
      await supabaseAdmin.storage
        .from('kb-documents')
        .remove(filePaths);
    }
  }

  // CASCADE will delete sources and chunks
  const { error } = await supabaseAdmin
    .from('knowledge_bases')
    .delete()
    .eq('id', kbId)
    .eq('organization_id', ctx.organization.id);

  if (error) throw new Error(`Failed to delete knowledge base: ${error.message}`);
  logger.info('Knowledge base deleted', { id: kbId });
}

// =============================================
// Source Management
// =============================================

export async function listSources(kbId: string): Promise<KBSource[]> {
  const { data, error } = await supabaseAdmin
    .from('kb_sources')
    .select()
    .eq('knowledge_base_id', kbId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list sources: ${error.message}`);
  return (data || []) as KBSource[];
}

export async function deleteSource(kbId: string, sourceId: string): Promise<void> {
  // Get file path before delete
  const { data: source } = await supabaseAdmin
    .from('kb_sources')
    .select('file_path, chunk_count')
    .eq('id', sourceId)
    .eq('knowledge_base_id', kbId)
    .single();

  if (source?.file_path) {
    await supabaseAdmin.storage
      .from('kb-documents')
      .remove([source.file_path]);
  }

  // CASCADE will delete chunks
  const { error } = await supabaseAdmin
    .from('kb_sources')
    .delete()
    .eq('id', sourceId)
    .eq('knowledge_base_id', kbId);

  if (error) throw new Error(`Failed to delete source: ${error.message}`);

  // Update KB chunk count
  await recalculateKBStats(kbId);
  logger.info('Source deleted', { sourceId, kbId });
}

// =============================================
// Ingestion: Text Source
// =============================================

export async function addTextSource(
  kbId: string,
  data: AddTextSourceRequest
): Promise<KBSource> {
  // Create source record
  const { data: source, error: sourceError } = await supabaseAdmin
    .from('kb_sources')
    .insert({
      knowledge_base_id: kbId,
      source_type: 'text',
      name: data.name,
      status: 'processing',
    })
    .select()
    .single();

  if (sourceError) throw new Error(`Failed to create source: ${sourceError.message}`);

  // Process in background
  processTextSource(kbId, source.id, data.content).catch(async (err) => {
    logger.error('Text source processing failed (uncaught)', { sourceId: source.id, error: err.message });
    await updateSourceStatus(source.id, 'error', err.message || 'Unknown error during text processing');
  });

  return source as KBSource;
}

async function processTextSource(kbId: string, sourceId: string, content: string): Promise<void> {
  try {
    // Chunk the text
    const chunks = chunkText(content);
    
    if (chunks.length === 0) {
      await updateSourceStatus(sourceId, 'error', 'No content to process');
      return;
    }

    logger.info('Chunking complete', { sourceId, chunkCount: chunks.length });

    // Generate embeddings
    const texts = chunks.map(c => c.content);
    const embeddings = await embedDocuments(texts);

    // Store chunks with embeddings
    const chunkRows = chunks.map((chunk, i) => ({
      knowledge_base_id: kbId,
      source_id: sourceId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.index,
      token_count: chunk.metadata.tokenEstimate,
      metadata: chunk.metadata,
    }));

    // Insert in batches of 50
    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error } = await supabaseAdmin
        .from('kb_chunks')
        .insert(batch);
      
      if (error) throw new Error(`Failed to insert chunks: ${error.message}`);
    }

    // Update source status
    await supabaseAdmin
      .from('kb_sources')
      .update({ status: 'ready', chunk_count: chunks.length })
      .eq('id', sourceId);

    // Update KB stats
    await recalculateKBStats(kbId);

    logger.info('Text source processed', { sourceId, chunkCount: chunks.length });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await updateSourceStatus(sourceId, 'error', errMsg);
    logger.error('Text source processing failed', { sourceId, error: errMsg });
  }
}

// =============================================
// Ingestion: Document Upload
// =============================================

export async function addDocumentSource(
  kbId: string,
  orgId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<KBSource> {
  // Upload to Supabase Storage
  const storagePath = `${orgId}/${kbId}/${Date.now()}_${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('kb-documents')
    .upload(storagePath, fileBuffer, { contentType: mimeType });

  if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);

  // Create source record
  const { data: source, error: sourceError } = await supabaseAdmin
    .from('kb_sources')
    .insert({
      knowledge_base_id: kbId,
      source_type: 'document',
      name: fileName,
      file_path: storagePath,
      file_size_bytes: fileBuffer.length,
      status: 'processing',
    })
    .select()
    .single();

  if (sourceError) throw new Error(`Failed to create source: ${sourceError.message}`);

  // Process in background
  processDocumentSource(kbId, source.id, fileBuffer, mimeType, fileName).catch(async (err) => {
    logger.error('Document source processing failed (uncaught)', { sourceId: source.id, error: err.message });
    await updateSourceStatus(source.id, 'error', err.message || 'Unknown error during document processing');
  });

  return source as KBSource;
}

async function processDocumentSource(
  kbId: string,
  sourceId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<void> {
  try {
    // Extract text from document
    const text = await extractText(fileBuffer, mimeType, fileName);
    
    if (!text || text.trim().length === 0) {
      await updateSourceStatus(sourceId, 'error', 'No text content could be extracted');
      return;
    }

    logger.info('Text extracted from document', { sourceId, textLength: text.length });

    // Chunk → embed → store (same as text source)
    const chunks = chunkText(text);
    
    if (chunks.length === 0) {
      await updateSourceStatus(sourceId, 'error', 'No chunks generated');
      return;
    }

    const texts = chunks.map(c => c.content);
    const embeddings = await embedDocuments(texts);

    const chunkRows = chunks.map((chunk, i) => ({
      knowledge_base_id: kbId,
      source_id: sourceId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.index,
      token_count: chunk.metadata.tokenEstimate,
      metadata: chunk.metadata,
    }));

    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error } = await supabaseAdmin.from('kb_chunks').insert(batch);
      if (error) throw new Error(`Failed to insert chunks: ${error.message}`);
    }

    await supabaseAdmin
      .from('kb_sources')
      .update({ status: 'ready', chunk_count: chunks.length })
      .eq('id', sourceId);

    await recalculateKBStats(kbId);
    logger.info('Document source processed', { sourceId, fileName, chunkCount: chunks.length });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await updateSourceStatus(sourceId, 'error', errMsg);
    logger.error('Document processing failed', { sourceId, error: errMsg });
  }
}

/**
 * Extract text from various document formats.
 */
async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // Plain text formats
  if (mimeType === 'text/plain' || ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'tsv') {
    return buffer.toString('utf-8');
  }

  // JSON
  if (mimeType === 'application/json' || ext === 'json') {
    try {
      const obj = JSON.parse(buffer.toString('utf-8'));
      return JSON.stringify(obj, null, 2);
    } catch {
      return buffer.toString('utf-8');
    }
  }

  // PDF
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    try {
      // @ts-ignore - optional dependency, installed at runtime
      const pdfParse = (await import('pdf-parse')) as any;
      const parseFn = pdfParse.default || pdfParse;
      const result = await parseFn(buffer);
      return result.text;
    } catch (error) {
      throw new Error(`PDF parsing failed: ${(error as Error).message}. Install pdf-parse: npm install pdf-parse`);
    }
  }

  // DOCX
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
    try {
      // @ts-ignore - optional dependency, installed at runtime
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      throw new Error(`DOCX parsing failed: ${(error as Error).message}. Install mammoth: npm install mammoth`);
    }
  }

  throw new Error(`Unsupported file type: ${mimeType} (${ext})`);
}

// =============================================
// Ingestion: URL Source
// =============================================

export async function addURLSource(
  kbId: string,
  data: AddURLSourceRequest
): Promise<KBSource> {
  // Create source record
  const { data: source, error: sourceError } = await supabaseAdmin
    .from('kb_sources')
    .insert({
      knowledge_base_id: kbId,
      source_type: 'url',
      name: data.name,
      url: data.url,
      status: 'processing',
    })
    .select()
    .single();

  if (sourceError) throw new Error(`Failed to create source: ${sourceError.message}`);

  // Process in background
  processURLSource(kbId, source.id, data.url).catch(async (err) => {
    logger.error('URL source processing failed (uncaught)', { sourceId: source.id, error: err.message });
    await updateSourceStatus(source.id, 'error', err.message || 'Unknown error during URL processing');
  });

  return source as KBSource;
}

async function processURLSource(kbId: string, sourceId: string, url: string): Promise<void> {
  try {
    let text = '';

    // Strategy 1: Use Jina Reader API (renders JS, returns clean text — works for SPAs)
    try {
      text = await fetchViaJinaReader(url);
      logger.info('Jina Reader succeeded', { sourceId, url, textLength: text.length });
    } catch (jinaErr) {
      logger.warn('Jina Reader failed, falling back to direct fetch', {
        sourceId, url, error: (jinaErr as Error).message
      });
    }

    // Strategy 2: Fallback to direct fetch + HTML stripping
    if (!text || text.trim().length < 50) {
      text = await fetchDirectAndStrip(url);
      logger.info('Direct fetch result', { sourceId, url, textLength: text.length });
    }

    if (!text || text.trim().length < 50) {
      await updateSourceStatus(sourceId, 'error', 'No meaningful content extracted from URL. The site may require JavaScript to render.');
      return;
    }

    // Chunk → embed → store
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await updateSourceStatus(sourceId, 'error', 'No chunks generated from URL content');
      return;
    }

    const texts = chunks.map(c => c.content);
    const embeddings = await embedDocuments(texts);

    const chunkRows = chunks.map((chunk, i) => ({
      knowledge_base_id: kbId,
      source_id: sourceId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.index,
      token_count: chunk.metadata.tokenEstimate,
      metadata: { ...chunk.metadata, url },
    }));

    for (let i = 0; i < chunkRows.length; i += 50) {
      const batch = chunkRows.slice(i, i + 50);
      const { error } = await supabaseAdmin.from('kb_chunks').insert(batch);
      if (error) throw new Error(`Failed to insert chunks: ${error.message}`);
    }

    await supabaseAdmin
      .from('kb_sources')
      .update({ status: 'ready', chunk_count: chunks.length })
      .eq('id', sourceId);

    await recalculateKBStats(kbId);
    logger.info('URL source processed', { sourceId, url, chunkCount: chunks.length });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await updateSourceStatus(sourceId, 'error', errMsg);
    logger.error('URL processing failed', { sourceId, error: errMsg });
  }
}

/**
 * Fetch URL content via Jina Reader API (free, no key required).
 * Renders JavaScript and returns clean markdown/text.
 * https://jina.ai/reader
 */
async function fetchViaJinaReader(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Jina Reader HTTP ${response.status}`);
    }

    return await response.text();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Direct fetch + HTML strip fallback for simple server-rendered pages.
 */
async function fetchDirectAndStrip(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();

    if (contentType.includes('text/html') || body.trim().startsWith('<')) {
      return stripHTML(body);
    }
    return body;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Strip HTML tags and extract readable text.
 */
function stripHTML(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

// =============================================
// Search / Retrieval
// =============================================

/**
 * Search knowledge base chunks by semantic similarity.
 * This is the function called by the voice pipeline's tool handler.
 */
export async function searchKnowledgeBase(
  knowledgeBaseIds: string[],
  query: string,
  matchCount: number = 5,
  matchThreshold: number = 0.3
): Promise<SearchResult[]> {
  if (knowledgeBaseIds.length === 0) return [];

  // Generate query embedding
  const queryEmbedding = await embedQuery(query);

  logger.info('KB search: generating embedding and querying', {
    query,
    embeddingLength: queryEmbedding.length,
    kbIds: knowledgeBaseIds,
    matchCount,
    matchThreshold,
  });

  // Call the Postgres function
  const { data, error } = await supabaseAdmin.rpc('search_kb_chunks', {
    p_knowledge_base_ids: knowledgeBaseIds,
    p_query_embedding: queryEmbedding,
    p_match_count: matchCount,
    p_match_threshold: matchThreshold,
  });

  if (error) {
    logger.error('Knowledge base search failed', { error: error.message });
    throw new Error(`Search failed: ${error.message}`);
  }

  logger.info('KB search: raw results', {
    query,
    resultCount: data?.length || 0,
    results: (data || []).slice(0, 3).map((r: any) => ({
      similarity: r.similarity,
      source: r.source_name,
      contentPreview: r.content?.substring(0, 80),
    })),
  });

  return (data || []).map((row: any) => ({
    chunk_id: row.chunk_id,
    content: row.content,
    similarity: row.similarity,
    source_name: row.source_name,
    source_type: row.source_type,
    metadata: row.metadata,
  }));
}

/**
 * Get knowledge base IDs linked to an agent.
 */
export async function getAgentKnowledgeBaseIds(agentId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('knowledge_bases')
    .select('id')
    .eq('agent_id', agentId)
    .eq('status', 'ready');

  if (error || !data) return [];
  return data.map(kb => kb.id);
}

// =============================================
// Helpers
// =============================================

async function updateSourceStatus(
  sourceId: string,
  status: 'pending' | 'processing' | 'ready' | 'error',
  errorMessage?: string
): Promise<void> {
  await supabaseAdmin
    .from('kb_sources')
    .update({
      status,
      error_message: errorMessage || null,
    })
    .eq('id', sourceId);
}

async function recalculateKBStats(kbId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('kb_chunks')
    .select('token_count')
    .eq('knowledge_base_id', kbId);

  const chunkCount = data?.length || 0;
  const totalTokens = data?.reduce((sum, c) => sum + (c.token_count || 0), 0) || 0;

  await supabaseAdmin
    .from('knowledge_bases')
    .update({
      chunk_count: chunkCount,
      total_tokens: totalTokens,
      status: chunkCount > 0 ? 'ready' : 'processing',
    })
    .eq('id', kbId);
}
