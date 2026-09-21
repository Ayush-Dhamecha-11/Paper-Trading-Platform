import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { Stock } from "../../data/stocksData";
import {
  formatChangePercent,
  formatCurrency,
  formatVolume,
} from "../../utils/formatters";
import "./StockTable.css";

type SortKey = "ticker" | "name" | "price" | "changePct" | "open" | "close" | "volume";

type SortDirection = "asc" | "desc";

type SortState = {
  key: SortKey;
  direction: SortDirection;
};

const SORTABLE_COLUMNS: ReadonlyArray<{
  key: SortKey;
  label: string;
  align: "left" | "right";
}> = [
  { key: "ticker", label: "Ticker", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "price", label: "Current Price", align: "right" },
  { key: "changePct", label: "Change %", align: "right" },
  { key: "open", label: "Open", align: "right" },
  { key: "close", label: "Close", align: "right" },
  { key: "volume", label: "Volume", align: "right" },
];

const SORT_OPTIONS: ReadonlyArray<{
  key: SortKey;
  label: string;
}> = [
  { key: "ticker", label: "Ticker" },
  { key: "name", label: "Name" },
  { key: "price", label: "Current price" },
  { key: "changePct", label: "Percentage change" },
  { key: "open", label: "Open price" },
  { key: "close", label: "Close price" },
  { key: "volume", label: "Volume" },
];

function compareRows(left: Stock, right: Stock, key: SortKey): number {
  const leftValue = left[key];
  const rightValue = right[key];

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue));
}

function SortDirectionIcon({
  columnKey,
  sort,
}: Readonly<{
  columnKey: SortKey;
  sort: SortState;
}>) {
  if (sort.key !== columnKey) {
    return <ChevronsUpDown size={14} aria-hidden="true" />;
  }

  return sort.direction === "asc" ? (
    <ChevronUp size={14} aria-hidden="true" />
  ) : (
    <ChevronDown size={14} aria-hidden="true" />
  );
}

