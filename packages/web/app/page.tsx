"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock, Gauge, Loader2, Newspaper, Repeat2, ScanLine, Waves, Zap, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CopyTradeDecision, NewsItem, PlacedTrade, TrackerSnapshot, WhaleEvent } from "@whale-tracker/core";

const POLL_MS = 3000;

function usd(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function btc(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} BTC`;
}

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export default function Home() {
  const [snap, setSnap] = useState<TrackerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [confirmLive, setConfirmLive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function notify(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/track", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.error ?? `Request failed (${res.status})`);
          setConnected(false);
          return;
        }
        setSnap(data as TrackerSnapshot);
        setError(null);
        setConnected(true);
      } catch (err) {
        if (alive) {
          setConnected(false);
          setError(err instanceof Error ? err.message : "Network error");
        }
      }
    };
    void poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadNews = async () => {
      try {
        const res = await fetch("/api/news", { cache: "no-store" });
        const data = await res.json();
        if (alive && Array.isArray(data)) setNews(data as NewsItem[]);
      } catch {
        /* keep last headlines */
      }
    };
    void loadNews();
    const id = setInterval(loadNews, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function applyUpdate(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error ?? "Failed to update");
        return false;
      }
      setSnap(data as TrackerSnapshot);
      return true;
    } catch {
      notify("Request failed");
      return false;
    }
  }

  async function copyTrade(id: string) {
    setCopyingId(id);
    await applyUpdate({ copyTradeId: id });
    setCopyingId(null);
  }

  function handleSetLive(live: boolean) {
    if (live) {
      setConfirmLive(true);
      return;
    }
    void applyUpdate({ live: false });
  }

  const stats = snap?.stats;
  const whales = (snap?.events ?? []).filter((e) => e.isWhale);
  const maxUsd = whales.reduce((m, w) => Math.max(m, w.valueUsd), 0);
  const trades = snap?.trades ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="bg-gold/15 text-gold ring-gold/20 flex size-11 items-center justify-center ring-1">
            <Waves className="size-5" strokeWidth={2.25} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Bitcoin Whale Tracker</h1>
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-wider">
              live on-chain whales · auto copy-traded on whop
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="relative flex size-2.5" title={error ? "error" : connected ? "live" : "connecting"}>
            {connected && !error ? (
              <span className="bg-positive absolute inline-flex size-full animate-ping opacity-60" />
            ) : null}
            <span
              className={`relative inline-flex size-2.5 ${
                error ? "bg-negative" : connected ? "bg-positive" : "bg-muted-foreground animate-pulse"
              }`}
            />
          </span>
          {error ? <span className="text-negative font-mono text-xs uppercase tracking-wider">error</span> : null}
          {stats?.btcPriceUsd ? (
            <span className="border-border bg-card flex items-center gap-1.5 border px-3 py-1.5 font-mono text-sm font-medium tabular-nums">
              <span className="text-gold">₿</span> {usd(stats.btcPriceUsd)}
            </span>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      {error ? (
        <Card className="border-negative/40 bg-negative/10 mb-6">
          <CardContent className="text-negative p-4 text-sm">{error}</CardContent>
        </Card>
      ) : null}

      {notice ? (
        <Card className="border-negative/40 bg-negative/10 mb-6">
          <CardContent className="text-negative p-4 font-mono text-sm">{notice}</CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmLive}
        danger
        title="Enable live copy-trading?"
        description={`Real funds will be used to buy ~${usd(stats?.budgetUsd ?? 100)} of cbBTC for every new whale detected. This places real swaps on your Whop account.`}
        confirmLabel="Enable live"
        onConfirm={() => {
          setConfirmLive(false);
          void applyUpdate({ live: true });
        }}
        onCancel={() => setConfirmLive(false)}
      />

      <section className="mb-9 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={Waves} label="Whales" value={stats ? String(stats.whaleCount) : "—"} gold />
        <ThresholdCard value={stats?.thresholdUsd} onCommit={(n) => applyUpdate({ threshold: n })} />
        <CopyTradeCard
          mode={stats?.copyTradeMode}
          budgetUsd={stats?.budgetUsd}
          fromToken={stats?.fromToken}
          accountType={stats?.accountType}
          hasBusiness={!!stats?.businessAccountId}
          hasPersonal={!!stats?.personalAccountId}
          yolo={stats?.yolo}
          onSetLive={handleSetLive}
          onSetBudget={(n) => applyUpdate({ budget: n })}
          onSetAccountType={(t) => applyUpdate({ accountType: t })}
          onSetYolo={(on) => applyUpdate({ yolo: on })}
        />
        <Stat icon={Zap} label="Trades placed" value={stats ? String(stats.copyTradeCount) : "—"} />
        <Stat icon={ScanLine} label="Txs scanned" value={stats ? String(stats.eventCount) : "—"} />
        <Stat icon={Clock} label="Last poll" value={stats?.lastPolledAt ? timeAgo(stats.lastPolledAt) : "—"} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm font-semibold tracking-wide">Whale Feed</h2>
              {whales.length ? (
                <Badge variant="muted" className="font-mono tabular-nums">
                  {whales.length}
                </Badge>
              ) : null}
            </div>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              BTC ≥ {stats ? usd(stats.thresholdUsd) : "—"}
            </span>
          </div>
          <Separator />
          {whales.length === 0 ? (
            <EmptyFeed />
          ) : (
            <div className="divide-border max-h-[640px] divide-y overflow-y-auto">
              {whales.map((event, i) => (
                <WhaleRow
                  key={event.id}
                  event={event}
                  rank={i + 1}
                  maxUsd={maxUsd}
                  canCopy={!!stats && stats.copyTradeMode !== "off"}
                  live={stats?.copyTradeMode === "live"}
                  busy={copyingId === event.id}
                  onCopyTrade={() => copyTrade(event.id)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Newspaper className="text-muted-foreground size-4" />
              <h2 className="font-display text-sm font-semibold tracking-wide">Bitcoin News</h2>
            </div>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {news.length ? `${news.length} stories` : ""}
            </span>
          </div>
          <Separator />
          {news.length === 0 ? (
            <div className="text-muted-foreground py-16 text-center text-sm">No headlines yet.</div>
          ) : (
            <div className="max-h-[640px] overflow-y-auto">
              {news.map((item) => (
                <NewsRow key={item.url} item={item} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Zap className="text-muted-foreground size-4" />
            <h2 className="font-display text-sm font-semibold tracking-wide">Copy Trades</h2>
            {trades.length ? (
              <Badge variant="muted" className="font-mono tabular-nums">
                {trades.length}
              </Badge>
            ) : null}
          </div>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {stats ? `${stats.copyTradeCount} placed` : ""}
          </span>
        </div>
        <Separator />
        {trades.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            No trades yet — click <span className="text-foreground font-mono">copy trade</span> on a whale.
          </div>
        ) : (
          <div className="divide-border max-h-[420px] divide-y overflow-y-auto">
            {trades.map((trade) => (
              <TradeRow key={trade.id} trade={trade} />
            ))}
          </div>
        )}
      </Card>

      <p className="text-muted-foreground/60 mt-6 text-center font-mono text-[11px] uppercase tracking-wider">
        blockchain.info · live BTC price · every whale verifiable on-chain
      </p>
    </main>
  );
}

function Stat({ icon: Icon, label, value, gold }: { icon: LucideIcon; label: string; value: string; gold?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest">{label}</span>
          <Icon className="size-4 opacity-60" />
        </div>
        <div className={`font-mono mt-2 text-2xl font-semibold capitalize tabular-nums ${gold ? "text-gold" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function ThresholdCard({ value, onCommit }: { value: number | undefined; onCommit: (n: number) => void }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest">Threshold</span>
          <Gauge className="size-4 opacity-60" />
        </div>
        <div className="mt-2 flex items-baseline">
          <span className="text-muted-foreground font-mono text-2xl font-semibold">$</span>
          <input
            key={value}
            type="number"
            min={1}
            defaultValue={value ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
            }}
            className="w-full min-w-0 bg-transparent font-mono text-2xl font-semibold tabular-nums outline-none"
            aria-label="Whale threshold in USD"
          />
        </div>
        <span className="text-muted-foreground/60 font-mono text-[10px] uppercase tracking-wider">↵ to apply</span>
      </CardContent>
    </Card>
  );
}

