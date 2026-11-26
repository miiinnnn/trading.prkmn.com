"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Download,
  Play,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { loadBarsForRange, type Timeframe } from "@/lib/dataLoader";
import {
  runMaCrossoverBacktest,
  type BacktestParams,
  type BacktestResult,
  type DirectionMode,
  type MAType,
  type SessionMode,
} from "@/lib/backtest";
import PriceChart from "./PriceChart";
import EquityChart from "./EquityChart";

const DEFAULT_PARAMS: BacktestParams = {
  timeframe: "1h",
  startDate: "2024-01-01",
  endDate: "2026-11-12",
  maType: "EMA",
  fastPeriod: 20,
  slowPeriod: 60,
  direction: "long_short",
  session: "all",
  contracts: 1,
  initialCapital: 100000,
  commissionPerSide: 2.5,
  slippageTicks: 1,
};

const DATE_PRESETS = [
  { label: "전체 5년", start: "2021-11-15", end: "2026-11-12" },
  { label: "최근 1년", start: "2025-11-12", end: "2026-11-12" },
  { label: "2026", start: "2026-01-01", end: "2026-11-12" },
  { label: "2025", start: "2025-01-01", end: "2025-12-31" },
  { label: "2022 하락장", start: "2022-01-01", end: "2022-12-31" },
];

const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "1m", label: "1분" },
  { value: "5m", label: "5분" },
  { value: "15m", label: "15분" },
  { value: "1h", label: "1시간" },
  { value: "1d", label: "일봉" },
];

