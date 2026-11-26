"""
Preprocess Databento GLBX.MDP3 NQ.FUT 1-minute OHLCV (.dbn.zst) into a
clean, front-month continuous 1-minute dataset (Parquet + roll schedule CSV).

Methodology:
1. Exclude calendar spreads (symbols containing '-').
2. Assign CME trade_date (US/Eastern shifted +6h so 18:00 ET starts the next session).
3. Select front-month contract per CME trade_date by highest daily volume,
   enforcing monotonic forward-only roll by contract expiration (no roll-back).
4. Compute Panama (additive) back-adjustment anchored to the latest contract (NQZ6)
   using the exact simultaneous-timestamp spread (B_close - A_close) at the last
   common 1-minute bar before each roll transition.
5. Preserve both back-adjusted OHLC (`open`, `high`, `low`, `close`) and
   unadjusted actual traded OHLC (`raw_open`, `raw_high`, `raw_low`, `raw_close`),
   plus `volume`, `symbol`, `trade_date`, `is_rth`, and `roll_adj`.
"""

from pathlib import Path
import time
import databento as db
import numpy as np
import pandas as pd

MONTH_CODE_MAP = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}


def contract_sort_key(sym: str) -> tuple[int, int]:
    """Parse CME NQ outright symbol (e.g. NQZ1, NQH6) into (year, month) for chronological sorting."""
    # Format: NQ + MonthCode (1 char) + YearDigit (1 or 2 chars)
    m_code = sym[2]
    y_part = int(sym[3:])
    year = 2020 + y_part if y_part < 10 else 2000 + y_part
    return (year, MONTH_CODE_MAP[m_code])


