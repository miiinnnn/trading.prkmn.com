export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

export interface OhlcvBar {
  time: number; // UTC Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isRth: boolean;
}

export interface DataManifest {
  symbol: string;
  point_value_usd: number;
  tick_size: number;
  record_bytes: number;
  start_date: string;
  end_date: string;
  timeframes: {
    "1m": {
      chunked: true;
      chunks: Array<{
        year: number;
        file: string;
        bars: number;
        bytes: number;
        start_ts: number;
        end_ts: number;
      }>;
    };
    [key: string]: {
      chunked: boolean;
      file?: string;
      bars?: number;
      bytes?: number;
      start_ts?: number;
      end_ts?: number;
      chunks?: Array<{
        year: number;
        file: string;
        bars: number;
        bytes: number;
        start_ts: number;
        end_ts: number;
      }>;
    };
  };
}

const RECORD_BYTES = 24;
let manifestCache: DataManifest | null = null;
const fileCache = new Map<string, OhlcvBar[]>();

export async function loadManifest(): Promise<DataManifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch("/market/manifest.json");
  if (!res.ok) throw new Error(`manifest 로드 실패 (${res.status})`);
  manifestCache = (await res.json()) as DataManifest;
  return manifestCache;
}

function parseBin(buffer: ArrayBuffer): OhlcvBar[] {
  const count = Math.floor(buffer.byteLength / RECORD_BYTES);
  const view = new DataView(buffer);
  const bars: OhlcvBar[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const off = i * RECORD_BYTES;
    const vf = view.getUint32(off + 20, true);
    bars[i] = {
      time: view.getUint32(off, true),
      open: view.getFloat32(off + 4, true),
      high: view.getFloat32(off + 8, true),
      low: view.getFloat32(off + 12, true),
      close: view.getFloat32(off + 16, true),
      volume: vf & 0x7fffffff,
      isRth: ((vf >>> 31) & 1) === 1,
    };
  }
  return bars;
}

async function fetchBin(filename: string): Promise<OhlcvBar[]> {
  const cached = fileCache.get(filename);
  if (cached) return cached;
  const res = await fetch(`/market/${filename}`);
  if (!res.ok) throw new Error(`${filename} 로드 실패 (${res.status})`);
  const buf = await res.arrayBuffer();
  const parsed = parseBin(buf);
  fileCache.set(filename, parsed);
  return parsed;
}

export async function loadTimeframeBars(
  tf: Timeframe,
  yearsFor1m?: number[]
): Promise<{ bars: OhlcvBar[]; loadedYears: number[]; availableYears: number[] }> {
  const manifest = await loadManifest();
  const availableYears = manifest.timeframes["1m"].chunks.map((c) => c.year);

  if (tf === "1m") {
    const targetYears =
      yearsFor1m && yearsFor1m.length > 0
        ? [...yearsFor1m].sort((a, b) => a - b)
        : [availableYears[availableYears.length - 1]];
    const chunks = manifest.timeframes["1m"].chunks.filter((c) =>
      targetYears.includes(c.year)
    );
    const arrays = await Promise.all(chunks.map((c) => fetchBin(c.file)));
    const merged: OhlcvBar[] = [];
    for (const arr of arrays) {
      for (let i = 0; i < arr.length; i++) merged.push(arr[i]);
    }
    return {
      bars: merged,
      loadedYears: chunks.map((c) => c.year),
      availableYears,
    };
  }

  const meta = manifest.timeframes[tf];
  if (!meta?.file) throw new Error(`${tf} 데이터 파일이 없습니다.`);
  const bars = await fetchBin(meta.file);
  return { bars, loadedYears: availableYears, availableYears };
}

export function computeEmaSeries(
  bars: OhlcvBar[],
  period: number
): Array<{ time: number; value: number }> {
  const n = bars.length;
  if (period <= 0 || n < period) return [];
  const out: Array<{ time: number; value: number }> = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += bars[i].close;
  let ema = sum / period;
  out.push({ time: bars[period - 1].time, value: Number(ema.toFixed(2)) });
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: Number(ema.toFixed(2)) });
  }
  return out;
}
