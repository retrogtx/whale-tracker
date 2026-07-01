import { NextResponse } from "next/server";
import { fetchCryptoNews, type NewsItem } from "@whale-tracker/core";

export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;
const cache = globalThis as unknown as { btcNews?: NewsItem[]; btcNewsAt?: number };

export async function GET() {
  const now = Date.now();
  if (cache.btcNews && cache.btcNewsAt && now - cache.btcNewsAt < CACHE_MS) {
    return NextResponse.json(cache.btcNews);
  }
  try {
    const items = await fetchCryptoNews(40);
    cache.btcNews = items;
    cache.btcNewsAt = now;
    return NextResponse.json(items);
  } catch (err) {
    if (cache.btcNews) return NextResponse.json(cache.btcNews);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
