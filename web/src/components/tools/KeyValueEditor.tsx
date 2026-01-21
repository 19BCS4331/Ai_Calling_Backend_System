import { Plus, Trash2 } from 'lucide-react';
import type { KeyValuePair } from '../../lib/supabase-types';

interface KeyValueEditorProps {
  items: KeyValuePair[];
  onChange: (items: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  label,
  description,
  disabled
}: KeyValueEditorProps) {
  const generateId = () => Math.random().toString(36).substring(2, 9);

  const addItem = () => {
    onChange([...items, { id: generateId(), key: '', value: '' }]);
  };

  const updateItem = (id: string, field: 'key' | 'value', value: string) => {
    onChange(items.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const removeItem = (id: string) => {
    onChange(items.filter(item => item.id !== id));
  };

  return (
    <div className="space-y-3">
      {label && (
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-white/70">{label}</label>
          <button
            type="button"
            onClick={addItem}
            disabled={disabled}
            className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      )}
      
      {description && (
        <p className="text-xs text-white/40">{description}</p>
      )}

      {items.length === 0 ? (
        <div className="flex items-center justify-center py-6 border border-dashed border-white/10 rounded-xl">
          <button
            type="button"
            onClick={addItem}
            disabled={disabled}
            className="flex items-center gap-2 text-sm text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
            Add your first item
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <input
                type="text"
                value={item.key}
                onChange={(e) => updateItem(item.id, 'key', e.target.value)}
                placeholder={keyPlaceholder}
                disabled={disabled}
                className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              <input
                type="text"
                value={item.value}
                onChange={(e) => updateItem(item.id, 'value', e.target.value)}
                placeholder={valuePlaceholder}
                disabled={disabled}
                className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                disabled={disabled}
                className="p-2.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper to convert KeyValuePair[] to Record<string, string>
export function keyValuePairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  return pairs.reduce((acc, pair) => {
    if (pair.key.trim()) {
      acc[pair.key.trim()] = pair.value;
    }
    return acc;
  }, {} as Record<string, string>);
}

// Helper to convert Record<string, string> to KeyValuePair[]
export function recordToKeyValuePairs(record: Record<string, string>): KeyValuePair[] {
  return Object.entries(record).map(([key, value]) => ({
    id: Math.random().toString(36).substring(2, 9),
    key,
    value
  }));
}