export default function StockTable({
  stocks,
  title = "Stock Universe",
  subtitle = "Browse all stocks available on the platform",
  visibleRows = 8,
}: Readonly<{
  stocks: Stock[];
  title?: string;
  subtitle?: string;
  visibleRows?: number;
}>) {
  const [query, setQuery] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [sectorQuery, setSectorQuery] = useState("");
  const [sectorMenuOpen, setSectorMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "ticker", direction: "asc" });
  const sectorMenuRef = useRef<HTMLDetailsElement | null>(null);
  const sortMenuRef = useRef<HTMLDetailsElement | null>(null);

  const allSectors = useMemo(
    () => Array.from(new Set(stocks.map((stock) => stock.sector))).sort(),
    [stocks]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sectorMenuRef.current &&
        event.target instanceof Node &&
        !sectorMenuRef.current.contains(event.target)
      ) {
        setSectorMenuOpen(false);
      }

      if (
        sortMenuRef.current &&
        event.target instanceof Node &&
        !sortMenuRef.current.contains(event.target)
      ) {
        setSortMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visibleSectors = useMemo(() => {
    const normalizedSectorQuery = sectorQuery.trim().toLowerCase();
    return allSectors.filter((sectorName) =>
      sectorName.toLowerCase().includes(normalizedSectorQuery)
    );
  }, [allSectors, sectorQuery]);

  const filteredStocks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = stocks.filter((stock) => {
      const matchesSector =
        selectedSectors.length === 0 || selectedSectors.includes(stock.sector);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        stock.ticker.toLowerCase().includes(normalizedQuery) ||
        stock.name.toLowerCase().includes(normalizedQuery);

      return matchesSector && matchesQuery;
    });

    return [...filtered].sort((left, right) => {
      const comparison = compareRows(left, right, sort.key);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [stocks, query, selectedSectors, sort]);

  const handleSectorToggle = (sectorName: string) => {
    setSelectedSectors((current) =>
      current.includes(sectorName)
        ? current.filter((selectedSector) => selectedSector !== sectorName)
        : [...current, sectorName]
    );
  };

  const handleSort = (columnKey: SortKey) => {
    setSort((current) => {
      if (current.key === columnKey) {
        return {
          key: columnKey,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      return { key: columnKey, direction: "asc" };
    });
  };

  const handleReset = () => {
    setQuery("");
    setSelectedSectors([]);
    setSort({ key: "ticker", direction: "asc" });
  };

  const hasActiveControls =
    query.trim().length > 0 ||
    selectedSectors.length > 0 ||
    sort.key !== "ticker" ||
    sort.direction !== "asc";

  return (
    <section className="stock-table-panel" aria-labelledby="stock-table-title">
      <div className="stock-table-header">
        <div>
          <h2 id="stock-table-title">{title}</h2>
          <p>{subtitle}</p>
        </div>

        {/* <span className="stock-count-badge">
          {filteredStocks.length} / {stocks.length} stocks
        </span> */}
      </div>

      <div className="stock-table-controls">
        <label className="stock-table-search" htmlFor="stock-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search stocks</span>
          <input
            id="stock-search"
            type="search"
            placeholder="Search by ticker or name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <details
          ref={sectorMenuRef}
          className="stock-sector-multiselect"
          open={sectorMenuOpen}
          onToggle={(event) => setSectorMenuOpen(event.currentTarget.open)}
        >
          <summary onClick={(event) => {
            event.preventDefault();
            setSectorMenuOpen((current) => !current);
          }}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>
              {selectedSectors.length === 0
                ? "All sectors"
                : `${selectedSectors.length} sectors`}
            </span>
          </summary>

          <div className="stock-sector-menu">
            <div className="stock-sector-menu-header">
              <span>Sector filter</span>
              <button
                type="button"
                className="stock-menu-reset"
                onClick={() => {
                  setSelectedSectors([]);
                  setSectorQuery("");
                }}
                disabled={selectedSectors.length === 0}
              >
                Reset
              </button>
            </div>

            <label className="stock-menu-search" htmlFor="sector-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Search sectors</span>
              <input
                id="sector-search"
                type="search"
                placeholder="Search sectors"
                value={sectorQuery}
                onChange={(event) => setSectorQuery(event.target.value)}
              />
            </label>

            {visibleSectors.map((sectorName) => {
              const isSelected = selectedSectors.includes(sectorName);

              return (
                <label key={sectorName} className="stock-sector-option">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleSectorToggle(sectorName)}
                  />
                  <span className={isSelected ? "checked" : ""}>
                    {isSelected && <Check size={14} aria-hidden="true" />}
                  </span>
                  {sectorName}
                </label>
              );
            })}

            {visibleSectors.length === 0 && (
              <p className="stock-menu-empty">No sectors found.</p>
            )}
          </div>
        </details>

        <details
          ref={sortMenuRef}
          className="stock-sort-select"
          open={sortMenuOpen}
          onToggle={(event) => setSortMenuOpen(event.currentTarget.open)}
        >
          <summary onClick={(event) => {
            event.preventDefault();
            setSortMenuOpen((current) => !current);
          }}>
            <ChevronsUpDown size={16} aria-hidden="true" />
            <span>Sort by {SORT_OPTIONS.find((option) => option.key === sort.key)?.label}</span>
          </summary>

          <div className="stock-sort-menu" role="listbox" aria-label="Sort by">
            <div className="stock-sort-menu-header">Sort by</div>
            {SORT_OPTIONS.map((option) => {
              const isSelected = sort.key === option.key;

              return (
                <button
                  key={option.key}
                  type="button"
                  className={`stock-sort-option${isSelected ? " selected" : ""}`}
                  onClick={() => {
                    setSort((current) => ({ ...current, key: option.key }));
                    setSortMenuOpen(false);
                  }}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </details>

        <div className="stock-sort-direction" aria-label="Sort direction">
          <button
            type="button"
            className={sort.direction === "asc" ? "active" : ""}
            onClick={() => setSort((current) => ({ ...current, direction: "asc" }))}
            aria-pressed={sort.direction === "asc"}
          >
            <ArrowUpNarrowWide size={15} aria-hidden="true" />
            <span>Asc</span>
          </button>
          <button
            type="button"
            className={sort.direction === "desc" ? "active" : ""}
            onClick={() => setSort((current) => ({ ...current, direction: "desc" }))}
            aria-pressed={sort.direction === "desc"}
          >
            <ArrowDownWideNarrow size={15} aria-hidden="true" />
            <span>Desc</span>
          </button>
        </div>

        {hasActiveControls && (
          <button type="button" className="stock-table-reset" onClick={handleReset}>
            Reset
          </button>
        )}
      </div>

      <div className="stock-table-scroll" style={{ "--visible-rows": visibleRows } as CSSProperties}>
        {filteredStocks.length === 0 ? (
          <div className="stock-table-empty">
            <p>No stocks match your search.</p>
            <button type="button" onClick={handleReset}>
              Clear filters
            </button>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                {SORTABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.align === "right" ? "col-right" : "col-left"}
                    aria-sort={
                      sort.key === column.key
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="stock-table-sort"
                      onClick={() => handleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <SortDirectionIcon columnKey={column.key} sort={sort} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map((stock) => {
                const changeClass =
                  stock.changePct > 0
                    ? "change-up"
                    : stock.changePct < 0
                      ? "change-down"
                      : "change-flat";

                return (
                  <tr key={stock.ticker}>
                    <td className="stock-ticker">
                      <strong>{stock.ticker}</strong>
                    </td>
                    <td className="stock-name">
                      <strong>{stock.name}</strong>
                      <span>{stock.sector}</span>
                    </td>
                    <td className="col-right">{formatCurrency(stock.price)}</td>
                    <td className={`col-right ${changeClass}`}>
                      {formatChangePercent(stock.changePct)}
                    </td>
                    <td className="col-right">{formatCurrency(stock.open)}</td>
                    <td className="col-right">{formatCurrency(stock.close)}</td>
                    <td className="col-right">{formatVolume(stock.volume)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
