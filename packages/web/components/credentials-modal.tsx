"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

export function CredentialsModal({
  open,
  hasApiKey,
  accountId,
  dismissible,
  onSave,
  onCancel,
}: {
  open: boolean;
  hasApiKey: boolean;
  accountId: string | null;
  dismissible: boolean;
  onSave: (apiKey: string, accountId: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [account, setAccount] = useState(accountId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setAccount(accountId ?? "");
  }, [open, accountId]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissible, onCancel]);

  if (!open) return null;

  const canSave = key.trim().length > 0 && account.trim().length > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const ok = await onSave(key.trim(), account.trim());
    setSaving(false);
    if (ok) setKey("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close"
        onClick={dismissible ? onCancel : undefined}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${dismissible ? "cursor-default" : "cursor-not-allowed"}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="bg-card border-border animate-in fade-in zoom-in-95 relative z-10 w-full max-w-md border p-6 shadow-2xl duration-150"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="bg-gold/15 text-gold flex size-9 shrink-0 items-center justify-center">
            <KeyRound className="size-5" />
          </span>
          <h2 className="font-display text-lg font-semibold">Connect your Whop account</h2>
        </div>
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          Both fields are required to run the tracker. Held in server memory only — never stored on disk or sent
          back to the browser.
        </p>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground font-mono text-[11px] uppercase tracking-wider">
              API key <span className="text-negative">*</span>
            </span>
            <input
              type="password"
              value={key}
              autoFocus
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder={hasApiKey ? "•••••••• (set — enter to replace)" : "apik_…"}
              className="border-border bg-secondary focus:border-gold/60 w-full border px-3 py-2 font-mono text-sm outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground font-mono text-[11px] uppercase tracking-wider">
              Trading account ID <span className="text-negative">*</span>
            </span>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="biz_… or user_…"
              className="border-border bg-secondary focus:border-gold/60 w-full border px-3 py-2 font-mono text-sm outline-none"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {dismissible ? (
            <button
              type="button"
              onClick={onCancel}
              className="border-border hover:bg-accent border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors"
            >
              cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || !canSave}
            className="bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition-opacity"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}
