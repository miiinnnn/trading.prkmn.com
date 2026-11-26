"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HyperliquidFill,
  HyperliquidPosition,
} from "@/app/api/hyperliquid/route";

interface TrackedWallet {
  id: string;
  label: string;
  address: string;
}

interface WalletState {
  accountValue: number;
  totalMarginUsed: number;
  totalNtlPos: number;
  positions: HyperliquidPosition[];
  recentFills: HyperliquidFill[];
  updatedAt: string;
  error?: string;
}

interface SignalAlert {
  id: string;
  time: string;
  trader: string;
  message: string;
  tone: "long" | "short" | "neutral";
}

interface YoutubeStream {
  id: string;
  trader: string;
  videoId: string;
}

interface FollowedTrade {
  id: string;
  trader: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  slPrice: number | null;
  tpPrice: number | null;
  exitPrice: number | null;
  status: "OPEN" | "CLOSED";
  note: string;
  openedAt: string;
  closedAt?: string;
}

const LS_WALLETS = "td_hl_wallets_v1";
const LS_STREAMS = "td_yt_streams_v1";
const LS_TRADES = "td_followed_trades_v1";

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  } catch {
    // Ignore autoplay restriction
  }
}

function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "").slice(0, 11);
      return id.length === 11 ? id : null;
    }
    const v = url.searchParams.get("v");
    if (v && v.length === 11) return v;
    const liveMatch = url.pathname.match(/\/(?:live|embed|shorts)\/([a-zA-Z0-9_-]{11})/);
    if (liveMatch) return liveMatch[1];
  } catch {
    return null;
  }
  return null;
}

