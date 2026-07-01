"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onCancel} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="bg-card border-border animate-in fade-in zoom-in-95 relative z-10 w-full max-w-md border p-6 shadow-2xl duration-150"
      >
        <div className="flex items-start gap-3">
          {danger ? (
            <span className="bg-negative/15 text-negative flex size-9 shrink-0 items-center justify-center">
              <AlertTriangle className="size-5" />
            </span>
          ) : null}
          <div>
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-border hover:bg-accent border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90 ${
              danger ? "bg-negative text-white" : "bg-primary text-primary-foreground"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
