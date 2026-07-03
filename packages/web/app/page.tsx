"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Clock, Gauge, Loader2, Newspaper, Repeat2, ScanLine, Volume2, VolumeX, Waves, Zap, type LucideIcon } from "lucide-react";
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

/** Smoothly tween a number toward its target — the count-up / odometer effect. */
function useTween(target: number, ms = 900): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return display;
}

function AnimatedUsd({ value, className }: { value: number; className?: string }) {
  return <span className={className}>{usd(Math.round(useTween(value)))}</span>;
}

let audioCtx: AudioContext | null = null;
function tone(freq: number, ms: number, type: OscillatorType, gain: number): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g).connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.start(t);
    osc.stop(t + ms / 1000);
  } catch {
    /* audio unavailable */
  }
}
function whalePing(): void {
  tone(430, 150, "sine", 0.05);
  window.setTimeout(() => tone(645, 200, "sine", 0.045), 90);
}
function tradeChime(): void {
  tone(880, 90, "triangle", 0.05);
  window.setTimeout(() => tone(1320, 220, "triangle", 0.05), 80);
}
function settleChime(): void {
  tone(660, 100, "triangle", 0.05);
  window.setTimeout(() => tone(990, 110, "triangle", 0.05), 100);
  window.setTimeout(() => tone(1320, 320, "triangle", 0.055), 210);
}

const BURST_PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  const dist = 90 + (i % 3) * 26;
  return { tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist };
});

