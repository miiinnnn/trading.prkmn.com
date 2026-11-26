"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import {
  computeEmaSeries,
  loadTimeframeBars,
  type OhlcvBar,
  type Timeframe,
} from "@/lib/chartData";

const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "1m", label: "1분" },
  { value: "5m", label: "5분" },
  { value: "15m", label: "15분" },
  { value: "1h", label: "1시간" },
  { value: "1d", label: "일봉" },
];

const RANGE_PRESETS: Array<{ label: string; seconds: number | null }> = [
  { label: "1일", seconds: 86400 },
  { label: "5일", seconds: 86400 * 5 },
  { label: "1개월", seconds: 86400 * 30 },
  { label: "3개월", seconds: 86400 * 90 },
  { label: "1년", seconds: 86400 * 365 },
  { label: "전체", seconds: null },
];

const UP_COLOR = "#089981";
const DOWN_COLOR = "#f23645";

function fmtPrice(v: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtKstTick(tsSec: number, withTime: boolean): string {
  const d = new Date(tsSec * 1000);
  if (!withTime) {
    return d.toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface LegendState {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
}

export default function TradingViewChart() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [rthOnly, setRthOnly] = useState(false);
  const [showVol, setShowVol] = useState(true);
  const [showEma20, setShowEma20] = useState(false);
  const [showEma60, setShowEma60] = useState(false);
  const [showEma200, setShowEma200] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedYears, setLoadedYears] = useState<number[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [barCount, setBarCount] = useState(0);
  const [jumpDate, setJumpDate] = useState("2026-11-12");
  const [legend, setLegend] = useState<LegendState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema60SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const rawBarsRef = useRef<OhlcvBar[]>([]);
  const visibleBarsRef = useRef<OhlcvBar[]>([]);
  const barByTimeRef = useRef<Map<number, { bar: OhlcvBar; prevClose: number }>>(new Map());
  const loadedYearsRef = useRef<number[]>([]);
  const availableYearsRef = useRef<number[]>([]);
  const timeframeRef = useRef<Timeframe>(timeframe);
  const loadingOlderRef = useRef(false);

  timeframeRef.current = timeframe;

  const updateLegendFromBar = useCallback((bar: OhlcvBar, prevClose: number) => {
    const change = bar.close - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    setLegend({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      change,
      changePct,
    });
  }, []);

  const applyBarsToChart = useCallback(
    (
      bars: OhlcvBar[],
      opts: {
        preserveRange?: { from: number; to: number; addedCount: number };
        resetViewport?: boolean;
        focusTs?: number;
      } = {}
    ) => {
      const candleSeries = candleSeriesRef.current;
      const volSeries = volSeriesRef.current;
      const ema20Series = ema20SeriesRef.current;
      const ema60Series = ema60SeriesRef.current;
      const ema200Series = ema200SeriesRef.current;
      const chart = chartRef.current;
      if (!candleSeries || !volSeries || !chart) return;

      const filtered = rthOnly ? bars.filter((b) => b.isRth) : bars;
      visibleBarsRef.current = filtered;
      setBarCount(filtered.length);

      const map = new Map<number, { bar: OhlcvBar; prevClose: number }>();
      const candleData = new Array(filtered.length);
      const volData = new Array(filtered.length);

      for (let i = 0; i < filtered.length; i++) {
        const b = filtered[i];
        const prevClose = i > 0 ? filtered[i - 1].close : b.open;
        map.set(b.time, { bar: b, prevClose });
        candleData[i] = {
          time: b.time as UTCTimestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        };
        volData[i] = {
          time: b.time as UTCTimestamp,
          value: b.volume,
          color: b.close >= b.open ? "rgba(8, 153, 129, 0.35)" : "rgba(242, 54, 69, 0.35)",
        };
      }
      barByTimeRef.current = map;

      candleSeries.setData(candleData);
      volSeries.setData(volData);

      if (ema20Series) {
        ema20Series.setData(
          showEma20
            ? computeEmaSeries(filtered, 20).map((p) => ({
                time: p.time as UTCTimestamp,
                value: p.value,
              }))
            : []
        );
      }
      if (ema60Series) {
        ema60Series.setData(
          showEma60
            ? computeEmaSeries(filtered, 60).map((p) => ({
                time: p.time as UTCTimestamp,
                value: p.value,
              }))
            : []
        );
      }
      if (ema200Series) {
        ema200Series.setData(
          showEma200
            ? computeEmaSeries(filtered, 200).map((p) => ({
                time: p.time as UTCTimestamp,
                value: p.value,
              }))
            : []
        );
      }

      if (filtered.length > 0) {
        const last = filtered[filtered.length - 1];
        const prev = filtered.length > 1 ? filtered[filtered.length - 2].close : last.open;
        updateLegendFromBar(last, prev);
      }

      if (opts.preserveRange) {
        const { from, to, addedCount } = opts.preserveRange;
        chart.timeScale().setVisibleLogicalRange({
          from: from + addedCount,
          to: to + addedCount,
        });
      } else if (opts.focusTs !== undefined && filtered.length > 0) {
        // Binary search nearest bar to focusTs
        let lo = 0;
        let hi = filtered.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (filtered[mid].time < opts.focusTs) lo = mid + 1;
          else hi = mid;
        }
        const half = 120;
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, lo - half),
          to: Math.min(filtered.length - 1 + 10, lo + half),
        });
      } else if (opts.resetViewport && filtered.length > 0) {
        const defaultVisible = Math.min(260, filtered.length);
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, filtered.length - defaultVisible),
          to: filtered.length + 8,
        });
      }
    },
    [rthOnly, showEma20, showEma60, showEma200, updateLegendFromBar]
  );

  // Load earlier 1m year chunk seamlessly when user pans near left edge
  const loadPreviousYearIfNeeded = useCallback(async () => {
    if (timeframeRef.current !== "1m") return;
    if (loadingOlderRef.current) return;
    const loaded = loadedYearsRef.current;
    const avail = availableYearsRef.current;
    if (loaded.length === 0 || avail.length === 0) return;

    const minLoaded = Math.min(...loaded);
    const prevYear = avail.filter((y) => y < minLoaded).pop();
    if (prevYear === undefined) return;

    const chart = chartRef.current;
    const currentRange = chart?.timeScale().getVisibleLogicalRange();
    if (!currentRange) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const prevVisibleCount = visibleBarsRef.current.length;
      const nextYears = [prevYear, ...loaded];
      const res = await loadTimeframeBars("1m", nextYears);
      rawBarsRef.current = res.bars;
      loadedYearsRef.current = res.loadedYears;
      setLoadedYears(res.loadedYears);

      const newVisibleCount = rthOnly
        ? res.bars.filter((b) => b.isRth).length
        : res.bars.length;
      const addedCount = Math.max(0, newVisibleCount - prevVisibleCount);

      applyBarsToChart(res.bars, {
        preserveRange: {
          from: currentRange.from,
          to: currentRange.to,
          addedCount,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "과거 연도 데이터 로드 실패");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [applyBarsToChart, rthOnly]);

  // Initialize Lightweight Chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#131722",
        fontSize: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: "#f0f3fa" },
        horzLines: { color: "#f0f3fa" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#9598a1",
          width: 1,
          style: 2,
          labelBackgroundColor: "#131722",
        },
        horzLine: {
          color: "#9598a1",
          width: 1,
          style: 2,
          labelBackgroundColor: "#131722",
        },
      },
      rightPriceScale: {
        borderColor: "#e0e3eb",
        scaleMargins: { top: 0.06, bottom: 0.2 },
      },
      timeScale: {
        borderColor: "#e0e3eb",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
      },
      localization: {
        locale: "ko-KR",
        timeFormatter: (time: Time) => {
          if (typeof time === "number") {
            return fmtKstTick(time, timeframeRef.current !== "1d");
          }
          return String(time);
        },
      },
      width: el.clientWidth,
      height: el.clientHeight,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });

    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const ema20Series = chart.addLineSeries({
      color: "#2962ff",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const ema60Series = chart.addLineSeries({
      color: "#ff9800",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const ema200Series = chart.addLineSeries({
      color: "#9c27b0",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    ema20SeriesRef.current = ema20Series;
    ema60SeriesRef.current = ema60Series;
    ema200SeriesRef.current = ema200Series;

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (param.time && typeof param.time === "number") {
        const found = barByTimeRef.current.get(param.time);
        if (found) {
          updateLegendFromBar(found.bar, found.prevClose);
          return;
        }
      }
      const vis = visibleBarsRef.current;
      if (vis.length > 0) {
        const last = vis[vis.length - 1];
        const prev = vis.length > 1 ? vis[vis.length - 2].close : last.open;
        updateLegendFromBar(last, prev);
      }
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    ro.observe(el);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [updateLegendFromBar]);

  // Subscribe to left-edge panning to auto-load older 1m year chunks
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onRangeChange = (range: { from: number; to: number } | null) => {
      if (!range) return;
      if (timeframeRef.current === "1m" && range.from < 80) {
        void loadPreviousYearIfNeeded();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
    };
  }, [loadPreviousYearIfNeeded]);

  // Load data when timeframe changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadTimeframeBars(timeframe)
      .then((res) => {
        if (cancelled) return;
        rawBarsRef.current = res.bars;
        loadedYearsRef.current = res.loadedYears;
        availableYearsRef.current = res.availableYears;
        setLoadedYears(res.loadedYears);
        setAvailableYears(res.availableYears);
        applyBarsToChart(res.bars, { resetViewport: true });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "데이터 로드 실패");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [timeframe, applyBarsToChart]);

  // Toggle volume visibility
  useEffect(() => {
    if (volSeriesRef.current) {
      volSeriesRef.current.applyOptions({ visible: showVol });
    }
    if (chartRef.current) {
      chartRef.current.priceScale("right").applyOptions({
        scaleMargins: { top: 0.06, bottom: showVol ? 0.2 : 0.06 },
      });
    }
  }, [showVol]);

  // Re-apply when RTH or EMA toggles change without re-fetching
  useEffect(() => {
    if (rawBarsRef.current.length === 0) return;
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    applyBarsToChart(
      rawBarsRef.current,
      range ? { preserveRange: { from: range.from, to: range.to, addedCount: 0 } } : {}
    );
  }, [rthOnly, showEma20, showEma60, showEma200, applyBarsToChart]);

  const handleJumpDate = async (dateStr: string) => {
    setJumpDate(dateStr);
    if (!dateStr) return;
    const targetSec = Math.floor(Date.parse(`${dateStr}T13:30:00Z`) / 1000);
    const targetYear = Number(dateStr.slice(0, 4));

    if (timeframe === "1m" && !loadedYearsRef.current.includes(targetYear)) {
      setLoading(true);
      try {
        // Load targetYear and any years between targetYear and current loaded min
        const minLoaded = Math.min(...loadedYearsRef.current, targetYear);
        const maxLoaded = Math.max(...loadedYearsRef.current, targetYear);
        const needed = availableYearsRef.current.filter(
          (y) => y >= minLoaded && y <= maxLoaded
        );
        const res = await loadTimeframeBars("1m", needed);
        rawBarsRef.current = res.bars;
        loadedYearsRef.current = res.loadedYears;
        setLoadedYears(res.loadedYears);
        applyBarsToChart(res.bars, { focusTs: targetSec });
      } catch (e) {
        setError(e instanceof Error ? e.message : "날짜 이동 실패");
      } finally {
        setLoading(false);
      }
      return;
    }

    applyBarsToChart(rawBarsRef.current, { focusTs: targetSec });
  };

  const handleQuickRange = async (seconds: number | null) => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seconds === null) {
      // Load all years if in 1m mode and user explicitly clicks "전체"
      if (
        timeframe === "1m" &&
        loadedYearsRef.current.length < availableYearsRef.current.length
      ) {
        setLoading(true);
        try {
          const res = await loadTimeframeBars("1m", availableYearsRef.current);
          rawBarsRef.current = res.bars;
          loadedYearsRef.current = res.loadedYears;
          setLoadedYears(res.loadedYears);
          applyBarsToChart(res.bars);
          chart.timeScale().fitContent();
        } finally {
          setLoading(false);
        }
        return;
      }
      chart.timeScale().fitContent();
      return;
    }

    const vis = visibleBarsRef.current;
    if (vis.length === 0) return;
    const endTs = vis[vis.length - 1].time;
    const startTs = endTs - seconds;

    // If 1m mode and startTs is earlier than loaded data, load previous year too
    if (timeframe === "1m" && startTs < vis[0].time) {
      const startYear = new Date(startTs * 1000).getUTCFullYear();
      const needed = availableYearsRef.current.filter((y) => y >= startYear);
      if (needed.length > loadedYearsRef.current.length) {
        setLoading(true);
        try {
          const res = await loadTimeframeBars("1m", needed);
          rawBarsRef.current = res.bars;
          loadedYearsRef.current = res.loadedYears;
          setLoadedYears(res.loadedYears);
          applyBarsToChart(res.bars);
        } finally {
          setLoading(false);
        }
      }
    }

    const updated = visibleBarsRef.current;
    if (updated.length === 0) return;
    const fromTime = Math.max(updated[0].time, startTs) as UTCTimestamp;
    const toTime = updated[updated.length - 1].time as UTCTimestamp;
    chart.timeScale().setVisibleRange({ from: fromTime, to: toTime });
  };

  const handleGoLatest = () => {
    const chart = chartRef.current;
    const vis = visibleBarsRef.current;
    if (!chart || vis.length === 0) return;
    const count = Math.min(260, vis.length);
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, vis.length - count),
      to: vis.length + 8,
    });
  };

  const isUp = legend ? legend.change >= 0 : true;

  return (
    <div className="flex h-screen w-screen flex-col bg-white text-[#131722] select-none">
      {/* Classic Top Toolbar */}
      <header className="flex h-[42px] shrink-0 items-center justify-between border-b border-[#e0e3eb] bg-white px-3 text-[13px]">
        <div className="flex items-center gap-1 overflow-x-auto">
          {/* Symbol */}
          <div className="flex items-center gap-2 pr-2">
            <span className="font-bold tracking-tight text-[#131722]">NQ1!</span>
            <span className="hidden sm:inline text-[11px] text-[#787b86]">
              CME · E-mini Nasdaq-100
            </span>
          </div>

          <Divider />

          {/* Timeframes */}
          <div className="flex items-center gap-0.5 px-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                type="button"
                onClick={() => setTimeframe(tf.value)}
                className={`rounded px-2 py-1 text-[12px] font-medium transition-colors ${
                  timeframe === tf.value
                    ? "bg-[#eef3ff] text-[#2962ff] font-semibold"
                    : "text-[#131722] hover:bg-[#f0f3fa]"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <Divider />

          {/* Session Toggle */}
          <div className="flex items-center gap-0.5 px-1">
            <button
              type="button"
              onClick={() => setRthOnly(false)}
              className={`rounded px-2 py-1 text-[12px] transition-colors ${
                !rthOnly
                  ? "bg-[#eef3ff] text-[#2962ff] font-semibold"
                  : "text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722]"
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setRthOnly(true)}
              className={`rounded px-2 py-1 text-[12px] transition-colors ${
                rthOnly
                  ? "bg-[#eef3ff] text-[#2962ff] font-semibold"
                  : "text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722]"
              }`}
            >
              정규장(RTH)
            </button>
          </div>

          <Divider />

          {/* Simple Overlay Toggles */}
          <div className="flex items-center gap-1 px-1 text-[12px]">
            <ToggleChip
              label="거래량"
              active={showVol}
              onClick={() => setShowVol((v) => !v)}
            />
            <ToggleChip
              label="EMA 20"
              active={showEma20}
              dotColor="#2962ff"
              onClick={() => setShowEma20((v) => !v)}
            />
            <ToggleChip
              label="EMA 60"
              active={showEma60}
              dotColor="#ff9800"
              onClick={() => setShowEma60((v) => !v)}
            />
            <ToggleChip
              label="EMA 200"
              active={showEma200}
              dotColor="#9c27b0"
              onClick={() => setShowEma200((v) => !v)}
            />
          </div>
        </div>

        {/* Right Controls: Date Jump & Latest */}
        <div className="hidden md:flex items-center gap-2 pl-2">
          <div className="flex items-center gap-1.5 text-[12px] text-[#787b86]">
            <span>이동</span>
            <input
              type="date"
              min="2021-11-15"
              max="2026-11-12"
              value={jumpDate}
              onChange={(e) => void handleJumpDate(e.target.value)}
              className="h-[26px] rounded border border-[#d1d4dc] bg-white px-1.5 text-[12px] text-[#131722] focus:border-[#2962ff] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleGoLatest}
            className="h-[26px] rounded border border-[#d1d4dc] bg-white px-2.5 text-[12px] text-[#131722] hover:bg-[#f0f3fa] transition-colors"
          >
            최신
          </button>
        </div>
      </header>

      {/* Main Chart Area */}
      <div className="relative flex-1 w-full bg-white overflow-hidden">
        {/* Classic TradingView Top-Left OHLCV Legend */}
        <div className="pointer-events-none absolute left-3 top-2.5 z-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-white/85 px-1.5 py-0.5 text-[12px]">
          <span className="font-semibold text-[#131722]">
            E-mini Nasdaq-100 선물 ({TIMEFRAMES.find((t) => t.value === timeframe)?.label})
          </span>
          {legend && (
            <div className="flex flex-wrap items-baseline gap-x-2.5 tabular-nums text-[12px]">
              <span className="text-[#787b86]">
                시 <strong className={isUp ? "text-[#089981]" : "text-[#f23645]"}>{fmtPrice(legend.open)}</strong>
              </span>
              <span className="text-[#787b86]">
                고 <strong className={isUp ? "text-[#089981]" : "text-[#f23645]"}>{fmtPrice(legend.high)}</strong>
              </span>
              <span className="text-[#787b86]">
                저 <strong className={isUp ? "text-[#089981]" : "text-[#f23645]"}>{fmtPrice(legend.low)}</strong>
              </span>
              <span className="text-[#787b86]">
                종 <strong className={isUp ? "text-[#089981]" : "text-[#f23645]"}>{fmtPrice(legend.close)}</strong>
              </span>
              <span className={isUp ? "text-[#089981] font-medium" : "text-[#f23645] font-medium"}>
                {legend.change >= 0 ? "+" : ""}
                {legend.change.toFixed(2)} ({legend.changePct >= 0 ? "+" : ""}
                {legend.changePct.toFixed(2)}%)
              </span>
              <span className="text-[#787b86]">
                거래량 <strong className="text-[#131722]">{legend.volume.toLocaleString()}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Subtle Loading / Error Notice */}
        {(loading || loadingOlder) && (
          <div className="pointer-events-none absolute right-16 top-2.5 z-10 rounded border border-[#e0e3eb] bg-white/95 px-2.5 py-1 text-[11px] text-[#787b86]">
            {loadingOlder ? "과거 연도 데이터 불러오는 중..." : "차트 데이터 로딩 중..."}
          </div>
        )}
        {error && (
          <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded border border-[#f23645] bg-white px-4 py-2 text-xs text-[#f23645]">
            {error}
          </div>
        )}

        <div ref={containerRef} className="h-full w-full" />
      </div>

      {/* Classic Bottom Bar */}
      <footer className="flex h-[32px] shrink-0 items-center justify-between border-t border-[#e0e3eb] bg-white px-3 text-[12px] text-[#787b86]">
        <div className="flex items-center gap-1">
          {RANGE_PRESETS.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => void handleQuickRange(r.seconds)}
              className="rounded px-2 py-0.5 text-[12px] text-[#131722] hover:bg-[#f0f3fa] transition-colors"
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[11px] tabular-nums">
          {timeframe === "1m" && loadedYears.length > 0 && (
            <span className="hidden sm:inline">
              로드 구간: {Math.min(...loadedYears)}~{Math.max(...loadedYears)}년
              {loadedYears.length < availableYears.length
                ? " (왼쪽 스크롤 시 과거 자동 로드)"
                : ""}
            </span>
          )}
          <span>{barCount.toLocaleString()}봉</span>
          <span className="border-l border-[#e0e3eb] pl-3 text-[#131722]">UTC+9 (KST)</span>
        </div>
      </footer>
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-[1px] shrink-0 bg-[#e0e3eb]" />;
}

function ToggleChip({
  label,
  active,
  dotColor,
  onClick,
}: {
  label: string;
  active: boolean;
  dotColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors ${
        active
          ? "bg-[#eef3ff] text-[#2962ff] font-medium"
          : "text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722]"
      }`}
    >
      {dotColor && (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: dotColor, opacity: active ? 1 : 0.35 }}
        />
      )}
      {label}
    </button>
  );
}
