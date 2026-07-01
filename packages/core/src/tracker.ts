import type { TrackerConfig } from "./config.js";
import { createWhopClient, type WhopClient } from "./whop.js";
import { explorerUrl, fetchBtcPriceUsd, fetchRecentTxs, type RawTx } from "./bitcoin.js";
import { planCopyTrade, refreshSwapStatus } from "./copytrade.js";
import type { CopyTradeDecision } from "./copytrade.js";
import type { ApiCall, PlacedTrade, TrackerSnapshot, WhaleEvent } from "./types.js";

export interface PollResult {
  newEvents: WhaleEvent[];
  newWhales: WhaleEvent[];
  backfill: boolean;
}

export type WhaleListener = (event: WhaleEvent) => void;

export class WhaleTracker {
  private readonly events: WhaleEvent[] = [];
  private readonly apiCalls: ApiCall[] = [];
  private readonly trades: PlacedTrade[] = [];
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<WhaleListener>();

  // Runtime-mutable settings (editable from the dashboard).
  private apiKey: string | undefined;
  private accountId: string | undefined;
  private threshold: number;
  private live: boolean;
  private budgetUsd: number;
  private whop: WhopClient | null;

  private apiCallSeq = 0;
  private tradeSeq = 0;
  private pollCount = 0;
  private copyTradeCount = 0;
  private btcPriceUsd: number | null = null;
  private seeded = false;
  private lastPolledAt: string | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Whop allows only one swap in flight per account — serialize live swaps.
  private swapQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: TrackerConfig) {
    this.apiKey = config.whopApiKey;
    this.accountId = config.copyTradeAccountId;
    this.threshold = config.thresholdUsd;
    this.live = config.copyTradeLive;
    this.budgetUsd = config.copyTradeBudgetUsd;
    this.whop = this.apiKey ? createWhopClient(this.apiKey, config.whopBaseURL) : null;
  }

  onWhale(listener: WhaleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private get copyEnabled(): boolean {
    return this.config.copyTrade && this.whop != null;
  }

  /** Switch copy-trading between dry-run and live at runtime. */
  setLive(live: boolean): { ok: boolean; error?: string } {
    if (!this.copyEnabled) return { ok: false, error: "Connect a Whop API key first." };
    if (live && !this.accountId) return { ok: false, error: "Set a trading account ID before going live." };
    this.live = live;
    return { ok: true };
  }

  /** Change the whale USD threshold and re-classify stored events. */
  setThreshold(value: number): { ok: boolean; error?: string } {
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Threshold must be a positive number." };
    this.threshold = value;
    for (const event of this.events) event.isWhale = event.valueUsd >= value;
    return { ok: true };
  }

  /** Set Whop credentials at runtime. The key is held in memory only. */
  setCredentials(apiKey: string | undefined, accountId: string | undefined): { ok: boolean; error?: string } {
    if (accountId !== undefined) this.accountId = accountId.trim() || undefined;
    if (apiKey !== undefined) {
      const trimmed = apiKey.trim();
      this.apiKey = trimmed || undefined;
      this.whop = this.apiKey ? createWhopClient(this.apiKey, this.config.whopBaseURL) : null;
      if (!this.whop) this.live = false;
    }
    return { ok: true };
  }

  /** Change the USD size of each mirrored swap at runtime. */
  setBudget(value: number): { ok: boolean; error?: string } {
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Swap size must be a positive number." };
    this.budgetUsd = value;
    return { ok: true };
  }

  /** Fire a copy-trade for one already-detected whale on demand and store the result. */
  async copyTradeNow(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.copyEnabled || !this.whop) return { ok: false, error: "Connect a Whop API key first." };
    if (this.live && !this.accountId) return { ok: false, error: "Set a trading account ID before going live." };
    const whale = this.events.find((e) => e.id === id);
    if (!whale) return { ok: false, error: "Whale not found." };

    const decision = await this.runCopyTrade(whale);
    if (decision) {
      whale.copyTrade = decision;
      this.recordTrade(whale, decision);
      if (decision.status === "completed") this.copyTradeCount += 1;
    }
    return { ok: true };
  }

  /** Persist a placed trade in a stable list, independent of the volatile whale feed. */
  private recordTrade(whale: WhaleEvent, decision: CopyTradeDecision): void {
    this.trades.unshift({
      id: `t${(this.tradeSeq += 1)}`,
      whaleId: whale.id,
      valueUsd: whale.valueUsd,
      valueBtc: whale.valueBtc,
      explorerUrl: whale.explorerUrl,
      placedAt: new Date().toISOString(),
      decision,
    });
    this.trades.length = Math.min(this.trades.length, this.config.maxEvents);
  }

  /** Run a copy-trade for one whale, serializing live swaps (one per account at a time). */
  private runCopyTrade(whale: WhaleEvent): Promise<CopyTradeDecision | null> {
    const run = () =>
      planCopyTrade(
        this.whop as WhopClient,
        {
          fromToken: this.config.fromToken,
          toToken: this.config.toToken,
          sizeUsd: this.budgetUsd,
          accountId: this.accountId,
          live: this.live,
        },
        whale,
      );
    return this.timed("POST", this.live ? "POST /swaps" : "POST /swaps/quote", () =>
      this.live ? this.enqueueSwap(run) : run(),
    );
  }

  /** Chain a live swap onto the queue so only one runs at a time. */
  private enqueueSwap<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.swapQueue.then(fn, fn);
    this.swapQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Re-check swaps still marked pending and fold their settled status into the trade + feed. */
  private async reconcilePendingSwaps(): Promise<void> {
    if (!this.whop) return;
    for (const trade of this.trades) {
      const d = trade.decision;
      if (d.status !== "pending" || !d.swapId) continue;
      const updated = await refreshSwapStatus(this.whop, d);
      trade.decision = updated;
      const event = this.events.find((e) => e.id === trade.whaleId);
      if (event) event.copyTrade = updated;
      if (updated.status === "completed") this.copyTradeCount += 1;
      if (event && (updated.status === "completed" || updated.status === "failed")) this.emit(event);
    }
  }

  async pollOnce(): Promise<PollResult> {
    const backfill = !this.seeded;
    const price = await this.timed("GET", "GET /ticker", () => fetchBtcPriceUsd(this.config.btcApiBase));
    if (price != null) this.btcPriceUsd = price;
    const txs = await this.timed("GET", "GET /unconfirmed-transactions", () =>
      fetchRecentTxs(this.config.btcApiBase),
    );

    this.pollCount += 1;
    this.lastPolledAt = new Date().toISOString();

    const newEvents: WhaleEvent[] = [];
    const newWhales: WhaleEvent[] = [];
    if (txs && this.btcPriceUsd != null) {
      for (const tx of txs) {
        if (this.seen.has(tx.txid)) continue;
        this.seen.add(tx.txid);
        const event = this.toEvent(tx, this.btcPriceUsd);
        newEvents.push(event);
        if (event.isWhale) newWhales.push(event);
      }
    }

    if (newEvents.length > 0) {
      this.events.unshift(...newEvents.sort((a, b) => b.valueUsd - a.valueUsd));
      this.events.length = Math.min(this.events.length, this.config.maxEvents);
    }

    for (const whale of newWhales) {
      if (backfill) continue;
      if (this.copyEnabled && this.whop) {
        whale.copyTrade = await this.runCopyTrade(whale);
        if (whale.copyTrade) {
          this.recordTrade(whale, whale.copyTrade);
          if (whale.copyTrade.status === "completed") this.copyTradeCount += 1;
        }
      }
      this.emit(whale);
    }

    if (!backfill) await this.reconcilePendingSwaps();

    this.seeded = true;
    return { newEvents, newWhales, backfill };
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      void this.pollOnce().catch(() => {
        /* errors are recorded per api call + lastError */
      });
    };
    tick();
    this.timer = setInterval(tick, this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  snapshot(): TrackerSnapshot {
    const mode = !this.copyEnabled ? "off" : this.live ? "live" : "dry-run";
    return {
      stats: {
        pollCount: this.pollCount,
        eventCount: this.events.length,
        whaleCount: this.events.reduce((n, e) => n + (e.isWhale ? 1 : 0), 0),
        btcPriceUsd: this.btcPriceUsd,
        lastPolledAt: this.lastPolledAt,
        lastError: this.lastError,
        thresholdUsd: this.threshold,
        budgetUsd: this.budgetUsd,
        copyTradeMode: mode,
        copyTradeCount: this.copyTradeCount,
        hasApiKey: this.whop != null,
        accountId: this.accountId ?? null,
        running: this.timer != null,
      },
      events: [...this.events],
      apiCalls: [...this.apiCalls],
      trades: [...this.trades],
    };
  }

  private toEvent(tx: RawTx, price: number): WhaleEvent {
    const valueBtc = tx.sats / 1e8;
    const valueUsd = valueBtc * price;
    return {
      id: tx.txid,
      txid: tx.txid,
      explorerUrl: explorerUrl(tx.txid),
      valueBtc,
      valueUsd,
      inputs: tx.inputs,
      outputs: tx.outputs,
      detectedAt: new Date().toISOString(),
      isWhale: valueUsd >= this.threshold,
      copyTrade: null,
    };
  }

  private emit(event: WhaleEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async timed<T>(method: string, endpoint: string, fn: () => Promise<T>): Promise<T | null> {
    const start = Date.now();
    try {
      const result = await fn();
      this.recordCall(method, endpoint, 200, true, Date.now() - start, null);
      this.lastError = null;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusMatch = message.match(/\b(\d{3})\b/);
      this.recordCall(method, endpoint, statusMatch ? Number(statusMatch[1]) : 0, false, Date.now() - start, message);
      this.lastError = message;
      return null;
    }
  }

  private recordCall(
    method: string,
    endpoint: string,
    status: number,
    ok: boolean,
    latencyMs: number,
    error: string | null,
  ): void {
    this.apiCalls.unshift({
      id: (this.apiCallSeq += 1),
      method,
      endpoint,
      status,
      ok,
      latencyMs,
      ts: new Date().toISOString(),
      error,
    });
    this.apiCalls.length = Math.min(this.apiCalls.length, this.config.maxEvents);
  }
}
