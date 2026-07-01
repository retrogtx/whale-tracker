import type { WhopClient } from "./whop.js";

export type CopyTradeStatus = "dry-run" | "pending" | "completed" | "failed";

export interface CopyTradeParams {
  fromToken: string;
  toToken: string;
  sizeUsd: number;
  accountId: string | undefined;
  live: boolean;
}

export interface CopyTradeDecision {
  action: "buy";
  reason: string;
  sizeUsd: number;
  fromToken: string;
  toToken: string;
  quote: { amountIn: string; amountOut: string; rate: string; feeBps: number } | null;
  live: boolean;
  status: CopyTradeStatus;
  swapId: string | null;
  txHash: string | null;
  error: string | null;
}

interface WhaleInput {
  valueBtc: number;
  valueUsd: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transient failures. Use ONLY for idempotent (read-only) calls. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw last;
}

/** Pull a human-readable message out of a Whop API error body. */
function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return cleanMessage(raw.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? raw);
}

function cleanMessage(msg: string): string {
  if (/insufficient|not enough|balance too low|no funds/i.test(msg)) {
    return `Insufficient USDT balance — fund your Whop wallet. [${msg}]`;
  }
  if (/network error|framing|timeout|ECONNRESET|ETIMEDOUT|fetch failed|503|502/i.test(msg)) {
    return `Swap provider unavailable (transient) — retries on the next whale: ${msg}`;
  }
  return msg;
}

/**
 * Mirror a detected whale by buying BTC (cbBTC) on Whop. We always fetch a real
 * Whop quote. In dry-run we stop there (no funds move). In live mode we submit
 * the swap and poll its real status — never reporting "completed" unless Whop
 * actually settled it.
 */
export async function planCopyTrade(
  whop: WhopClient,
  params: CopyTradeParams,
  whale: WhaleInput,
): Promise<CopyTradeDecision> {
  const decision: CopyTradeDecision = {
    action: "buy",
    reason: `Mirroring ${whale.valueBtc.toFixed(2)} BTC whale move (~$${Math.round(whale.valueUsd).toLocaleString()})`,
    sizeUsd: params.sizeUsd,
    fromToken: params.fromToken,
    toToken: params.toToken,
    quote: null,
    live: params.live,
    status: params.live ? "pending" : "dry-run",
    swapId: null,
    txHash: null,
    error: null,
  };

  try {
    // Quote is read-only — safe to retry on transient errors.
    const quote = await withRetry(() =>
      whop.swaps.createQuote({
        amount: String(params.sizeUsd),
        from_token: params.fromToken,
        to_token: params.toToken,
      }),
    );
    decision.quote = {
      amountIn: quote.amount_in,
      amountOut: quote.amount_out,
      rate: quote.rate,
      feeBps: quote.fee_bps,
    };
  } catch (err) {
    decision.status = params.live ? "failed" : "dry-run";
    decision.error = cleanError(err);
    return decision;
  }

  if (!params.live) return decision;

  if (!params.accountId) {
    decision.status = "failed";
    decision.error = "No trading account set (WHOP_ACCOUNT_ID).";
    return decision;
  }

  let swapId: string;
  try {
    const swap = (await whop.post("/swaps", {
      body: {
        account_id: params.accountId,
        amount: String(params.sizeUsd),
        from_token: params.fromToken,
        to_token: params.toToken,
      },
    })) as { id?: string; status?: string };
    swapId = swap.id ?? "";
    decision.swapId = swap.id ?? null;
    decision.status = normalizeStatus(swap.status);
  } catch (err) {
    // Do NOT retry: executing a swap moves funds and is not idempotent.
    decision.status = "failed";
    decision.error = cleanError(err);
    return decision;
  }

  // Swaps settle asynchronously — poll until terminal so a later failure
  // (e.g. insufficient USDT surfaced after acceptance) shows the real state.
  if (swapId) {
    for (let i = 0; i < 5; i += 1) {
      try {
        const result = (await whop.get(`/swaps/${swapId}`)) as {
          status?: string;
          tx_hashes?: string[];
          error?: string | null;
        };
        decision.status = normalizeStatus(result.status);
        decision.txHash = result.tx_hashes?.[0] ?? null;
        if (result.error) {
          decision.status = "failed";
          decision.error = cleanMessage(result.error);
        }
        if (decision.status === "completed" || decision.status === "failed") break;
      } catch {
        // transient read failure — try again
      }
      if (i < 4) await sleep(1500);
    }
  }

  return decision;
}

function normalizeStatus(status: string | undefined): CopyTradeStatus {
  if (status === "completed" || status === "succeeded") return "completed";
  if (status === "failed" || status === "error") return "failed";
  return "pending";
}
