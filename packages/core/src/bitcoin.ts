export interface RawTx {
  txid: string;
  sats: number;
  inputs: number;
  outputs: number;
}

const TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface TickerShape {
  USD?: { last?: number };
}

/** Live BTC price in USD from blockchain.info /ticker. */
export async function fetchBtcPriceUsd(base: string): Promise<number> {
  const data = (await getJson(`${base}/ticker`)) as TickerShape;
  const last = data.USD?.last;
  if (typeof last !== "number" || !Number.isFinite(last)) {
    throw new Error("Could not read USD price from ticker");
  }
  return last;
}

interface UnconfirmedShape {
  txs?: Array<{
    hash?: string;
    vin_sz?: number;
    vout_sz?: number;
    inputs?: unknown[];
    out?: Array<{ value?: number }>;
  }>;
}

/**
 * Recent unconfirmed transactions from blockchain.info. These are real, live
 * on-chain transactions; `sats` is the total output value (sum of outputs).
 */
export async function fetchRecentTxs(base: string): Promise<RawTx[]> {
  const data = (await getJson(`${base}/unconfirmed-transactions?format=json`)) as UnconfirmedShape;
  const txs = data.txs ?? [];
  const out: RawTx[] = [];
  for (const tx of txs) {
    if (!tx.hash) continue;
    const sats = (tx.out ?? []).reduce((sum, o) => sum + (o.value ?? 0), 0);
    out.push({
      txid: tx.hash,
      sats,
      inputs: tx.vin_sz ?? tx.inputs?.length ?? 0,
      outputs: tx.vout_sz ?? tx.out?.length ?? 0,
    });
  }
  return out;
}

/** Block-explorer URL so every whale can be independently verified. */
export function explorerUrl(txid: string): string {
  return `https://mempool.space/tx/${txid}`;
}
