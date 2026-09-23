import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
  Zap,
} from "lucide-react";
import type { Stock } from "../../data/stocksData";
import { formatCurrency } from "../../utils/formatters";
import {
  authenticatedFetch,
  getBackendBaseUrl,
  logBackendResponse,
} from "../../utils/authUtils";
import {
  DASHBOARD_STOCKS_CACHE_KEY,
  DASHBOARD_SUMMARY_CACHE_KEY,
  HOLDINGS_CACHE_KEY,
  CAPITAL_CACHE_KEY,
  getCachedData,
  setCachedData,
} from "../../utils/dataCache";
import { executeBatchTrade, updateCapital, fetchDailySuggestions } from "../../utils/tradeApi";
import "./TradeModal.css";

export type BasketOrder = {
  id: string;
  ticker: string;
  name: string;
  price: number;
  action: "buy" | "sell";
  quantity: number;
};

type Holding = {
  ticker: string;
  quantity: number;
  currentPrice: number;
};

type ModalStock = {
  ticker: string;
  name: string;
  price: number;
};

type TradeStatus = "idle" | "submitting" | "success" | "error";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  prefilledStock?: ModalStock | null;
  prefilledAction?: "buy" | "sell";
  initialBasket?: Array<{
    ticker: string;
    name: string;
    price: number;
    action: "buy" | "sell";
    quantity: number;
  }>;
};

// ─── Data helpers ────────────────────────────────────────────────────────────

async function fetchCapital(): Promise<number> {
  const cachedCapital = getCachedData<number>(CAPITAL_CACHE_KEY);
  if (typeof cachedCapital === "number") return cachedCapital;

  const cachedSummary = getCachedData<{ totalPortfolioValue?: number; availableCapital?: number; investedCapital?: number }>(
    DASHBOARD_SUMMARY_CACHE_KEY
  );
  if (cachedSummary) {
    const val = cachedSummary.availableCapital ?? cachedSummary.totalPortfolioValue ?? 0;
    return val;
  }

  try {
    const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/dashboard`, {
      credentials: "include",
    });
    logBackendResponse(res, "GET /api/dashboard (trade modal)");
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalPortfolioValue?: number; availableCapital?: number };
    const val = data.availableCapital ?? data.totalPortfolioValue ?? 0;
    setCachedData(CAPITAL_CACHE_KEY, val);
    return val;
  } catch {
    return 0;
  }
}

async function fetchHoldings(): Promise<Holding[]> {
  const cached = getCachedData<Holding[]>(HOLDINGS_CACHE_KEY);
  if (cached) return cached;

  try {
    const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/portfolio`, {
      credentials: "include",
    });
    logBackendResponse(res, "GET /api/portfolio (trade modal)");
    if (!res.ok) return [];
    const data = (await res.json()) as { holdings?: Holding[] };
    const holdings = data.holdings ?? (Array.isArray(data) ? (data as Holding[]) : []);
    setCachedData(HOLDINGS_CACHE_KEY, holdings);
    return holdings;
  } catch {
    return [];
  }
}

function getAllStocks(): Stock[] {
  return getCachedData<Stock[]>(DASHBOARD_STOCKS_CACHE_KEY) ?? [];
}

