# 🐋 Bitcoin Whale Tracker

Tracks **real on-chain Bitcoin whales** — large BTC transactions live from the mempool — and
**copy-trades** them on Whop, surfaced through a terminal bot and a web dashboard. Inspired by
[`00MB/bitcoin_trading_bot`](https://github.com/00MB/bitcoin_trading_bot), built with the
official [`@whop/sdk`](https://www.npmjs.com/package/@whop/sdk).

## How it works

1. **Detect** — polls [blockchain.info](https://blockchain.info)'s live unconfirmed-transaction
   feed and values each tx at the current BTC price. Any transaction at or above
   `WHALE_THRESHOLD_USD` (default $1,000,000) is a whale.
2. **Verify** — every whale carries its real `txid` and a
   [mempool.space](https://mempool.space) explorer link, so you can independently confirm it.
3. **Copy-trade** — for each fresh whale, it gets a **real Whop swap quote**
   (`USDT → cbBTC`) for your configured size. It only places a live swap when
   `COPY_TRADE_LIVE=true`; otherwise it's a dry-run (quote only, no funds move).

The data is genuine: no synthetic/demo whales. If the feed is quiet, the list is simply
empty until a real whale-sized transaction appears.

## Layout

```
packages/
  core/   @whale-tracker/core — config, BTC feed, whale detection, copy-trade engine, tracker
  cli/    @whale-tracker/cli  — terminal bot (live whale + copy-trade alerts)
  web/    @whale-tracker/web  — Next.js dashboard (whale feed + API-call log)
```

## Setup

Requires Node ≥ 20 and pnpm.

```bash
pnpm install
cp .env.example .env   # tracking works with no edits; add WHOP_API_KEY for copy-trade
```

Key settings (all optional, with sane defaults):

- `WHALE_THRESHOLD_USD` — whale cutoff (default `1000000`)
- `WHOP_API_KEY` — enables copy-trade quotes (from <https://whop.com/dashboard/developer>)
- `COPY_TRADE_LIVE` — `true` to execute real swaps; needs `WHOP_ACCOUNT_ID`
- `COPY_TRADE_BUDGET_USD`, `COPY_FROM_TOKEN`, `COPY_TO_TOKEN` — mirrored trade sizing/pair

## Run

```bash
pnpm bot    # terminal tracker
pnpm web    # dashboard at http://localhost:3737
```

## Safety

- The Whop API key is only used server-side (the CLI process and the Next.js route handler);
  it's never sent to the browser.
- Live trading is **off by default**. Quotes are read-only and move no funds. Turn on
  `COPY_TRADE_LIVE` only when you intend to trade real money.
- `WHALE_THRESHOLD_USD` is high by design ($1M). Lower it to see smaller movers.
