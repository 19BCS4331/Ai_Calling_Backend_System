import { motion } from 'framer-motion';
import { 
  PhoneOff, 
  PhoneForwarded, 
  Hash, 
  Pause, 
  Mic, 
  MessageSquare, 
  Info,
  Mail,
  Calendar,
  Check
} from 'lucide-react';
import type { BuiltinToolType, BuiltinToolDefinition, BuiltinConfigField } from '../../lib/supabase-types';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { DropdownOption } from '../ui/CustomDropdown';

// Define all available built-in tools
export const BUILTIN_TOOLS: BuiltinToolDefinition[] = [
  {
    type: 'end_call',
    name: 'End Call',
    description: 'Ends the current call gracefully',
    icon: 'PhoneOff',
    configFields: [
      {
        key: 'reason',
        label: 'End Reason',
        type: 'text',
        required: false,
        placeholder: 'Optional reason for ending the call',
        description: 'This will be logged but not spoken'
      }
    ]
  },
  {
    type: 'transfer_call',
    name: 'Transfer Call',
    description: 'Transfers the call to another number or agent',
    icon: 'PhoneForwarded',
    configFields: [
      {
        key: 'transfer_to',
        label: 'Transfer To',
        type: 'phone',
        required: true,
        placeholder: '+1234567890 or agent:agent-id',
        description: 'Phone number or agent ID to transfer to'
      },
      {
        key: 'announce',
        label: 'Announce Transfer',
        type: 'boolean',
        required: false,
        default_value: true,
        description: 'Announce the transfer to the caller before transferring'
      },
      {
        key: 'warm_transfer',
        label: 'Warm Transfer',
        type: 'boolean',
        required: false,
        default_value: false,
        description: 'Stay on the line until the transfer is accepted'
      }
    ]
  },
  {
    type: 'dial_keypad',
    name: 'Dial Keypad (DTMF)',
    description: 'Sends DTMF tones during the call',
    icon: 'Hash',
    configFields: [
      {
        key: 'digits',
        label: 'Digits to Dial',
        type: 'text',
        required: true,
        placeholder: '1234#',
        description: 'The digits/tones to send (0-9, *, #)'
      }
    ]
  },
  {
    type: 'hold_call',
    name: 'Hold Call',
    description: 'Places the caller on hold',
    icon: 'Pause',
    configFields: [
      {
        key: 'music_url',
        label: 'Hold Music URL',
        type: 'url',
        required: false,
        placeholder: 'https://example.com/hold-music.mp3',
        description: 'URL to hold music audio file'
      },
      {
        key: 'max_duration_seconds',
        label: 'Max Hold Duration (seconds)',
        type: 'number',
        required: false,
        default_value: 300,
        description: 'Maximum time to keep caller on hold'
      }
    ]
  },
  {
    type: 'record_call',
    name: 'Record Call',
    description: 'Starts recording the call',
    icon: 'Mic',
    configFields: [
      {
        key: 'dual_channel',
        label: 'Dual Channel Recording',
        type: 'boolean',
        required: false,
        default_value: true,
        description: 'Record each party on separate channels'
      },
      {
        key: 'transcribe',
        label: 'Transcribe Recording',
        type: 'boolean',
        required: false,
        default_value: false,
        description: 'Automatically transcribe the recording'
      }
    ]
  },
  {
    type: 'send_sms',
    name: 'Send SMS',
    description: 'Sends an SMS message to a phone number',
    icon: 'MessageSquare',
    configFields: [
      {
        key: 'to',
        label: 'To Phone Number',
        type: 'phone',
        required: true,
        placeholder: '+1234567890',
        description: 'Leave empty to send to caller'
      },
      {
        key: 'message',
        label: 'Message Template',
        type: 'text',
        required: false,
        placeholder: 'Hi {{name}}, your appointment is confirmed.',
        description: 'Use {{variable}} for dynamic content'
      }
    ]
  },
  {
    type: 'get_call_info',
    name: 'Get Call Info',
    description: 'Gets metadata about the current call',
    icon: 'Info',
    configFields: []
  },
  {
    type: 'send_email',
    name: 'Send Email',
    description: 'Sends an email to a specified address',
    icon: 'Mail',
    configFields: [
      {
        key: 'to',
        label: 'To Email',
        type: 'email',
        required: true,
        placeholder: 'user@example.com',
        description: 'Recipient email address'
      },
      {
        key: 'subject',
        label: 'Subject Template',
        type: 'text',
        required: false,
        placeholder: 'Appointment Confirmation',
        description: 'Email subject line'
      },
      {
        key: 'template_id',
        label: 'Email Template ID',
        type: 'text',
        required: false,
        placeholder: 'template_abc123',
        description: 'ID of pre-configured email template'
      }
    ]
  },
  {
    type: 'schedule_callback',
    name: 'Schedule Callback',
    description: 'Schedules a callback at a later time',
    icon: 'Calendar',
    configFields: [
      {
        key: 'delay_minutes',
        label: 'Default Delay (minutes)',
        type: 'number',
        required: false,
        default_value: 30,
        description: 'Default time before callback'
      },
      {
        key: 'max_attempts',
        label: 'Max Callback Attempts',
        type: 'number',
        required: false,
        default_value: 3,
        description: 'Maximum number of callback attempts'
      }
    ]
  }
];

