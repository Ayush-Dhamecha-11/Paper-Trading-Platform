"""Live inference for the Attention Factor Model (AFM).

Place this file at ``backend/jobs/predict_next_day_portfolio.py``.

The job:
1. Reads the characteristics Parquet panel from Supabase Storage.
2. Reads closing prices from ``price_history`` and aligns daily returns to the
   characteristic dates exactly as the research DataLoader does.
3. Loads the trained AttentionFactorModel state_dict from Hugging Face Hub.
4. Reconstructs the most recent ``s`` residuals using X[t-1] and R[t].
5. Uses X[t] plus residual history through t to produce asset-space weights
   intended for the next trading session (t+1).
6. Upserts weights to ``model_predictions`` under ``(model_name, as_of_date)``.

"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

logger = logging.getLogger(__name__)

MARKET_INDEX_SYMBOL = "^CNX100"
DEFAULT_MODEL_NAME = "attention_factor_longconv"

from ML.models.attention_factor_model import AttentionFactorModel
from ML.models.train import ModelConfig
from ML.hf_checkpoint_manager import download_checkpoint

# 1. Go 3 levels up to find the great-grandparent folder
great_grandparent = Path.cwd().parents[1]

# 2. Move sideways into the sibling folder
sibling_dir1 = great_grandparent / "data"
sibling_dir2 = great_grandparent / "db"

# 3. Add the sibling folder path as a string to sys.path
sys.path.append(str(sibling_dir1))
sys.path.append(str(sibling_dir2))

from data.feature_comp_migration import download_panel, get_supabase_client
from db.database import SessionLocal
from db.models import ModelPrediction, PriceHistory, UniverseStock


def _get_device() -> torch.device:
    configured = os.getenv("AFM_DEVICE", "auto").strip().lower()
    if configured == "auto":
        configured = "cuda" if torch.cuda.is_available() else "cpu"
    if configured == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("AFM_DEVICE=cuda was requested, but CUDA is not available.")

    return torch.device(configured)


def _load_model(
    repo_id: str,
    checkpoint_filename: str,
    n_assets: int,
    n_features: int,
    device: torch.device,
    feature_names: list[str],
    config: ModelConfig,
    strict: bool = True,
) -> AttentionFactorModel:
    
    # Use the shared checkpoint manager so token/repository handling and Hub
    # downloads follow the same path as the rest of the ML project.
    state_dict = download_checkpoint(
        filename=checkpoint_filename,
        repo_id=repo_id,
        token= os.getenv("HF_TOKEN"),
        device="cpu",
    )

    model = AttentionFactorModel(
        N=n_assets,
        M=n_features,
        K=config.K,
        d=config.d,
        s=config.s,
        lambda_ridge=config.lambda_ridge,
        d_hidden_conv=config.d_hidden_conv,
        lambda_squash=config.lambda_squash,
        dropout=config.dropout,
    )

    model.load_state_dict(state_dict, strict=strict)
    model.to(device)

    logger.info(
        "Loaded AFM | K=%d d=%d M=%d LongConv hidden=%d lookback=%d device=%s",
        config.K, config.d, n_features, config.d_hidden_conv, config.s, device,
    )
    return model


def _get_active_symbols(db) -> list[str]:
    symbols = db.execute(
        select(UniverseStock.symbol).where(UniverseStock.symbol != MARKET_INDEX_SYMBOL)
    ).scalars().all()
    symbols = sorted({str(symbol) for symbol in symbols})
    if not symbols:
        raise RuntimeError("universe_stocks contains no tradable symbols.")
    return symbols


def _normalize_panel_index(panel: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(panel.index, pd.MultiIndex) or not {"symbol", "day"}.issubset(
        set(panel.index.names)
    ):
        raise ValueError(
            "The characteristics Parquet panel must have a MultiIndex with 'symbol' and 'day' levels."
        )

    # Normalise index types and levels consistently with DataLoader.
    symbols = panel.index.get_level_values("symbol").astype(str)
    days = pd.to_datetime(panel.index.get_level_values("day")).normalize()
    panel = panel.copy()
    panel.index = pd.MultiIndex.from_arrays([symbols, days], names=["symbol", "day"])
    return panel.swaplevel("symbol", "day").sort_index()


def _fetch_aligned_data(
    db,
    panel_day_symbol: pd.DataFrame,
    target_date: date,
    symbols: list[str],
    lookback: int,
) -> tuple[torch.Tensor, torch.Tensor, list[str], list[pd.Timestamp]]:
    
    """Return X/R for the last s+1 feature dates in training-compatible order."""
    feature_names = [str(column) for column in panel_day_symbol.columns]
    date_values = pd.DatetimeIndex(
        pd.to_datetime(panel_day_symbol.index.get_level_values("day").unique())
    ).normalize().sort_values()
    target_ts = pd.Timestamp(target_date)
    dates_through_target = date_values[date_values <= target_ts]

    if len(dates_through_target) == 0 or dates_through_target[-1].date() != target_date.date():
        latest_available = dates_through_target[-1].date() if len(dates_through_target) else None
        raise RuntimeError(
            f"No characteristics panel row exists for target date {target_date}. "
            f"Latest available panel date at or before target: {latest_available}. "
            "Run the price-fetch and compute_for_date stages successfully before inference."
        )

    selected_dates = list(dates_through_target[-(lookback + 1):])
    if len(selected_dates) < lookback + 1:
        raise RuntimeError(
            f"Insufficient characteristic history: need at least {lookback + 1} dates "
            f"to construct {lookback} residuals; found {len(selected_dates)}."
        )

    # Fail rather than silently produce today's weights from incomplete latest
    # characteristics. Older holes are imputed the same way as the supplied
    # research DataLoader (NaN -> 0.5, infinities clipped to [-10, 10]).
    latest_day = selected_dates[-1]
    present_latest = set(
        panel_day_symbol.loc[
            panel_day_symbol.index.get_level_values("day") == latest_day
        ].index.get_level_values("symbol").astype(str)
    )
    missing_latest = sorted(set(symbols) - present_latest)
    if missing_latest:
        raise RuntimeError(
            f"Latest characteristics for {target_date} are missing {len(missing_latest)} "
            f"active symbol(s): {missing_latest[:10]}. Refusing to write incomplete predictions."
        )

    expected_index = pd.MultiIndex.from_product(
        [selected_dates, symbols], names=["day", "symbol"]
    )
    selected_panel = panel_day_symbol.reindex(expected_index)
    x_np = selected_panel.to_numpy(dtype=np.float32).reshape(
        len(selected_dates), len(symbols), len(feature_names)
    )
    x_np = np.nan_to_num(
        x_np,
        nan=0.5,
        posinf=np.finfo(np.float32).max,
        neginf=-np.finfo(np.float32).max,
    )
    np.clip(x_np, -10.0, 10.0, out=x_np)

    # Fetch the single most recent close before the first selected date for each
    # symbol, plus all closes within the selected window. This preserves pct_change
    # alignment even if an asset has a missing price row on the first date.
    first_day = selected_dates[0].date()
    target_day = selected_dates[-1].date()
    previous_day_subquery = (
        select(
            PriceHistory.symbol.label("symbol"),
            func.max(PriceHistory.day).label("previous_day"),
        )
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day < first_day)
        .group_by(PriceHistory.symbol)
        .subquery()
    )
    previous_rows = db.execute(
        select(PriceHistory.day, PriceHistory.symbol, PriceHistory.close)
        .join(
            previous_day_subquery,
            and_(
                PriceHistory.symbol == previous_day_subquery.c.symbol,
                PriceHistory.day == previous_day_subquery.c.previous_day,
            ),
        )
    ).all()
    in_window_rows = db.execute(
        select(PriceHistory.day, PriceHistory.symbol, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day >= first_day)
        .where(PriceHistory.day <= target_day)
        .order_by(PriceHistory.day, PriceHistory.symbol)
    ).all()
    price_rows = list(previous_rows) + list(in_window_rows)
    if not price_rows:
        raise RuntimeError("No price_history closes found for the inference window.")

    prices_long = pd.DataFrame(price_rows, columns=["day", "symbol", "close"])
    prices_long["day"] = pd.to_datetime(prices_long["day"]).dt.normalize()
    prices_long["symbol"] = prices_long["symbol"].astype(str)
    prices_long["close"] = prices_long["close"].astype(float)
    prices_wide = prices_long.pivot(index="day", columns="symbol", values="close").sort_index()
    prices_wide = prices_wide.reindex(columns=symbols)

    # Deliberately match data_loader.py's pct_change() convention.
    returns_wide = prices_wide.pct_change()
    returns_wide = returns_wide.reindex(index=pd.DatetimeIndex(selected_dates), columns=symbols)
    r_np = returns_wide.to_numpy(dtype=np.float32)
    r_np = np.nan_to_num(r_np, nan=0.0, posinf=0.0, neginf=0.0)
    np.clip(r_np, -0.5, 0.5, out=r_np)

    X = torch.from_numpy(x_np)
    R = torch.from_numpy(r_np)
    logger.info(
        "Prepared live inference arrays | dates=%s..%s (%d) symbols=%d features=%d",
        selected_dates[0].date(), selected_dates[-1].date(), len(selected_dates),
        len(symbols), len(feature_names),
    )
    return X, R, feature_names, selected_dates


def _infer_next_weights(
    model: AttentionFactorModel,
    X: torch.Tensor,
    R: torch.Tensor,
    device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Build epsilon history through t and produce asset weights for t+1.

    For each historical day u, residual epsilon_u is calculated with X[u-1] and
    R[u], matching AttentionFactorModel.forward_sequence(). Once the most
    recent s residuals (through today t) are available, today's X[t] is used to
    compute the attention-factor projection and map LongConv outputs to assets.
    No R[t+1] is required or used.
    """
    model.eval()
    X = X.to(device=device, dtype=torch.float32)
    R = R.to(device=device, dtype=torch.float32)
    if X.ndim != 3 or R.ndim != 2 or X.shape[:2] != (R.shape[0], model.N) or R.shape[1] != model.N:
        raise ValueError(
            f"Unexpected live tensor shapes X={tuple(X.shape)}, R={tuple(R.shape)}, N={model.N}."
        )
    if X.shape[0] < model.s + 1:
        raise ValueError(f"Need at least s+1={model.s + 1} aligned dates, got {X.shape[0]}.")

    residuals: list[torch.Tensor] = []
    with torch.no_grad():
        # The selected input contains exactly s+1 dates. Use dates 1..s as
        # realized return dates; each is paired with characteristics from the
        # preceding date. These are the s residuals known after today's close.
        for t in range(1, X.shape[0]):
            X_prev = X[t - 1]
            R_curr = R[t]
            X_tilde_prev = model.embed_characteristics(X_prev)
            omega_F_prev = model.compute_factor_weights(X_tilde_prev)
            F_curr = model.compute_factor_returns(omega_F_prev, R_curr)
            beta_prev = model.compute_factor_loadings(omega_F_prev)
            eps_curr = model.compute_residuals(R_curr, beta_prev, F_curr)
            residuals.append(eps_curr)

        eps_hist = torch.stack(residuals, dim=1)  # (N, s), oldest -> newest
        if eps_hist.shape != (model.N, model.s):
            raise RuntimeError(
                f"Residual history shape {tuple(eps_hist.shape)} != {(model.N, model.s)}."
            )

        # Generate portfolio weights for the NEXT trading return. At this point
        # X[-1] is today's characteristic row and eps_hist includes epsilon_t.
        X_today = X[-1]
        X_tilde_today = model.embed_characteristics(X_today)
        omega_F_today = model.compute_factor_weights(X_tilde_today)
        beta_today = model.compute_factor_loadings(omega_F_today)
        omega_eps_today = model.compute_residual_projection_mat(beta_today, omega_F_today)
        omega_port_next = model.longconv(eps_hist)
        omega_assets_next = model.compute_portfolio_weights(omega_eps_today, omega_port_next)
        omega_assets_next = omega_assets_next / (omega_assets_next.abs().sum() + 1e-8)

    if not torch.isfinite(omega_assets_next).all():
        raise RuntimeError("AFM inference produced NaN/Inf portfolio weights; refusing DB write.")
    if float(omega_assets_next.abs().sum().item()) < 1e-6:
        raise RuntimeError("AFM inference produced all-zero portfolio weights; refusing DB write.")
    return omega_assets_next.detach().cpu(), omega_port_next.detach().cpu()


