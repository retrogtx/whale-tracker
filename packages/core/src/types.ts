import type { CopyTradeDecision } from "./copytrade.js";

export interface WhaleEvent {
  id: string;
  txid: string;
  explorerUrl: string;
  valueBtc: number;
  valueUsd: number;
  inputs: number;
  outputs: number;
  detectedAt: string;
  isWhale: boolean;
  copyTrade: CopyTradeDecision | null;
}

export interface ApiCall {
  id: number;
  method: string;
  endpoint: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  ts: string;
  error: string | null;
}

export interface TrackerStats {
  pollCount: number;
  eventCount: number;
  whaleCount: number;
  btcPriceUsd: number | null;
  lastPolledAt: string | null;
  lastError: string | null;
  thresholdUsd: number;
  copyTradeMode: "off" | "dry-run" | "live";
  copyTradeCount: number;
  hasApiKey: boolean;
  accountId: string | null;
  running: boolean;
}

export interface TrackerSnapshot {
  stats: TrackerStats;
  events: WhaleEvent[];
  apiCalls: ApiCall[];
}
