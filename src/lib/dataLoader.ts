export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

export interface MarketBars {
  length: number;
  ts: Uint32Array;       // UTC Unix seconds
  open: Float32Array;
  high: Float32Array;
  low: Float32Array;
  close: Float32Array;
  volume: Uint32Array;
  isRth: Uint8Array;
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
const binCache = new Map<string, MarketBars>();

export async function loadManifest(): Promise<DataManifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch("/data/manifest.json");
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
  manifestCache = (await res.json()) as DataManifest;
  return manifestCache;
}

function parseBinaryBars(buffer: ArrayBuffer): MarketBars {
  const count = Math.floor(buffer.byteLength / RECORD_BYTES);
  const view = new DataView(buffer);

  const ts = new Uint32Array(count);
  const open = new Float32Array(count);
  const high = new Float32Array(count);
  const low = new Float32Array(count);
  const close = new Float32Array(count);
  const volume = new Uint32Array(count);
  const isRth = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const off = i * RECORD_BYTES;
    ts[i] = view.getUint32(off, true);
    open[i] = view.getFloat32(off + 4, true);
    high[i] = view.getFloat32(off + 8, true);
    low[i] = view.getFloat32(off + 12, true);
    close[i] = view.getFloat32(off + 16, true);
    const vf = view.getUint32(off + 20, true);
    volume[i] = vf & 0x7fffffff;
    isRth[i] = (vf >>> 31) & 1;
  }

  return { length: count, ts, open, high, low, close, volume, isRth };
}

async function fetchBinFile(filename: string): Promise<MarketBars> {
  const cached = binCache.get(filename);
  if (cached) return cached;
  const res = await fetch(`/data/${filename}`);
  if (!res.ok) throw new Error(`Failed to load ${filename}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const parsed = parseBinaryBars(buf);
  binCache.set(filename, parsed);
  return parsed;
}

function concatBars(chunks: MarketBars[]): MarketBars {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.length;

  const ts = new Uint32Array(total);
  const open = new Float32Array(total);
  const high = new Float32Array(total);
  const low = new Float32Array(total);
  const close = new Float32Array(total);
  const volume = new Uint32Array(total);
  const isRth = new Uint8Array(total);

  let offset = 0;
  for (const c of chunks) {
    ts.set(c.ts, offset);
    open.set(c.open, offset);
    high.set(c.high, offset);
    low.set(c.low, offset);
    close.set(c.close, offset);
    volume.set(c.volume, offset);
    isRth.set(c.isRth, offset);
    offset += c.length;
  }

  return { length: total, ts, open, high, low, close, volume, isRth };
}

function lowerBound(arr: Uint32Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: Uint32Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function loadBarsForRange(
  tf: Timeframe,
  startDate: string,
  endDate: string,
  warmupBars = 0
): Promise<{ bars: MarketBars; evalStartIdx: number }> {
  const manifest = await loadManifest();
  const startSec = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
  const endSec = Math.floor(Date.parse(`${endDate}T23:59:59Z`) / 1000);

  let full: MarketBars;
  if (tf === "1m") {
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    // Include prior year if warmup might cross year boundary (Jan)
    const minYear = startDate.slice(5, 7) === "01" ? startYear - 1 : startYear;
    const needed = manifest.timeframes["1m"].chunks.filter(
      (c) => c.year >= minYear && c.year <= endYear
    );
    const loaded = await Promise.all(needed.map((c) => fetchBinFile(c.file)));
    full = concatBars(loaded);
  } else {
    const meta = manifest.timeframes[tf];
    if (!meta?.file) throw new Error(`Missing file for timeframe ${tf}`);
    full = await fetchBinFile(meta.file);
  }

  const rawStart = lowerBound(full.ts, startSec);
  const rawEnd = upperBound(full.ts, endSec);
  const sliceStart = Math.max(0, rawStart - warmupBars);
  const sliceEnd = Math.max(sliceStart, rawEnd);

  const sliced: MarketBars = {
    length: sliceEnd - sliceStart,
    ts: full.ts.subarray(sliceStart, sliceEnd),
    open: full.open.subarray(sliceStart, sliceEnd),
    high: full.high.subarray(sliceStart, sliceEnd),
    low: full.low.subarray(sliceStart, sliceEnd),
    close: full.close.subarray(sliceStart, sliceEnd),
    volume: full.volume.subarray(sliceStart, sliceEnd),
    isRth: full.isRth.subarray(sliceStart, sliceEnd),
  };

  return {
    bars: sliced,
    evalStartIdx: rawStart - sliceStart,
  };
}
