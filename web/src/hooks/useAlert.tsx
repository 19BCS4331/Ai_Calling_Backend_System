import { create } from 'zustand';
import type { AlertType } from '../components/ui/AlertDialog';

interface AlertState {
  isOpen: boolean;
  title?: string;
  message: string;
  type: AlertType;
  confirmText?: string;
  showAlert: (message: string, type?: AlertType, title?: string, confirmText?: string) => void;
  closeAlert: () => void;
}

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  variant: 'danger' | 'warning' | 'info';
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  showConfirm: (options: {
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
    confirmText?: string;
    cancelText?: string;
  }) => void;
  closeConfirm: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  isOpen: false,
  message: '',
  type: 'info',
  showAlert: (message, type = 'info', title, confirmText) => 
    set({ isOpen: true, message, type, title, confirmText }),
  closeAlert: () => 
    set({ isOpen: false })
}));

export const useConfirmStore = create<ConfirmState>((set) => ({
  isOpen: false,
  title: '',
  message: '',
  variant: 'danger',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  onConfirm: () => {},
  showConfirm: (options) =>
    set({
      isOpen: true,
      title: options.title,
      message: options.message,
      onConfirm: options.onConfirm,
      variant: options.variant || 'danger',
      confirmText: options.confirmText || 'Confirm',
      cancelText: options.cancelText || 'Cancel'
    }),
  closeConfirm: () =>
    set({ isOpen: false })
}));

export function useAlert() {
  const { showAlert } = useAlertStore();

  return {
    showSuccess: (message: string, title?: string) => showAlert(message, 'success', title || 'Success'),
    showError: (message: string, title?: string) => showAlert(message, 'error', title || 'Error'),
    showWarning: (message: string, title?: string) => showAlert(message, 'warning', title || 'Warning'),
    showInfo: (message: string, title?: string) => showAlert(message, 'info', title || 'Information'),
  };
}

export function useConfirm() {
  const { showConfirm } = useConfirmStore();
  return { showConfirm };
}
