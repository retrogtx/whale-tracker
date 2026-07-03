import type { TrackerConfig } from "./config.js";
import { createWhopClient, listAccounts, type WhopAccount, type WhopClient } from "./whop.js";
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
  // Raw recent transactions — used for the "txs scanned" count; churns fast.
  private readonly events: WhaleEvent[] = [];
  // Detected whales kept in their own bounded list so the flood of small txs
  // can't evict them from the feed.
  private whales: WhaleEvent[] = [];
  private readonly apiCalls: ApiCall[] = [];
  private readonly trades: PlacedTrade[] = [];
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<WhaleListener>();

  // Runtime-mutable settings (editable from the dashboard).
  private apiKey: string | undefined;
  private businessAccountId: string | undefined;
  private personalAccountId: string | undefined;
  private accountType: "business" | "personal";
  private availableAccounts: WhopAccount[] = [];
  private readonly fromToken: string;
  private readonly verbose: boolean;
  private threshold: number;
  private live: boolean;
  private budgetUsd: number;
  // YOLO: auto-trade only every other detected whale (skip one, trade the next).
  private yolo = false;
  private yoloCounter = 0;
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
    const acct = config.copyTradeAccountId;
    const seededPersonal = acct?.startsWith("user_") ? acct : undefined;
    this.personalAccountId = seededPersonal;
    this.businessAccountId = seededPersonal ? undefined : acct;
    this.accountType = seededPersonal ? "personal" : "business";
    this.fromToken = config.fromToken;
    this.verbose = config.verbose;
    this.threshold = config.thresholdUsd;
    this.live = config.copyTradeLive;
    this.budgetUsd = config.copyTradeBudgetUsd;
    this.whop = this.apiKey ? createWhopClient(this.apiKey, config.whopBaseURL) : null;
  }

  /** The account currently selected for trading. */
  private get accountId(): string | undefined {
    return this.accountType === "business" ? this.businessAccountId : this.personalAccountId;
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
    if (live && !this.accountId) {
      return { ok: false, error: `Set a ${this.accountType} account ID before going live.` };
    }
    this.live = live;
    return { ok: true };
  }

  /** Switch which wallet funds swaps: personal (/finance, user_) or business (biz_). */
  setAccountType(type: "business" | "personal"): { ok: boolean; error?: string } {
    this.accountType = type;
    return { ok: true };
  }

  /** YOLO: auto-trade only every other detected whale. Leaves threshold and size untouched. */
  setYolo(on: boolean): { ok: boolean; error?: string } {
    this.yolo = on;
    this.yoloCounter = 0;
    return { ok: true };
  }

  /** In YOLO mode, skip the 1st eligible whale, trade the 2nd, skip the 3rd, and so on. */
  private yoloShouldSkip(): boolean {
    if (!this.yolo) return false;
    this.yoloCounter += 1;
    return this.yoloCounter % 2 === 1;
  }

  /** Change the whale USD threshold and re-classify stored events + the whale feed. */
  setThreshold(value: number): { ok: boolean; error?: string } {
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Threshold must be a positive number." };
    this.threshold = value;
    for (const event of this.events) event.isWhale = event.valueUsd >= value;
    // Rebuild the feed: keep existing whales that still qualify, plus any
    // in-window txs that now do. Drops those below a raised threshold.
    const byId = new Map<string, WhaleEvent>();
    for (const w of this.whales) if (w.valueUsd >= value) byId.set(w.id, w);
    for (const e of this.events) if (e.valueUsd >= value) byId.set(e.id, e);
    this.whales = [...byId.values()].sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );
    this.whales.length = Math.min(this.whales.length, this.config.maxEvents);
    return { ok: true };
  }

  /** Find a detected whale by id — checks the persistent feed first, then raw events. */
  private findWhale(id: string): WhaleEvent | undefined {
    return this.whales.find((e) => e.id === id) ?? this.events.find((e) => e.id === id);
  }

  /** Discover the accounts this key can trade from and auto-fill any that aren't set yet. */
  async discoverAccounts(): Promise<{ ok: boolean; error?: string }> {
    if (!this.whop) {
      this.availableAccounts = [];
      return { ok: false, error: "Connect a Whop API key first." };
    }
    const accounts = await listAccounts(this.whop);
    this.availableAccounts = accounts;
    if (!this.businessAccountId) this.businessAccountId = accounts.find((a) => a.type === "business")?.id;
    if (!this.personalAccountId) this.personalAccountId = accounts.find((a) => a.type === "personal")?.id;
    // If the selected type has no account but the other does, switch to the usable one.
    if (!this.accountId) {
      if (this.accountType === "personal" && this.businessAccountId) this.accountType = "business";
      else if (this.accountType === "business" && this.personalAccountId) this.accountType = "personal";
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
    const whale = this.findWhale(id);
    if (!whale) return { ok: false, error: "Whale not found." };

    const decision = await this.runCopyTrade(whale);
    if (decision) {
      whale.copyTrade = decision;
      this.recordTrade(whale, decision);
      if (decision.swapId) this.copyTradeCount += 1;
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
    const out = decision.quote ? `${decision.quote.amountOut} ${decision.toToken}` : "?";
    const tail = decision.swapId ? ` · swap=${decision.swapId}` : decision.error ? ` · ${decision.error}` : "";
    this.vlog(`  ↳ copy-trade ${decision.status}: buy $${decision.sizeUsd} ${decision.fromToken} → ${out}${tail}`);
  }

  /** Run a copy-trade for one whale, serializing live swaps (one per account at a time). */
  private runCopyTrade(whale: WhaleEvent): Promise<CopyTradeDecision | null> {
    const run = () =>
      planCopyTrade(
        this.whop as WhopClient,
        {
          fromToken: this.fromToken,
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
      const event = this.findWhale(trade.whaleId);
      if (event) event.copyTrade = updated;
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

    if (newWhales.length > 0) {
      this.whales.unshift(...newWhales.slice().sort((a, b) => b.valueUsd - a.valueUsd));
      this.whales.length = Math.min(this.whales.length, this.config.maxEvents);
    }

    const priceTag = this.btcPriceUsd != null ? ` · BTC $${Math.round(this.btcPriceUsd).toLocaleString("en-US")}` : "";
    this.vlog(
      backfill
        ? `seeded ${newEvents.length} txs · ${newWhales.length} whales ≥ $${this.threshold.toLocaleString("en-US")}${priceTag}`
        : `poll #${this.pollCount} · +${newEvents.length} txs · ${newWhales.length} whales${priceTag}`,
    );

    for (const whale of newWhales) {
      this.vlog(WhaleTracker.whaleLine(whale));
      if (backfill) continue;
      if (this.copyEnabled && this.whop && !this.yoloShouldSkip()) {
        whale.copyTrade = await this.runCopyTrade(whale);
        if (whale.copyTrade) {
          this.recordTrade(whale, whale.copyTrade);
          if (whale.copyTrade.swapId) this.copyTradeCount += 1;
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
        whaleCount: this.whales.length,
        btcPriceUsd: this.btcPriceUsd,
        lastPolledAt: this.lastPolledAt,
        lastError: this.lastError,
        thresholdUsd: this.threshold,
        budgetUsd: this.budgetUsd,
        copyTradeMode: mode,
        yolo: this.yolo,
        copyTradeCount: this.copyTradeCount,
        hasApiKey: this.whop != null,
        accountId: this.accountId ?? null,
        accountType: this.accountType,
        businessAccountId: this.businessAccountId ?? null,
        personalAccountId: this.personalAccountId ?? null,
        accounts: [...this.availableAccounts],
        fromToken: this.fromToken,
        toToken: this.config.toToken,
        running: this.timer != null,
      },
      events: [...this.events],
      whales: [...this.whales],
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

  /** Console log gated by the verbose flag — used for continuous server-side tracing. */
  private vlog(msg: string): void {
    if (!this.verbose) return;
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }

  private static whaleLine(w: WhaleEvent): string {
    return `🐋 whale $${Math.round(w.valueUsd).toLocaleString("en-US")} · ${w.valueBtc.toFixed(4)} BTC · ${w.txid.slice(0, 10)}…`;
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
    this.vlog(`${ok ? "→" : "✗"} ${method} ${endpoint} · ${status} · ${latencyMs}ms${error ? ` · ${error}` : ""}`);
  }
}
