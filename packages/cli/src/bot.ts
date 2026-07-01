import {
  formatBtc,
  formatUsd,
  loadConfig,
  shortHash,
  WhaleTracker,
  type TrackerConfig,
  type WhaleEvent,
} from "@whale-tracker/core";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyLine(event: WhaleEvent): string {
  const ct = event.copyTrade;
  if (!ct) return "";
  if (ct.error) return `\n   ${c.red}↳ copy-trade ${ct.status}: ${ct.error}${c.reset}`;
  const color = ct.status === "completed" ? c.green : ct.status === "failed" ? c.red : c.dim;
  const out = ct.quote ? `${ct.quote.amountOut} ${ct.toToken}` : "?";
  const id = ct.swapId ? ` swap=${ct.swapId}` : "";
  return `\n   ${color}↳ ${ct.status.toUpperCase()}${c.reset}${c.dim} buy ${formatUsd(ct.sizeUsd)} ${ct.fromToken}→${out}${id}${c.reset}`;
}

function whaleLine(event: WhaleEvent): string {
  return (
    `${c.bold}${c.yellow}🐋 WHALE${c.reset} ${c.cyan}${formatUsd(event.valueUsd)}${c.reset} ` +
    `${c.bold}${formatBtc(event.valueBtc)}${c.reset} ` +
    `${c.dim}${shortHash(event.txid)} · ${event.explorerUrl}${c.reset}` +
    copyLine(event)
  );
}

function banner(config: TrackerConfig): void {
  const mode = !config.copyTrade ? "off" : config.copyTradeLive ? "LIVE ⚠" : "dry-run";
  console.log(`${c.bold}🐋 Bitcoin Whale Tracker${c.reset}`);
  console.log(`${c.dim}   source     ${c.reset}${config.btcApiBase} (on-chain BTC txs)`);
  console.log(`${c.dim}   threshold  ${c.reset}${formatUsd(config.thresholdUsd)}`);
  console.log(`${c.dim}   copy-trade ${c.reset}${mode}${config.copyTrade ? ` · ${formatUsd(config.copyTradeBudgetUsd)} ${config.fromToken}→${config.toToken}` : ""}`);
  console.log(`${c.dim}   interval   ${c.reset}${config.pollIntervalMs}ms`);
  console.log("");
}

async function main(): Promise<void> {
  let config: TrackerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`${c.red}Config error:${c.reset} ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  banner(config);
  const tracker = new WhaleTracker(config);
  tracker.onWhale((event) => console.log(whaleLine(event)));

  let running = true;
  process.on("SIGINT", () => {
    running = false;
    console.log(`\n${c.dim}Stopping…${c.reset}`);
  });

  while (running) {
    try {
      const { newEvents, newWhales, backfill } = await tracker.pollOnce();
      const price = tracker.snapshot().stats.btcPriceUsd;
      const ts = new Date().toLocaleTimeString();
      const priceTag = price ? ` ${c.dim}BTC ${formatUsd(price)}${c.reset}` : "";
      if (backfill) {
        console.log(`${c.dim}[${ts}] seeded ${newEvents.length} txs (${newWhales.length} whales over ${formatUsd(config.thresholdUsd)})${c.reset}${priceTag}`);
        for (const w of newWhales) console.log(`${c.dim}  ${whaleLine(w)}${c.reset}`);
      } else if (newEvents.length > 0) {
        console.log(`${c.dim}[${ts}] +${newEvents.length} new txs, ${newWhales.length} whales${c.reset}${priceTag}`);
      } else {
        process.stdout.write(`${c.dim}[${ts}] no new txs${c.reset}${priceTag}\r`);
      }
    } catch (err) {
      console.error(`${c.red}[poll error]${c.reset} ${err instanceof Error ? err.message : String(err)}`);
    }
    if (running) await sleep(config.pollIntervalMs);
  }

  process.exit(0);
}

void main();