export default function TradeModal({
  isOpen,
  onClose,
  prefilledStock,
  prefilledAction = "buy",
  initialBasket,
}: Readonly<Props>) {
  // ── Basket state (multi-stock orders) ──
  const [basket, setBasket] = useState<BasketOrder[]>([]);

  // ── Candidate order being configured in the top form ──
  const [candidateStock, setCandidateStock] = useState<ModalStock | null>(null);
  const [candidateAction, setCandidateAction] = useState<"buy" | "sell">("buy");
  const [candidateQty, setCandidateQty] = useState<string>("1");

  // ── Search dropdown state ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Data & Capital ──
  const [allStocks, setAllStocks] = useState<Stock[]>([]);
  const [availableCapital, setAvailableCapital] = useState<number>(0);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [capitalLoading, setCapitalLoading] = useState(true);

  // ── Capital inline editing ──
  const [editingCapital, setEditingCapital] = useState(false);
  const [capitalDraft, setCapitalDraft] = useState("");
  const [capitalSaving, setCapitalSaving] = useState(false);

  // ── Submission status ──
  const [tradeStatus, setTradeStatus] = useState<TradeStatus>("idle");
  const [tradeError, setTradeError] = useState<string>("");

  const searchRef = useRef<HTMLDivElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // ── Initialize or reset modal ──
  useEffect(() => {
    if (!isOpen) {
      // Clear candidate state immediately when closed to prevent any ghost "1" UI
      setCandidateStock(null);
      setSearchQuery("");
      setSearchOpen(false);
      setBasket([]);
      setTradeStatus("idle");
      setTradeError("");
      setEditingCapital(false);
      return;
    }

    // Load available stocks
    setAllStocks(getAllStocks());

    // Load capital and holdings
    setCapitalLoading(true);
    void Promise.all([fetchCapital(), fetchHoldings()]).then(([cap, hold]) => {
      setAvailableCapital(cap);
      setHoldings(hold);
      setCapitalLoading(false);
    });

    // If initial basket is provided (e.g. from strategy suggestions), populate it
    if (initialBasket && initialBasket.length > 0) {
      setBasket(
        initialBasket.map((item, idx) => ({
          id: `item_${Date.now()}_${idx}`,
          ticker: item.ticker,
          name: item.name,
          price: item.price,
          action: item.action,
          quantity: item.quantity,
        }))
      );
      setCandidateStock(null);
      setSearchQuery("");
      setSearchOpen(false);
    } else if (prefilledStock) {
      // If pre-filled from clicking a stock row or portfolio "Sell", auto-populate the basket
      setBasket([
        {
          id: `item_${Date.now()}`,
          ticker: prefilledStock.ticker,
          name: prefilledStock.name,
          price: prefilledStock.price,
          action: prefilledAction,
          quantity: 1,
        },
      ]);
      setCandidateStock(null);
      setSearchQuery("");
      setSearchOpen(false);
    } else {
      // Opened from TradeFAB: start with clean basket and search ready
      setBasket([]);
      setCandidateStock(null);
      setCandidateAction("buy");
      setCandidateQty("1");
      setSearchQuery("");
      setSearchOpen(false);
    }
  }, [isOpen, prefilledStock, prefilledAction, initialBasket]);

  // ── Escape key & body overflow ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  // ── Close search dropdown when clicking outside ──
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Search results ──
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allStocks.slice(0, 8);
    return allStocks
      .filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [allStocks, searchQuery]);

  const handleSelectStock = useCallback((stock: Stock) => {
    setCandidateStock({ ticker: stock.ticker, name: stock.name, price: stock.price });
    setSearchQuery(stock.ticker);
    setSearchOpen(false);
    setCandidateQty("1");
    // Focus quantity input
    setTimeout(() => qtyInputRef.current?.focus(), 50);
  }, []);

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchResults.length > 0) {
      handleSelectStock(searchResults[0]);
    }
  };

  // ── Basket operations ──
  const handleAddToBasket = () => {
    if (!candidateStock) return;
    const q = Math.max(1, parseInt(candidateQty, 10) || 1);

    setBasket((prev) => {
      // Check if stock with same action already in basket -> increase quantity
      const existingIdx = prev.findIndex(
        (item) => item.ticker === candidateStock.ticker && item.action === candidateAction
      );
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + q,
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          ticker: candidateStock.ticker,
          name: candidateStock.name,
          price: candidateStock.price,
          action: candidateAction,
          quantity: q,
        },
      ];
    });

    // Reset top form so user can immediately add another stock
    setCandidateStock(null);
    setSearchQuery("");
    setCandidateQty("1");
  };

  const handleUpdateBasketQty = (id: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveBasketItem(id);
      return;
    }
    setBasket((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity: newQty } : item))
    );
  };

  const handleRemoveBasketItem = (id: string) => {
    setBasket((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBasket = () => {
    setBasket([]);
  };

  // ── Financial calculations (Net Capital Check) ──
  const totalBuy = useMemo(
    () =>
      basket
        .filter((o) => o.action === "buy")
        .reduce((sum, o) => sum + o.price * o.quantity, 0),
    [basket]
  );

  const totalSell = useMemo(
    () =>
      basket
        .filter((o) => o.action === "sell")
        .reduce((sum, o) => sum + o.price * o.quantity, 0),
    [basket]
  );

  // Net Cash Required: if Buys > Sells, user pays the net difference
  // If Sells >= Buys, net requirement is 0 (or negative, meaning user receives cash!)
  const netRequired = totalBuy - totalSell;
  const shortfall = netRequired > availableCapital ? netRequired - availableCapital : 0;
  const isOverCapital = shortfall > 0;
  const postTradeBalance = availableCapital - netRequired;

  // Check for short-selling in basket
  const shortSellOrders = useMemo(() => {
    return basket.filter((o) => {
      if (o.action !== "sell") return false;
      const held = holdings.find((h) => h.ticker === o.ticker)?.quantity ?? 0;
      return o.quantity > held;
    });
  }, [basket, holdings]);

  // Can submit check: basket has at least 1 order, no shortfall, not submitting
  const canSubmit =
    basket.length > 0 &&
    !isOverCapital &&
    tradeStatus !== "submitting" &&
    tradeStatus !== "success";

  // ── Order execution ──
  const handleSubmitOrders = async () => {
    if (!canSubmit) return;

    setTradeStatus("submitting");
    setTradeError("");

    try {
      await executeBatchTrade(
        basket.map((o) => ({
          ticker: o.ticker,
          action: o.action,
          quantity: o.quantity,
          price: o.price,
        }))
      );

      // Optimistically update capital in cache and state
      const nextCap = Math.max(0, postTradeBalance);
      setAvailableCapital(nextCap);
      setCachedData(CAPITAL_CACHE_KEY, nextCap);

      setTradeStatus("success");
      // Notify other pages to refresh
      window.dispatchEvent(new CustomEvent("trade-executed"));
    } catch (err) {
      setTradeStatus("error");
      setTradeError(err instanceof Error ? err.message : "Trade execution failed. Please try again.");
    }
  };

  // ── Capital update handler ──
  const handleSaveCapital = async () => {
    const newCap = parseFloat(capitalDraft.replace(/[^0-9.]/g, ""));
    if (isNaN(newCap) || newCap < 0) return;
    setCapitalSaving(true);
    try {
      await updateCapital(newCap);
      setAvailableCapital(newCap);
      setCachedData(CAPITAL_CACHE_KEY, newCap);
      setEditingCapital(false);
    } catch {
      // Optimistic update
      setAvailableCapital(newCap);
      setCachedData(CAPITAL_CACHE_KEY, newCap);
      setEditingCapital(false);
    } finally {
      setCapitalSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="tm-overlay tm-overlay--open"
      role="dialog"
      aria-modal="true"
      aria-label="Trade & Portfolio Rebalance Panel"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tm-panel">
        {/* Modal Header */}
        <div className="tm-header">
          <div className="tm-header-titles">
            <h2 className="tm-title">Trade Workspace</h2>
            <span className="tm-subtitle">Buy & sell stocks with net balance settlement</span>
          </div>
          <button
            type="button"
            className="tm-close"
            onClick={onClose}
            aria-label="Close trade panel"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Available Capital Bar (with Edit) */}
        <div className="tm-capital-bar">
          {!editingCapital ? (
            <div className="tm-capital-display">
              <span className="tm-capital-tag">Available Capital</span>
              <strong className="tm-capital-amount">
                {capitalLoading ? "..." : formatCurrency(availableCapital)}
              </strong>
              <button
                type="button"
                className="tm-capital-pencil"
                onClick={() => {
                  setEditingCapital(true);
                  setCapitalDraft(String(availableCapital));
                }}
                title="Edit capital"
              >
                <Pencil size={13} aria-hidden="true" />
                <span>Edit</span>
              </button>
            </div>
          ) : (
            <div className="tm-capital-edit-inline">
              <span className="tm-capital-tag">Set Capital (₹):</span>
              <input
                type="number"
                min="0"
                className="tm-capital-input-sm"
                value={capitalDraft}
                onChange={(e) => setCapitalDraft(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="tm-btn-save-cap"
                onClick={() => void handleSaveCapital()}
                disabled={capitalSaving}
              >
                {capitalSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="tm-btn-cancel-cap"
                onClick={() => setEditingCapital(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Section 1: Add Stock to Basket */}
        <div className="tm-section tm-add-section">
          <div className="tm-section-label">
            <span>Add Stock to Order</span>
          </div>

          <div className="tm-add-form">
            {/* Search Input */}
            <div ref={searchRef} className="tm-search-wrap">
              <div className="tm-search-field">
                <Search size={15} className="tm-search-icon" aria-hidden="true" />
                <input
                  type="search"
                  className="tm-search-input"
                  placeholder="Search ticker or stock name to trade…"
                  value={searchQuery}
                  autoComplete="off"
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchOpen(true);
                    if (!e.target.value) setCandidateStock(null);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>

              {searchOpen && searchResults.length > 0 && (
                <ul className="tm-search-dropdown" role="listbox">
                  {searchResults.map((stock) => (
                    <li
                      key={stock.ticker}
                      role="option"
                      aria-selected={candidateStock?.ticker === stock.ticker}
                      className={`tm-search-option${candidateStock?.ticker === stock.ticker ? " selected" : ""}`}
                      onMouseDown={() => handleSelectStock(stock)}
                    >
                      <span className="tm-option-ticker">{stock.ticker}</span>
                      <span className="tm-option-name">{stock.name}</span>
                      <span className="tm-option-price">{formatCurrency(stock.price)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Candidate Configuration (Action + Qty + Add Button) */}
            {candidateStock && (
              <div className="tm-candidate-card">
                <div className="tm-candidate-meta">
                  <div>
                    <strong className="tm-cand-ticker">{candidateStock.ticker}</strong>
                    <span className="tm-cand-name">{candidateStock.name}</span>
                  </div>
                  <strong className="tm-cand-price">{formatCurrency(candidateStock.price)}</strong>
                </div>

                <div className="tm-candidate-controls">
                  {/* Buy / Sell Toggle */}
                  <div className="tm-action-pills">
                    <button
                      type="button"
                      className={`tm-pill tm-pill-buy${candidateAction === "buy" ? " active" : ""}`}
                      onClick={() => setCandidateAction("buy")}
                    >
                      <TrendingUp size={13} aria-hidden="true" />
                      Buy
                    </button>
                    <button
                      type="button"
                      className={`tm-pill tm-pill-sell${candidateAction === "sell" ? " active" : ""}`}
                      onClick={() => setCandidateAction("sell")}
                    >
                      <TrendingDown size={13} aria-hidden="true" />
                      Sell
                    </button>
                  </div>

                  {/* Quantity */}
                  <div className="tm-cand-qty-box">
                    <label htmlFor="cand-qty">Qty:</label>
                    <input
                      id="cand-qty"
                      ref={qtyInputRef}
                      type="number"
                      min="1"
                      className="tm-cand-qty-input"
                      value={candidateQty}
                      onChange={(e) => setCandidateQty(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </div>

                  {/* Estimated Subtotal */}
                  <div className="tm-cand-subtotal">
                    <span>=</span>
                    <strong>
                      {formatCurrency(
                        candidateStock.price * Math.max(1, parseInt(candidateQty, 10) || 1)
                      )}
                    </strong>
                  </div>

                  {/* Add Button */}
                  <button
                    type="button"
                    className="tm-btn-add"
                    onClick={handleAddToBasket}
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>Add to Order</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Order Basket (List of orders) */}
        <div className="tm-section tm-basket-section">
          <div className="tm-basket-header">
            <div className="tm-basket-heading">
              <ShoppingBag size={15} aria-hidden="true" />
              <span>Order Basket ({basket.length} {basket.length === 1 ? "item" : "items"})</span>
            </div>
            {basket.length > 0 && (
              <button
                type="button"
                className="tm-btn-clear"
                onClick={handleClearBasket}
              >
                Clear all
              </button>
            )}
          </div>

          {basket.length === 0 ? (
            <div className="tm-basket-empty">
              <p>Your basket is empty. Search a stock above to add buy and sell orders together.</p>
              <button
                type="button"
                className="tm-btn-import-sug"
                onClick={async () => {
                  const sugs = await fetchDailySuggestions();
                  setBasket(
                    sugs.map((s, idx) => ({
                      id: `item_${Date.now()}_${idx}`,
                      ticker: s.ticker,
                      name: s.name,
                      price: s.price,
                      action: s.action,
                      quantity: s.quantity,
                    }))
                  );
                }}
              >
                <Zap size={13} aria-hidden="true" />
                <span>Load Today&apos;s Strategy Suggestions</span>
              </button>
            </div>
          ) : (
            <div className="tm-basket-list">
              {basket.map((item) => {
                const subtotal = item.price * item.quantity;
                return (
                  <div key={item.id} className={`tm-basket-row tm-row-${item.action}`}>
                    <div className="tm-row-action-tag">
                      <span className={`tm-badge tm-badge-${item.action}`}>
                        {item.action.toUpperCase()}
                      </span>
                    </div>

                    <div className="tm-row-details">
                      <strong className="tm-row-ticker">{item.ticker}</strong>
                      <span className="tm-row-price">@{formatCurrency(item.price)}</span>
                    </div>

                    <div className="tm-row-qty-stepper">
                      <button
                        type="button"
                        className="tm-step-btn"
                        onClick={() => handleUpdateBasketQty(item.id, item.quantity - 1)}
                        aria-label="Decrease quantity"
                      >
                        <Minus size={12} aria-hidden="true" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        className="tm-step-input"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                          handleUpdateBasketQty(item.id, isNaN(val) ? 1 : val);
                        }}
                      />
                      <button
                        type="button"
                        className="tm-step-btn"
                        onClick={() => handleUpdateBasketQty(item.id, item.quantity + 1)}
                        aria-label="Increase quantity"
                      >
                        <Plus size={12} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="tm-row-total">
                      <strong>{formatCurrency(subtotal)}</strong>
                    </div>

                    <button
                      type="button"
                      className="tm-row-remove"
                      onClick={() => handleRemoveBasketItem(item.id)}
                      title="Remove order"
                      aria-label={`Remove ${item.ticker}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Short-selling notice */}
          {shortSellOrders.length > 0 && (
            <div className="tm-warning" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>
                Short selling on:{" "}
                {shortSellOrders.map((o) => o.ticker).join(", ")}. Short positions will be opened.
              </span>
            </div>
          )}
        </div>

        {/* Section 3: Net Financial Breakdown */}
        {basket.length > 0 && (
          <div className="tm-section tm-summary-section">
            <div className="tm-summary-grid">
              <div className="tm-summary-stat">
                <span>Total Buys</span>
                <strong>{formatCurrency(totalBuy)}</strong>
              </div>
              <div className="tm-summary-stat">
                <span>Sell Proceeds</span>
                <strong className="tm-stat-green">{formatCurrency(totalSell)}</strong>
              </div>
              <div className="tm-summary-stat tm-stat-net">
                <span>Net Required</span>
                <strong>{formatCurrency(Math.max(0, netRequired))}</strong>
              </div>
            </div>

            {/* Validation feedback */}
            {isOverCapital ? (
              <div className="tm-error" role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                <div>
                  <strong>Shortfall of {formatCurrency(shortfall)}</strong>
                  <p>
                    Net required ({formatCurrency(netRequired)}) exceeds your capital ({formatCurrency(availableCapital)}).{" "}
                    Add sell orders of at least {formatCurrency(shortfall)}, or{" "}
                    <button
                      type="button"
                      className="tm-inline-btn"
                      onClick={() => {
                        setEditingCapital(true);
                        setCapitalDraft(String(Math.ceil(netRequired)));
                      }}
                    >
                      update your capital
                    </button>{" "}
                    to proceed.
                  </p>
                </div>
              </div>
            ) : netRequired <= 0 && totalSell > 0 ? (
              <div className="tm-net-positive" role="status">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>
                  Net credit of {formatCurrency(Math.abs(netRequired))} will be added to your balance upon execution.
                </span>
              </div>
            ) : (
              <div className="tm-net-balanced" role="status">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>
                  Net required: {formatCurrency(netRequired)}. Balance after trade:{" "}
                  {formatCurrency(postTradeBalance)}.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Success or error message */}
        {tradeStatus === "success" && (
          <div className="tm-success-banner" role="status">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div>
              <strong>Orders Placed Successfully!</strong>
              <p>Executed {basket.length} order{basket.length !== 1 ? "s" : ""}. Capital updated.</p>
            </div>
          </div>
        )}

        {tradeStatus === "error" && tradeError && (
          <div className="tm-error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{tradeError}</span>
          </div>
        )}

        {/* Footer */}
        <div className="tm-footer">
          {tradeStatus === "success" ? (
            <button
              type="button"
              className="tm-btn-primary tm-btn-full"
              onClick={onClose}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="tm-btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tm-btn-primary"
                onClick={() => void handleSubmitOrders()}
                disabled={!canSubmit}
                aria-disabled={!canSubmit}
              >
                {tradeStatus === "submitting" ? (
                  "Placing Orders…"
                ) : (
                  <>
                    <span>Execute Trade</span>
                    {basket.length > 0 && <span>({basket.length} {basket.length === 1 ? "order" : "orders"})</span>}
                    <ArrowRight size={15} aria-hidden="true" />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
