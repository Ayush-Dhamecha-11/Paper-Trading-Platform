import { useTradeModal } from "../../context/TradeContext";
import "./TradeFAB.css";

/**
 * Global Floating Action Button — fixed at the bottom-right of every page.
 * Clicking it opens the trade modal with no stock pre-selected so the user
 * can search for any ticker.
 */
export default function TradeFAB() {
  const { openTrade } = useTradeModal();

  return (
    <button
      type="button"
      className="trade-fab"
      aria-label="Open trade panel"
      onClick={() => openTrade()}
    >
      <span className="trade-fab-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </span>
      <span className="trade-fab-label">Trade</span>
    </button>
  );
}
