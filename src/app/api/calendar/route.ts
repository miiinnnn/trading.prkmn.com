import { NextResponse } from "next/server";

export interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
}

interface RawFFEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

const FEEDS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];

export const revalidate = 300; // 5 minutes

export async function GET() {
  try {
    const results = await Promise.allSettled(
      FEEDS.map(async (url) => {
        const res = await fetch(url, {
          next: { revalidate: 300 },
          headers: { "User-Agent": "TradingDesk/1.0" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as RawFFEvent[];
      })
    );

    const merged: CalendarEvent[] = [];
    const seen = new Set<string>();

    for (const r of results) {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
      for (const item of r.value) {
        // Strictly Level 3 (High Impact) only
        if (item.impact !== "High") continue;
        if (!item.title || !item.date) continue;
        const key = `${item.date}|${item.country ?? ""}|${item.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          id: key,
          title: item.title,
          country: item.country ?? "USD",
          date: item.date,
          impact: "High",
          forecast: item.forecast ?? "",
          previous: item.previous ?? "",
        });
      }
    }

    merged.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    return NextResponse.json({
      source: "ForexFactory / Faireconomy (Level 3 High Impact)",
      updatedAt: new Date().toISOString(),
      events: merged,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "캘린더 데이터를 불러오지 못했습니다.",
        events: [],
      },
      { status: 502 }
    );
  }
}
