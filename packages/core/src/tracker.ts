import type { TrackerConfig } from "./config.js";
import { createWhopClient, type WhopClient } from "./whop.js";
import { explorerUrl, fetchBtcPriceUsd, fetchRecentTxs, type RawTx } from "./bitcoin.js";
import { planCopyTrade } from "./copytrade.js";
import type { ApiCall, TrackerSnapshot, WhaleEvent } from "./types.js";

export interface PollResult {
  newEvents: WhaleEvent[];
  newWhales: WhaleEvent[];
  backfill: boolean;
}

export type WhaleListener = (event: WhaleEvent) => void;

export class WhaleTracker {
  private readonly events: WhaleEvent[] = [];
  private readonly apiCalls: ApiCall[] = [];
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<WhaleListener>();

  // Runtime-mutable settings (editable from the dashboard).
  private apiKey: string | undefined;
  private accountId: string | undefined;
  private threshold: number;
  private live: boolean;
  private whop: WhopClient | null;

  private apiCallSeq = 0;
  private pollCount = 0;
  private copyTradeCount = 0;
  private btcPriceUsd: number | null = null;
  private seeded = false;
  private lastPolledAt: string | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: TrackerConfig) {
    this.apiKey = config.whopApiKey;
    this.accountId = config.copyTradeAccountId;
    this.threshold = config.thresholdUsd;
    this.live = config.copyTradeLive;
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
        whale.copyTrade = await this.timed("POST", this.live ? "POST /swaps" : "POST /swaps/quote", () =>
          planCopyTrade(
            this.whop as WhopClient,
            {
              fromToken: this.config.fromToken,
              toToken: this.config.toToken,
              sizeUsd: this.config.copyTradeBudgetUsd,
              accountId: this.accountId,
              live: this.live,
            },
            whale,
          ),
        );
        if (whale.copyTrade) this.copyTradeCount += 1;
      }
      this.emit(whale);
    }

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
        copyTradeMode: mode,
        copyTradeCount: this.copyTradeCount,
        hasApiKey: this.whop != null,
        accountId: this.accountId ?? null,
        running: this.timer != null,
      },
      events: [...this.events],
      apiCalls: [...this.apiCalls],
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
