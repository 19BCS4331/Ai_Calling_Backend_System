import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, User, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';
import { useAgents } from '../../hooks/useAgents';
import type { AgentVersion } from '../../lib/supabase-types';

interface VersionHistoryProps {
  agentId: string;
  currentVersion: number;
  publishedVersion: number | null;
  onRollback?: () => void;
}

export function VersionHistory({ agentId, currentVersion, publishedVersion, onRollback }: VersionHistoryProps) {
  const { getVersionHistory, rollbackToVersion } = useAgents();
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadVersions();
  }, [agentId]);

  const loadVersions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getVersionHistory(agentId);
      setVersions(data);
    } catch (err) {
      console.error('Failed to load version history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollback = async (versionNumber: number) => {
    if (!confirm(`Are you sure you want to rollback to version ${versionNumber}?\n\nThis will:\n• Restore all configuration from version ${versionNumber}\n• Set this as the active published version\n• Activate the agent immediately\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      setIsRollingBack(true);
      await rollbackToVersion(agentId, versionNumber);
      await loadVersions();
      onRollback?.();
    } catch (err) {
      console.error('Failed to rollback:', err);
      setError(err instanceof Error ? err.message : 'Failed to rollback');
    } finally {
      setIsRollingBack(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle size={18} />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-8 text-center">
        <Clock size={32} className="mx-auto text-white/20 mb-3" />
        <p className="text-white/50 text-sm">No version history yet</p>
        <p className="text-white/30 text-xs mt-1">Publish this agent to create the first version</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {versions.map((version, index) => {
        const isPublished = version.version === publishedVersion;
        const isCurrent = version.version === currentVersion - 1; // Current version is one ahead

        return (
          <motion.div
            key={version.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`bg-white/[0.02] border rounded-xl p-4 ${
              isPublished
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-white/5'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {/* Version Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-white">
                    Version {version.version}
                  </span>
                  {isPublished && (
                    <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded text-xs font-medium text-green-400 flex items-center gap-1">
                      <CheckCircle size={12} />
                      Published
                    </span>
                  )}
                  {isCurrent && !isPublished && (
                    <span className="px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded text-xs font-medium text-blue-400">
                      Latest Draft
                    </span>
                  )}
                </div>

                {/* Change Summary */}
                {version.change_summary && (
                  <p className="text-sm text-white/70 mb-3">{version.change_summary}</p>
                )}

                {/* Metadata */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
                  {version.published_at && (
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} />
                      <span>{formatDate(version.published_at)}</span>
                    </div>
                  )}
                  {version.published_by && (
                    <div className="flex items-center gap-1.5">
                      <User size={14} />
                      <span>Published by user</span>
                    </div>
                  )}
                </div>

                {/* Config Preview */}
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-white/40 mb-0.5">LLM</p>
                      <p className="text-white/70 font-medium">
                        {version.config_snapshot.llm_provider}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/40 mb-0.5">TTS</p>
                      <p className="text-white/70 font-medium">
                        {version.config_snapshot.tts_provider}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/40 mb-0.5">STT</p>
                      <p className="text-white/70 font-medium">
                        {version.config_snapshot.stt_provider}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/40 mb-0.5">Language</p>
                      <p className="text-white/70 font-medium">
                        {version.config_snapshot.language}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              {!isPublished && (
                <button
                  onClick={() => handleRollback(version.version)}
                  disabled={isRollingBack}
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium text-white hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                  title="Rollback to this version"
                >
                  {isRollingBack ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <RotateCcw size={14} />
                      Rollback
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
