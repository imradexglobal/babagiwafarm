import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmVoidModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

export const ConfirmVoidModal: React.FC<ConfirmVoidModalProps> = ({
  open,
  title,
  description,
  confirmLabel,
  requireReason = true,
  reasonPlaceholder = 'State the reason for voiding or deactivating this record...',
  onConfirm,
  onClose,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requireReason && reason.trim().length < 3) {
      setError('Please enter a brief reason (at least 3 characters) for the audit trail.');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        {/* Mobile Sheet Drag Indicator */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 border border-red-200">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 id="confirm-modal-title" className="text-base sm:text-lg font-bold text-slate-900">
                {title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
            aria-label="Close confirmation dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600">{description}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {requireReason && (
            <div>
              <label htmlFor="void-reason" className="block text-xs sm:text-sm font-medium text-slate-700">
                Reason for Audit Log <span className="text-red-600">*</span>
              </label>
              <textarea
                id="void-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20"
                required
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs sm:text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 sm:gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="w-full sm:w-auto rounded-xl border border-slate-300 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (requireReason && reason.trim().length < 3)}
              className="w-full sm:w-auto rounded-xl bg-red-700 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-red-800 active:bg-red-900 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Voiding...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
