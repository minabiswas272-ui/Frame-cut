import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md bg-[#12151C] border border-[#2A3242] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222836]">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${destructive ? 'text-rose-400' : 'text-amber-400'}`}
            />
            <h3
              id="confirm-modal-title"
              className="text-sm font-semibold text-[#F3F5F8] font-display"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-1 text-[#8E98AB] hover:text-[#F3F5F8] rounded-md transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-[#B2BCCB] leading-relaxed">{description}</p>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-[#0E1117] border-t border-[#222836]">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium text-[#C5CDDB] bg-[#1A1F2B] hover:bg-[#232A39] rounded-lg transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
            }`}
          >
            {busy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