export default function Home() {
  const [snap, setSnap] = useState<TrackerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [confirmLive, setConfirmLive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [whaleAlert, setWhaleAlert] = useState<WhaleEvent | null>(null);
  const [burst, setBurst] = useState<{ id: string; label: string; settled: boolean } | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [session, setSession] = useState({ volume: 0, whales: 0, trades: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenWhales = useRef<Set<string>>(new Set());
  const seenTrades = useRef<Set<string>>(new Set());
  const settledSeen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const mutedRef = useRef(true);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Diff each poll against what we've seen to fire the dopamine effects:
  // a whale alert + row flash on new whales, a burst on new trades, a rolling counter.
  useEffect(() => {
    if (!snap) return;
    const whaleList = snap.whales;

    if (!primed.current) {
      whaleList.forEach((w) => seenWhales.current.add(w.id));
      snap.trades.forEach((t) => {
        seenTrades.current.add(t.id);
        if (t.decision.status === "completed") settledSeen.current.add(t.id);
      });
      setSession({
        volume: whaleList.reduce((s, w) => s + w.valueUsd, 0),
        whales: whaleList.length,
        trades: snap.trades.length,
      });
      primed.current = true;
      return;
    }

    const freshWhales = whaleList.filter((w) => !seenWhales.current.has(w.id));
    if (freshWhales.length > 0) {
      freshWhales.forEach((w) => seenWhales.current.add(w.id));
      const added = freshWhales.reduce((s, w) => s + w.valueUsd, 0);
      setSession((s) => ({ ...s, volume: s.volume + added, whales: s.whales + freshWhales.length }));
      const biggest = freshWhales.reduce((a, b) => (b.valueUsd > a.valueUsd ? b : a));
      setWhaleAlert(biggest);
      setFlashIds((prev) => new Set([...prev, ...freshWhales.map((w) => w.id)]));
      if (!mutedRef.current) whalePing();
      if (alertTimer.current) clearTimeout(alertTimer.current);
      alertTimer.current = setTimeout(() => setWhaleAlert(null), 4200);
      const ids = freshWhales.map((w) => w.id);
      setTimeout(() => {
        setFlashIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, 1600);
    }

    const freshTrades = snap.trades.filter((t) => !seenTrades.current.has(t.id));
    if (freshTrades.length > 0) {
      freshTrades.forEach((t) => seenTrades.current.add(t.id));
      setSession((s) => ({ ...s, trades: s.trades + freshTrades.length }));
      const d = freshTrades[0].decision;
      const out = d.quote ? `${d.quote.amountOut} ${d.toToken}` : d.toToken;
      fireBurst({ id: freshTrades[0].id, label: `+${out}`, settled: false });
    }

    // Real live swaps settle asynchronously — celebrate the moment funds actually land.
    const settled = snap.trades.filter((t) => t.decision.status === "completed" && !settledSeen.current.has(t.id));
    if (settled.length > 0) {
      settled.forEach((t) => settledSeen.current.add(t.id));
      const d = settled[0].decision;
      const out = d.quote ? `${d.quote.amountOut} ${d.toToken}` : d.toToken;
      fireBurst({ id: `settled-${settled[0].id}`, label: `+${out}`, settled: true });
    }
  }, [snap]);

  function fireBurst(next: { id: string; label: string; settled: boolean }): void {
    setBurst(next);
    if (!mutedRef.current) (next.settled ? settleChime : tradeChime)();
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(null), next.settled ? 2200 : 1400);
  }

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
  const whales = snap?.whales ?? [];
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
          <button
            type="button"
            aria-label={muted ? "Unmute alerts" : "Mute alerts"}
            onClick={() => setMuted((m) => !m)}
            className="border-border bg-card text-muted-foreground hover:text-foreground flex size-9 items-center justify-center border transition-colors"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {whaleAlert ? <WhaleAlert key={whaleAlert.id} event={whaleAlert} /> : null}
      {burst ? <TradeBurst key={burst.id} label={burst.label} settled={burst.settled} /> : null}

      <SessionBar volume={session.volume} whales={session.whales} trades={session.trades} />

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
                  flash={flashIds.has(event.id)}
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
  flash,
  onCopyTrade,
}: {
  event: WhaleEvent;
  rank: number;
  maxUsd: number;
  canCopy: boolean;
  live: boolean;
  busy: boolean;
  flash: boolean;
  onCopyTrade: () => void;
}) {
  const ct = event.copyTrade;
  const width = maxUsd > 0 ? Math.max(4, Math.round((event.valueUsd / maxUsd) * 100)) : 4;
  const badge = ct ? copyBadge(ct.status) : null;
  const pending = ct?.status === "pending";
  const working = busy || pending;
  return (
    <div className={`px-5 py-3.5 transition-colors ${flash ? "whale-flash" : "hover:bg-accent/40"}`}>
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

function SessionBar({ volume, whales, trades }: { volume: number; whales: number; trades: number }) {
  return (
    <div className="border-border bg-card mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-muted-foreground font-mono text-[10px] font-medium uppercase tracking-widest">
          Tracked this session
        </span>
        <AnimatedUsd value={volume} className="text-gold font-display text-3xl font-semibold tabular-nums" />
        <ArrowUpRight className="text-gold/70 size-5" />
      </div>
      <div className="text-muted-foreground flex items-center gap-5 font-mono text-xs uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          <Waves className="size-3.5" /> {whales} whales
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="size-3.5" /> {trades} copied
        </span>
      </div>
    </div>
  );
}

function WhaleAlert({ event }: { event: WhaleEvent }) {
  return (
    <div className="animate-in fade-in slide-in-from-top-2 fixed left-1/2 top-6 z-[60] -translate-x-1/2 duration-300">
      <div className="border-gold/50 bg-card/95 flex items-center gap-3 border px-5 py-3 shadow-2xl backdrop-blur">
        <span className="bg-gold/15 flex size-10 items-center justify-center text-xl">🐋</span>
        <div className="flex flex-col leading-tight">
          <span className="text-gold/80 font-mono text-[10px] font-medium uppercase tracking-widest">Whale detected</span>
          <AnimatedUsd value={event.valueUsd} className="text-gold font-display text-2xl font-semibold tabular-nums" />
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">{btc(event.valueBtc)}</span>
        </div>
      </div>
    </div>
  );
}

function TradeBurst({ label, settled }: { label: string; settled: boolean }) {
  const accent = settled ? "text-positive" : "text-gold";
  const subtle = settled ? "text-positive/80" : "text-gold/80";
  const dot = settled ? "bg-positive" : "bg-gold";
  const border = settled ? "border-positive/60" : "border-gold/50";
  const particles = settled ? [...BURST_PARTICLES, ...BURST_PARTICLES] : BURST_PARTICLES;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
      <div className="relative">
        {particles.map((p, i) => (
          <span
            key={i}
            className={`coin-particle ${dot} absolute left-1/2 top-1/2 rounded-full ${settled && i % 2 ? "size-2.5" : "size-2"}`}
            style={{ "--tx": `${settled ? p.tx * 1.4 : p.tx}px`, "--ty": `${settled ? p.ty * 1.4 : p.ty}px` } as unknown as CSSProperties}
          />
        ))}
        <div className={`animate-in fade-in zoom-in-50 ${border} bg-card/95 flex items-center gap-2 border px-5 py-3 shadow-2xl backdrop-blur duration-200`}>
          <Zap className={`${accent} size-5`} />
          <div className="flex flex-col leading-tight">
            <span className={`${subtle} font-mono text-[10px] font-medium uppercase tracking-widest`}>
              {settled ? "Swap settled" : "Trade placed"}
            </span>
            <span className={`${accent} font-display text-lg font-semibold tabular-nums`}>{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
