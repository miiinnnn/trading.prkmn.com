"use client";

import { useMemo, useState } from "react";
import type { CalendarEvent } from "@/app/api/calendar/route";

interface CalendarPanelProps {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  nowMs: number;
  onRefresh: () => void;
}

function fmtKstDateTime(iso: string): { dateStr: string; timeStr: string } {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const timeStr = d.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { dateStr, timeStr };
}

function fmtCountdown(diffMs: number): string {
  if (diffMs <= 0) return "발표됨";
  const totalSec = Math.floor(diffMs / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${String(m).padStart(2, "0")}분`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function CalendarPanel({
  events,
  loading,
  error,
  nowMs,
  onRefresh,
}: CalendarPanelProps) {
  const [countryFilter, setCountryFilter] = useState<"USD" | "ALL">("USD");
  const [hidePast, setHidePast] = useState(true);

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (countryFilter === "USD" && ev.country !== "USD") return false;
      if (hidePast && Date.parse(ev.date) < nowMs - 15 * 60 * 1000) return false;
      return true;
    });
  }, [events, countryFilter, hidePast, nowMs]);

  return (
    <section className="flex flex-col border-b border-[#dfe3ea] bg-white min-h-0 flex-1">
      {/* Panel Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#dfe3ea] bg-[#f7f8fa] px-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-bold tracking-tight text-[#111827]">
            경제지표 캘린더
          </h2>
          <span className="border border-[#f1c4c4] bg-[#fff5f5] px-1.5 py-0.5 text-[10px] font-semibold text-[#c92a2a]">
            중요도 ★★★ (Lv.3)
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setCountryFilter("USD")}
            className={`px-2 py-0.5 border transition-colors ${
              countryFilter === "USD"
                ? "border-[#1d4ed8] bg-[#eff4ff] text-[#1d4ed8] font-semibold"
                : "border-[#dfe3ea] bg-white text-[#64748b] hover:text-[#111827]"
            }`}
          >
            미국(USD)
          </button>
          <button
            type="button"
            onClick={() => setCountryFilter("ALL")}
            className={`px-2 py-0.5 border transition-colors ${
              countryFilter === "ALL"
                ? "border-[#1d4ed8] bg-[#eff4ff] text-[#1d4ed8] font-semibold"
                : "border-[#dfe3ea] bg-white text-[#64748b] hover:text-[#111827]"
            }`}
          >
            전체
          </button>
          <label className="ml-1 flex items-center gap-1 text-[#64748b] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hidePast}
              onChange={(e) => setHidePast(e.target.checked)}
              className="accent-[#1d4ed8]"
            />
            예정만
          </label>
          <button
            type="button"
            onClick={onRefresh}
            className="ml-1 border border-[#dfe3ea] bg-white px-2 py-0.5 text-[#475569] hover:bg-[#f1f5f9]"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="p-4 text-[12px] text-[#c92a2a]">{error}</div>
        ) : loading && events.length === 0 ? (
          <div className="p-4 text-[12px] text-[#64748b]">중요도 레벨3 일정을 불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-[12px] text-[#64748b]">
            표시할 중요도 레벨3 일정이 없습니다.
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-[12px] tabular-nums">
            <thead className="sticky top-0 bg-[#f8f9fb] border-b border-[#dfe3ea] text-[11px] text-[#64748b]">
              <tr>
                <th className="py-1.5 pl-3 pr-2 font-medium">일시 (KST)</th>
                <th className="py-1.5 px-1.5 font-medium">통화</th>
                <th className="py-1.5 px-2 font-medium">지표명</th>
                <th className="py-1.5 px-2 text-right font-medium">예측</th>
                <th className="py-1.5 px-2 text-right font-medium">이전</th>
                <th className="py-1.5 pl-2 pr-3 text-right font-medium">남은시간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef1f5]">
              {filtered.map((ev) => {
                const evMs = Date.parse(ev.date);
                const diff = evMs - nowMs;
                const isImminent = diff > 0 && diff <= 30 * 60 * 1000;
                const isPast = diff <= 0;
                const { dateStr, timeStr } = fmtKstDateTime(ev.date);

                return (
                  <tr
                    key={ev.id}
                    className={`${
                      isImminent
                        ? "bg-[#fff5f5]"
                        : isPast
                        ? "text-[#94a3b8] bg-white"
                        : "hover:bg-[#f8fafc]"
                    }`}
                  >
                    <td className="py-1.5 pl-3 pr-2 whitespace-nowrap">
                      <span className="text-[#64748b] mr-1.5">{dateStr}</span>
                      <span className="font-medium text-[#111827]">{timeStr}</span>
                    </td>
                    <td className="py-1.5 px-1.5 font-semibold text-[#334155]">
                      {ev.country}
                    </td>
                    <td className="py-1.5 px-2 font-medium text-[#111827]">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#c92a2a] align-middle" />
                      {ev.title}
                    </td>
                    <td className="py-1.5 px-2 text-right text-[#334155]">
                      {ev.forecast || "-"}
                    </td>
                    <td className="py-1.5 px-2 text-right text-[#64748b]">
                      {ev.previous || "-"}
                    </td>
                    <td
                      className={`py-1.5 pl-2 pr-3 text-right whitespace-nowrap font-medium ${
                        isImminent
                          ? "text-[#c92a2a] font-bold"
                          : isPast
                          ? "text-[#94a3b8]"
                          : "text-[#1d4ed8]"
                      }`}
                    >
                      {fmtCountdown(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
