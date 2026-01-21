import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownOption<T = string> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface CustomDropdownProps<T = string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  error?: string;
}

export function CustomDropdown<T = string>({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  label,
  required,
  disabled,
  className = '',
  error
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (option: DropdownOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {label && (
        <label className="block text-sm font-medium text-white/70 mb-2">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}
      
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-3 bg-white/5 border rounded-xl text-left transition-all ${
          error
            ? 'border-red-500/50 focus:border-red-500'
            : isOpen
            ? 'border-purple-500/50 ring-2 ring-purple-500/20'
            : 'border-white/10 hover:border-white/20'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {selectedOption?.icon}
          <span className={selectedOption ? 'text-white' : 'text-white/40'}>
            {selectedOption?.label || placeholder}
          </span>
        </div>
        <ChevronDown
          size={18}
          className={`text-white/40 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-2 py-2 bg-gray-900 border border-white/10 rounded-xl shadow-xl max-h-64 overflow-y-auto"
          >
            {options.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => handleSelect(option)}
                disabled={option.disabled}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  option.disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : option.value === value
                    ? 'bg-purple-600/20 text-purple-400'
                    : 'hover:bg-white/5 text-white'
                }`}
              >
                {option.icon && (
                  <span className="flex-shrink-0">{option.icon}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{option.label}</div>
                  {option.description && (
                    <div className="text-xs text-white/50 mt-0.5 truncate">
                      {option.description}
                    </div>
                  )}
                </div>
                {option.value === value && (
                  <Check size={16} className="text-purple-400 flex-shrink-0" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
