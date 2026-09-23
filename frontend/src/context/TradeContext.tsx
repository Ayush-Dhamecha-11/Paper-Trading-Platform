import { createContext, useContext, useState, type ReactNode } from "react";

/** Minimal stock info needed to pre-fill a single stock trade. */
export type TradeTarget = {
  ticker: string;
  name: string;
  price: number;
} | null;

/** Item to preload into the trade modal basket (e.g. from suggestions). */
export type InitialBasketItem = {
  ticker: string;
  name: string;
  price: number;
  action: "buy" | "sell";
  quantity: number;
};

type TradeModalContextValue = {
  isOpen: boolean;
  prefilledStock: TradeTarget;
  prefilledAction: "buy" | "sell";
  initialBasket: InitialBasketItem[];
  openTrade: (stock?: TradeTarget, action?: "buy" | "sell") => void;
  openTradeWithBasket: (basket: InitialBasketItem[]) => void;
  closeTrade: () => void;
};

const TradeModalContext = createContext<TradeModalContextValue>({
  isOpen: false,
  prefilledStock: null,
  prefilledAction: "buy",
  initialBasket: [],
  openTrade: () => {},
  openTradeWithBasket: () => {},
  closeTrade: () => {},
});

export function TradeModalProvider({ children }: { readonly children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefilledStock, setPrefilledStock] = useState<TradeTarget>(null);
  const [prefilledAction, setPrefilledAction] = useState<"buy" | "sell">("buy");
  const [initialBasket, setInitialBasket] = useState<InitialBasketItem[]>([]);

  const openTrade = (stock?: TradeTarget, action?: "buy" | "sell") => {
    setPrefilledStock(stock ?? null);
    setPrefilledAction(action ?? "buy");
    setInitialBasket([]);
    setIsOpen(true);
  };

  const openTradeWithBasket = (basket: InitialBasketItem[]) => {
    setPrefilledStock(null);
    setPrefilledAction("buy");
    setInitialBasket(basket);
    setIsOpen(true);
  };

  const closeTrade = () => {
    setIsOpen(false);
    setPrefilledStock(null);
    setPrefilledAction("buy");
    setInitialBasket([]);
  };

  return (
    <TradeModalContext.Provider
      value={{
        isOpen,
        prefilledStock,
        prefilledAction,
        initialBasket,
        openTrade,
        openTradeWithBasket,
        closeTrade,
      }}
    >
      {children}
    </TradeModalContext.Provider>
  );
}

/** Use inside any component to open/close the global trade modal. */
export function useTradeModal() {
  return useContext(TradeModalContext);
}
