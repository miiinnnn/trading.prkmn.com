import type { MarketBars, Timeframe } from "./dataLoader";

export type MAType = "SMA" | "EMA";
export type DirectionMode = "long_short" | "long_only" | "short_only";
export type SessionMode = "all" | "rth_only";

export interface BacktestParams {
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  maType: MAType;
  fastPeriod: number;
  slowPeriod: number;
  direction: DirectionMode;
  session: SessionMode;
  contracts: number;
  initialCapital: number;
  commissionPerSide: number;
  slippageTicks: number;
}

export interface TradeRecord {
  id: number;
  side: "LONG" | "SHORT";
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  pnlPts: number;
  pnlUsd: number;
  feesUsd: number;
  barsHeld: number;
  cumEquity: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdownPct: number;
  buyHoldEquity: number;
}

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  fastMa: number | null;
  slowMa: number | null;
}

export interface ChartMarker {
  time: number;
  position: "belowBar" | "aboveBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

export interface BacktestMetrics {
  netProfitUsd: number;
  netProfitPct: number;
  buyHoldPct: number;
  cagrPct: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  winRatePct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWinUsd: number;
  avgLossUsd: number;
  payoffRatio: number;
  totalFeesUsd: number;
  avgBarsHeld: number;
  evaluatedBars: number;
  execMs: number;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: TradeRecord[];
  equityCurve: EquityPoint[];
  candles: ChartCandle[];
  markers: ChartMarker[];
  chartTruncated: boolean;
}

const POINT_VALUE_USD = 20; // NQ E-mini: $20 per point
const TICK_SIZE = 0.25;     // 1 tick = 0.25 pts = $5

function computeSMA(close: Float32Array, period: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (period <= 0 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += close[i];
    if (i >= period) sum -= close[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeEMA(close: Float32Array, period: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (period <= 0 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += close[i];
  let ema = sum / period;
  out[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    ema = close[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function filterRthBars(
  bars: MarketBars,
  evalStartIdx: number
): { bars: MarketBars; evalStartIdx: number } {
  let count = 0;
  for (let i = 0; i < bars.length; i++) {
    if (bars.isRth[i] === 1) count++;
  }
  const ts = new Uint32Array(count);
  const open = new Float32Array(count);
  const high = new Float32Array(count);
  const low = new Float32Array(count);
  const close = new Float32Array(count);
  const volume = new Uint32Array(count);
  const isRth = new Uint8Array(count);

  let j = 0;
  let newEvalStart = 0;
  let evalAssigned = false;
  for (let i = 0; i < bars.length; i++) {
    if (bars.isRth[i] === 1) {
      if (!evalAssigned && i >= evalStartIdx) {
        newEvalStart = j;
        evalAssigned = true;
      }
      ts[j] = bars.ts[i];
      open[j] = bars.open[i];
      high[j] = bars.high[i];
      low[j] = bars.low[i];
      close[j] = bars.close[i];
      volume[j] = bars.volume[i];
      isRth[j] = 1;
      j++;
    }
  }
  if (!evalAssigned) newEvalStart = count;

  return {
    bars: { length: count, ts, open, high, low, close, volume, isRth },
    evalStartIdx: newEvalStart,
  };
}

export function runMaCrossoverBacktest(
  rawBars: MarketBars,
  rawEvalStartIdx: number,
  params: BacktestParams
): BacktestResult {
  const t0 = performance.now();

  const { bars, evalStartIdx } =
    params.session === "rth_only"
      ? filterRthBars(rawBars, rawEvalStartIdx)
      : { bars: rawBars, evalStartIdx: rawEvalStartIdx };

  const n = bars.length;
  const evalCount = Math.max(0, n - evalStartIdx);

  if (evalCount < 2) {
    return {
      metrics: {
        netProfitUsd: 0,
        netProfitPct: 0,
        buyHoldPct: 0,
        cagrPct: 0,
        maxDrawdownUsd: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        profitFactor: 0,
        winRatePct: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgWinUsd: 0,
        avgLossUsd: 0,
        payoffRatio: 0,
        totalFeesUsd: 0,
        avgBarsHeld: 0,
        evaluatedBars: evalCount,
        execMs: performance.now() - t0,
      },
      trades: [],
      equityCurve: [],
      candles: [],
      markers: [],
      chartTruncated: false,
    };
  }

  const fastMa =
    params.maType === "EMA"
      ? computeEMA(bars.close, params.fastPeriod)
      : computeSMA(bars.close, params.fastPeriod);
  const slowMa =
    params.maType === "EMA"
      ? computeEMA(bars.close, params.slowPeriod)
      : computeSMA(bars.close, params.slowPeriod);

  const slipPts = params.slippageTicks * TICK_SIZE;
  const sideFeeUsd = params.commissionPerSide * params.contracts;
  const dollarPerPt = POINT_VALUE_USD * params.contracts;

  const state: { pos: 0 | 1 | -1 } = { pos: 0 }; // 0=flat, 1=long, -1=short
  let entryPrice = 0;
  let entryTs = 0;
  let entryBarIdx = 0;
  let realizedEquity = params.initialCapital;
  let totalFeesUsd = 0;

  let peakEquity = params.initialCapital;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;

  const trades: TradeRecord[] = [];
  let tradeId = 0;

  // Daily equity buckets for Sharpe calculation
  const dailyEquity = new Map<number, number>();

  // Downsampled equity curve (~1500 points max)
  const eqStep = Math.max(1, Math.floor(evalCount / 1500));
  const equityCurve: EquityPoint[] = [];
  const bhStartPrice = bars.open[evalStartIdx];

  // Pending target position decided on bar i-1 close, executed at bar i open (no look-ahead)
  let pendingTarget: 0 | 1 | -1 | null = null;

  const closePosition = (exitRawOpen: number, exitTs: number, barIdx: number) => {
    if (state.pos === 0) return;
    const fillExit = state.pos === 1 ? exitRawOpen - slipPts : exitRawOpen + slipPts;
    const pnlPts = state.pos === 1 ? fillExit - entryPrice : entryPrice - fillExit;
    const grossUsd = pnlPts * dollarPerPt;
    const roundTripFees = sideFeeUsd * 2;
    const netUsd = grossUsd - roundTripFees;
    realizedEquity += netUsd;
    totalFeesUsd += roundTripFees;
    tradeId++;
    trades.push({
      id: tradeId,
      side: state.pos === 1 ? "LONG" : "SHORT",
      entryTs,
      exitTs,
      entryPrice,
      exitPrice: fillExit,
      pnlPts,
      pnlUsd: netUsd,
      feesUsd: roundTripFees,
      barsHeld: barIdx - entryBarIdx,
      cumEquity: realizedEquity,
    });
    state.pos = 0;
  };

  const openPosition = (side: 1 | -1, entryRawOpen: number, ts: number, barIdx: number) => {
    const fillEntry = side === 1 ? entryRawOpen + slipPts : entryRawOpen - slipPts;
    state.pos = side;
    entryPrice = fillEntry;
    entryTs = ts;
    entryBarIdx = barIdx;
  };

  for (let i = evalStartIdx; i < n; i++) {
    const ts = bars.ts[i];
    const openPx = bars.open[i];
    const closePx = bars.close[i];

    // 1. Execute pending signal at bar open
    if (pendingTarget !== null) {
      if (state.pos !== 0 && pendingTarget !== state.pos) {
        closePosition(openPx, ts, i);
      }
      if (pendingTarget !== 0 && state.pos === 0) {
        openPosition(pendingTarget, openPx, ts, i);
      }
      pendingTarget = null;
    }

    // 2. Mark-to-market equity at bar close
    let unrealized = 0;
    if (state.pos === 1) unrealized = (closePx - entryPrice) * dollarPerPt - sideFeeUsd;
    else if (state.pos === -1) unrealized = (entryPrice - closePx) * dollarPerPt - sideFeeUsd;

    const mtmEquity = realizedEquity + unrealized;
    if (mtmEquity > peakEquity) peakEquity = mtmEquity;
    const ddUsd = peakEquity - mtmEquity;
    const ddPct = peakEquity > 0 ? (ddUsd / peakEquity) * 100 : 0;
    if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    const dayKey = Math.floor(ts / 86400);
    dailyEquity.set(dayKey, mtmEquity);

    const relIdx = i - evalStartIdx;
    if (relIdx % eqStep === 0 || i === n - 1) {
      const bhEquity =
        params.initialCapital + (closePx - bhStartPrice) * dollarPerPt;
      equityCurve.push({
        time: ts,
        equity: Number(mtmEquity.toFixed(2)),
        drawdownPct: Number((-ddPct).toFixed(2)),
        buyHoldEquity: Number(bhEquity.toFixed(2)),
      });
    }

    // 3. Evaluate MA crossover signal at bar close for NEXT bar's open
    if (i > 0 && i < n - 1) {
      const fPrev = fastMa[i - 1];
      const sPrev = slowMa[i - 1];
      const fCurr = fastMa[i];
      const sCurr = slowMa[i];

      if (!Number.isNaN(fPrev) && !Number.isNaN(sPrev) && !Number.isNaN(fCurr) && !Number.isNaN(sCurr)) {
        const bullCross = fPrev <= sPrev && fCurr > sCurr;
        const bearCross = fPrev >= sPrev && fCurr < sCurr;

        if (bullCross) {
          if (params.direction === "long_short" || params.direction === "long_only") {
            pendingTarget = 1;
          } else if (params.direction === "short_only" && state.pos === -1) {
            pendingTarget = 0;
          }
        } else if (bearCross) {
          if (params.direction === "long_short" || params.direction === "short_only") {
            pendingTarget = -1;
          } else if (params.direction === "long_only" && state.pos === 1) {
            pendingTarget = 0;
          }
        }
      }
    }
  }

  // Close open position at final bar close so metrics reflect realized PnL
  if (state.pos !== 0) {
    closePosition(bars.close[n - 1], bars.ts[n - 1], n - 1);
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1].equity = Number(realizedEquity.toFixed(2));
    }
  }

  // Summary statistics
  const netProfitUsd = realizedEquity - params.initialCapital;
  const netProfitPct = (netProfitUsd / params.initialCapital) * 100;
  const bhEndPrice = bars.close[n - 1];
  const buyHoldPct = bhStartPrice > 0 ? ((bhEndPrice - bhStartPrice) / bhStartPrice) * 100 : 0;

  const spanYears = Math.max((bars.ts[n - 1] - bars.ts[evalStartIdx]) / (365.25 * 86400), 1 / 365.25);
  const endRatio = Math.max(realizedEquity / params.initialCapital, 0.0001);
  const cagrPct = (Math.pow(endRatio, 1 / spanYears) - 1) * 100;

  // Daily Sharpe Ratio (annualized, 252 trading days)
  const dayVals = Array.from(dailyEquity.values());
  let sharpeRatio = 0;
  if (dayVals.length > 2) {
    const rets: number[] = [];
    for (let k = 1; k < dayVals.length; k++) {
      if (dayVals[k - 1] > 0) rets.push((dayVals[k] - dayVals[k - 1]) / dayVals[k - 1]);
    }
    if (rets.length > 1) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
      const std = Math.sqrt(variance);
      if (std > 0) sharpeRatio = (mean / std) * Math.sqrt(252);
    }
  }

  let grossWin = 0;
  let grossLoss = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let totalBarsHeld = 0;

  for (const t of trades) {
    totalBarsHeld += t.barsHeld;
    if (t.pnlUsd > 0) {
      winningTrades++;
      grossWin += t.pnlUsd;
    } else {
      losingTrades++;
      grossLoss += Math.abs(t.pnlUsd);
    }
  }

  const totalTrades = trades.length;
  const winRatePct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const avgWinUsd = winningTrades > 0 ? grossWin / winningTrades : 0;
  const avgLossUsd = losingTrades > 0 ? grossLoss / losingTrades : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.99 : 0;
  const payoffRatio = avgLossUsd > 0 ? avgWinUsd / avgLossUsd : 0;
  const avgBarsHeld = totalTrades > 0 ? totalBarsHeld / totalTrades : 0;

  // Prepare candlestick + MA chart data (cap at 35,000 most recent bars for crisp 60fps canvas rendering)
  const MAX_CHART_BARS = 35000;
  const chartStart = Math.max(evalStartIdx, n - MAX_CHART_BARS);
  const chartTruncated = chartStart > evalStartIdx;
  const chartMinTs = bars.ts[chartStart];

  const candles: ChartCandle[] = new Array(n - chartStart);
  for (let i = chartStart; i < n; i++) {
    candles[i - chartStart] = {
      time: bars.ts[i],
      open: bars.open[i],
      high: bars.high[i],
      low: bars.low[i],
      close: bars.close[i],
      fastMa: Number.isNaN(fastMa[i]) ? null : Number(fastMa[i].toFixed(2)),
      slowMa: Number.isNaN(slowMa[i]) ? null : Number(slowMa[i].toFixed(2)),
    };
  }

  const markers: ChartMarker[] = [];
  for (const t of trades) {
    if (t.entryTs >= chartMinTs) {
      markers.push({
        time: t.entryTs,
        position: t.side === "LONG" ? "belowBar" : "aboveBar",
        color: t.side === "LONG" ? "#10b981" : "#f43f5e",
        shape: t.side === "LONG" ? "arrowUp" : "arrowDown",
        text: t.side === "LONG" ? "L" : "S",
      });
    }
  }
  markers.sort((a, b) => a.time - b.time);

  return {
    metrics: {
      netProfitUsd,
      netProfitPct,
      buyHoldPct,
      cagrPct,
      maxDrawdownUsd,
      maxDrawdownPct,
      sharpeRatio,
      profitFactor,
      winRatePct,
      totalTrades,
      winningTrades,
      losingTrades,
      avgWinUsd,
      avgLossUsd,
      payoffRatio,
      totalFeesUsd,
      avgBarsHeld,
      evaluatedBars: evalCount,
      execMs: performance.now() - t0,
    },
    trades,
    equityCurve,
    candles,
    markers,
    chartTruncated,
  };
}