function CopyTradeCard({
  mode,
  budgetUsd,
  fromToken,
  accountType,
  hasBusiness,
  hasPersonal,
  yolo,
  onSetLive,
  onSetBudget,
  onSetAccountType,
  onSetYolo,
}: {
  mode: "off" | "dry-run" | "live" | undefined;
  budgetUsd: number | undefined;
  fromToken: string | undefined;
  accountType: "business" | "personal" | undefined;
  hasBusiness: boolean;
  hasPersonal: boolean;
  yolo: boolean | undefined;
  onSetLive: (live: boolean) => void;
  onSetBudget: (n: number) => void;
  onSetAccountType: (type: "business" | "personal") => void;
  onSetYolo: (on: boolean) => void;
}) {
  const seg = "px-2.5 py-1 uppercase transition-colors";
  const availableTypes = (["business", "personal"] as const).filter((t) =>
    t === "business" ? hasBusiness : hasPersonal,
  );
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest">Copy-trade</span>
          <Repeat2 className="size-4 opacity-60" />
        </div>
        {!mode || mode === "off" ? (
          <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
            set <span className="text-foreground">WHOP_API_KEY</span> in .env.local
          </p>
        ) : (
          <>
            <div className="border-border mt-2.5 inline-flex border font-mono text-[11px]">
              <button
                type="button"
                onClick={() => onSetLive(false)}
                className={`${seg} ${mode !== "live" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                dry-run
              </button>
              <button
                type="button"
                onClick={() => onSetLive(true)}
                className={`${seg} border-border border-l ${mode === "live" ? "bg-negative/20 text-negative" : "text-muted-foreground hover:text-foreground"}`}
              >
                live
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[11px]">
              {availableTypes.length > 1 ? (
                <div className="border-border inline-flex border">
                  {availableTypes.map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onSetAccountType(t)}
                      className={`${seg} ${i > 0 ? "border-border border-l" : ""} ${
                        accountType === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t === "business" ? "biz" : "finance"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono text-xs">
              <span>$</span>
              <input
                key={budgetUsd}
                type="number"
                min={1}
                defaultValue={budgetUsd ?? ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0 && n !== budgetUsd) onSetBudget(n);
                }}
                className="text-foreground w-10 min-w-0 bg-transparent font-mono text-xs tabular-nums outline-none"
                aria-label="Swap size in USD"
              />
              <span className="text-muted-foreground/70 whitespace-nowrap">{fromToken ?? "USD"} / swap</span>
            </div>
            <button
              type="button"
              onClick={() => onSetYolo(!yolo)}
              title="Auto-trade only every other detected whale (skip one, trade the next)"
              className={`mt-2 border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                yolo ? "border-gold/50 bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              yolo {yolo ? "on" : "off"}
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function copyBadge(status: CopyTradeDecision["status"]): { variant: "muted" | "gold" | "positive" | "negative"; label: string } {
  switch (status) {
    case "completed":
      return { variant: "positive", label: "executed" };
    case "pending":
      return { variant: "gold", label: "pending" };
    case "failed":
      return { variant: "negative", label: "failed" };
    default:
      return { variant: "muted", label: "dry-run" };
  }
}

function WhaleRow({
  event,
  rank,
  maxUsd,
  canCopy,
  live,
  busy,
  onCopyTrade,
}: {
  event: WhaleEvent;
  rank: number;
  maxUsd: number;
  canCopy: boolean;
  live: boolean;
  busy: boolean;
  onCopyTrade: () => void;
}) {
  const ct = event.copyTrade;
  const width = maxUsd > 0 ? Math.max(4, Math.round((event.valueUsd / maxUsd) * 100)) : 4;
  const badge = ct ? copyBadge(ct.status) : null;
  const pending = ct?.status === "pending";
  const working = busy || pending;
  return (
    <div className="hover:bg-accent/40 px-5 py-3.5 transition-colors">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-muted-foreground/50 w-5 text-right font-mono text-xs tabular-nums">
            {String(rank).padStart(2, "0")}
          </span>
          <span className="text-gold font-mono text-lg font-semibold tracking-tight tabular-nums">
            {usd(event.valueUsd)}
          </span>
          <span className="text-muted-foreground font-mono text-sm tabular-nums">{btc(event.valueBtc)}</span>
        </div>
        <div className="flex items-center gap-3">
          {canCopy ? (
            <button
              type="button"
              onClick={onCopyTrade}
              disabled={working}
              className={`border-border inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider transition-colors disabled:opacity-50 ${
                live ? "text-negative hover:bg-negative/10" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {working ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
              {busy ? "swapping…" : pending ? "settling…" : ct ? "retry" : live ? "copy trade" : "quote"}
            </button>
          ) : null}
          <a
            href={event.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
          >
            verify <ArrowUpRight className="size-3" />
          </a>
        </div>
      </div>

      <div className="bg-secondary mt-2 ml-7 h-1 overflow-hidden">
        <div className="bg-gold/70 h-full" style={{ width: `${width}%` }} />
      </div>

      <div className="text-muted-foreground mt-2 ml-7 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
        <span className="tabular-nums">{timeAgo(event.detectedAt)}</span>
        {ct && badge ? (
          <span className="inline-flex items-center gap-1.5">
            <Badge variant={badge.variant} className="inline-flex items-center gap-1 font-mono uppercase">
              {pending ? <Loader2 className="size-3 animate-spin" /> : null}
              {badge.label}
            </Badge>
            {ct.error ? (
              <span className="text-negative/90">{ct.error}</span>
            ) : (
              <span className="tabular-nums">
                buy {usd(ct.sizeUsd)} {ct.fromToken} → {ct.quote ? `${ct.quote.amountOut} ${ct.toToken}` : "?"}
              </span>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: PlacedTrade }) {
  const d = trade.decision;
  const badge = copyBadge(d.status);
  const pending = d.status === "pending";
  return (
    <div className="hover:bg-accent/40 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3 font-mono text-xs transition-colors">
      <div className="flex items-center gap-3">
        <Badge variant={badge.variant} className="inline-flex min-w-[70px] items-center justify-center gap-1 font-mono uppercase">
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          {badge.label}
        </Badge>
        <span className="tabular-nums">
          buy {usd(d.sizeUsd)} {d.fromToken} → {d.quote ? `${d.quote.amountOut} ${d.toToken}` : "?"}
        </span>
      </div>
      <div className="text-muted-foreground flex items-center gap-3">
        {d.error ? <span className="text-negative/90 max-w-[320px] truncate">{d.error}</span> : null}
        <span className="tabular-nums">{usd(trade.valueUsd)} whale</span>
        <span className="tabular-nums">{timeAgo(trade.placedAt)}</span>
        <a
          href={trade.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground inline-flex items-center gap-0.5"
        >
          verify <ArrowUpRight className="size-3" />
        </a>
      </div>
    </div>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="border-border hover:bg-accent/40 group flex flex-col gap-1 border-b px-5 py-3 transition-colors"
    >
      <span className="group-hover:text-gold text-sm leading-snug transition-colors">{item.title}</span>
      <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
        <span className="text-gold/80">{item.source}</span>
        {item.publishedAt ? <span>· {timeAgo(item.publishedAt)}</span> : null}
        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </a>
  );
}

function EmptyFeed() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <span className="bg-secondary flex size-12 items-center justify-center">
        <Waves className="text-muted-foreground size-6" />
      </span>
      <div className="text-center">
        <p className="text-sm font-medium">Scanning the mempool…</p>
        <p className="text-muted-foreground text-xs">Whale-sized transactions will appear here in real time.</p>
      </div>
    </div>
  );
}
