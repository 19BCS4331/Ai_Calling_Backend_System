import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  Key, 
  Lock, 
  User, 
  Globe, 
  Hash,
  Eye,
  EyeOff
} from 'lucide-react';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { DropdownOption } from '../ui/CustomDropdown';
import type { 
  AuthType, 
  ApiKeyAuthConfig, 
  HmacAuthConfig 
} from '../../lib/supabase-types';

interface AuthConfigEditorProps {
  authType: AuthType;
  authConfig: Record<string, any>;
  onAuthTypeChange: (type: AuthType) => void;
  onAuthConfigChange: (config: Record<string, any>) => void;
  disabled?: boolean;
}

const authTypeOptions: DropdownOption<AuthType>[] = [
  {
    value: 'none',
    label: 'No Authentication',
    description: 'No authentication required',
    icon: <Shield size={18} className="text-gray-400" />
  },
  {
    value: 'bearer',
    label: 'Bearer Token',
    description: 'Authorization: Bearer <token>',
    icon: <Key size={18} className="text-blue-400" />
  },
  {
    value: 'api_key',
    label: 'API Key',
    description: 'Custom header or query parameter',
    icon: <Lock size={18} className="text-green-400" />
  },
  {
    value: 'basic',
    label: 'Basic Auth',
    description: 'Username and password',
    icon: <User size={18} className="text-yellow-400" />
  },
  {
    value: 'oauth2',
    label: 'OAuth 2.0',
    description: 'Client credentials flow',
    icon: <Globe size={18} className="text-purple-400" />
  },
  {
    value: 'hmac',
    label: 'HMAC Signature',
    description: 'Request signing with secret key',
    icon: <Hash size={18} className="text-orange-400" />
  }
];

const apiKeyLocationOptions: DropdownOption<'header' | 'query'>[] = [
  { value: 'header', label: 'Header' },
  { value: 'query', label: 'Query Parameter' }
];

const hmacAlgorithmOptions: DropdownOption<'sha256' | 'sha512'>[] = [
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha512', label: 'SHA-512' }
];

export function AuthConfigEditor({
  authType,
  authConfig,
  onAuthTypeChange,
  onAuthConfigChange,
  disabled
}: AuthConfigEditorProps) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (field: string) => {
    setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const updateConfig = (field: string, value: any) => {
    onAuthConfigChange({ ...authConfig, [field]: value });
  };

  const handleTypeChange = (type: AuthType) => {
    onAuthTypeChange(type);
    
    // Reset config based on type with defaults
    switch (type) {
      case 'none':
        onAuthConfigChange({});
        break;
      case 'bearer':
        onAuthConfigChange({ token: '' });
        break;
      case 'api_key':
        onAuthConfigChange({ key: '', header_name: 'X-API-Key', location: 'header' });
        break;
      case 'basic':
        onAuthConfigChange({ username: '', password: '' });
        break;
      case 'oauth2':
        onAuthConfigChange({ client_id: '', client_secret: '', token_url: '', scope: '' });
        break;
      case 'hmac':
        onAuthConfigChange({ secret_key: '', algorithm: 'sha256', header_name: 'X-Signature', timestamp_header: '' });
        break;
    }
  };

  const renderSecretInput = (
    label: string,
    field: string,
    placeholder: string,
    required?: boolean
  ) => (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <input
          type={showSecrets[field] ? 'text' : 'password'}
          value={authConfig[field] || ''}
          onChange={(e) => updateConfig(field, e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => toggleSecret(field)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
        >
          {showSecrets[field] ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );

  const renderTextInput = (
    label: string,
    field: string,
    placeholder: string,
    required?: boolean,
    description?: string
  ) => (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type="text"
        value={authConfig[field] || ''}
        onChange={(e) => updateConfig(field, e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
      />
      {description && (
        <p className="text-xs text-white/40 mt-1">{description}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <CustomDropdown
        options={authTypeOptions}
        value={authType}
        onChange={handleTypeChange}
        label="Authentication"
        placeholder="Select authentication type"
        disabled={disabled}
      />

      <AnimatePresence>
        {authType !== 'none' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 overflow-hidden"
          >

            {authType === 'bearer' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 p-4 bg-white/5 rounded-xl border border-white/10"
              >
                {renderSecretInput('Bearer Token', 'token', 'Enter your bearer token', true)}
              </motion.div>
            )}

            {authType === 'api_key' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 p-4 bg-white/5 rounded-xl border border-white/10"
              >
                {renderSecretInput('API Key', 'key', 'Enter your API key', true)}
                {renderTextInput('Header/Parameter Name', 'header_name', 'X-API-Key', true)}
                <CustomDropdown
                  options={apiKeyLocationOptions}
                  value={(authConfig as ApiKeyAuthConfig).location || 'header'}
                  onChange={(val) => updateConfig('location', val)}
                  label="Location"
                  disabled={disabled}
                />
              </motion.div>
            )}

            {authType === 'basic' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 p-4 bg-white/5 rounded-xl border border-white/10"
              >
                {renderTextInput('Username', 'username', 'Enter username', true)}
                {renderSecretInput('Password', 'password', 'Enter password', true)}
              </motion.div>
            )}

            {authType === 'oauth2' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 p-4 bg-white/5 rounded-xl border border-white/10"
              >
                <p className="text-xs text-white/50 mb-2">
                  Using Client Credentials flow for server-to-server authentication
                </p>
                {renderTextInput('Client ID', 'client_id', 'Enter client ID', true)}
                {renderSecretInput('Client Secret', 'client_secret', 'Enter client secret', true)}
                {renderTextInput('Token URL', 'token_url', 'https://auth.example.com/oauth/token', true)}
                {renderTextInput('Scope', 'scope', 'read write (optional)', false, 'Space-separated scopes')}
              </motion.div>
            )}

            {authType === 'hmac' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 p-4 bg-white/5 rounded-xl border border-white/10"
              >
                {renderSecretInput('Secret Key', 'secret_key', 'Enter HMAC secret key', true)}
                <CustomDropdown
                  options={hmacAlgorithmOptions}
                  value={(authConfig as HmacAuthConfig).algorithm || 'sha256'}
                  onChange={(val) => updateConfig('algorithm', val)}
                  label="Algorithm"
                  disabled={disabled}
                />
                {renderTextInput('Signature Header', 'header_name', 'X-Signature', true, 'Header name for the signature')}
                {renderTextInput('Timestamp Header', 'timestamp_header', 'X-Timestamp (optional)', false, 'Header name for the timestamp')}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
