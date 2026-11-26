"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { ChartCandle, ChartMarker } from "@/lib/backtest";

interface PriceChartProps {
  candles: ChartCandle[];
  markers: ChartMarker[];
  fastLabel: string;
  slowLabel: string;
  truncated: boolean;
}

export default function PriceChart({
  candles,
  markers,
  fastLabel,
  slowLabel,
  truncated,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f1624" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#1e293b",
      },
      timeScale: {
        borderColor: "#1e293b",
        timeVisible: true,
        secondsVisible: false,
      },
      width: el.clientWidth,
      height: 380,
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderUpColor: "#10b981",
      borderDownColor: "#f43f5e",
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    const fastSeries = chart.addLineSeries({
      color: "#fbbf24",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const slowSeries = chart.addLineSeries({
      color: "#38bdf8",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    const fastData = candles
      .filter((c) => c.fastMa !== null)
      .map((c) => ({ time: c.time as UTCTimestamp, value: c.fastMa as number }));
    const slowData = candles
      .filter((c) => c.slowMa !== null)
      .map((c) => ({ time: c.time as UTCTimestamp, value: c.slowMa as number }));

    fastSeries.setData(fastData);
    slowSeries.setData(slowData);

    if (markers.length > 0 && markers.length <= 4000) {
      const lwMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      }));
      candleSeries.setMarkers(lwMarkers);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, markers]);

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f1624] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-100">
            가격 차트 &amp; 이동평균선 시그널
          </h3>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              {fastLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
              {slowLabel}
            </span>
            <span className="flex items-center gap-1">
              <span className="text-emerald-400 font-bold">▲</span> 롱 진입
            </span>
            <span className="flex items-center gap-1">
              <span className="text-rose-400 font-bold">▼</span> 숏 진입
            </span>
          </div>
        </div>
        {truncated && (
          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 border border-amber-500/20">
            차트는 최근 35,000봉만 표시 (수익률은 전체 구간 계산)
          </span>
        )}
        {markers.length > 4000 && (
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
            거래 수 과다({markers.length.toLocaleString()}건)로 차트 마커 생략
          </span>
        )}
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