def predict_next_day_portfolio(target_date: date | None = None) -> dict[str, Any]:
    """Generate next-session AFM asset weights and upsert ``model_predictions``.

    Args:
        target_date: The completed trading date whose prices/characteristics have
            already been fetched/computed. If omitted, uses ``date.today()``;
            the panel must contain that exact date.

    Returns a small result dictionary for cron logging. ``as_of_date`` stored in
    model_predictions is the signal/data cutoff date t. The stored weights are
    intended for the next trading session (t+1); this function does not guess
    exchange holidays or invent a future market date.
    """
    target_date = target_date or date.today()
    repo_id = (os.getenv("HF_REPO_ID") or "").strip()

    # Model parameters to configure
    data_dir = "../data"
    years_to_train = 8
    years_to_validate = 2
    years_to_test = 1
    K_list = [3]
    md = ["learnable"]  # ["learnable", "pca"]
    hidden_projection_dim = 32
    lookback_length = 40
    epoch = 30
    learning_rate = 0.005
    weight_decay = 0.002
    lambda_var_coeff = 0.0
    lambda_ridge = 0.01
    lambda_squash = 0.001
    early_stop_patience = 6
    device = _get_device()

    metadata_ans = {}

    db = SessionLocal()
    sb = get_supabase_client()
    
    raw_panel = download_panel(sb)
    if raw_panel is None or raw_panel.empty:
        raise RuntimeError(
            "No characteristics panel found in Supabase Storage. Run backfill_all first."
        )
    
    panel = _normalize_panel_index(raw_panel)

    symbols = _get_active_symbols(db)
    panel_symbols = set(panel.index.get_level_values("symbol").astype(str))
    symbols_without_history = sorted(set(symbols) - panel_symbols)
    if symbols_without_history:
        raise RuntimeError(
            f"Active universe contains {len(symbols_without_history)} symbol(s) absent from "
            f"the stored characteristics panel: {symbols_without_history[:10]}"
        )

    # The trained DataLoader takes feature order directly from panel.columns.
    feature_names = [str(column) for column in panel.columns]

    X, R, feature_names, used_dates = _fetch_aligned_data(
        db=db,
        panel_day_symbol=panel,
        target_date=target_date,
        symbols=symbols,
        lookback=lookback_length,
    )
    
    for k in K_list:
        for mdd in md:
            try:

                config = ModelConfig(
                    K = k,
                    d = hidden_projection_dim,
                    s = lookback_length,
                    epochs = epoch,
                    lr = learning_rate,
                    weight_decay = weight_decay,
                    d_hidden_conv = hidden_projection_dim,
                    lambda_var = lambda_var_coeff,
                    lambda_ridge = lambda_ridge,
                    lambda_squash = lambda_squash,
                    patience = early_stop_patience,
                    save_dir = f"{data_dir}/../model_results_{mdd}",
                    device=device,
                    mode=mdd,
                )

                checkpoint_filename = f"K{k}_checkpoint_window_01.pt"
                
                model = _load_model(
                    repo_id=repo_id,
                    checkpoint_filename=checkpoint_filename,
                    n_assets=len(symbols),
                    n_features=len(feature_names),
                    device=device,
                    feature_names=feature_names,
                    config=config,
                    strict=True,
                )
                
                weights, residual_space_weights = _infer_next_weights(model, X, R, device)
                weight_values = [float(value) for value in weights.tolist()]

                # This table's current schema stores weights as a numeric array only.
                # Its implicit order is the sorted symbols array defined above.
                statement = pg_insert(ModelPrediction).values(
                    model_name=mdd,
                    as_of_date=target_date,
                    k_factors=model.K,
                    weight_for_symbols=weight_values,
                )

                statement = statement.on_conflict_do_update(
                    index_elements=[ModelPrediction.model_name, ModelPrediction.as_of_date],
                    set_={
                        "k_factors": statement.excluded.k_factors,
                        "weight_for_symbols": statement.excluded.weight_for_symbols,
                    },
                )

                db.execute(statement)
                db.commit()

                abs_sum = float(weights.abs().sum().item())
                logger.info(
                    "AFM prediction saved | model=%s as_of_date=%s effective_session=next session "
                    "symbols=%d K=%d abs_weight_sum=%.6f",
                    mdd, target_date, len(symbols), model.K, abs_sum,
                )

                logger.debug(
                    "LongConv residual-space weight L1 norm: %.6f",
                    float(residual_space_weights.abs().sum().item()),
                )

                metadata_ans[f"{k}_{mdd}"] = {
                    "model_name": mdd,
                    "as_of_date": target_date,
                    "k_factors": model.K,
                    "symbols_count": len(symbols),
                    "symbols": symbols,
                    "weight_for_symbols": weight_values,
                    "residual_dates": [d.date().isoformat() for d in used_dates],
                    "absolute_weight_sum": abs_sum,
                }

            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    return metadata_ans