import { loadConfig, WhaleTracker } from "@whale-tracker/core";

// Survive Next.js HMR / module reloads by stashing the instance on globalThis.
const globalForTracker = globalThis as unknown as { whaleTracker?: WhaleTracker };

export function getTracker(): WhaleTracker {
  if (!globalForTracker.whaleTracker) {
    const config = loadConfig();
    // The dashboard always logs every poll, whale, copy-trade, and API call to the server console.
    config.verbose = true;
    const tracker = new WhaleTracker(config);
    tracker.start();
    // Credentials come from env now — discover the trading accounts up front so
    // the copy-trade controls are ready without any user action.
    void tracker.discoverAccounts();
    globalForTracker.whaleTracker = tracker;
  }
  return globalForTracker.whaleTracker;
}
