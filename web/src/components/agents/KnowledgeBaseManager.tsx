import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Plus, Trash2, FileText, Globe, Type, Upload,
  Search, Loader2, CheckCircle2, AlertCircle, X, ChevronDown, ChevronUp
} from 'lucide-react';
import { saasApi, saasEndpoints } from '../../lib/api';
import { supabase } from '../../lib/supabase';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  status: 'processing' | 'ready' | 'error';
  chunk_count: number;
  total_tokens: number;
  embedding_model: string;
  created_at: string;
}

interface KBSource {
  id: string;
  source_type: 'document' | 'url' | 'text';
  name: string;
  url: string | null;
  file_path: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error_message: string | null;
  chunk_count: number;
  created_at: string;
}

interface Props {
  agentId?: string;
  orgId: string;
}

type AddSourceMode = 'text' | 'url' | 'document' | null;

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export function KnowledgeBaseManager({ agentId, orgId }: Props) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [sources, setSources] = useState<KBSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create KB form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKBName, setNewKBName] = useState('');
  const [newKBDescription, setNewKBDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Add source
  const [addSourceMode, setAddSourceMode] = useState<AddSourceMode>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [addingSource, setAddingSource] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const fetchKnowledgeBases = useCallback(async () => {
    const token = await getToken();
    if (!token || !orgId) return;
    try {
      setLoading(true);
      const url = agentId
        ? `${saasEndpoints.knowledgeBases(orgId)}?agent_id=${agentId}`
        : saasEndpoints.knowledgeBases(orgId);
      const res = await saasApi.get<{ knowledge_bases: KnowledgeBase[] }>(url, token);
      setKnowledgeBases(res.knowledge_bases || []);
      setError(null);
    } catch (err: any) {
      setError(err.error || 'Failed to load knowledge bases');
    } finally {
      setLoading(false);
    }
  }, [orgId, agentId]);

  useEffect(() => {
    fetchKnowledgeBases();
  }, [fetchKnowledgeBases]);

  const fetchSources = useCallback(async (kbId: string) => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await saasApi.get<{ sources: KBSource[] }>(
        saasEndpoints.kbSources(orgId, kbId), token
      );
      setSources(res.sources || []);
    } catch (err: any) {
      console.error('Failed to fetch sources:', err);
    }
  }, [orgId]);

  useEffect(() => {
    if (selectedKB) {
      fetchSources(selectedKB.id);
      const interval = setInterval(() => fetchSources(selectedKB.id), 5000);
      return () => clearInterval(interval);
    }
  }, [selectedKB, fetchSources]);

  const handleCreateKB = async () => {
    const token = await getToken();
    if (!token || !newKBName.trim()) return;
    setCreating(true);
    try {
      const res = await saasApi.post<{ knowledge_base: KnowledgeBase }>(
        saasEndpoints.knowledgeBases(orgId),
        { name: newKBName, description: newKBDescription || undefined, agent_id: agentId },
        token
      );
      setKnowledgeBases(prev => [res.knowledge_base, ...prev]);
      setSelectedKB(res.knowledge_base);
      setShowCreateForm(false);
      setNewKBName('');
      setNewKBDescription('');
    } catch (err: any) {
      setError(err.error || 'Failed to create knowledge base');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteKB = async (kbId: string) => {
    const token = await getToken();
    if (!token || !confirm('Delete this knowledge base and all its data?')) return;
    try {
      await saasApi.delete(saasEndpoints.knowledgeBase(orgId, kbId), token);
      setKnowledgeBases(prev => prev.filter(kb => kb.id !== kbId));
      if (selectedKB?.id === kbId) {
        setSelectedKB(null);
        setSources([]);
      }
    } catch (err: any) {
      setError(err.error || 'Failed to delete');
    }
  };

  const handleAddTextSource = async () => {
    const token = await getToken();
    if (!token || !selectedKB || !sourceName.trim() || !sourceContent.trim()) return;
    setAddingSource(true);
    try {
      await saasApi.post(
        saasEndpoints.kbAddText(orgId, selectedKB.id),
        { name: sourceName, content: sourceContent },
        token
      );
      resetSourceForm();
      fetchSources(selectedKB.id);
    } catch (err: any) {
      setError(err.error || 'Failed to add text');
    } finally {
      setAddingSource(false);
    }
  };

  const handleAddUrlSource = async () => {
    const token = await getToken();
    if (!token || !selectedKB || !sourceName.trim() || !sourceUrl.trim()) return;
    setAddingSource(true);
    try {
      await saasApi.post(
        saasEndpoints.kbAddUrl(orgId, selectedKB.id),
        { name: sourceName, url: sourceUrl },
        token
      );
      resetSourceForm();
      fetchSources(selectedKB.id);
    } catch (err: any) {
      setError(err.error || 'Failed to add URL');
    } finally {
      setAddingSource(false);
    }
  };

  const handleAddDocumentSource = async (file: File) => {
    const token = await getToken();
    if (!token || !selectedKB) return;
    setAddingSource(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const t = await getToken();
        await saasApi.post(
          saasEndpoints.kbAddDocument(orgId, selectedKB.id),
          { name: file.name, content_base64: base64, mime_type: file.type },
          t || undefined
        );
        resetSourceForm();
        fetchSources(selectedKB.id);
        setAddingSource(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.error || 'Failed to upload document');
      setAddingSource(false);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    const token = await getToken();
    if (!token || !selectedKB || !confirm('Delete this source?')) return;
    try {
      await saasApi.delete(
        saasEndpoints.kbSourceDelete(orgId, selectedKB.id, sourceId),
        token
      );
      setSources(prev => prev.filter(s => s.id !== sourceId));
    } catch (err: any) {
      setError(err.error || 'Failed to delete source');
    }
  };

  const handleSearch = async () => {
    const token = await getToken();
    if (!token || !selectedKB || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await saasApi.post<{ results: any[] }>(
        saasEndpoints.kbSearch(orgId, selectedKB.id),
        { query: searchQuery },
        token
      );
      setSearchResults(res.results || []);
    } catch (err: any) {
      setError(err.error || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const resetSourceForm = () => {
    setAddSourceMode(null);
    setSourceName('');
    setSourceContent('');
    setSourceUrl('');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready': return <CheckCircle2 size={14} className="text-emerald-400" />;
      case 'processing': return <Loader2 size={14} className="text-yellow-400 animate-spin" />;
      case 'error': return <AlertCircle size={14} className="text-red-400" />;
      default: return <Loader2 size={14} className="text-white/40 animate-spin" />;
    }
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'document': return <FileText size={16} className="text-blue-400" />;
      case 'url': return <Globe size={16} className="text-purple-400" />;
      case 'text': return <Type size={16} className="text-emerald-400" />;
      default: return <FileText size={16} className="text-white/40" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-white/40">
        <Loader2 size={24} className="animate-spin mr-2" />
        Loading knowledge bases...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <X size={14} />
          </button>
        </div>
      )}

      {/* KB List + Create */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Database size={20} className="text-purple-400" />
          Knowledge Bases
        </h3>
        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-sm flex items-center gap-1.5"
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* Create Form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <input
                type="text"
                placeholder="Knowledge base name"
                value={newKBName}
                onChange={e => setNewKBName(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 text-sm"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newKBDescription}
                onChange={e => setNewKBDescription(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 text-sm"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(false); setNewKBName(''); setNewKBDescription(''); }}
                  className="px-3 py-1.5 text-sm text-white/50 hover:text-white/70 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateKB}
                  disabled={!newKBName.trim() || creating}
                  className="px-4 py-1.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 text-sm flex items-center gap-1.5"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Create
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KB Cards */}
      {knowledgeBases.length === 0 && !showCreateForm ? (
        <div className="text-center py-8 text-white/30">
          <Database size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No knowledge bases yet</p>
          <p className="text-xs mt-1">Create one to add documents, URLs, or text for your agent to reference</p>
        </div>
      ) : (
        <div className="space-y-2">
          {knowledgeBases.map(kb => (
            <div
              key={kb.id}
              className={`border rounded-xl p-3 cursor-pointer transition-all ${
                selectedKB?.id === kb.id
                  ? 'bg-purple-500/10 border-purple-500/30'
                  : 'bg-white/[0.02] border-white/10 hover:border-white/20'
              }`}
              onClick={() => setSelectedKB(selectedKB?.id === kb.id ? null : kb)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(kb.status)}
                  <span className="text-sm font-medium text-white">{kb.name}</span>
                  <span className="text-xs text-white/30">{kb.chunk_count} chunks</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleDeleteKB(kb.id); }}
                    className="p-1 text-white/30 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                  {selectedKB?.id === kb.id ? <ChevronUp size={14} className="text-white/40" /> : <ChevronDown size={14} className="text-white/40" />}
                </div>
              </div>
              {kb.description && (
                <p className="text-xs text-white/40 mt-1 ml-5">{kb.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Selected KB Detail */}
      <AnimatePresence>
        {selectedKB && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Add Source Buttons */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/50">Add source:</span>
              <button
                type="button"
                onClick={() => setAddSourceMode(addSourceMode === 'text' ? null : 'text')}
                className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
                  addSourceMode === 'text' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/50 hover:text-white/70'
                }`}
              >
                <Type size={12} /> Text
              </button>
              <button
                type="button"
                onClick={() => setAddSourceMode(addSourceMode === 'url' ? null : 'url')}
                className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
                  addSourceMode === 'url' ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-white/50 hover:text-white/70'
                }`}
              >
                <Globe size={12} /> URL
              </button>
              <button
                type="button"
                onClick={() => setAddSourceMode(addSourceMode === 'document' ? null : 'document')}
                className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
                  addSourceMode === 'document' ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/50 hover:text-white/70'
                }`}
              >
                <Upload size={12} /> Document
              </button>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => setShowSearch(!showSearch)}
                  className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
                    showSearch ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-white/50 hover:text-white/70'
                  }`}
                >
                  <Search size={12} /> Test
                </button>
              </div>
            </div>

            {/* Add Source Forms */}
            <AnimatePresence>
              {addSourceMode === 'text' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
                    <input
                      type="text"
                      placeholder="Source name (e.g., 'Product FAQ')"
                      value={sourceName}
                      onChange={e => setSourceName(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 text-sm"
                    />
                    <textarea
                      placeholder="Paste your text content here..."
                      value={sourceContent}
                      onChange={e => setSourceContent(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 text-sm resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={resetSourceForm} className="px-3 py-1.5 text-sm text-white/50 hover:text-white/70">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddTextSource}
                        disabled={!sourceName.trim() || !sourceContent.trim() || addingSource}
                        className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm flex items-center gap-1.5"
                      >
                        {addingSource ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Add Text
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {addSourceMode === 'url' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 space-y-3">
                    <input
                      type="text"
                      placeholder="Source name (e.g., 'Company Website')"
                      value={sourceName}
                      onChange={e => setSourceName(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 text-sm"
                    />
                    <input
                      type="url"
                      placeholder="https://example.com/page"
                      value={sourceUrl}
                      onChange={e => setSourceUrl(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 text-sm"
                    />
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={resetSourceForm} className="px-3 py-1.5 text-sm text-white/50 hover:text-white/70">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddUrlSource}
                        disabled={!sourceName.trim() || !sourceUrl.trim() || addingSource}
                        className="px-4 py-1.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 text-sm flex items-center gap-1.5"
                      >
                        {addingSource ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                        Add URL
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {addSourceMode === 'document' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
                    <label className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-blue-500/30 transition-colors">
                      <Upload size={24} className="text-blue-400 mb-2" />
                      <span className="text-sm text-white/60">Click to upload a document</span>
                      <span className="text-xs text-white/30 mt-1">PDF, DOCX, TXT, CSV, MD, JSON</span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.csv,.md,.json,.xml,.tsv,.yaml,.log"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleAddDocumentSource(file);
                        }}
                      />
                    </label>
                    {addingSource && (
                      <div className="flex items-center justify-center gap-2 mt-3 text-sm text-blue-400">
                        <Loader2 size={14} className="animate-spin" /> Uploading and processing...
                      </div>
                    )}
                    <div className="flex justify-end mt-3">
                      <button type="button" onClick={resetSourceForm} className="px-3 py-1.5 text-sm text-white/50 hover:text-white/70">
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search Panel */}
            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Test a search query..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-yellow-500/50 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleSearch}
                        disabled={!searchQuery.trim() || searching}
                        className="px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 disabled:opacity-50 text-sm flex items-center gap-1.5"
                      >
                        {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                        Search
                      </button>
                    </div>
                    {searchResults.length > 0 && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {searchResults.map((r, i) => (
                          <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-white/40">{r.source_name}</span>
                              <span className="text-xs text-yellow-400">{Math.round(r.similarity * 100)}% match</span>
                            </div>
                            <p className="text-xs text-white/70 line-clamp-3">{r.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sources List */}
            <div>
              <h4 className="text-sm font-medium text-white/60 mb-2">Sources ({sources.length})</h4>
              {sources.length === 0 ? (
                <p className="text-xs text-white/30 py-4 text-center">No sources added yet</p>
              ) : (
                <div className="space-y-1.5">
                  {sources.map(source => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getSourceIcon(source.source_type)}
                        <span className="text-sm text-white/80 truncate">{source.name}</span>
                        {getStatusIcon(source.status)}
                        {source.status === 'ready' && (
                          <span className="text-xs text-white/30">{source.chunk_count} chunks</span>
                        )}
                        {source.status === 'error' && source.error_message && (
                          <span className="text-xs text-red-400 truncate max-w-[200px]" title={source.error_message}>
                            {source.error_message}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSource(source.id)}
                        className="p-1 text-white/20 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
