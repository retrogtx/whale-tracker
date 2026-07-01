import { loadConfig, WhaleTracker } from "@whale-tracker/core";

// Survive Next.js HMR / module reloads by stashing the instance on globalThis.
const globalForTracker = globalThis as unknown as { whaleTracker?: WhaleTracker };

export function getTracker(): WhaleTracker {
  if (!globalForTracker.whaleTracker) {
    const tracker = new WhaleTracker(loadConfig());
    tracker.start();
    globalForTracker.whaleTracker = tracker;
  }
  return globalForTracker.whaleTracker;
}
