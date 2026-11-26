"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import type { EquityPoint } from "@/lib/backtest";

interface EquityChartProps {
  equityCurve: EquityPoint[];
  initialCapital: number;
}

export default function EquityChart({
  equityCurve,
  initialCapital,
}: EquityChartProps) {
  const eqContainerRef = useRef<HTMLDivElement | null>(null);
  const ddContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const eqEl = eqContainerRef.current;
    const ddEl = ddContainerRef.current;
    if (!eqEl || !ddEl || equityCurve.length === 0) return;

    const eqChart = createChart(eqEl, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f1624" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", timeVisible: true, secondsVisible: false },
      width: eqEl.clientWidth,
      height: 250,
    });

    const isProfit = equityCurve[equityCurve.length - 1].equity >= initialCapital;

    const stratSeries = eqChart.addAreaSeries({
      lineColor: isProfit ? "#10b981" : "#f43f5e",
      topColor: isProfit ? "rgba(16, 185, 129, 0.28)" : "rgba(244, 63, 94, 0.28)",
      bottomColor: isProfit ? "rgba(16, 185, 129, 0.02)" : "rgba(244, 63, 94, 0.02)",
      lineWidth: 2,
    });

    const bhSeries = eqChart.addLineSeries({
      color: "#64748b",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
    });

    stratSeries.setData(
      equityCurve.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity }))
    );
    bhSeries.setData(
      equityCurve.map((p) => ({ time: p.time as UTCTimestamp, value: p.buyHoldEquity }))
    );
    eqChart.timeScale().fitContent();

    const ddChart = createChart(ddEl, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f1624" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", timeVisible: true, secondsVisible: false },
      width: ddEl.clientWidth,
      height: 120,
    });

    const ddSeries = ddChart.addAreaSeries({
      lineColor: "#f43f5e",
      topColor: "rgba(244, 63, 94, 0.05)",
      bottomColor: "rgba(244, 63, 94, 0.35)",
      lineWidth: 1,
    });
    ddSeries.setData(
      equityCurve.map((p) => ({ time: p.time as UTCTimestamp, value: p.drawdownPct }))
    );
    ddChart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (eqEl.clientWidth > 0) eqChart.applyOptions({ width: eqEl.clientWidth });
      if (ddEl.clientWidth > 0) ddChart.applyOptions({ width: ddEl.clientWidth });
    });
    ro.observe(eqEl);

    return () => {
      ro.disconnect();
      eqChart.remove();
      ddChart.remove();
    };
  }, [equityCurve, initialCapital]);

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f1624] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">
          자산 곡선 (Equity Curve) &amp; 낙폭 (Drawdown %)
        </h3>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            전략 자산 (USD)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 border-t border-dashed border-slate-400" />
            Buy &amp; Hold (동일 계약수)
          </span>
        </div>
      </div>
      <div ref={eqContainerRef} className="w-full" />
      <div className="pt-1 border-t border-slate-800/80">
        <div className="mb-1 text-[11px] text-slate-400">Drawdown (%)</div>
        <div ref={ddContainerRef} className="w-full" />
      </div>
    </div>
  );
}
