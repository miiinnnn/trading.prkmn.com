"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "@/app/api/calendar/route";
import type { NewsItem } from "@/app/api/news/route";
import CalendarPanel from "./CalendarPanel";
import NewsPanel from "./NewsPanel";
import TraderTrackerPanel from "./TraderTrackerPanel";

function getUsMarketSession(now: Date): { label: string; isRth: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hr = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mn = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hr * 60 + mn;

  if (wd === "Sat" || (wd === "Sun" && mins < 18 * 60) || (wd === "Fri" && mins >= 17 * 60)) {
    return { label: "주말 휴장", isRth: false };
  }
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) {
    return { label: "미 정규장 (RTH)", isRth: true };
  }
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) {
    return { label: "프리마켓 / 글로벡스", isRth: false };
  }
  if (mins >= 16 * 60 && mins < 17 * 60) {
    return { label: "장후 / 마감", isRth: false };
  }
  if (mins >= 17 * 60 && mins < 18 * 60) {
    return { label: "CME 일일 점검", isRth: false };
  }
  return { label: "야간 글로벡스 (ETH)", isRth: false };
}

function fmtClock(now: Date, tz: string): string {
  return now.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtShortCountdown(diffMs: number): string {
  const s = Math.max(0, Math.floor(diffMs / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function TradingDesk() {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calLoading, setCalLoading] = useState(true);
  const [calError, setCalError] = useState<string | null>(null);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchCalendar = useCallback(async () => {
    setCalLoading(true);
    try {
      const res = await fetch("/api/calendar");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEvents(data.events ?? []);
      setCalError(null);
    } catch (e) {
      setCalError(e instanceof Error ? e.message : "캘린더 로드 오류");
    } finally {
      setCalLoading(false);
    }
  }, []);

  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const res = await fetch("/api/news");
      const data = await res.json();
      if (res.ok) setNews(data.items ?? []);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCalendar();
    void fetchNews();
    const calTimer = setInterval(() => void fetchCalendar(), 5 * 60 * 1000);
    const newsTimer = setInterval(() => void fetchNews(), 3 * 60 * 1000);
    return () => {
      clearInterval(calTimer);
      clearInterval(newsTimer);
    };
  }, [fetchCalendar, fetchNews]);

  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const session = useMemo(() => getUsMarketSession(nowDate), [nowDate]);

  const nextUsdEvent = useMemo(() => {
    return events.find((e) => e.country === "USD" && Date.parse(e.date) > nowMs) ?? null;
  }, [events, nowMs]);

  return (
    <div className="flex h-screen w-screen flex-col bg-white text-[#111827] overflow-hidden">
      {/* Classic Top Status & Clock Bar */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#dfe3ea] bg-white px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-bold tracking-wider text-[#111827]">
              TRADING DESK
            </span>
            <span className="hidden md:inline text-[11px] text-[#64748b]">
              Macro · News · Live Position Monitor
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2 border-l border-[#dfe3ea] pl-4 text-[11px]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                session.isRth ? "bg-[#0b7a5c]" : "bg-[#94a3b8]"
              }`}
            />
            <span className="font-semibold text-[#334155]">{session.label}</span>
          </div>
        </div>

        {/* Center/Right: Next Level-3 Alert + World Clocks */}
        <div className="flex items-center gap-4 text-[11px] tabular-nums">
          {nextUsdEvent && (
            <div className="hidden xl:flex items-center gap-2 border border-[#f1c4c4] bg-[#fff5f5] px-2.5 py-1 text-[#c92a2a]">
              <span className="font-bold">다음 USD Lv.3</span>
              <span className="font-medium text-[#111827] max-w-[220px] truncate">
                {nextUsdEvent.title}
              </span>
              <span className="font-bold">
                {fmtShortCountdown(Date.parse(nextUsdEvent.date) - nowMs)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 text-[#475569]">
            <span>
              <strong className="text-[#111827] mr-1">KST</strong>
              {fmtClock(nowDate, "Asia/Seoul")}
            </span>
            <span className="hidden sm:inline border-l border-[#dfe3ea] pl-3">
              <strong className="text-[#111827] mr-1">NY</strong>
              {fmtClock(nowDate, "America/New_York")}
            </span>
            <span className="hidden md:inline border-l border-[#dfe3ea] pl-3">
              <strong className="text-[#111827] mr-1">LDN</strong>
              {fmtClock(nowDate, "Europe/London")}
            </span>
          </div>
        </div>
      </header>

      {/* Main 2-Column Classic Desk Layout */}
      <main className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#dfe3ea]">
        {/* Left Column (5/12): Level 3 Economic Calendar + Live Market News */}
        <div className="flex flex-col min-h-0 lg:col-span-5">
          <CalendarPanel
            events={events}
            loading={calLoading}
            error={calError}
            nowMs={nowMs}
            onRefresh={() => void fetchCalendar()}
          />
          <NewsPanel
            items={news}
            loading={newsLoading}
            onRefresh={() => void fetchNews()}
          />
        </div>

        {/* Right Column (7/12): Live Trader Position Tracker (Hyperliquid + YouTube Live) */}
        <div className="flex flex-col min-h-0 lg:col-span-7">
          <TraderTrackerPanel />
        </div>
      </main>
    </div>
  );
}
