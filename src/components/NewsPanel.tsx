"use client";

import { useMemo, useState } from "react";
import type { NewsItem } from "@/app/api/news/route";

interface NewsPanelProps {
  items: NewsItem[];
  loading: boolean;
  onRefresh: () => void;
}

function fmtKstTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function NewsPanel({ items, loading, onRefresh }: NewsPanelProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("ALL");

  const sources = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.source));
    return ["ALL", ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (source !== "ALL" && item.source !== source) return false;
      if (q && !item.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, source, query]);

  return (
    <section className="flex flex-col bg-white min-h-0 flex-1">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[#dfe3ea] bg-[#f7f8fa] px-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-bold tracking-tight text-[#111827]">
            실시간 마켓 뉴스
          </h2>
          <span className="text-[11px] text-[#64748b] tabular-nums">
            {filtered.length}건
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px]">
          <input
            type="text"
            placeholder="키워드 필터 (Fed, CPI...)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-6 w-32 sm:w-40 border border-[#d1d5db] bg-white px-2 text-[11px] text-[#111827] placeholder:text-[#94a3b8] focus:border-[#1d4ed8] focus:outline-none"
          />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-6 border border-[#d1d5db] bg-white px-1.5 text-[11px] text-[#334155] focus:border-[#1d4ed8] focus:outline-none"
          >
            {sources.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "전체 매체" : s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRefresh}
            className="h-6 border border-[#dfe3ea] bg-white px-2 text-[#475569] hover:bg-[#f1f5f9]"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* Headline List */}
      <div className="flex-1 overflow-auto divide-y divide-[#eef1f5]">
        {loading && items.length === 0 ? (
          <div className="p-4 text-[12px] text-[#64748b]">뉴스 피드를 불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-[12px] text-[#64748b]">조건에 맞는 뉴스가 없습니다.</div>
        ) : (
          filtered.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-[#f8fafc] transition-colors group"
            >
              <div className="min-w-0 flex-1">
                <span className="mr-2 inline-block border border-[#e2e8f0] bg-[#f8fafc] px-1 py-0.2 text-[10px] font-medium text-[#475569]">
                  {item.source}
                </span>
                <span className="text-[12px] text-[#111827] group-hover:text-[#1d4ed8] group-hover:underline leading-snug">
                  {item.title}
                </span>
              </div>
              <span className="shrink-0 text-[11px] text-[#94a3b8] tabular-nums">
                {fmtKstTime(item.publishedAt)}
              </span>
            </a>
          ))
        )}
      </div>
    </section>
  );
}
