import { useEffect, useState, useMemo } from "react";
import {
  Zap,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Sliders,
  X,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { formatCurrency } from "../../utils/formatters";
import {
  fetchDailySuggestions,
  executeSuggestionsAsIs,
  type TradeSuggestion,
} from "../../utils/tradeApi";
import type { Stock } from "../../data/stocksData";
import { useTradeModal } from "../../context/TradeContext";
import { getStoredUserInfo } from "../../utils/authUtils";
import { getCachedData, HOLDINGS_CACHE_KEY } from "../../utils/dataCache";
import "./StrategyBanner.css";

type Props = {
  stocks?: Stock[];
};

export default function StrategyBanner({ stocks }: Readonly<Props> = {}) {
  const { openTradeWithBasket } = useTradeModal();
  const [rawSuggestions, setRawSuggestions] = useState<TradeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [executionResult, setExecutionResult] = useState<string | null>(null);

  // Check user's auto_trade preference (stored in userInfo)
  const isAutoTradeOn = useMemo(() => {
    const info = getStoredUserInfo();
    return Boolean(info?.auto_trade);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchDailySuggestions(stocks)
      .then((data) => {
        if (mounted) {
          setRawSuggestions(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [stocks]);

  // Filter out any stocks with 0 quantity (backend might send 0 buy or 0 sell)
  const validSuggestions = useMemo(() => {
    return rawSuggestions.filter(
      (s) => typeof s.quantity === "number" && s.quantity > 0
    );
  }, [rawSuggestions]);

  // Compute financial totals with 20% short-selling margin freeze rule
  const breakdown = useMemo(() => {
    const cachedHoldings =
      getCachedData<Array<{ ticker: string; quantity: number }>>(HOLDINGS_CACHE_KEY) ?? [];
    const heldMap = new Map<string, number>();
    cachedHoldings.forEach((h) => {
      heldMap.set(
        h.ticker.toUpperCase(),
        (heldMap.get(h.ticker.toUpperCase()) ?? 0) + h.quantity
      );
    });

    let buyTotal = 0;
    let regularSell = 0;
    let shortNominal = 0;
    let shortMarginToFreeze = 0;

    validSuggestions.forEach((item) => {
      if (item.action === "buy") {
        buyTotal += item.price * item.quantity;
      } else {
        const currentHeld = heldMap.get(item.ticker.toUpperCase()) ?? 0;
        const regQty = Math.min(item.quantity, currentHeld);
        const sQty = Math.max(0, item.quantity - currentHeld);
        heldMap.set(item.ticker.toUpperCase(), Math.max(0, currentHeld - regQty));

        const regAmt = regQty * item.price;
        const sNom = sQty * item.price;
        const margin = sNom * 0.20; // 20% margin frozen from capital

        regularSell += regAmt;
        shortNominal += sNom;
        shortMarginToFreeze += margin;
      }
    });

    const netTradeCapital = buyTotal - regularSell;
    const netRequired = netTradeCapital + shortMarginToFreeze;

    return {
      buyTotal,
      regularSell,
      shortNominal,
      shortMarginToFreeze,
      netRequired,
    };
  }, [validSuggestions]);

  const { buyTotal: totalBuy, netRequired } = breakdown;

  const buyCount = useMemo(
    () => validSuggestions.filter((s) => s.action === "buy").length,
    [validSuggestions]
  );
  const sellCount = useMemo(
    () => validSuggestions.filter((s) => s.action === "sell").length,
    [validSuggestions]
  );

  if (dismissed || loading || validSuggestions.length === 0) {
    return null;
  }

  // ── Mode 1: Auto-Trade is ON (Trades were executed overnight by backend) ──
  if (isAutoTradeOn) {
    return (
      <section className="strategy-banner strategy-banner-auto-on" aria-label="Auto-Trade Activity">
        <div className="strategy-banner-header">
          <div className="strategy-badge-group">
            <span className="strategy-pill strategy-pill-auto">
              <Zap size={13} aria-hidden="true" />
              Auto-Trade ON
            </span>
            <span className="strategy-status-text">
              Overnight orders executed by backend ({validSuggestions.length} trades)
            </span>
          </div>
          <button
            type="button"
            className="strategy-dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss auto-trade summary"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable table of executed trades — 1 by 1 row */}
        <div className="strategy-table-wrapper">
          <table className="strategy-table">
            <thead>
              <tr>
                <th className="sb-col-action">Action</th>
                <th>Stock</th>
                <th className="sb-col-right">Qty</th>
                <th className="sb-col-right">Executed Price</th>
                <th className="sb-col-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {validSuggestions.map((item) => (
                <tr key={item.id}>
                  <td className="sb-col-action">
                    <span className={`strategy-action-tag tag-${item.action}`}>
                      {item.action === "buy" ? "BOUGHT" : "SOLD"}
                    </span>
                  </td>
                  <td>
                    <div className="sb-stock-cell">
                      <strong className="sb-ticker">{item.ticker}</strong>
                      <span className="sb-name">{item.name}</span>
                    </div>
                  </td>
                  <td className="sb-col-right">{item.quantity}</td>
                  <td className="sb-col-right">{formatCurrency(item.price)}</td>
                  <td className="sb-col-right sb-col-total">
                    {formatCurrency(item.price * item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="strategy-footer-note">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>All positions and capital were updated automatically. View in Portfolio.</span>
        </div>
      </section>
    );
  }

  // ── Mode 2: Auto-Trade is OFF (Pending suggestions need user action) ──────
  const handleExecuteAsIs = async () => {
    setExecuting(true);
    try {
      await executeSuggestionsAsIs(validSuggestions);
      setExecutionResult("All strategy suggestions executed successfully!");
      window.dispatchEvent(new CustomEvent("trade-executed"));
      setTimeout(() => setDismissed(true), 3000);
    } catch (err) {
      setExecutionResult(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  };

  const handleCustomize = () => {
    openTradeWithBasket(
      validSuggestions.map((s) => ({
        ticker: s.ticker,
        name: s.name,
        price: s.price,
        action: s.action,
        quantity: s.quantity,
      }))
    );
  };

  return (
    <section className="strategy-banner strategy-banner-pending" aria-label="Today's Strategy Suggestions">
      <div className="strategy-banner-header">
        <div className="strategy-title-group">
          <div className="strategy-tag-row">
            <span className="strategy-pill strategy-pill-suggestion">
              <Zap size={13} aria-hidden="true" />
              Daily Strategy Desk
            </span>
            <span className="strategy-mode-indicator">Auto-Trade: OFF</span>
          </div>
          <h3 className="strategy-heading">
            Today&apos;s Trade Suggestions ({validSuggestions.length} stocks: {buyCount} buy, {sellCount} sell)
          </h3>
          <p className="strategy-desc">
            Algorithm-generated trade recommendations. Execute directly as-is or customize quantities in your trade basket.
          </p>
        </div>

        <button
          type="button"
          className="strategy-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss strategy suggestions"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="strategy-banner-content">
        {/* Scrollable table of suggestions — 1 by 1 row just like StockTable */}
        <div className="strategy-table-wrapper">
          <table className="strategy-table">
            <thead>
              <tr>
                <th className="sb-col-action">Action</th>
                <th>Stock</th>
                <th className="sb-col-right">Suggested Qty</th>
                <th className="sb-col-right">Market Price</th>
                <th className="sb-col-right">Estimated Total</th>
              </tr>
            </thead>
            <tbody>
              {validSuggestions.map((item) => {
                const subtotal = item.price * item.quantity;
                return (
                  <tr key={item.id} className={`sb-row-${item.action}`}>
                    <td className="sb-col-action">
                      <span className={`strategy-action-tag tag-${item.action}`}>
                        {item.action === "buy" ? (
                          <>
                            <TrendingUp size={12} aria-hidden="true" /> BUY
                          </>
                        ) : (
                          <>
                            <TrendingDown size={12} aria-hidden="true" /> SELL
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="sb-stock-cell">
                        <strong className="sb-ticker">{item.ticker}</strong>
                        <span className="sb-name">{item.name}</span>
                      </div>
                    </td>
                    <td className="sb-col-right">{item.quantity}</td>
                    <td className="sb-col-right">{formatCurrency(item.price)}</td>
                    <td className="sb-col-right sb-col-total">
                      {formatCurrency(subtotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Financial Summary & Actions */}
        <div className="strategy-action-bar">
          <div className="strategy-net-preview">
            <span className="strategy-net-label">Strategy Net Impact:</span>
            <strong className="strategy-net-val">
              {netRequired >= 0
                ? `${formatCurrency(netRequired)} required`
                : `+${formatCurrency(Math.abs(netRequired))} proceeds`}
            </strong>
            <span className="strategy-net-subtext">
              Buys: {formatCurrency(totalBuy)} · Sells: {formatCurrency(breakdown.regularSell)}
              {breakdown.shortMarginToFreeze > 0 && (
                <> · Margin Frozen (20%): {formatCurrency(breakdown.shortMarginToFreeze)}</>
              )}
            </span>
          </div>

          <div className="strategy-btn-group">
            <button
              type="button"
              className="strategy-btn-customize"
              onClick={handleCustomize}
              title="Customize quantities, add/remove stocks in the trade basket"
            >
              <Sliders size={14} aria-hidden="true" />
              <span>Customize &amp; Edit</span>
            </button>

            <button
              type="button"
              className="strategy-btn-execute"
              onClick={() => void handleExecuteAsIs()}
              disabled={executing}
              title="Execute all suggestions directly as recommended"
            >
              {executing ? (
                <>
                  <RefreshCw size={14} className="strategy-spin" aria-hidden="true" />
                  <span>Executing…</span>
                </>
              ) : (
                <>
                  <span>Execute As-Is</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>

        {executionResult && (
          <div className="strategy-result-banner" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{executionResult}</span>
          </div>
        )}
      </div>
    </section>
  );
}