const iconMap: Record<string, React.ReactNode> = {
  PhoneOff: <PhoneOff size={20} className="text-red-400" />,
  PhoneForwarded: <PhoneForwarded size={20} className="text-blue-400" />,
  Hash: <Hash size={20} className="text-green-400" />,
  Pause: <Pause size={20} className="text-yellow-400" />,
  Mic: <Mic size={20} className="text-purple-400" />,
  MessageSquare: <MessageSquare size={20} className="text-cyan-400" />,
  Info: <Info size={20} className="text-gray-400" />,
  Mail: <Mail size={20} className="text-pink-400" />,
  Calendar: <Calendar size={20} className="text-orange-400" />
};

interface BuiltinToolSelectorProps {
  selectedType: BuiltinToolType | null;
  onSelect: (type: BuiltinToolType) => void;
  disabled?: boolean;
}

export function BuiltinToolSelector({ selectedType, onSelect, disabled }: BuiltinToolSelectorProps) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-white/70">
        Select Built-in Tool <span className="text-red-400">*</span>
      </label>
      
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BUILTIN_TOOLS.map((tool) => (
          <motion.button
            key={tool.type}
            type="button"
            onClick={() => !disabled && onSelect(tool.type)}
            disabled={disabled}
            whileHover={{ scale: disabled ? 1 : 1.02 }}
            whileTap={{ scale: disabled ? 1 : 0.98 }}
            className={`relative p-4 rounded-xl border text-left transition-all ${
              selectedType === tool.type
                ? 'border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/20'
                : 'border-white/10 bg-white/5 hover:border-white/20'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {selectedType === tool.type && (
              <div className="absolute top-2 right-2">
                <Check size={16} className="text-purple-400" />
              </div>
            )}
            <div className="flex items-center gap-3 mb-2">
              {iconMap[tool.icon]}
              <span className="font-medium text-white">{tool.name}</span>
            </div>
            <p className="text-xs text-white/50">{tool.description}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

interface BuiltinToolConfigProps {
  toolType: BuiltinToolType;
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
  customName?: string;
  customDescription?: string;
  onCustomNameChange?: (name: string) => void;
  onCustomDescriptionChange?: (description: string) => void;
  disabled?: boolean;
}

export function BuiltinToolConfig({
  toolType,
  config,
  onChange,
  customName,
  customDescription,
  onCustomNameChange,
  onCustomDescriptionChange,
  disabled
}: BuiltinToolConfigProps) {
  const toolDefinition = BUILTIN_TOOLS.find(t => t.type === toolType);
  
  if (!toolDefinition) return null;

  const updateConfig = (key: string, value: any) => {
    onChange({ ...config, [key]: value });
  };

  const renderField = (field: BuiltinConfigField) => {
    const value = config[field.key] ?? field.default_value ?? '';

    switch (field.type) {
      case 'boolean':
        return (
          <div key={field.key} className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
            <div>
              <h4 className="font-medium text-white">{field.label}</h4>
              {field.description && (
                <p className="text-sm text-white/50">{field.description}</p>
              )}
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => updateConfig(field.key, e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
            </label>
          </div>
        );

      case 'select':
        const options: DropdownOption<string>[] = (field.options || []).map(opt => ({
          value: opt.value,
          label: opt.label
        }));
        return (
          <div key={field.key}>
            <CustomDropdown
              options={options}
              value={value}
              onChange={(val) => updateConfig(field.key, val)}
              label={field.label}
              required={field.required}
              disabled={disabled}
            />
            {field.description && (
              <p className="text-xs text-white/40 mt-1">{field.description}</p>
            )}
          </div>
        );

      case 'number':
        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-white/70 mb-2">
              {field.label} {field.required && <span className="text-red-400">*</span>}
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => updateConfig(field.key, parseInt(e.target.value) || 0)}
              placeholder={field.placeholder}
              disabled={disabled}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
            />
            {field.description && (
              <p className="text-xs text-white/40 mt-1">{field.description}</p>
            )}
          </div>
        );

      default:
        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-white/70 mb-2">
              {field.label} {field.required && <span className="text-red-400">*</span>}
            </label>
            <input
              type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
              value={value}
              onChange={(e) => updateConfig(field.key, e.target.value)}
              placeholder={field.placeholder}
              disabled={disabled}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
            />
            {field.description && (
              <p className="text-xs text-white/40 mt-1">{field.description}</p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Custom name and description */}
      <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl space-y-4">
        <div className="flex items-center gap-2 mb-2">
          {iconMap[toolDefinition.icon]}
          <span className="font-medium text-white">{toolDefinition.name}</span>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Custom Tool Name
          </label>
          <input
            type="text"
            value={customName || ''}
            onChange={(e) => onCustomNameChange?.(e.target.value)}
            placeholder={toolDefinition.name}
            disabled={disabled}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
          />
          <p className="text-xs text-white/40 mt-1">
            Override the default name (used by AI and in logs)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Custom Description
          </label>
          <textarea
            value={customDescription || ''}
            onChange={(e) => onCustomDescriptionChange?.(e.target.value)}
            placeholder={toolDefinition.description}
            rows={2}
            disabled={disabled}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 resize-none disabled:opacity-50"
          />
          <p className="text-xs text-white/40 mt-1">
            Override the description (helps AI understand when to use this tool)
          </p>
        </div>
      </div>

      {/* Tool-specific configuration */}
      {toolDefinition.configFields.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-white/70">Tool Configuration</h4>
          {toolDefinition.configFields.map(renderField)}
        </div>
      )}

      {toolDefinition.configFields.length === 0 && (
        <div className="text-center py-6 text-white/50">
          <Info size={24} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">This tool doesn't require additional configuration</p>
        </div>
      )}
    </div>
  );
}
