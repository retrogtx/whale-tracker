import type { CopyTradeDecision } from "./copytrade.js";
import type { WhopAccount } from "./whop.js";

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
  budgetUsd: number;
  copyTradeMode: "off" | "dry-run" | "live";
  yolo: boolean;
  copyTradeCount: number;
  hasApiKey: boolean;
  accountId: string | null;
  accountType: "business" | "personal";
  businessAccountId: string | null;
  personalAccountId: string | null;
  accounts: WhopAccount[];
  fromToken: string;
  toToken: string;
  running: boolean;
}

export interface PlacedTrade {
  id: string;
  whaleId: string;
  valueUsd: number;
  valueBtc: number;
  explorerUrl: string;
  placedAt: string;
  decision: CopyTradeDecision;
}

export interface TrackerSnapshot {
  stats: TrackerStats;
  events: WhaleEvent[];
  apiCalls: ApiCall[];
  trades: PlacedTrade[];
}
