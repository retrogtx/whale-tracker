export function formatUsd(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatBtc(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} BTC`;
}

export function shortHash(txid: string): string {
  return `${txid.slice(0, 10)}…${txid.slice(-6)}`;
}
