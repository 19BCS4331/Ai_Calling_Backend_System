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

export const useAlertStore = create<AlertState>((set) => ({
  isOpen: false,
  message: '',
  type: 'info',
  showAlert: (message, type = 'info', title, confirmText) => 
    set({ isOpen: true, message, type, title, confirmText }),
  closeAlert: () => 
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
