"""
Export data/nq_1m_continuous.parquet into ultra-compact binary files in
public/data/ for zero-backend, CDN-hosted Vercel deployment.

Binary record format (24 bytes per bar, little-endian):
  uint32 ts_sec    (UTC Unix timestamp in seconds)
  float32 open     (Panama back-adjusted)
  float32 high
  float32 low
  float32 close
  uint32 vol_flags (bits 0..30 = volume, bit 31 = is_rth flag)

Outputs:
  public/data/nq_1d.bin
  public/data/nq_1h.bin
  public/data/nq_15m.bin
  public/data/nq_5m.bin
  public/data/nq_1m_2021.bin .. nq_1m_2026.bin  (yearly chunks, ~2-8 MB each)
  public/data/manifest.json
"""

import json
import time
from pathlib import Path
import numpy as np
import pandas as pd

RECORD_DTYPE = np.dtype([
    ("ts", "<u4"),
    ("open", "<f4"),
    ("high", "<f4"),
    ("low", "<f4"),
    ("close", "<f4"),
    ("vol_flags", "<u4"),
])


def write_bin(df: pd.DataFrame, path: Path) -> dict:
    n = len(df)
    arr = np.empty(n, dtype=RECORD_DTYPE)
    # pandas 3.x DatetimeIndex may be ns, us, or s; convert safely to UTC epoch seconds
    ts_sec = df.index.as_unit("s").asi8.astype(np.uint32)
    arr["ts"] = ts_sec
    arr["open"] = df["open"].to_numpy(dtype=np.float32)
    arr["high"] = df["high"].to_numpy(dtype=np.float32)
    arr["low"] = df["low"].to_numpy(dtype=np.float32)
    arr["close"] = df["close"].to_numpy(dtype=np.float32)
    vol = np.clip(df["volume"].to_numpy(dtype=np.uint64), 0, (1 << 31) - 1).astype(np.uint32)
    rth_bit = df["is_rth"].to_numpy(dtype=np.uint32) << 31
    arr["vol_flags"] = vol | rth_bit

    arr.tofile(path)
    return {
        "file": path.name,
        "bars": int(n),
        "bytes": int(path.stat().st_size),
        "start_ts": int(ts_sec[0]),
        "end_ts": int(ts_sec[-1]),
    }


def resample_ohlcv(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    agg = df.resample(rule, label="left", closed="left").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
        is_rth=("is_rth", "any"),
    )
    return agg.dropna(subset=["open"])


def main() -> None:
    t0 = time.time()
    root = Path(__file__).resolve().parent.parent
    src = root / "data" / "nq_1m_continuous.parquet"
    out_dir = root / "public" / "market"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading {src} ...")
    df = pd.read_parquet(src, columns=["open", "high", "low", "close", "volume", "is_rth", "trade_date"])

    manifest: dict = {
        "symbol": "NQ.FUT (Front-Month Panama Back-Adjusted)",
        "point_value_usd": 20,
        "tick_size": 0.25,
        "record_bytes": 24,
        "start_date": str(df["trade_date"].iloc[0]),
        "end_date": str(df["trade_date"].iloc[-1]),
        "timeframes": {},
    }

    # 1. Yearly 1m chunks
    years = sorted(df.index.year.unique())
    chunks_1m = []
    for yr in years:
        sub = df[df.index.year == yr]
        info = write_bin(sub, out_dir / f"nq_1m_{yr}.bin")
        info["year"] = int(yr)
        chunks_1m.append(info)
        print(f"  1m {yr}: {info['bars']:,} bars ({info['bytes']/1e6:.2f} MB)")
    manifest["timeframes"]["1m"] = {"chunked": True, "chunks": chunks_1m}

    # 2. Resampled timeframes: 5m, 15m, 1h
    for tf, rule in [("5m", "5min"), ("15m", "15min"), ("1h", "1h")]:
        rdf = resample_ohlcv(df, rule)
        info = write_bin(rdf, out_dir / f"nq_{tf}.bin")
        manifest["timeframes"][tf] = {"chunked": False, **info}
        print(f"  {tf:3s}: {info['bars']:,} bars ({info['bytes']/1e6:.2f} MB)")

    # 3. Daily (by CME trade_date, indexed at trade_date 00:00 UTC for clean calendar dates)
    daily = df.groupby("trade_date").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
        is_rth=("is_rth", "any"),
    )
    daily.index = pd.to_datetime(daily.index, utc=True)
    info_1d = write_bin(daily, out_dir / "nq_1d.bin")
    manifest["timeframes"]["1d"] = {"chunked": False, **info_1d}
    print(f"  1d : {info_1d['bars']:,} bars ({info_1d['bytes']/1e3:.1f} KB)")

    with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    total_mb = sum(p.stat().st_size for p in out_dir.glob("*.bin")) / 1e6
    print(f"\nExported all web data to {out_dir} (total {total_mb:.2f} MB) in {time.time() - t0:.2f}s")


if __name__ == "__main__":
    main()
