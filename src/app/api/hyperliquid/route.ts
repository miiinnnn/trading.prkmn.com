import { NextRequest, NextResponse } from "next/server";

export interface HyperliquidPosition {
  coin: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  roePct: number;
  liquidationPx: number | null;
  leverage: number;
  leverageType: string;
}

export interface HyperliquidFill {
  coin: string;
  side: "BUY" | "SELL";
  px: number;
  sz: number;
  time: number;
  closedPnl: number;
  dir: string;
}

const HL_API = "https://api.hyperliquid.xyz/info";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "올바른 이더리움/하이퍼리퀴드 지갑 주소(0x + 40자리)를 입력해 주세요." },
      { status: 400 }
    );
  }

  try {
    const [stateRes, fillsRes] = await Promise.all([
      fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "clearinghouseState", user: address }),
        cache: "no-store",
      }),
      fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "userFills", user: address }),
        cache: "no-store",
      }),
    ]);

    if (!stateRes.ok) {
      throw new Error(`Hyperliquid API 오류 (${stateRes.status})`);
    }

    const stateJson = await stateRes.json();
    const fillsJson = fillsRes.ok ? await fillsRes.json() : [];

    const positions: HyperliquidPosition[] = [];
    const assetPositions = Array.isArray(stateJson?.assetPositions)
      ? stateJson.assetPositions
      : [];

    for (const ap of assetPositions) {
      const p = ap?.position;
      if (!p) continue;
      const szi = Number(p.szi ?? 0);
      if (szi === 0) continue;
      positions.push({
        coin: String(p.coin ?? ""),
        side: szi > 0 ? "LONG" : "SHORT",
        size: Math.abs(szi),
        entryPx: Number(p.entryPx ?? 0),
        positionValue: Math.abs(Number(p.positionValue ?? 0)),
        unrealizedPnl: Number(p.unrealizedPnl ?? 0),
        roePct: Number(p.returnOnEquity ?? 0) * 100,
        liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
        leverage: Number(p.leverage?.value ?? 1),
        leverageType: String(p.leverage?.type ?? "cross"),
      });
    }

    positions.sort((a, b) => b.positionValue - a.positionValue);

    const recentFills: HyperliquidFill[] = Array.isArray(fillsJson)
      ? fillsJson.slice(0, 12).map((f: Record<string, unknown>) => ({
          coin: String(f.coin ?? ""),
          side: f.side === "B" ? "BUY" : "SELL",
          px: Number(f.px ?? 0),
          sz: Number(f.sz ?? 0),
          time: Number(f.time ?? 0),
          closedPnl: Number(f.closedPnl ?? 0),
          dir: String(f.dir ?? ""),
        }))
      : [];

    const margin = stateJson?.marginSummary ?? {};

    return NextResponse.json({
      address,
      updatedAt: new Date().toISOString(),
      accountValue: Number(margin.accountValue ?? 0),
      totalMarginUsed: Number(margin.totalMarginUsed ?? 0),
      totalNtlPos: Number(margin.totalNtlPos ?? 0),
      positions,
      recentFills,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "하이퍼리퀴드 포지션 조회 실패",
      },
      { status: 502 }
    );
  }
}