function fmtUsd(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmtPct(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtKst(tsSec: number): string {
  const d = new Date(tsSec * 1000);
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

export default function BacktesterApp() {
  const [params, setParams] = useState<BacktestParams>(DEFAULT_PARAMS);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tradePage, setTradePage] = useState(1);
  const TRADES_PER_PAGE = 25;

  const executeBacktest = useCallback(async (cfg: BacktestParams) => {
    if (cfg.fastPeriod >= cfg.slowPeriod) {
      setError("단기 이평선(Fast) 기간은 장기 이평선(Slow)보다 작아야 합니다.");
      return;
    }
    if (cfg.startDate > cfg.endDate) {
      setError("시작일은 종료일보다 이전이어야 합니다.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const warmup = cfg.slowPeriod + 5;
      const { bars, evalStartIdx } = await loadBarsForRange(
        cfg.timeframe,
        cfg.startDate,
        cfg.endDate,
        warmup
      );
      const res = runMaCrossoverBacktest(bars, evalStartIdx, cfg);
      setResult(res);
      setTradePage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "백테스트 실행 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void executeBacktest(DEFAULT_PARAMS);
  }, [executeBacktest]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeBacktest(params);
  };

  const exportTradesCsv = () => {
    if (!result || result.trades.length === 0) return;
    const header =
      "id,side,entry_kst,exit_kst,entry_price,exit_price,pnl_pts,pnl_usd,fees_usd,bars_held,cum_equity\n";
    const rows = result.trades
      .map(
        (t) =>
          `${t.id},${t.side},"${fmtKst(t.entryTs)}","${fmtKst(t.exitTs)}",${t.entryPrice.toFixed(2)},${t.exitPrice.toFixed(2)},${t.pnlPts.toFixed(2)},${t.pnlUsd.toFixed(2)},${t.feesUsd.toFixed(2)},${t.barsHeld},${t.cumEquity.toFixed(2)}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nq_ma_${params.maType}_${params.fastPeriod}_${params.slowPeriod}_${params.timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const paginatedTrades = useMemo(() => {
    if (!result) return [];
    const reversed = [...result.trades].reverse();
    const start = (tradePage - 1) * TRADES_PER_PAGE;
    return reversed.slice(start, start + TRADES_PER_PAGE);
  }, [result, tradePage]);

  const totalPages = result ? Math.max(1, Math.ceil(result.trades.length / TRADES_PER_PAGE)) : 1;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800/90 bg-[#090d16]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-100">
                NQ.FUT 백테스터
              </h1>
              <p className="text-[11px] text-slate-400">
                CME E-mini Nasdaq-100 근월물 연속 데이터 (Panama 롤보정 · 2021.11 ~ 2026.11)
              </p>
            </div>
          </div>
          {result && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-2.5 py-1 border border-slate-700/60 tabular-nums">
                <Zap className="h-3 w-3 text-amber-400" />
                {result.metrics.evaluatedBars.toLocaleString()}봉 · {result.metrics.execMs.toFixed(1)}ms
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Body Layout */}
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 p-4 lg:flex-row sm:p-6">
        {/* Left Sidebar Controls */}
        <aside className="w-full shrink-0 lg:w-80">
          <form
            onSubmit={handleSubmit}
            className="sticky top-20 space-y-4 rounded-xl border border-slate-800 bg-[#0f1624] p-4"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <SlidersHorizontal className="h-4 w-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">전략 파라미터</h2>
            </div>

            {/* Timeframe */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">타임프레임</label>
              <div className="grid grid-cols-5 gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    type="button"
                    onClick={() => setParams((p) => ({ ...p, timeframe: tf.value }))}
                    className={`rounded-lg py-1.5 text-xs font-medium transition ${
                      params.timeframe === tf.value
                        ? "bg-sky-500 text-slate-950 font-semibold"
                        : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">테스트 기간</label>
              <div className="flex flex-wrap gap-1">
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setParams((p) => ({
                        ...p,
                        startDate: preset.start,
                        endDate: preset.end,
                      }))
                    }
                    className="rounded-md bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 transition"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  min="2021-11-15"
                  max="2026-11-12"
                  value={params.startDate}
                  onChange={(e) => setParams((p) => ({ ...p, startDate: e.target.value }))}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                />
                <input
                  type="date"
                  min="2021-11-15"
                  max="2026-11-12"
                  value={params.endDate}
                  onChange={(e) => setParams((p) => ({ ...p, endDate: e.target.value }))}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {/* MA Strategy Settings */}
            <div className="space-y-2.5 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">이동평균선 교차</span>
                <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                  {(["EMA", "SMA"] as MAType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setParams((p) => ({ ...p, maType: t }))}
                      className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition ${
                        params.maType === t
                          ? "bg-sky-500/20 text-sky-300"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-amber-400">
                    단기선 (Fast)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={500}
                    value={params.fastPeriod}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, fastPeriod: Math.max(2, Number(e.target.value)) }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-sky-400">
                    장기선 (Slow)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={1000}
                    value={params.slowPeriod}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, slowPeriod: Math.max(3, Number(e.target.value)) }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">매매 방향</label>
                  <select
                    value={params.direction}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, direction: e.target.value as DirectionMode }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="long_short">롱 + 숏</option>
                    <option value="long_only">롱 전용</option>
                    <option value="short_only">숏 전용</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">세션 필터</label>
                  <select
                    value={params.session}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, session: e.target.value as SessionMode }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="all">전체 (23시간)</option>
                    <option value="rth_only">정규장 (RTH)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Capital & Execution */}
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <span className="text-xs font-medium text-slate-400">자금 &amp; 체결 비용</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">초기 자본 ($)</label>
                  <input
                    type="number"
                    min={1000}
                    step={10000}
                    value={params.initialCapital}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, initialCapital: Math.max(1000, Number(e.target.value)) }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">계약 수 (NQ)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={params.contracts}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, contracts: Math.max(1, Number(e.target.value)) }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">편도 수수료 ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={params.commissionPerSide}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, commissionPerSide: Math.max(0, Number(e.target.value)) }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">슬리피지 (틱)</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={params.slippageTicks}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, slippageTicks: Math.max(0, Number(e.target.value)) }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                * NQ 1계약 = $20/pt (1틱 = 0.25pt = $5). 종가 교차 시그널 발생 시 다음 봉 시가 체결 (Look-ahead 없음).
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              {loading ? "데이터 로딩 & 계산 중..." : "백테스트 실행"}
            </button>
          </form>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1 space-y-5">
          {/* KPI Cards */}
          {result && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <KpiCard
                label="순수익 (Net Profit)"
                value={fmtUsd(result.metrics.netProfitUsd)}
                sub={fmtPct(result.metrics.netProfitPct)}
                positive={result.metrics.netProfitUsd >= 0}
              />
              <KpiCard
                label="연환산 (CAGR)"
                value={fmtPct(result.metrics.cagrPct)}
                sub={`B&H ${fmtPct(result.metrics.buyHoldPct)}`}
                positive={result.metrics.cagrPct >= 0}
              />
              <KpiCard
                label="최대 낙폭 (MDD)"
                value={`-${result.metrics.maxDrawdownPct.toFixed(2)}%`}
                sub={`-$${Math.round(result.metrics.maxDrawdownUsd).toLocaleString()}`}
                positive={false}
              />
              <KpiCard
                label="샤프 / 손익비(PF)"
                value={result.metrics.sharpeRatio.toFixed(2)}
                sub={`PF ${result.metrics.profitFactor.toFixed(2)}`}
                positive={result.metrics.sharpeRatio >= 1}
                neutral={result.metrics.sharpeRatio > 0 && result.metrics.sharpeRatio < 1}
              />
              <KpiCard
                label="승률 (Win Rate)"
                value={`${result.metrics.winRatePct.toFixed(1)}%`}
                sub={`${result.metrics.winningTrades}승 / ${result.metrics.losingTrades}패 (${result.metrics.totalTrades}건)`}
                neutral
              />
              <KpiCard
                label="평균 손익비"
                value={result.metrics.payoffRatio.toFixed(2)}
                sub={`수수료 $${Math.round(result.metrics.totalFeesUsd).toLocaleString()}`}
                neutral
              />
            </div>
          )}

          {/* Price + MA Chart */}
          {result && result.candles.length > 0 && (
            <PriceChart
              candles={result.candles}
              markers={result.markers}
              fastLabel={`${params.maType} ${params.fastPeriod}`}
              slowLabel={`${params.maType} ${params.slowPeriod}`}
              truncated={result.chartTruncated}
            />
          )}

          {/* Equity Curve & Drawdown */}
          {result && result.equityCurve.length > 0 && (
            <EquityChart
              equityCurve={result.equityCurve}
              initialCapital={params.initialCapital}
            />
          )}

          {/* Trade Log Table */}
          {result && (
            <div className="rounded-xl border border-slate-800 bg-[#0f1624] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    거래 내역 (최신순 · 총 {result.trades.length.toLocaleString()}건)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    평균 수익 {fmtUsd(result.metrics.avgWinUsd)} · 평균 손실 -${Math.round(result.metrics.avgLossUsd).toLocaleString()} · 평균 보유 {result.metrics.avgBarsHeld.toFixed(1)}봉 (시각은 KST 기준)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportTradesCsv}
                  disabled={result.trades.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40 transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV 다운로드
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">포지션</th>
                      <th className="py-2 pr-3">진입 시각 (KST)</th>
                      <th className="py-2 pr-3">청산 시각 (KST)</th>
                      <th className="py-2 pr-3 text-right">진입가</th>
                      <th className="py-2 pr-3 text-right">청산가</th>
                      <th className="py-2 pr-3 text-right">손익 (pt)</th>
                      <th className="py-2 pr-3 text-right">순손익 ($)</th>
                      <th className="py-2 text-right">누적 자산 ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {paginatedTrades.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-800/30">
                        <td className="py-2 pr-3 text-slate-500">{t.id}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              t.side === "LONG"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-rose-500/15 text-rose-400"
                            }`}
                          >
                            {t.side === "LONG" ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {t.side}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-slate-300">{fmtKst(t.entryTs)}</td>
                        <td className="py-2 pr-3 text-slate-300">{fmtKst(t.exitTs)}</td>
                        <td className="py-2 pr-3 text-right text-slate-200">
                          {t.entryPrice.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-200">
                          {t.exitPrice.toFixed(2)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-medium ${
                            t.pnlPts >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {t.pnlPts >= 0 ? "+" : ""}
                          {t.pnlPts.toFixed(2)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-semibold ${
                            t.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {fmtUsd(t.pnlUsd)}
                        </td>
                        <td className="py-2 text-right text-slate-300">
                          ${Math.round(t.cumEquity).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {paginatedTrades.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-500">
                          선택한 조건에서 체결된 거래가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
                  <span>
                    페이지 {tradePage} / {totalPages}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={tradePage <= 1}
                      onClick={() => setTradePage((p) => Math.max(1, p - 1))}
                      className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                    >
                      이전
                    </button>
                    <button
                      type="button"
                      disabled={tradePage >= totalPages}
                      onClick={() => setTradePage((p) => Math.min(totalPages, p + 1))}
                      className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  positive,
  neutral,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
  neutral?: boolean;
}) {
  const colorClass = neutral
    ? "text-slate-100"
    : positive
    ? "text-emerald-400"
    : "text-rose-400";

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0f1624] p-3.5">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold tracking-tight tabular-nums ${colorClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{sub}</div>
    </div>
  );
}
