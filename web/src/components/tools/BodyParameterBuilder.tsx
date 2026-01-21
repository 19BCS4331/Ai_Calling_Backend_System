import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { DropdownOption } from '../ui/CustomDropdown';
import type { BodyParameter, ParameterType } from '../../lib/supabase-types';

interface BodyParameterBuilderProps {
  parameters: BodyParameter[];
  onChange: (parameters: BodyParameter[]) => void;
  disabled?: boolean;
  showRawJson?: boolean;
  onToggleRawJson?: () => void;
  rawJson?: string;
  onRawJsonChange?: (json: string) => void;
}

const parameterTypeOptions: DropdownOption<ParameterType>[] = [
  { value: 'string', label: 'String', description: 'Text value' },
  { value: 'number', label: 'Number', description: 'Numeric value' },
  { value: 'boolean', label: 'Boolean', description: 'True/False' },
  { value: 'array', label: 'Array', description: 'List of items' },
  { value: 'object', label: 'Object', description: 'Nested object' }
];

const generateId = () => Math.random().toString(36).substring(2, 9);

export function BodyParameterBuilder({
  parameters,
  onChange,
  disabled,
  showRawJson,
  onToggleRawJson,
  rawJson,
  onRawJsonChange
}: BodyParameterBuilderProps) {
  const [expandedParams, setExpandedParams] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedParams(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const addParameter = (parentId?: string) => {
    const newParam: BodyParameter = {
      id: generateId(),
      key: '',
      type: 'string',
      required: false,
      description: ''
    };

    if (parentId) {
      onChange(parameters.map(p => {
        if (p.id === parentId) {
          return {
            ...p,
            properties: [...(p.properties || []), newParam]
          };
        }
        return p;
      }));
    } else {
      onChange([...parameters, newParam]);
    }
  };

  const updateParameter = (id: string, updates: Partial<BodyParameter>, parentId?: string) => {
    if (parentId) {
      onChange(parameters.map(p => {
        if (p.id === parentId) {
          return {
            ...p,
            properties: (p.properties || []).map(child =>
              child.id === id ? { ...child, ...updates } : child
            )
          };
        }
        return p;
      }));
    } else {
      onChange(parameters.map(p => p.id === id ? { ...p, ...updates } : p));
    }
  };

  const removeParameter = (id: string, parentId?: string) => {
    if (parentId) {
      onChange(parameters.map(p => {
        if (p.id === parentId) {
          return {
            ...p,
            properties: (p.properties || []).filter(child => child.id !== id)
          };
        }
        return p;
      }));
    } else {
      onChange(parameters.filter(p => p.id !== id));
    }
  };

  const renderParameter = (param: BodyParameter, level: number = 0, parentId?: string) => {
    const isExpanded = expandedParams.has(param.id);
    const hasChildren = param.type === 'object' && (param.properties?.length || 0) > 0;
    const canHaveChildren = param.type === 'object';

    return (
      <div key={param.id} className={`${level > 0 ? 'ml-6 border-l border-white/10 pl-4' : ''}`}>
        <div className="flex items-start gap-2 py-2">
          {/* Expand/Collapse for objects */}
          <div className="w-6 flex-shrink-0 pt-3">
            {canHaveChildren && (
              <button
                type="button"
                onClick={() => toggleExpand(param.id)}
                className="text-white/40 hover:text-white/60 transition-colors"
              >
                {isExpanded || hasChildren ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
              </button>
            )}
          </div>

          {/* Drag handle */}
          <div className="pt-3 text-white/20">
            <GripVertical size={16} />
          </div>

          {/* Parameter fields */}
          <div className="flex-1 grid grid-cols-12 gap-2">
            {/* Key */}
            <div className="col-span-3">
              <input
                type="text"
                value={param.key}
                onChange={(e) => updateParameter(param.id, { key: e.target.value }, parentId)}
                placeholder="Parameter name"
                disabled={disabled}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
            </div>

            {/* Type */}
            <div className="col-span-2">
              <CustomDropdown
                options={parameterTypeOptions}
                value={param.type}
                onChange={(type) => {
                  const updates: Partial<BodyParameter> = { type };
                  if (type === 'object' && !param.properties) {
                    updates.properties = [];
                  }
                  if (type === 'array' && !param.items_type) {
                    updates.items_type = 'string';
                  }
                  updateParameter(param.id, updates, parentId);
                }}
                disabled={disabled}
              />
            </div>

            {/* Array items type */}
            {param.type === 'array' && (
              <div className="col-span-2">
                <CustomDropdown
                  options={parameterTypeOptions.filter(o => o.value !== 'object')}
                  value={param.items_type || 'string'}
                  onChange={(type) => updateParameter(param.id, { items_type: type }, parentId)}
                  placeholder="Items type"
                  disabled={disabled}
                />
              </div>
            )}

            {/* Description */}
            <div className={param.type === 'array' ? 'col-span-3' : 'col-span-5'}>
              <input
                type="text"
                value={param.description || ''}
                onChange={(e) => updateParameter(param.id, { description: e.target.value }, parentId)}
                placeholder="Description (for AI context)"
                disabled={disabled}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
            </div>

            {/* Required toggle */}
            <div className="col-span-1 flex items-center justify-center">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={param.required}
                  onChange={(e) => updateParameter(param.id, { required: e.target.checked }, parentId)}
                  disabled={disabled}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/20"
                />
                <span className="text-xs text-white/50">Req</span>
              </label>
            </div>

            {/* Delete */}
            <div className="col-span-1 flex items-center justify-end">
              <button
                type="button"
                onClick={() => removeParameter(param.id, parentId)}
                disabled={disabled}
                className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Nested properties for object type */}
        <AnimatePresence>
          {canHaveChildren && (isExpanded || hasChildren) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              {(param.properties || []).map(child => renderParameter(child, level + 1, param.id))}
              
              <button
                type="button"
                onClick={() => addParameter(param.id)}
                disabled={disabled}
                className="ml-6 flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition-colors py-2 disabled:opacity-50"
              >
                <Plus size={14} />
                Add nested property
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-white/70">Request Body Parameters</label>
        <div className="flex items-center gap-3">
          {onToggleRawJson && (
            <button
              type="button"
              onClick={onToggleRawJson}
              className="text-sm text-white/50 hover:text-white/70 transition-colors"
            >
              {showRawJson ? 'Visual Builder' : 'Raw JSON'}
            </button>
          )}
          {!showRawJson && (
            <button
              type="button"
              onClick={() => addParameter()}
              disabled={disabled}
              className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50"
            >
              <Plus size={14} />
              Add Parameter
            </button>
          )}
        </div>
      </div>

      {showRawJson ? (
        <div>
          <textarea
            value={rawJson}
            onChange={(e) => onRawJsonChange?.(e.target.value)}
            placeholder='{"type": "object", "properties": {"location": {"type": "string"}}}'
            rows={10}
            disabled={disabled}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 font-mono text-sm resize-none disabled:opacity-50"
          />
          <p className="text-xs text-white/40 mt-1">
            Define parameters using JSON Schema format
          </p>
        </div>
      ) : parameters.length === 0 ? (
        <div className="flex items-center justify-center py-8 border border-dashed border-white/10 rounded-xl">
          <button
            type="button"
            onClick={() => addParameter()}
            disabled={disabled}
            className="flex items-center gap-2 text-sm text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
            Add your first parameter
          </button>
        </div>
      ) : (
        <div className="border border-white/10 rounded-xl p-3 bg-white/[0.02]">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-8 pb-2 border-b border-white/10 text-xs text-white/50">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-5">Description</div>
            <div className="col-span-1 text-center">Req</div>
            <div className="col-span-1"></div>
          </div>
          
          {parameters.map(param => renderParameter(param))}
        </div>
      )}
    </div>
  );
}

// Convert BodyParameter[] to JSON Schema
export function parametersToJsonSchema(parameters: BodyParameter[]): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of parameters) {
    if (!param.key) continue;

    const propSchema: Record<string, any> = {
      type: param.type
    };

    if (param.description) {
      propSchema.description = param.description;
    }

    if (param.default_value !== undefined) {
      propSchema.default = param.default_value;
    }

    if (param.enum_values?.length) {
      propSchema.enum = param.enum_values;
    }

    if (param.type === 'array' && param.items_type) {
      propSchema.items = { type: param.items_type };
    }

    if (param.type === 'object' && param.properties?.length) {
      const nested = parametersToJsonSchema(param.properties);
      propSchema.properties = nested.properties;
      if (nested.required?.length) {
        propSchema.required = nested.required;
      }
    }

    properties[param.key] = propSchema;

    if (param.required) {
      required.push(param.key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length && { required })
  };
}

// Convert JSON Schema to BodyParameter[]
export function jsonSchemaToParameters(schema: Record<string, any>): BodyParameter[] {
  if (!schema?.properties) return [];

  const requiredFields = new Set(schema.required || []);

  return Object.entries(schema.properties).map(([key, prop]: [string, any]) => {
    const param: BodyParameter = {
      id: generateId(),
      key,
      type: prop.type || 'string',
      description: prop.description || '',
      required: requiredFields.has(key),
      default_value: prop.default
    };

    if (prop.enum) {
      param.enum_values = prop.enum;
    }

    if (prop.type === 'array' && prop.items?.type) {
      param.items_type = prop.items.type;
    }

    if (prop.type === 'object' && prop.properties) {
      param.properties = jsonSchemaToParameters(prop);
    }

    return param;
  });
}
