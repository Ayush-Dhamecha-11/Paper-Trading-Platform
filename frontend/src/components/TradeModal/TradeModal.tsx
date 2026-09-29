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
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
  Zap,
  Info,
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
import { isMarketClosed } from "../../utils/marketUtils";
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
  // Always query /api/dashboard first when fetching capital for TradeModal to get the latest capitalBalance
  try {
    const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/dashboard`, {
      credentials: "include",
    });
    logBackendResponse(res, "GET /api/dashboard (trade modal capital)");
    if (res.ok) {
      const data = (await res.json()) as {
        totalPortfolioValue?: number;
        capitalBalance?: number;
        accountEquity?: number;
        investedCapital?: number;
        availableCapital?: number;
      };
      const val =
        typeof data.capitalBalance === "number"
          ? data.capitalBalance
          : (data.availableCapital ?? data.totalPortfolioValue ?? 0);
      setCachedData(CAPITAL_CACHE_KEY, val);
      return val;
    }
  } catch {
    // If network request fails, fall back to cached values
  }

  const cachedCapital = getCachedData<number>(CAPITAL_CACHE_KEY);
  if (typeof cachedCapital === "number") return cachedCapital;

  const cachedSummary = getCachedData<{
    totalPortfolioValue?: number;
    capitalBalance?: number;
    accountEquity?: number;
    availableCapital?: number;
    investedCapital?: number;
  }>(DASHBOARD_SUMMARY_CACHE_KEY);
  if (cachedSummary) {
    if (typeof cachedSummary.capitalBalance === "number") return cachedSummary.capitalBalance;
    if (typeof cachedSummary.availableCapital === "number") return cachedSummary.availableCapital;
    return cachedSummary.totalPortfolioValue ?? 0;
  }

  return 0;
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

  // ── Capital management (Add / Remove) ──
  const [managingCapital, setManagingCapital] = useState(false);
  const [capitalAction, setCapitalAction] = useState<"add" | "remove">("add");
  const [capitalDelta, setCapitalDelta] = useState("");
  const [capitalSaving, setCapitalSaving] = useState(false);
  const [capitalSuccess, setCapitalSuccess] = useState(false);
  const [capitalError, setCapitalError] = useState("");

  // ── Submission status ──
  const [tradeStatus, setTradeStatus] = useState<TradeStatus>("idle");
  const [tradeError, setTradeError] = useState<string>("");
  const [lastExecutedCount, setLastExecutedCount] = useState<number>(0);

  const searchRef = useRef<HTMLDivElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const autoCloseTimerRef = useRef<number | null>(null);

  // Clean up auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  // ── Initialize or reset modal ──
  useEffect(() => {
    if (!isOpen) {
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
      // Clear candidate state immediately when closed to prevent any ghost "1" UI
      setCandidateStock(null);
      setSearchQuery("");
      setSearchOpen(false);
      setBasket([]);
      setTradeStatus("idle");
      setTradeError("");
      setLastExecutedCount(0);
      setManagingCapital(false);
      setCapitalAction("add");
      setCapitalDelta("");
      setCapitalSuccess(false);
      setCapitalError("");
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

  // ── Escape key & background scroll lock ──
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    // Prevent background scrolling on both body and html elements
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
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

  // ── Candidate order analysis (real-time preview before adding to basket) ──
  // ── Candidate order analysis (real-time preview before adding to basket) ──
  const candidateAnalysis = useMemo(() => {
    if (!candidateStock) return null;
    const qty = Math.max(1, parseInt(candidateQty, 10) || 1);
    const price = candidateStock.price;
    const nominalSubtotal = price * qty;

    if (candidateAction === "buy") {
      return {
        isShort: false,
        isPartialShort: false,
        regularQty: 0,
        shortQty: 0,
        nominalSubtotal,
        regularCredit: 0,
        marginToFreeze: 0,
        totalHeld: 0,
        availableHeld: 0,
      };
    }

    // Sell action: check if user holds this stock
    const totalHeld =
      holdings.find(
        (h) => h.ticker.toUpperCase() === candidateStock.ticker.toUpperCase()
      )?.quantity ?? 0;

    // Sells already staged in current basket for this stock
    const alreadyInBasket = basket
      .filter(
        (item) =>
          item.action === "sell" &&
          item.ticker.toUpperCase() === candidateStock.ticker.toUpperCase()
      )
      .reduce((sum, item) => sum + item.quantity, 0);

    const availableHeld = Math.max(0, totalHeld - alreadyInBasket);
    const regularQty = Math.min(qty, availableHeld);
    const shortQty = Math.max(0, qty - availableHeld);

    const regularCredit = regularQty * price;
    const shortNominal = shortQty * price;
    const marginToFreeze = shortNominal * 0.20; // 20% margin frozen from capital

    return {
      isShort: shortQty > 0 && regularQty === 0,
      isPartialShort: shortQty > 0 && regularQty > 0,
      regularQty,
      shortQty,
      nominalSubtotal,
      regularCredit,
      marginToFreeze,
      totalHeld,
      availableHeld,
    };
  }, [candidateStock, candidateAction, candidateQty, holdings, basket]);

  // ── Financial calculations (Net Capital Check with 20% Margin Freeze) ──
  // Rule:
  // 1. Buy: full nominal cost added to totalBuy
  // 2. Regular Sell (owned stock): 100% credited against buy requirements (regularSell)
  // 3. Short Sell (unowned stock): 0% proceeds credited (liability); 20% margin frozen from capital
  // 4. Net Required = (totalBuy - regularSell) + shortMarginToFreeze
  // 5. Shortfall = max(0, netRequired - availableCapital)
  const basketAnalysis = useMemo(() => {
    const heldMap = new Map<string, number>();
    holdings.forEach((h) => {
      heldMap.set(
        h.ticker.toUpperCase(),
        (heldMap.get(h.ticker.toUpperCase()) ?? 0) + h.quantity
      );
    });

    let totalBuy = 0;
    let regularSell = 0;
    let shortSellNominal = 0;
    let shortMarginToFreeze = 0;

    const items = basket.map((item) => {
      const nominalSubtotal = item.price * item.quantity;

      if (item.action === "buy") {
        totalBuy += nominalSubtotal;
        return {
          ...item,
          isShort: false,
          isPartialShort: false,
          regularQty: 0,
          regularAmount: 0,
          shortQty: 0,
          shortNominal: 0,
          marginToFreeze: 0,
          creditedAmount: 0,
          nominalSubtotal,
        };
      }

      // Action is "sell"
      const currentHeld = heldMap.get(item.ticker.toUpperCase()) ?? 0;
      const regularQty = Math.min(item.quantity, currentHeld);
      const shortQty = Math.max(0, item.quantity - currentHeld);

      // Decrement held quantity for subsequent sells of this stock
      heldMap.set(
        item.ticker.toUpperCase(),
        Math.max(0, currentHeld - regularQty)
      );

      const regularAmount = regularQty * item.price;
      const shortNominal = shortQty * item.price;
      const marginToFreeze = shortNominal * 0.20; // 20% margin frozen from capital

      regularSell += regularAmount;
      shortSellNominal += shortNominal;
      shortMarginToFreeze += marginToFreeze;

      return {
        ...item,
        isShort: shortQty > 0 && regularQty === 0,
        isPartialShort: shortQty > 0 && regularQty > 0,
        regularQty,
        regularAmount,
        shortQty,
        shortNominal,
        marginToFreeze,
        creditedAmount: regularAmount,
        nominalSubtotal,
      };
    });

    // Net capital required: buys minus owned proceeds plus 20% frozen short margin
    const netTradeCapital = totalBuy - regularSell;
    const netRequired = netTradeCapital + shortMarginToFreeze;
    const shortfall = netRequired > availableCapital ? netRequired - availableCapital : 0;
    const isOverCapital = shortfall > 0;
    const postTradeBalance = availableCapital - netRequired;

    const shortSellOrders = items.filter((i) => i.shortQty > 0);

    return {
      items,
      totalBuy,
      regularSell,
      shortSellNominal,
      shortMarginToFreeze,
      netRequired,
      shortfall,
      isOverCapital,
      postTradeBalance,
      shortSellOrders,
    };
  }, [basket, holdings, availableCapital]);

  const {
    totalBuy,
    regularSell,
    shortSellNominal,
    shortMarginToFreeze,
    netRequired,
    shortfall,
    isOverCapital,
    postTradeBalance,
    shortSellOrders,
  } = basketAnalysis;

  const marketClosed = isMarketClosed(allStocks);

  // Can submit check: basket has at least 1 order, no shortfall, not submitting, market is open
  const canSubmit =
    basket.length > 0 &&
    !isOverCapital &&
    tradeStatus !== "submitting" &&
    tradeStatus !== "success" &&
    !marketClosed;

  // ── Order execution ──
  const handleSubmitOrders = async () => {
    if (marketClosed) {
      setTradeStatus("error");
      setTradeError("You cannot trade right now because the stock market is closed.");
      return;
    }
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
      sessionStorage.removeItem(DASHBOARD_SUMMARY_CACHE_KEY);
      sessionStorage.removeItem(HOLDINGS_CACHE_KEY);
      sessionStorage.removeItem("analytics_data");

      setLastExecutedCount(basket.length);
      setBasket([]);
      setTradeStatus("success");

      // Notify other pages to refresh
      window.dispatchEvent(new CustomEvent("trade-executed"));
      window.dispatchEvent(new CustomEvent("capital-updated"));

      // Auto close the trade modal after brief success presentation
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
      autoCloseTimerRef.current = window.setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setTradeStatus("error");
      setTradeError(err instanceof Error ? err.message : "Trade execution failed. Please try again.");
    }
  };

  // ── Capital management calculation & handler (Add / Remove) ──
  const deltaVal = parseFloat(capitalDelta.replace(/[^0-9.]/g, "")) || 0;
  const previewNewCapital =
    capitalAction === "add"
      ? availableCapital + deltaVal
      : Math.max(0, availableCapital - deltaVal);

  const handleSaveCapital = async () => {
    const delta = parseFloat(capitalDelta.replace(/[^0-9.]/g, ""));
    if (isNaN(delta) || delta <= 0) {
      setCapitalError("Please enter a valid amount greater than 0");
      return;
    }
    if (capitalAction === "remove" && delta > availableCapital) {
      setCapitalError(`Cannot withdraw more than available capital (${formatCurrency(availableCapital)})`);
      return;
    }

    const newCap = capitalAction === "add" ? availableCapital + delta : Math.max(0, availableCapital - delta);
    setCapitalSaving(true);
    setCapitalError("");
    try {
      await updateCapital(newCap);
      setAvailableCapital(newCap);
      setCachedData(CAPITAL_CACHE_KEY, newCap);
      sessionStorage.removeItem(DASHBOARD_SUMMARY_CACHE_KEY);
      sessionStorage.removeItem(HOLDINGS_CACHE_KEY);
      sessionStorage.removeItem("analytics_data");
      setCapitalSuccess(true);

      // Notify other pages to refresh immediately
      window.dispatchEvent(new CustomEvent("capital-updated"));
      window.dispatchEvent(new CustomEvent("trade-executed"));

      // Auto close the trade modal
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
      autoCloseTimerRef.current = window.setTimeout(() => {
        setManagingCapital(false);
        setCapitalDelta("");
        setCapitalSuccess(false);
        onClose();
      }, 650);
    } catch {
      // Optimistic update
      setAvailableCapital(newCap);
      setCachedData(CAPITAL_CACHE_KEY, newCap);
      sessionStorage.removeItem(DASHBOARD_SUMMARY_CACHE_KEY);
      sessionStorage.removeItem(HOLDINGS_CACHE_KEY);
      sessionStorage.removeItem("analytics_data");
      setCapitalSuccess(true);

      window.dispatchEvent(new CustomEvent("capital-updated"));
      window.dispatchEvent(new CustomEvent("trade-executed"));

      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
      autoCloseTimerRef.current = window.setTimeout(() => {
        setManagingCapital(false);
        setCapitalDelta("");
        setCapitalSuccess(false);
        onClose();
      }, 650);
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
      onWheel={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
      onTouchMove={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
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

        {/* Market Closed Alert */}
        {marketClosed && (
          <div className="tm-market-closed-banner" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div className="tm-market-closed-content">
              <strong>Market is Closed</strong>
              <p>You cannot trade right now because the market is closed. Trading will resume when the market opens.</p>
            </div>
          </div>
        )}

        {/* Available Capital Bar with Add / Withdraw Actions */}
        <div className="tm-capital-bar">
          {!managingCapital ? (
            <div className="tm-capital-display">
              <div className="tm-capital-info">
                <span className="tm-capital-tag">Available Capital</span>
                <strong className="tm-capital-amount">
                  {capitalLoading ? "..." : formatCurrency(availableCapital)}
                </strong>
              </div>
              <div className="tm-capital-action-btns">
                <button
                  type="button"
                  className="tm-btn-cap-pill tm-btn-cap-add"
                  onClick={() => {
                    setManagingCapital(true);
                    setCapitalAction("add");
                    setCapitalDelta("");
                    setCapitalError("");
                  }}
                  title="Add funds to capital"
                >
                  <Plus size={13} aria-hidden="true" />
                  <span>Add Funds</span>
                </button>
                <button
                  type="button"
                  className="tm-btn-cap-pill tm-btn-cap-remove"
                  onClick={() => {
                    setManagingCapital(true);
                    setCapitalAction("remove");
                    setCapitalDelta("");
                    setCapitalError("");
                  }}
                  title="Withdraw / Remove funds from capital"
                >
                  <Minus size={13} aria-hidden="true" />
                  <span>Withdraw</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="tm-capital-manager">
              <div className="tm-cap-manager-header">
                <div className="tm-cap-toggle-group">
                  <button
                    type="button"
                    className={`tm-cap-toggle ${capitalAction === "add" ? "active add" : ""}`}
                    onClick={() => {
                      setCapitalAction("add");
                      setCapitalError("");
                    }}
                  >
                    <Plus size={13} aria-hidden="true" />
                    <span>Add Funds</span>
                  </button>
                  <button
                    type="button"
                    className={`tm-cap-toggle ${capitalAction === "remove" ? "active remove" : ""}`}
                    onClick={() => {
                      setCapitalAction("remove");
                      setCapitalError("");
                    }}
                  >
                    <Minus size={13} aria-hidden="true" />
                    <span>Withdraw Funds</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="tm-cap-close-btn"
                  onClick={() => {
                    setManagingCapital(false);
                    setCapitalDelta("");
                    setCapitalError("");
                  }}
                  aria-label="Close capital manager"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="tm-cap-manager-row">
                <div className="tm-cap-input-wrap">
                  <span className="tm-cap-currency">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="Enter amount"
                    className="tm-cap-amount-input"
                    value={capitalDelta}
                    onChange={(e) => {
                      setCapitalDelta(e.target.value);
                      if (capitalError) setCapitalError("");
                    }}
                    autoFocus
                  />
                </div>

                <div className="tm-cap-calc-preview">
                  <span className="tm-cap-calc-label">
                    {capitalAction === "add" ? "New Capital:" : "Remaining:"}
                  </span>
                  <strong className={`tm-cap-calc-val ${capitalAction === "add" ? "val-add" : "val-remove"}`}>
                    {formatCurrency(previewNewCapital)}
                  </strong>
                </div>

                <div className="tm-cap-actions">
                  <button
                    type="button"
                    className="tm-btn-cap-confirm"
                    onClick={() => void handleSaveCapital()}
                    disabled={capitalSaving || capitalSuccess || deltaVal <= 0 || (capitalAction === "remove" && deltaVal > availableCapital)}
                  >
                    {capitalSuccess
                      ? "Success! Closing…"
                      : capitalSaving
                      ? "Processing…"
                      : capitalAction === "add"
                      ? `Confirm +${deltaVal > 0 ? formatCurrency(deltaVal) : ""}`
                      : `Confirm -${deltaVal > 0 ? formatCurrency(deltaVal) : ""}`}
                  </button>
                  <button
                    type="button"
                    className="tm-btn-cap-cancel"
                    onClick={() => {
                      setManagingCapital(false);
                      setCapitalDelta("");
                      setCapitalError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {capitalError && (
                <div className="tm-cap-error" role="alert">
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>{capitalError}</span>
                </div>
              )}
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
            {candidateStock && candidateAnalysis && (
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
                    <div className="tm-cand-subtotal-text">
                      <strong>{formatCurrency(candidateAnalysis.nominalSubtotal)}</strong>
                      {candidateAnalysis.marginToFreeze > 0 && (
                        <span className="tm-cand-deduction-hint">
                          Margin: {formatCurrency(candidateAnalysis.marginToFreeze)} (20%)
                        </span>
                      )}
                    </div>
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

                {/* Sell Action Context Hint (Holdings vs Short Sell) */}
                {candidateAction === "sell" && (
                  <div className="tm-cand-status-row">
                    {candidateAnalysis.isShort ? (
                      <div className="tm-cand-short-alert">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>
                          <strong>Short Sell:</strong> You hold 0 shares of {candidateStock.ticker}. 20% margin ({formatCurrency(candidateAnalysis.marginToFreeze)}) will be frozen from your capital. Short sell proceeds are not credited to purchasing power.
                        </span>
                      </div>
                    ) : candidateAnalysis.isPartialShort ? (
                      <div className="tm-cand-short-alert">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>
                          <strong>Partial Short:</strong> Selling {candidateAnalysis.regularQty} held shares (+{formatCurrency(candidateAnalysis.regularCredit)} credited) + {candidateAnalysis.shortQty} shorted shares ({formatCurrency(candidateAnalysis.marginToFreeze)} margin frozen from capital).
                        </span>
                      </div>
                    ) : (
                      <div className="tm-cand-held-info">
                        <CheckCircle2 size={13} aria-hidden="true" />
                        <span>Holding {candidateAnalysis.availableHeld} shares available. 100% sale proceeds (+{formatCurrency(candidateAnalysis.regularCredit)}) credited.</span>
                      </div>
                    )}
                  </div>
                )}
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

          {tradeStatus === "success" ? (
            <div className="tm-basket-success-state">
              <CheckCircle2 size={32} className="tm-basket-success-icon" aria-hidden="true" />
              <p className="tm-basket-success-title">Order Execution Completed</p>
              <p className="tm-basket-success-desc">
                {lastExecutedCount > 0
                  ? `Successfully executed ${lastExecutedCount} order${lastExecutedCount !== 1 ? "s" : ""}. Your basket has been cleared.`
                  : "All orders executed. Basket cleared."}
              </p>
            </div>
          ) : basket.length === 0 ? (
            <div className="tm-basket-empty">
              <p>Your basket is empty. Search a stock above to add buy and sell orders together.</p>
              <button
                type="button"
                className="tm-btn-import-sug"
                onClick={async () => {
                  const sugs = await fetchDailySuggestions(allStocks);
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
              {basketAnalysis.items.map((item) => {
                return (
                  <div
                    key={item.id}
                    className={`tm-basket-row tm-row-${item.action}${item.isShort ? " tm-row-short" : ""}`}
                  >
                    <div className="tm-row-action-tag">
                      {item.action === "buy" ? (
                        <span className="tm-badge tm-badge-buy">BUY</span>
                      ) : item.isShort ? (
                        <span className="tm-badge tm-badge-short" title="Short Sell (20% margin frozen from capital)">
                          SHORT
                        </span>
                      ) : item.isPartialShort ? (
                        <span className="tm-badge tm-badge-partial" title="Partial short sell">
                          PARTIAL
                        </span>
                      ) : (
                        <span className="tm-badge tm-badge-sell">SELL</span>
                      )}
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
                      {item.action === "buy" ? (
                        <strong>{formatCurrency(item.nominalSubtotal)}</strong>
                      ) : item.isShort ? (
                        <>
                          <strong className="tm-stat-amber">{formatCurrency(item.nominalSubtotal)}</strong>
                          <small className="tm-row-margin-hint">
                            Margin: {formatCurrency(item.marginToFreeze)}
                          </small>
                        </>
                      ) : item.isPartialShort ? (
                        <>
                          <strong className="tm-stat-green">+{formatCurrency(item.creditedAmount)}</strong>
                          <small className="tm-row-margin-hint">
                            Margin: {formatCurrency(item.marginToFreeze)}
                          </small>
                        </>
                      ) : (
                        <strong className="tm-stat-green">+{formatCurrency(item.nominalSubtotal)}</strong>
                      )}
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
        </div>

        {/* Section 3: Net Financial Breakdown (Buys - Regular Sells + 20% Margin Freeze) */}
        {basket.length > 0 && (
          <div className="tm-section tm-summary-section">
            <div className="tm-summary-grid tm-summary-grid-4">
              <div className="tm-summary-stat">
                <span>Total Buys</span>
                <strong>{formatCurrency(totalBuy)}</strong>
              </div>
              <div className="tm-summary-stat">
                <span>Holdings Sold</span>
                <strong className="tm-stat-green">+{formatCurrency(regularSell)}</strong>
              </div>
              <div className="tm-summary-stat tm-stat-short-box">
                <div className="tm-stat-header-row">
                  <span>Margin Frozen (20%)</span>
                  {shortMarginToFreeze > 0 && (
                    <span className="tm-stat-chip-deduction">20% Collateral</span>
                  )}
                </div>
                <strong className={shortMarginToFreeze > 0 ? "tm-stat-amber" : ""}>
                  {formatCurrency(shortMarginToFreeze)}
                </strong>
                {shortSellNominal > 0 && (
                  <span className="tm-stat-gross-hint">
                    Gross Short: {formatCurrency(shortSellNominal)}
                  </span>
                )}
              </div>
              <div className="tm-summary-stat tm-stat-net">
                <span>Net Required</span>
                <strong>{formatCurrency(Math.max(0, netRequired))}</strong>
                {netRequired < 0 && (
                  <span className="tm-stat-gross-hint tm-stat-green">
                    Net Credit: +{formatCurrency(Math.abs(netRequired))}
                  </span>
                )}
              </div>
            </div>

            {/* 20% Short Selling Notice Banner */}
            {shortSellNominal > 0 && (
              <div className="tm-short-deduction-banner" role="note">
                <div className="tm-short-banner-icon">
                  <Info size={16} aria-hidden="true" />
                </div>
                <div className="tm-short-banner-content">
                  <div className="tm-short-banner-title">
                    <strong>20% Short Selling Margin: {formatCurrency(shortMarginToFreeze)} Frozen from Capital</strong>
                    <span className="tm-short-badge-small">Collateral Lock</span>
                  </div>
                  <p>
                    Short sale proceeds are not credited to your purchasing power. A 20% margin ({formatCurrency(shortMarginToFreeze)}) is frozen from your available capital as security for {formatCurrency(shortSellNominal)} in open short positions.
                  </p>
                </div>
              </div>
            )}

            {/* Validation feedback */}
            {isOverCapital ? (
              <div className="tm-error" role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                <div>
                  <strong>Shortfall of {formatCurrency(shortfall)}</strong>
                  <p>
                    Net capital required ({formatCurrency(netRequired)}) exceeds your available capital ({formatCurrency(availableCapital)}) (including {formatCurrency(shortMarginToFreeze)} margin frozen for short positions).{" "}
                    Add owned sell orders of at least {formatCurrency(shortfall)}, or{" "}
                    <button
                      type="button"
                      className="tm-inline-btn"
                      onClick={() => {
                        setManagingCapital(true);
                        setCapitalAction("add");
                        setCapitalDelta(String(Math.ceil(shortfall)));
                        setCapitalError("");
                      }}
                    >
                      add funds to capital
                    </button>{" "}
                    to proceed.
                  </p>
                </div>
              </div>
            ) : netRequired <= 0 && regularSell > totalBuy ? (
              <div className="tm-net-positive" role="status">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>
                  Net credit of {formatCurrency(Math.abs(netRequired))} from owned stock sales will be added to your balance upon execution.
                </span>
              </div>
            ) : (
              <div className="tm-net-balanced" role="status">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>
                  Net capital needed: {formatCurrency(netRequired)}. Usable capital after trade:{" "}
                  {formatCurrency(postTradeBalance)}{shortMarginToFreeze > 0 ? ` (${formatCurrency(shortMarginToFreeze)} locked as margin)` : ""}.
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
              <p>Executed {lastExecutedCount} order{lastExecutedCount !== 1 ? "s" : ""}. Basket cleared and capital updated.</p>
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
                title={marketClosed ? "Market is closed. Cannot place orders." : undefined}
              >
                {marketClosed ? (
                  "Market Closed"
                ) : tradeStatus === "submitting" ? (
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