function fmtUsd(v: number, signed = false): string {
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "-" : "") : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtTimeKst(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function TraderTrackerPanel() {
  const [activeTab, setActiveTab] = useState<"hyperliquid" | "youtube">("hyperliquid");

  // --- Hyperliquid State ---
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [walletStates, setWalletStates] = useState<Record<string, WalletState>>({});
  const [newLabel, setNewLabel] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [pollSec, setPollSec] = useState<number>(10);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [signals, setSignals] = useState<SignalAlert[]>([]);
  const [hlFormErr, setHlFormErr] = useState<string | null>(null);
  const prevPosSnapRef = useRef<Record<string, Map<string, { side: string; size: number }>>>({});

  // --- YouTube & Follow-Along State ---
  const [streams, setStreams] = useState<YoutubeStream[]>([]);
  const [ytTrader, setYtTrader] = useState("");
  const [ytUrl, setYtUrl] = useState("");
  const [ytErr, setYtErr] = useState<string | null>(null);

  const [trades, setTrades] = useState<FollowedTrade[]>([]);
  const [fTrader, setFTrader] = useState("");
  const [fSymbol, setFSymbol] = useState("NQ");
  const [fSide, setFSide] = useState<"LONG" | "SHORT">("LONG");
  const [fEntry, setFEntry] = useState("");
  const [fSl, setFSl] = useState("");
  const [fTp, setFTp] = useState("");
  const [fNote, setFNote] = useState("");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePxInput, setClosePxInput] = useState("");

  // Load saved state from localStorage
  useEffect(() => {
    try {
      const wRaw = localStorage.getItem(LS_WALLETS);
      if (wRaw) {
        const parsed = JSON.parse(wRaw) as TrackedWallet[];
        setWallets(parsed);
        if (parsed.length > 0) setSelectedWalletId(parsed[0].id);
      }
      const sRaw = localStorage.getItem(LS_STREAMS);
      if (sRaw) setStreams(JSON.parse(sRaw) as YoutubeStream[]);
      const tRaw = localStorage.getItem(LS_TRADES);
      if (tRaw) setTrades(JSON.parse(tRaw) as FollowedTrade[]);
    } catch {
      // Ignore corrupt storage
    }
  }, []);

  const persistWallets = (next: TrackedWallet[]) => {
    setWallets(next);
    try {
      localStorage.setItem(LS_WALLETS, JSON.stringify(next));
    } catch {}
  };

  const persistStreams = (next: YoutubeStream[]) => {
    setStreams(next);
    try {
      localStorage.setItem(LS_STREAMS, JSON.stringify(next));
    } catch {}
  };

  const persistTrades = (next: FollowedTrade[]) => {
    setTrades(next);
    try {
      localStorage.setItem(LS_TRADES, JSON.stringify(next));
    } catch {}
  };

  // Fetch & diff Hyperliquid positions for all tracked wallets
  const pollWallets = useCallback(async () => {
    if (wallets.length === 0) return;

    await Promise.all(
      wallets.map(async (w) => {
        try {
          const res = await fetch(`/api/hyperliquid?address=${encodeURIComponent(w.address)}`);
          const data = await res.json();
          if (!res.ok) {
            setWalletStates((prev) => ({
              ...prev,
              [w.id]: {
                accountValue: 0,
                totalMarginUsed: 0,
                totalNtlPos: 0,
                positions: [],
                recentFills: [],
                updatedAt: new Date().toISOString(),
                error: data.error ?? "조회 오류",
              },
            }));
            return;
          }

          const positions = (data.positions ?? []) as HyperliquidPosition[];
          const prevMap = prevPosSnapRef.current[w.id];
          const currMap = new Map<string, { side: string; size: number }>();
          for (const p of positions) currMap.set(p.coin, { side: p.side, size: p.size });

          if (prevMap) {
            const newAlerts: SignalAlert[] = [];
            const nowStr = fmtTimeKst(Date.now());

            for (const p of positions) {
              const old = prevMap.get(p.coin);
              if (!old) {
                newAlerts.push({
                  id: `${w.id}-${p.coin}-${Date.now()}`,
                  time: nowStr,
                  trader: w.label,
                  message: `${p.coin} ${p.side} 신규 진입 (${p.size}, 진입가 ${p.entryPx})`,
                  tone: p.side === "LONG" ? "long" : "short",
                });
              } else if (old.side !== p.side) {
                newAlerts.push({
                  id: `${w.id}-${p.coin}-flip-${Date.now()}`,
                  time: nowStr,
                  trader: w.label,
                  message: `${p.coin} 스위칭 ${old.side} → ${p.side} (${p.size}, 진입가 ${p.entryPx})`,
                  tone: p.side === "LONG" ? "long" : "short",
                });
              } else if (Math.abs(old.size - p.size) / Math.max(old.size, 1e-9) > 0.05) {
                const action = p.size > old.size ? "추가 진입" : "부분 청산";
                newAlerts.push({
                  id: `${w.id}-${p.coin}-sz-${Date.now()}`,
                  time: nowStr,
                  trader: w.label,
                  message: `${p.coin} ${p.side} ${action} (${old.size} → ${p.size})`,
                  tone: p.side === "LONG" ? "long" : "short",
                });
              }
            }

            for (const [coin, old] of prevMap.entries()) {
              if (!currMap.has(coin)) {
                newAlerts.push({
                  id: `${w.id}-${coin}-close-${Date.now()}`,
                  time: nowStr,
                  trader: w.label,
                  message: `${coin} ${old.side} 전량 청산`,
                  tone: "neutral",
                });
              }
            }

            if (newAlerts.length > 0) {
              if (soundEnabled) playBeep();
              setSignals((prev) => [...newAlerts, ...prev].slice(0, 40));
            }
          }

          prevPosSnapRef.current[w.id] = currMap;

          setWalletStates((prev) => ({
            ...prev,
            [w.id]: {
              accountValue: data.accountValue,
              totalMarginUsed: data.totalMarginUsed,
              totalNtlPos: data.totalNtlPos,
              positions,
              recentFills: data.recentFills ?? [],
              updatedAt: data.updatedAt,
            },
          }));
        } catch (e) {
          setWalletStates((prev) => ({
            ...prev,
            [w.id]: {
              accountValue: 0,
              totalMarginUsed: 0,
              totalNtlPos: 0,
              positions: [],
              recentFills: [],
              updatedAt: new Date().toISOString(),
              error: e instanceof Error ? e.message : "네트워크 오류",
            },
          }));
        }
      })
    );
  }, [wallets, soundEnabled]);

  useEffect(() => {
    void pollWallets();
    if (pollSec <= 0 || wallets.length === 0) return;
    const timer = setInterval(() => void pollWallets(), pollSec * 1000);
    return () => clearInterval(timer);
  }, [pollWallets, pollSec, wallets.length]);

  const handleAddWallet = (e: React.FormEvent) => {
    e.preventDefault();
    const addr = newAddress.trim();
    const label = newLabel.trim() || `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setHlFormErr("0x로 시작하는 42자리 지갑 주소를 입력해 주세요.");
      return;
    }
    if (wallets.some((w) => w.address.toLowerCase() === addr.toLowerCase())) {
      setHlFormErr("이미 등록된 지갑 주소입니다.");
      return;
    }
    setHlFormErr(null);
    const created: TrackedWallet = { id: `w_${Date.now()}`, label, address: addr };
    const next = [...wallets, created];
    persistWallets(next);
    setSelectedWalletId(created.id);
    setNewLabel("");
    setNewAddress("");
  };

  const handleRemoveWallet = (id: string) => {
    const next = wallets.filter((w) => w.id !== id);
    persistWallets(next);
    delete prevPosSnapRef.current[id];
    if (selectedWalletId === id) setSelectedWalletId(next[0]?.id ?? "");
  };

  const handleAddStream = (e: React.FormEvent) => {
    e.preventDefault();
    const vid = extractYoutubeVideoId(ytUrl);
    if (!vid) {
      setYtErr("올바른 유튜브 라이브 URL 또는 11자리 영상 ID를 입력해 주세요.");
      return;
    }
    setYtErr(null);
    const next = [
      ...streams,
      { id: `yt_${Date.now()}`, trader: ytTrader.trim() || "라이브 트레이더", videoId: vid },
    ];
    persistStreams(next);
    setYtTrader("");
    setYtUrl("");
  };

  const handleAddFollowedTrade = (e: React.FormEvent) => {
    e.preventDefault();
    const entry = Number(fEntry);
    if (!entry || Number.isNaN(entry)) return;
    const sl = fSl.trim() ? Number(fSl) : null;
    const tp = fTp.trim() ? Number(fTp) : null;
    const item: FollowedTrade = {
      id: `tr_${Date.now()}`,
      trader: fTrader.trim() || streams[0]?.trader || "트레이더",
      symbol: fSymbol.trim().toUpperCase() || "NQ",
      side: fSide,
      entryPrice: entry,
      slPrice: sl,
      tpPrice: tp,
      exitPrice: null,
      status: "OPEN",
      note: fNote.trim(),
      openedAt: fmtTimeKst(Date.now()),
    };
    persistTrades([item, ...trades]);
    setFEntry("");
    setFSl("");
    setFTp("");
    setFNote("");
  };

  const handleCloseFollowedTrade = (id: string) => {
    const exitPx = Number(closePxInput);
    if (!exitPx || Number.isNaN(exitPx)) return;
    const next = trades.map((t) =>
      t.id === id
        ? { ...t, status: "CLOSED" as const, exitPrice: exitPx, closedAt: fmtTimeKst(Date.now()) }
        : t
    );
    persistTrades(next);
    setClosingId(null);
    setClosePxInput("");
  };

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId) ?? wallets[0];
  const selectedState = selectedWallet ? walletStates[selectedWallet.id] : undefined;

  return (
    <section className="flex h-full flex-col bg-white min-h-0">
      {/* Classic Underline Tab Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#dfe3ea] bg-[#f7f8fa] px-3">
        <div className="flex h-full items-center gap-4 text-[12px]">
          <button
            type="button"
            onClick={() => setActiveTab("hyperliquid")}
            className={`h-full border-b-2 px-1 font-semibold transition-colors ${
              activeTab === "hyperliquid"
                ? "border-[#1d4ed8] text-[#1d4ed8]"
                : "border-transparent text-[#64748b] hover:text-[#111827]"
            }`}
          >
            하이퍼리퀴드 실시간 포지션 추적
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("youtube")}
            className={`h-full border-b-2 px-1 font-semibold transition-colors ${
              activeTab === "youtube"
                ? "border-[#1d4ed8] text-[#1d4ed8]"
                : "border-transparent text-[#64748b] hover:text-[#111827]"
            }`}
          >
            유튜브 라이브 &amp; 포지션 따라가기
          </button>
        </div>

        {activeTab === "hyperliquid" && (
          <div className="flex items-center gap-2 text-[11px] text-[#64748b]">
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => setSoundEnabled(e.target.checked)}
                className="accent-[#1d4ed8]"
              />
              변동 알림음
            </label>
            <select
              value={pollSec}
              onChange={(e) => setPollSec(Number(e.target.value))}
              className="h-6 border border-[#d1d5db] bg-white px-1.5 text-[11px] text-[#334155]"
            >
              <option value={5}>5초 갱신</option>
              <option value={10}>10초 갱신</option>
              <option value={30}>30초 갱신</option>
              <option value={0}>수동</option>
            </select>
            <button
              type="button"
              onClick={() => void pollWallets()}
              className="h-6 border border-[#dfe3ea] bg-white px-2 text-[#475569] hover:bg-[#f1f5f9]"
            >
              갱신
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: HYPERLIQUID REAL-TIME ON-CHAIN TRACKER */}
      {activeTab === "hyperliquid" && (
        <div className="flex flex-1 flex-col min-h-0 overflow-auto">
          {/* Add Wallet Bar */}
          <form
            onSubmit={handleAddWallet}
            className="flex flex-wrap items-center gap-2 border-b border-[#dfe3ea] bg-white px-3 py-2 text-[12px]"
          >
            <input
              type="text"
              placeholder="트레이더 별명 (예: 고래1)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-7 w-36 border border-[#d1d5db] px-2 text-[12px] focus:border-[#1d4ed8] focus:outline-none"
            />
            <input
              type="text"
              placeholder="Hyperliquid 지갑 주소 (0x...)"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="h-7 min-w-[240px] flex-1 border border-[#d1d5db] px-2 text-[12px] font-mono focus:border-[#1d4ed8] focus:outline-none"
            />
            <button
              type="submit"
              className="h-7 border border-[#1d4ed8] bg-[#1d4ed8] px-3 text-[12px] font-medium text-white hover:bg-[#1e40af]"
            >
              트레이더 추가
            </button>
            {hlFormErr && <span className="text-[11px] text-[#c92a2a]">{hlFormErr}</span>}
          </form>

          {/* Tracked Wallets Strip */}
          {wallets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[#dfe3ea] bg-[#f8f9fb] px-3 py-1.5 text-[11px]">
              {wallets.map((w) => {
                const st = walletStates[w.id];
                const posCount = st?.positions.length ?? 0;
                const active = selectedWallet?.id === w.id;
                return (
                  <div
                    key={w.id}
                    className={`inline-flex items-center border ${
                      active
                        ? "border-[#1d4ed8] bg-[#eff4ff] text-[#1d4ed8]"
                        : "border-[#dfe3ea] bg-white text-[#334155]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedWalletId(w.id)}
                      className="px-2 py-0.5 font-medium"
                    >
                      {w.label}{" "}
                      <span className="text-[10px] text-[#64748b] tabular-nums">
                        ({posCount})
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveWallet(w.id)}
                      className="border-l border-[#dfe3ea] px-1.5 py-0.5 text-[#94a3b8] hover:text-[#c92a2a]"
                      title="삭제"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected Wallet Overview & Live Positions */}
          {!selectedWallet ? (
            <div className="p-6 text-[12px] text-[#64748b] space-y-1">
              <p className="font-semibold text-[#111827]">
                추적할 하이퍼리퀴드 트레이더 지갑 주소를 등록해 주세요.
              </p>
              <p>
                Hyperliquid 공개 API를 통해 별도 키 없이 실시간 오픈 포지션, 진입가, 레버리지, 청산가, 미실현 PnL 및 최근 체결 내역을 자동 추적합니다.
              </p>
              <p>
                포지션 신규 진입·스위칭·청산이 감지되면 하단 변동 로그와 알림음으로 즉시 알려줍니다.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col divide-y divide-[#dfe3ea]">
              {/* Account Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#eef1f5] bg-white text-[12px] tabular-nums">
                <div className="px-3 py-2">
                  <div className="text-[10px] text-[#64748b]">트레이더 / 지갑</div>
                  <div className="font-semibold text-[#111827] truncate">
                    {selectedWallet.label}{" "}
                    <span className="font-mono text-[10px] font-normal text-[#94a3b8]">
                      {selectedWallet.address.slice(0, 6)}...{selectedWallet.address.slice(-4)}
                    </span>
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-[10px] text-[#64748b]">계좌 자산 (Account Value)</div>
                  <div className="font-bold text-[#111827]">
                    {selectedState ? fmtUsd(selectedState.accountValue) : "-"}
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-[10px] text-[#64748b]">총 포지션 규모</div>
                  <div className="font-semibold text-[#111827]">
                    {selectedState ? fmtUsd(selectedState.totalNtlPos) : "-"}
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-[10px] text-[#64748b]">사용 증거금</div>
                  <div className="font-semibold text-[#334155]">
                    {selectedState ? fmtUsd(selectedState.totalMarginUsed) : "-"}
                  </div>
                </div>
              </div>

              {selectedState?.error && (
                <div className="px-3 py-2 text-[12px] text-[#c92a2a] bg-[#fff5f5]">
                  {selectedState.error}
                </div>
              )}

              {/* Open Positions Table */}
              <div>
                <div className="flex items-center justify-between bg-[#f8f9fb] px-3 py-1 border-b border-[#eef1f5] text-[11px] font-semibold text-[#334155]">
                  <span>실시간 보유 포지션 ({selectedState?.positions.length ?? 0})</span>
                  {selectedState?.updatedAt && (
                    <span className="font-normal text-[#94a3b8] tabular-nums">
                      업데이트 {fmtTimeKst(Date.parse(selectedState.updatedAt))}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-[12px] tabular-nums">
                    <thead className="border-b border-[#dfe3ea] bg-white text-[11px] text-[#64748b]">
                      <tr>
                        <th className="py-1.5 pl-3 pr-2 font-medium">종목</th>
                        <th className="py-1.5 px-2 font-medium">방향</th>
                        <th className="py-1.5 px-2 text-right font-medium">수량</th>
                        <th className="py-1.5 px-2 text-right font-medium">진입가</th>
                        <th className="py-1.5 px-2 text-right font-medium">규모 ($)</th>
                        <th className="py-1.5 px-2 text-right font-medium">청산가</th>
                        <th className="py-1.5 pl-2 pr-3 text-right font-medium">미실현 PnL (ROE)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eef1f5]">
                      {selectedState && selectedState.positions.length > 0 ? (
                        selectedState.positions.map((p) => (
                          <tr key={p.coin} className="hover:bg-[#f8fafc]">
                            <td className="py-1.5 pl-3 pr-2 font-bold text-[#111827]">
                              {p.coin}{" "}
                              <span className="text-[10px] font-normal text-[#64748b]">
                                {p.leverage}x
                              </span>
                            </td>
                            <td className="py-1.5 px-2">
                              <span
                                className={`inline-block px-1.5 py-0.5 text-[10px] font-bold border ${
                                  p.side === "LONG"
                                    ? "border-[#b2dfdb] bg-[#eefaf6] text-[#0b7a5c]"
                                    : "border-[#f1c4c4] bg-[#fff5f5] text-[#c92a2a]"
                                }`}
                              >
                                {p.side}
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#111827]">
                              {p.size.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#111827]">
                              {p.entryPx.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#334155]">
                              {fmtUsd(p.positionValue)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#64748b]">
                              {p.liquidationPx ? p.liquidationPx.toLocaleString() : "-"}
                            </td>
                            <td
                              className={`py-1.5 pl-2 pr-3 text-right font-semibold ${
                                p.unrealizedPnl >= 0 ? "text-[#0b7a5c]" : "text-[#c92a2a]"
                              }`}
                            >
                              {fmtUsd(p.unrealizedPnl, true)}{" "}
                              <span className="text-[10px] font-normal">
                                ({p.roePct >= 0 ? "+" : ""}
                                {p.roePct.toFixed(1)}%)
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="py-4 text-center text-[12px] text-[#94a3b8]">
                            현재 보유 중인 오픈 포지션이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Fills & Live Change Alerts */}
              <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-[#dfe3ea]">
                {/* Recent Fills */}
                <div>
                  <div className="bg-[#f8f9fb] px-3 py-1 border-b border-[#eef1f5] text-[11px] font-semibold text-[#334155]">
                    최근 체결 내역
                  </div>
                  <div className="max-h-48 overflow-auto divide-y divide-[#eef1f5] text-[11px] tabular-nums">
                    {selectedState && selectedState.recentFills.length > 0 ? (
                      selectedState.recentFills.map((f, idx) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-1.5">
                          <div>
                            <span
                              className={`mr-1.5 font-bold ${
                                f.side === "BUY" ? "text-[#0b7a5c]" : "text-[#c92a2a]"
                              }`}
                            >
                              {f.side}
                            </span>
                            <span className="font-semibold text-[#111827] mr-1.5">{f.coin}</span>
                            <span className="text-[#475569]">
                              {f.sz} @ {f.px.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {f.closedPnl !== 0 && (
                              <span
                                className={
                                  f.closedPnl > 0 ? "text-[#0b7a5c] font-medium" : "text-[#c92a2a] font-medium"
                                }
                              >
                                {fmtUsd(f.closedPnl, true)}
                              </span>
                            )}
                            <span className="text-[#94a3b8]">{fmtTimeKst(f.time)}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-[#94a3b8]">최근 체결 기록이 없습니다.</div>
                    )}
                  </div>
                </div>

                {/* Live Position Change Signals */}
                <div>
                  <div className="flex items-center justify-between bg-[#f8f9fb] px-3 py-1 border-b border-[#eef1f5] text-[11px] font-semibold text-[#334155]">
                    <span>실시간 포지션 변동 알림 로그</span>
                    {signals.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSignals([])}
                        className="font-normal text-[#64748b] hover:text-[#111827]"
                      >
                        비우기
                      </button>
                    )}
                  </div>
                  <div className="max-h-48 overflow-auto divide-y divide-[#eef1f5] text-[11px] tabular-nums">
                    {signals.length > 0 ? (
                      signals.map((sig) => (
                        <div key={sig.id} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                          <div>
                            <span className="mr-1.5 font-semibold text-[#111827]">[{sig.trader}]</span>
                            <span
                              className={
                                sig.tone === "long"
                                  ? "text-[#0b7a5c] font-medium"
                                  : sig.tone === "short"
                                  ? "text-[#c92a2a] font-medium"
                                  : "text-[#475569]"
                              }
                            >
                              {sig.message}
                            </span>
                          </div>
                          <span className="shrink-0 text-[#94a3b8]">{sig.time}</span>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-[#94a3b8]">
                        포지션 신규 진입·청산·스위칭이 감지되면 여기에 실시간 기록됩니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: YOUTUBE LIVE MULTIVIEW + FOLLOW-ALONG MIRROR LOG */}
      {activeTab === "youtube" && (
        <div className="flex flex-1 flex-col min-h-0 overflow-auto divide-y divide-[#dfe3ea]">
          {/* Add YouTube Live Stream */}
          <form
            onSubmit={handleAddStream}
            className="flex flex-wrap items-center gap-2 bg-white px-3 py-2 text-[12px]"
          >
            <input
              type="text"
              placeholder="트레이더 이름"
              value={ytTrader}
              onChange={(e) => setYtTrader(e.target.value)}
              className="h-7 w-32 border border-[#d1d5db] px-2 text-[12px] focus:border-[#1d4ed8] focus:outline-none"
            />
            <input
              type="text"
              placeholder="유튜브 라이브 URL 또는 영상 ID (예: https://youtube.com/watch?v=...)"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              className="h-7 min-w-[220px] flex-1 border border-[#d1d5db] px-2 text-[12px] focus:border-[#1d4ed8] focus:outline-none"
            />
            <button
              type="submit"
              className="h-7 border border-[#1d4ed8] bg-[#1d4ed8] px-3 text-[12px] font-medium text-white hover:bg-[#1e40af]"
            >
              방송 추가
            </button>
            {ytErr && <span className="text-[11px] text-[#c92a2a]">{ytErr}</span>}
          </form>

          {/* Embedded Streams Grid */}
          {streams.length > 0 ? (
            <div
              className={`grid gap-2 bg-[#f8f9fb] p-2 ${
                streams.length === 1 ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2"
              }`}
            >
              {streams.map((s) => (
                <div key={s.id} className="border border-[#dfe3ea] bg-white">
                  <div className="flex items-center justify-between border-b border-[#eef1f5] px-2.5 py-1 text-[11px]">
                    <span className="font-semibold text-[#111827]">{s.trader}</span>
                    <button
                      type="button"
                      onClick={() => persistStreams(streams.filter((x) => x.id !== s.id))}
                      className="text-[#94a3b8] hover:text-[#c92a2a]"
                    >
                      닫기
                    </button>
                  </div>
                  <div className="aspect-video w-full bg-black">
                    <iframe
                      src={`https://www.youtube.com/embed/${s.videoId}?autoplay=0&rel=0`}
                      title={s.trader}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-[12px] text-[#64748b] bg-[#f8f9fb]">
              유튜브 라이브 URL을 추가하면 화면을 분할해 방송을 보면서 바로 아래에서 포지션을 따라 기록·관리할 수 있습니다.
            </div>
          )}

          {/* Quick Follow-Along Position Entry */}
          <div className="bg-white">
            <div className="bg-[#f7f8fa] px-3 py-1.5 border-b border-[#dfe3ea] text-[11px] font-bold text-[#111827]">
              포지션 따라가기 (미러링 기록 &amp; 손익비 계산)
            </div>
            <form
              onSubmit={handleAddFollowedTrade}
              className="flex flex-wrap items-center gap-1.5 border-b border-[#eef1f5] p-2.5 text-[12px]"
            >
              <input
                type="text"
                placeholder="트레이더"
                value={fTrader}
                onChange={(e) => setFTrader(e.target.value)}
                className="h-7 w-24 border border-[#d1d5db] px-2 text-[12px]"
              />
              <input
                type="text"
                placeholder="종목 (NQ)"
                value={fSymbol}
                onChange={(e) => setFSymbol(e.target.value)}
                className="h-7 w-20 border border-[#d1d5db] px-2 text-[12px] font-semibold uppercase"
              />
              <select
                value={fSide}
                onChange={(e) => setFSide(e.target.value as "LONG" | "SHORT")}
                className="h-7 border border-[#d1d5db] bg-white px-2 text-[12px] font-semibold"
              >
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
              <input
                type="number"
                step="any"
                required
                placeholder="진입가"
                value={fEntry}
                onChange={(e) => setFEntry(e.target.value)}
                className="h-7 w-24 border border-[#d1d5db] px-2 text-[12px] tabular-nums"
              />
              <input
                type="number"
                step="any"
                placeholder="손절가(SL)"
                value={fSl}
                onChange={(e) => setFSl(e.target.value)}
                className="h-7 w-24 border border-[#d1d5db] px-2 text-[12px] tabular-nums"
              />
              <input
                type="number"
                step="any"
                placeholder="목표가(TP)"
                value={fTp}
                onChange={(e) => setFTp(e.target.value)}
                className="h-7 w-24 border border-[#d1d5db] px-2 text-[12px] tabular-nums"
              />
              <input
                type="text"
                placeholder="메모"
                value={fNote}
                onChange={(e) => setFNote(e.target.value)}
                className="h-7 min-w-[100px] flex-1 border border-[#d1d5db] px-2 text-[12px]"
              />
              <button
                type="submit"
                className="h-7 border border-[#111827] bg-[#111827] px-3 text-[12px] font-medium text-white hover:bg-[#334155]"
              >
                진입 기록
              </button>
            </form>

            {/* Followed Trades Table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[12px] tabular-nums">
                <thead className="border-b border-[#dfe3ea] bg-[#f8f9fb] text-[11px] text-[#64748b]">
                  <tr>
                    <th className="py-1.5 pl-3 pr-2 font-medium">시각</th>
                    <th className="py-1.5 px-2 font-medium">트레이더</th>
                    <th className="py-1.5 px-2 font-medium">종목/방향</th>
                    <th className="py-1.5 px-2 text-right font-medium">진입가</th>
                    <th className="py-1.5 px-2 text-right font-medium">SL / TP (R:R)</th>
                    <th className="py-1.5 px-2 text-right font-medium">청산 / 손익(pt)</th>
                    <th className="py-1.5 pl-2 pr-3 text-right font-medium">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef1f5]">
                  {trades.map((t) => {
                    const risk = t.slPrice !== null ? Math.abs(t.entryPrice - t.slPrice) : null;
                    const reward = t.tpPrice !== null ? Math.abs(t.tpPrice - t.entryPrice) : null;
                    const rr = risk && reward && risk > 0 ? (reward / risk).toFixed(2) : null;
                    const pnlPts =
                      t.exitPrice !== null
                        ? t.side === "LONG"
                          ? t.exitPrice - t.entryPrice
                          : t.entryPrice - t.exitPrice
                        : null;

                    return (
                      <tr key={t.id} className="hover:bg-[#f8fafc]">
                        <td className="py-1.5 pl-3 pr-2 text-[#64748b]">{t.openedAt}</td>
                        <td className="py-1.5 px-2 font-medium text-[#111827]">
                          {t.trader}
                          {t.note && (
                            <span className="ml-1.5 text-[10px] text-[#64748b]">({t.note})</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="font-bold text-[#111827] mr-1.5">{t.symbol}</span>
                          <span
                            className={`px-1 py-0.5 text-[10px] font-bold border ${
                              t.side === "LONG"
                                ? "border-[#b2dfdb] bg-[#eefaf6] text-[#0b7a5c]"
                                : "border-[#f1c4c4] bg-[#fff5f5] text-[#c92a2a]"
                            }`}
                          >
                            {t.side}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-medium">
                          {t.entryPrice.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-right text-[#64748b]">
                          {t.slPrice ?? "-"} / {t.tpPrice ?? "-"}
                          {rr && <span className="ml-1 text-[#1d4ed8] font-medium">({rr}R)</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {t.status === "CLOSED" && pnlPts !== null ? (
                            <span
                              className={`font-semibold ${
                                pnlPts >= 0 ? "text-[#0b7a5c]" : "text-[#c92a2a]"
                              }`}
                            >
                              {t.exitPrice?.toLocaleString()} ({pnlPts >= 0 ? "+" : ""}
                              {pnlPts.toFixed(2)})
                            </span>
                          ) : closingId === t.id ? (
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                placeholder="청산가"
                                value={closePxInput}
                                onChange={(e) => setClosePxInput(e.target.value)}
                                className="h-6 w-20 border border-[#1d4ed8] px-1.5 text-[11px]"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleCloseFollowedTrade(t.id)}
                                className="h-6 bg-[#1d4ed8] px-2 text-[11px] text-white"
                              >
                                확인
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] font-medium text-[#1d4ed8]">보유중</span>
                          )}
                        </td>
                        <td className="py-1.5 pl-2 pr-3 text-right whitespace-nowrap">
                          {t.status === "OPEN" && closingId !== t.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setClosingId(t.id);
                                setClosePxInput("");
                              }}
                              className="mr-2 text-[11px] text-[#1d4ed8] hover:underline"
                            >
                              청산
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => persistTrades(trades.filter((x) => x.id !== t.id))}
                            className="text-[11px] text-[#94a3b8] hover:text-[#c92a2a]"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {trades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-5 text-center text-[12px] text-[#94a3b8]">
                        기록된 따라가기 포지션이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
