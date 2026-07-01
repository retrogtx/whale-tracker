export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

const RSS_SOURCES: Array<{ name: string; url: string }> = [
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
  { name: "NewsBTC", url: "https://www.newsbtc.com/feed/" },
  { name: "Bitcoinist", url: "https://bitcoinist.com/feed/" },
  { name: "CryptoPotato", url: "https://cryptopotato.com/feed/" },
  { name: "AMBCrypto", url: "https://ambcrypto.com/feed/" },
  { name: "CryptoNews", url: "https://cryptonews.com/news/feed/" },
  { name: "BeInCrypto", url: "https://beincrypto.com/feed/" },
  { name: "99Bitcoins", url: "https://99bitcoins.com/feed/" },
];

const TIMEOUT_MS = 9_000;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function field(chunk: string, tag: string): string {
  const match = chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decode(match[1] ?? "") : "";
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0", accept: "application/rss+xml,text/xml,*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items = xml
    .split("<item>")
    .slice(1)
    .map((c) => c.split("</item>")[0] ?? "");
  const out: NewsItem[] = [];
  for (const chunk of items) {
    const title = field(chunk, "title");
    let url = field(chunk, "link");
    if (!url) url = chunk.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    if (!title || !url) continue;
    out.push({ title, url, source, publishedAt: field(chunk, "pubDate") || field(chunk, "dc:date") });
  }
  return out;
}

async function fetchRss(name: string, url: string): Promise<NewsItem[]> {
  return parseRss(await getText(url), name);
}

interface CryptoPanicResult {
  title?: string;
  url?: string;
  published_at?: string;
  domain?: string;
  source?: { title?: string };
}

/** CryptoPanic aggregates news + social posts (incl. Twitter/X). Needs a free token. */
async function fetchCryptoPanic(token: string): Promise<NewsItem[]> {
  const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${token}&public=true&kind=news`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from CryptoPanic`);
    const data = (await res.json()) as { results?: CryptoPanicResult[] };
    return (data.results ?? [])
      .filter((r): r is CryptoPanicResult & { title: string; url: string } => !!r.title && !!r.url)
      .map((r) => ({
        title: r.title,
        url: r.url,
        source: r.source?.title ?? r.domain ?? "CryptoPanic",
        publishedAt: r.published_at ?? "",
      }));
  } finally {
    clearTimeout(timer);
  }
}

function timestamp(item: NewsItem): number {
  const t = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Aggregate recent crypto headlines across many sources, deduped and newest-first. */
export async function fetchCryptoNews(limit = 30): Promise<NewsItem[]> {
  const tasks = RSS_SOURCES.map((s) => fetchRss(s.name, s.url));
  const token = process.env.CRYPTOPANIC_TOKEN?.trim();
  if (token) tasks.push(fetchCryptoPanic(token));

  const settled = await Promise.allSettled(tasks);
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  all.sort((a, b) => timestamp(b) - timestamp(a));

  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of all) {
    const key = item.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** @deprecated use {@link fetchCryptoNews}. Kept for compatibility. */
export const fetchBtcNews = fetchCryptoNews;