def main() -> None:
    t0 = time.time()
    root = Path(__file__).resolve().parent.parent
    dbn_path = root / "GLBX-20261113-6XU8ERGXUY" / "glbx-mdp3-20211113-20261112.ohlcv-1m.dbn.zst"
    out_dir = root / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = out_dir / "nq_1m_continuous.parquet"
    roll_csv_path = out_dir / "nq_roll_schedule.csv"

    print(f"Loading {dbn_path.name} ...")
    store = db.DBNStore.from_file(str(dbn_path))
    df = store.to_df()

    # 1. Keep only outright contracts (exclude calendar spreads like NQH2-NQM2)
    df = df[~df["symbol"].str.contains("-", na=False)].copy()
    df = df[["symbol", "open", "high", "low", "close", "volume"]].sort_index()

    # 2. Compute US/Eastern timestamp and CME trade_date (session starts 18:00 ET)
    ts_et = df.index.tz_convert("America/New_York")
    df["trade_date"] = (ts_et + pd.Timedelta(hours=6)).strftime("%Y-%m-%d")

    # 3. Determine front-month per trade_date (highest daily volume, forward-only)
    daily_vol = (
        df.groupby(["trade_date", "symbol"], sort=False)["volume"]
        .sum()
        .reset_index()
    )
    daily_vol["exp_key"] = daily_vol["symbol"].map(contract_sort_key)

    all_dates = sorted(daily_vol["trade_date"].unique())
    vol_lookup = {
        d: g.sort_values("volume", ascending=False)
        for d, g in daily_vol.groupby("trade_date", sort=False)
    }

    front_map: dict[str, str] = {}
    current_sym: str | None = None
    current_key: tuple[int, int] | None = None

    for d in all_dates:
        candidates = vol_lookup[d]
        if current_sym is None:
            top = candidates.iloc[0]
            current_sym = top["symbol"]
            current_key = top["exp_key"]
        else:
            # Only allow staying on current_sym or rolling forward to a later expiration
            valid = candidates[candidates["exp_key"] >= current_key]
            top = valid.iloc[0]
            if top["symbol"] != current_sym:
                current_sym = top["symbol"]
                current_key = top["exp_key"]
        front_map[d] = current_sym

    # 4. Identify roll transitions and compute simultaneous-timestamp Panama spreads
    roll_records = []
    prev_sym = None
    for d in all_dates:
        sym = front_map[d]
        if prev_sym is not None and sym != prev_sym:
            # Find last common timestamp on or before roll_date's session start
            prev_day_idx = all_dates.index(d) - 1
            prev_date = all_dates[prev_day_idx]

            sub_prev = df[df["trade_date"] == prev_date]
            a_bars = sub_prev[sub_prev["symbol"] == prev_sym]["close"]
            b_bars = sub_prev[sub_prev["symbol"] == sym]["close"]
            common_ts = a_bars.index.intersection(b_bars.index)

            if len(common_ts) > 0:
                ref_ts = common_ts.max()
                a_px = float(a_bars.loc[ref_ts])
                b_px = float(b_bars.loc[ref_ts])
                spread = round(b_px - a_px, 4)
                method = "simultaneous_prev_session_close"
            else:
                # Fallback: first common timestamp on roll_date
                sub_curr = df[df["trade_date"] == d]
                a_bars_c = sub_curr[sub_curr["symbol"] == prev_sym]["close"]
                b_bars_c = sub_curr[sub_curr["symbol"] == sym]["close"]
                common_ts_c = a_bars_c.index.intersection(b_bars_c.index)
                ref_ts = common_ts_c.min()
                a_px = float(a_bars_c.loc[ref_ts])
                b_px = float(b_bars_c.loc[ref_ts])
                spread = round(b_px - a_px, 4)
                method = "simultaneous_roll_session_open"

            roll_records.append({
                "roll_trade_date": d,
                "from_symbol": prev_sym,
                "to_symbol": sym,
                "ref_ts_utc": ref_ts.isoformat(),
                "from_close": a_px,
                "to_close": b_px,
                "spread_pts": spread,
                "method": method,
            })
        prev_sym = sym

    roll_df = pd.DataFrame(roll_records)

    # Cumulative additive adjustment anchored to the latest contract (0.0 for latest)
    # Each earlier contract gets the sum of spreads of all rolls AFTER it.
    symbols_ordered = [front_map[all_dates[0]]] + roll_df["to_symbol"].tolist()
    sym_adj: dict[str, float] = {symbols_ordered[-1]: 0.0}
    cum_spread = 0.0
    for i in range(len(roll_df) - 1, -1, -1):
        cum_spread = round(cum_spread + float(roll_df.iloc[i]["spread_pts"]), 4)
        sym_adj[roll_df.iloc[i]["from_symbol"]] = cum_spread

    roll_df["cum_adj_applied_to_from"] = roll_df["from_symbol"].map(sym_adj)
    roll_df.to_csv(roll_csv_path, index=False)

    # 5. Filter to front-month rows and apply Panama back-adjustment
    front_series = df["trade_date"].map(front_map)
    fm = df[df["symbol"] == front_series].copy()
    fm = fm.sort_index()

    # Rename raw prices and compute adjusted prices
    fm = fm.rename(columns={
        "open": "raw_open",
        "high": "raw_high",
        "low": "raw_low",
        "close": "raw_close",
    })
    fm["roll_adj"] = fm["symbol"].map(sym_adj).astype("float64")
    for col in ("open", "high", "low", "close"):
        fm[col] = (fm[f"raw_{col}"] + fm["roll_adj"]).round(2)

    # Add RTH flag (Mon-Fri, 09:30 <= ET < 16:00)
    fm_et = fm.index.tz_convert("America/New_York")
    time_min = fm_et.hour * 60 + fm_et.minute
    fm["is_rth"] = (fm_et.day_of_week < 5) & (time_min >= 9 * 60 + 30) & (time_min < 16 * 60)

    # Column ordering
    cols = [
        "symbol", "trade_date", "is_rth",
        "open", "high", "low", "close", "volume",
        "raw_open", "raw_high", "raw_low", "raw_close", "roll_adj",
    ]
    fm = fm[cols]

    # 6. Integrity checks before saving
    assert not fm.index.has_duplicates, "Duplicate timestamps found!"
    assert (fm["high"] >= fm["low"]).all(), "OHLC error: high < low"
    assert (fm["high"] >= fm[["open", "close"]].max(axis=1)).all(), "OHLC error: high < max(o,c)"
    assert (fm["low"] <= fm[["open", "close"]].min(axis=1)).all(), "OHLC error: low > min(o,c)"
    assert fm.isna().sum().sum() == 0, "NaNs found in continuous dataset!"

    fm.to_parquet(parquet_path, engine="pyarrow", compression="zstd")

    elapsed = time.time() - t0
    print(f"\nSaved continuous dataset -> {parquet_path} ({parquet_path.stat().st_size / 1e6:.2f} MB)")
    print(f"Saved roll schedule      -> {roll_csv_path}")
    print(f"Rows: {len(fm):,} | Trading dates: {fm['trade_date'].nunique()} | Contracts: {fm['symbol'].nunique()}")
    print(f"Time range (UTC): {fm.index.min()} ~ {fm.index.max()}")
    print(f"Adjusted price:   {fm['open'].iloc[0]:.2f} -> {fm['close'].iloc[-1]:.2f} (total roll_adj at start: {fm['roll_adj'].iloc[0]:+.2f} pts)")
    print(f"Raw price:        {fm['raw_open'].iloc[0]:.2f} -> {fm['raw_close'].iloc[-1]:.2f}")
    print(f"\nRoll schedule ({len(roll_df)} rolls):")
    print(roll_df[["roll_trade_date", "from_symbol", "to_symbol", "from_close", "to_close", "spread_pts", "cum_adj_applied_to_from"]].to_string(index=False))
    print(f"\nCompleted in {elapsed:.2f}s")


if __name__ == "__main__":
    main()
