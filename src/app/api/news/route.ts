import { NextResponse } from "next/server";

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
}

const RSS_SOURCES = [
  {
    name: "CNBC Markets",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
  },
  {
    name: "CNBC Finance",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664",
  },
  {
    name: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rssindex",
  },
  {
    name: "MarketWatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
  },
];

function decodeXml(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : "";
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of matches.slice(0, 18)) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubRaw = extractTag(block, "pubDate");
    if (!title || !link) continue;
    const ts = Date.parse(pubRaw);
    const publishedAt = Number.isNaN(ts)
      ? new Date().toISOString()
      : new Date(ts).toISOString();
    items.push({
      id: `${source}:${link}`,
      title,
      link,
      source,
      publishedAt,
    });
  }
  return items;
}

export const revalidate = 180; // 3 minutes

export async function GET() {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(async (src) => {
      const res = await fetch(src.url, {
        next: { revalidate: 180 },
        headers: { "User-Agent": "TradingDesk/1.0" },
      });
      if (!res.ok) throw new Error(`${src.name} HTTP ${res.status}`);
      const xml = await res.text();
      return parseRss(xml, src.name);
    })
  );

  const all: NewsItem[] = [];
  const seenTitles = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const norm = item.title.toLowerCase();
      if (seenTitles.has(norm)) continue;
      seenTitles.add(norm);
      all.push(item);
    }
  }

  all.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    items: all.slice(0, 40),
  });
}
