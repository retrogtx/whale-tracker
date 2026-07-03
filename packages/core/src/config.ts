export interface TrackerConfig {
  // --- Bitcoin whale feed ---
  btcApiBase: string;
  thresholdUsd: number;
  pollIntervalMs: number;
  maxEvents: number;
  // Log every poll, whale, copy-trade, and API call to the console.
  verbose: boolean;
  // --- Whop copy-trade ---
  whopApiKey: string | undefined;
  whopBaseURL: string | undefined;
  copyTrade: boolean;
  copyTradeLive: boolean;
  copyTradeAccountId: string | undefined;
  copyTradeBudgetUsd: number;
  fromToken: string;
  toToken: string;
}

class ConfigError extends Error {}

function numberEnv(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ConfigError(`Invalid ${name}: expected a non-negative number, got "${raw}"`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TrackerConfig {
  const whopApiKey = env.WHOP_API_KEY?.trim() || undefined;
  return {
    btcApiBase: env.BTC_API_BASE?.trim() || "https://blockchain.info",
    thresholdUsd: numberEnv("WHALE_THRESHOLD_USD", 1_000_000, env),
    pollIntervalMs: numberEnv("POLL_INTERVAL_MS", 15_000, env),
    maxEvents: numberEnv("MAX_EVENTS", 200, env),
    verbose: false,
    whopApiKey,
    whopBaseURL: env.WHOP_BASE_URL?.trim() || undefined,
    // Whether copy-trade is allowed at all. A key can be supplied later at runtime.
    copyTrade: boolEnv("COPY_TRADE", true, env),
    copyTradeLive: boolEnv("COPY_TRADE_LIVE", false, env),
    copyTradeAccountId: env.WHOP_ACCOUNT_ID?.trim() || env.WHOP_COMPANY_ID?.trim() || undefined,
    copyTradeBudgetUsd: numberEnv("COPY_TRADE_BUDGET_USD", 100, env),
    fromToken: env.COPY_FROM_TOKEN?.trim() || "USDT",
    toToken: env.COPY_TO_TOKEN?.trim() || "cbBTC",
  };
}
