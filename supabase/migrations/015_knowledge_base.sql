-- =============================================================================
-- Knowledge Base Tables
-- Stores document sources, chunked content, and embeddings for RAG retrieval.
-- Embeddings stored as float8[] (native Postgres array) since pgvector is
-- unavailable in this Supabase region. Cosine similarity computed via SQL function.
-- =============================================================================

-- Knowledge bases (linked to an agent)
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'error')),
  embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-001',
  embedding_dimensions INTEGER NOT NULL DEFAULT 768,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source documents / URLs / text blocks
CREATE TABLE IF NOT EXISTS kb_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('document', 'url', 'text')),
  name TEXT NOT NULL,
  url TEXT,                          -- for website sources
  file_path TEXT,                    -- Supabase storage path
  file_size_bytes BIGINT,
  content_hash TEXT,                 -- for dedup / change detection
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),
  error_message TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chunked + embedded content
CREATE TABLE IF NOT EXISTS kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding float8[],                -- Gemini embedding as native Postgres array
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',  -- page number, section title, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_kb_org ON knowledge_bases(organization_id);
CREATE INDEX idx_kb_agent ON knowledge_bases(agent_id);
CREATE INDEX idx_kb_sources_kb ON kb_sources(knowledge_base_id);
CREATE INDEX idx_kb_chunks_kb ON kb_chunks(knowledge_base_id);
CREATE INDEX idx_kb_chunks_source ON kb_chunks(source_id);

-- =============================================================================
-- Cosine similarity function (no pgvector needed)
-- =============================================================================
CREATE OR REPLACE FUNCTION cosine_similarity(a float8[], b float8[])
RETURNS float8
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  dot float8 := 0;
  norm_a float8 := 0;
  norm_b float8 := 0;
  i integer;
BEGIN
  IF array_length(a, 1) IS DISTINCT FROM array_length(b, 1) THEN
    RETURN 0;
  END IF;
  FOR i IN 1..array_length(a, 1) LOOP
    dot    := dot    + a[i] * b[i];
    norm_a := norm_a + a[i] * a[i];
    norm_b := norm_b + b[i] * b[i];
  END LOOP;
  IF norm_a = 0 OR norm_b = 0 THEN RETURN 0; END IF;
  RETURN dot / (sqrt(norm_a) * sqrt(norm_b));
END;
$$;

-- =============================================================================
-- Search function: returns top-K chunks by cosine similarity
-- =============================================================================
CREATE OR REPLACE FUNCTION search_kb_chunks(
  p_knowledge_base_ids UUID[],
  p_query_embedding float8[],
  p_match_count INTEGER DEFAULT 5,
  p_match_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  chunk_id UUID,
  content TEXT,
  similarity FLOAT,
  source_name TEXT,
  source_type TEXT,
  metadata JSONB
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.content,
    cosine_similarity(c.embedding, p_query_embedding)::FLOAT AS similarity,
    s.name AS source_name,
    s.source_type,
    c.metadata
  FROM kb_chunks c
  JOIN kb_sources s ON s.id = c.source_id
  WHERE c.knowledge_base_id = ANY(p_knowledge_base_ids)
    AND c.embedding IS NOT NULL
    AND cosine_similarity(c.embedding, p_query_embedding) > p_match_threshold
  ORDER BY cosine_similarity(c.embedding, p_query_embedding) DESC
  LIMIT p_match_count;
END;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;

-- knowledge_bases: org members can read, owners/admins can write
CREATE POLICY kb_select ON knowledge_bases FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY kb_insert ON knowledge_bases FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY kb_update ON knowledge_bases FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY kb_delete ON knowledge_bases FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- kb_sources: inherit from parent knowledge_base
CREATE POLICY kbs_select ON kb_sources FOR SELECT
  USING (knowledge_base_id IN (SELECT id FROM knowledge_bases));

CREATE POLICY kbs_insert ON kb_sources FOR INSERT
  WITH CHECK (knowledge_base_id IN (SELECT id FROM knowledge_bases));

CREATE POLICY kbs_update ON kb_sources FOR UPDATE
  USING (knowledge_base_id IN (SELECT id FROM knowledge_bases));

CREATE POLICY kbs_delete ON kb_sources FOR DELETE
  USING (knowledge_base_id IN (SELECT id FROM knowledge_bases));

-- kb_chunks: inherit from parent knowledge_base
CREATE POLICY kbc_select ON kb_chunks FOR SELECT
  USING (knowledge_base_id IN (SELECT id FROM knowledge_bases));

CREATE POLICY kbc_insert ON kb_chunks FOR INSERT
  WITH CHECK (knowledge_base_id IN (SELECT id FROM knowledge_bases));

CREATE POLICY kbc_delete ON kb_chunks FOR DELETE
  USING (knowledge_base_id IN (SELECT id FROM knowledge_bases));

-- Service role bypass for server-side operations
CREATE POLICY kb_service_all ON knowledge_bases FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY kbs_service_all ON kb_sources FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY kbc_service_all ON kb_chunks FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_kb_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kb_updated_at
  BEFORE UPDATE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION update_kb_updated_at();

CREATE TRIGGER trg_kbs_updated_at
  BEFORE UPDATE ON kb_sources
  FOR EACH ROW EXECUTE FUNCTION update_kb_updated_at();

-- Create storage bucket for KB documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('kb-documents', 'kb-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: org members can upload, owners/admins can delete
CREATE POLICY kb_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'kb-documents');

CREATE POLICY kb_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'kb-documents');

CREATE POLICY kb_storage_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'kb-documents');
