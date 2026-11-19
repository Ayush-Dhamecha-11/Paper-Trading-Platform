import { useEffect, useMemo, useState, useRef } from "react";
import Header from "../components/Header";
import {
  formatCurrency,
  formatChangePercent,
} from "../utils/formatters";
import { getStoredUserInfo, logoutUser } from "../utils/authUtils";
import { trackAction, useResetStuckAction } from "../utils/actionWatchdog";
import {
  runSimulation,
  validateSimulationParams,
  getDefaultSimulationDates,
  getMaxSimulationEndDate,
  formatDateToISO,
  formatSimulationWeight,
  MIN_SIMULATION_START_DATE,
  getSavedSimulationParams,
  saveSimulationParams,
  getSavedSimulationResult,
  inFlightSimulationPromise,
  inFlightSimulationParams,
  type SimulationExecutionResult,
  type SimulationDailyRecord,
} from "../utils/simulationUtils";
import {
  Play,
  RefreshCw,
  AlertCircle,
  Info,
  Calendar,
  Layers,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
} from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import "../pages_css/simulation.css";

// Register Chart.js modules
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

export default function SimulationPage() {
  const [userInfo, setUserInfo] = useState(() => {
    const stored = getStoredUserInfo();
    return {
      name: stored?.name?.trim() || "User",
      email: stored?.email?.trim() || "--",
    };
  });

  const defaults = useMemo(() => getDefaultSimulationDates(), []);
  const maxAllowedDateStr = useMemo(() => formatDateToISO(getMaxSimulationEndDate(2)), []);
  const savedParams = useMemo(() => getSavedSimulationParams(), []);
  const savedResult = useMemo(() => getSavedSimulationResult(), []);

  const [startDate, setStartDate] = useState(savedParams?.startDate ?? defaults.startDate);
  const [endDate, setEndDate] = useState(savedParams?.endDate ?? defaults.endDate);
  const [capital, setCapital] = useState<number>(savedParams?.capital ?? defaults.defaultCapital);
  const [modelName, setModelName] = useState<string>(savedParams?.modelName ?? defaults.defaultModel);
  const [loading, setLoading] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationExecutionResult | null>(savedResult);

  // View state: "floored" (real execution) or "ideal" (theoretical fractional shares)
  const [executionTier, setExecutionTier] = useState<"floored" | "ideal">("floored");

  // Chart view toggle: "both" | "floored" | "ideal" | "error_loss"
  const [chartCurveView, setChartCurveView] = useState<"both" | "floored" | "ideal" | "error_loss">("both");

  // Selected date for viewing daily stock positions (defaults to latest available)
  const [selectedDayDate, setSelectedDayDate] = useState<string>("");

  // Custom dropdown state for day picker (ensures dropdown opens downwards, not upwards)
  const [dayDropdownOpen, setDayDropdownOpen] = useState(false);
  const dayDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!dayDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dayDropdownRef.current && !dayDropdownRef.current.contains(e.target as Node)) {
        setDayDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDayDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    if (selectedOptionRef.current) {
      selectedOptionRef.current.scrollIntoView({ block: "nearest" });
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dayDropdownOpen]);

  // Auto-recover simulation button if action times out or is cancelled
  useResetStuckAction(() => {
    setLoading(false);
  });

  const handleLogout = async () => {
    await logoutUser({ redirectTo: "/login" });
  };

  const executeSimulation = async (
    start: string = startDate,
    end: string = endDate,
    cap: number = capital,
    model: string = modelName
  ) => {
    const validation = validateSimulationParams(start, end, cap);
    if (!validation.valid) {
      setValidationError(validation.error || "Invalid parameters");
      return;
    }

    setValidationError(null);
    setLoading(true);

    try {
      await trackAction(
        "Run Model Simulation",
        async () => {
          const res = await runSimulation({
            start_date: start,
            end_date: end,
            initial_capital: cap,
            model_name: model,
          });
          setResult(res);

          if (res.daily && res.daily.length > 0) {
            setSelectedDayDate(res.daily[res.daily.length - 1].date);
          }
        },
        {
          onError: (err) => {
            setValidationError(err instanceof Error ? err.message : "Simulation failed to execute.");
          },
        }
      );
    } catch {
      // Handled in onError
    } finally {
      setLoading(false);
    }
  };

  // Run initial simulation or restore in-flight / cached simulation
  useEffect(() => {
    // 1. If an in-flight simulation is already running (e.g. user started it and switched pages):
    if (inFlightSimulationPromise && inFlightSimulationParams) {
      setLoading(true);
      setStartDate(inFlightSimulationParams.startDate);
      setEndDate(inFlightSimulationParams.endDate);
      setCapital(inFlightSimulationParams.capital);
      setModelName(inFlightSimulationParams.modelName);

      inFlightSimulationPromise
        .then((res) => {
          setResult(res);
          if (res.daily && res.daily.length > 0) {
            setSelectedDayDate(res.daily[res.daily.length - 1].date);
          }
        })
        .catch((err) => {
          setValidationError(err instanceof Error ? err.message : "Simulation failed to execute.");
        })
        .finally(() => {
          setLoading(false);
        });
      return;
    }

    // 2. If a result is already saved from a previous user run, DO NOT rerun with default dates!
    if (savedResult) {
      if (savedResult.daily && savedResult.daily.length > 0) {
        setSelectedDayDate(savedResult.daily[savedResult.daily.length - 1].date);
      }
      return;
    }

    // 3. Only run initial default simulation if user has never run a simulation this session
    void executeSimulation(defaults.startDate, defaults.endDate, defaults.defaultCapital, defaults.defaultModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTierSummary = useMemo(() => {
    if (!result?.summary) return null;
    return result.summary[executionTier];
  }, [result, executionTier]);

  const selectedDayRecord: SimulationDailyRecord | null = useMemo(() => {
    if (!result?.daily || result.daily.length === 0) return null;
    if (!selectedDayDate) return result.daily[result.daily.length - 1];
    return result.daily.find((d) => d.date === selectedDayDate) ?? result.daily[result.daily.length - 1];
  }, [result, selectedDayDate]);

  const simDateRange = useMemo(() => {
    if (!result?.daily || result.daily.length === 0) {
      return { min: "", max: "" };
    }
    return {
      min: result.daily[0].date,
      max: result.daily[result.daily.length - 1].date,
    };
  }, [result]);

  const currentDayIndex = useMemo(() => {
    if (!result?.daily || !selectedDayRecord) return -1;
    return result.daily.findIndex((d) => d.date === selectedDayRecord.date);
  }, [result, selectedDayRecord]);

  const handlePrevDay = () => {
    if (!result?.daily || currentDayIndex <= 0) return;
    setSelectedDayDate(result.daily[currentDayIndex - 1].date);
  };

  const handleNextDay = () => {
    if (!result?.daily || currentDayIndex < 0 || currentDayIndex >= result.daily.length - 1) return;
    setSelectedDayDate(result.daily[currentDayIndex + 1].date);
  };

  const handleCalendarDayChange = (pickedDate: string) => {
    if (!pickedDate || !result?.daily || result.daily.length === 0) return;

    // Check if the picked date matches an exact trading day in simulation
    const exactMatch = result.daily.find((d) => d.date === pickedDate);
    if (exactMatch) {
      setSelectedDayDate(exactMatch.date);
      return;
    }

    // If picked date falls on a weekend or holiday, select the closest trading day in the simulation
    const targetTime = new Date(`${pickedDate}T00:00:00`).getTime();
    let closest = result.daily[0];
    let minDiff = Math.abs(new Date(`${closest.date}T00:00:00`).getTime() - targetTime);

    for (let i = 1; i < result.daily.length; i++) {
      const diff = Math.abs(new Date(`${result.daily[i].date}T00:00:00`).getTime() - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = result.daily[i];
      }
    }

    setSelectedDayDate(closest.date);
  };

  const chartData: ChartData<"line"> = useMemo(() => {
    if (!result || !result.daily || result.daily.length === 0) {
      return { labels: [], datasets: [] };
    }

    const labels = result.daily.map((d) => {
      const parsed = new Date(`${d.date}T00:00:00`);
      return parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    });

    const datasets: ChartData<"line">["datasets"] = [];

    if (chartCurveView === "both" || chartCurveView === "floored") {
      datasets.push({
        label: "Floored Equity (Real Execution)",
        data: result.daily.map((d) => d.equity_floored),
        borderColor: "#00d2ff",
        backgroundColor: "rgba(0, 210, 255, 0.12)",
        borderWidth: 2.5,
        pointRadius: result.daily.length > 40 ? 1 : 3,
        pointHoverRadius: 6,
        fill: chartCurveView === "floored",
        tension: 0.32,
      });
    }

    if (chartCurveView === "both" || chartCurveView === "ideal") {
      datasets.push({
        label: "Ideal Equity (Fractional Shares)",
        data: result.daily.map((d) => d.equity_ideal),
        borderColor: "#a855f7",
        backgroundColor: "rgba(168, 85, 247, 0.10)",
        borderWidth: 2,
        borderDash: chartCurveView === "both" ? [5, 4] : undefined,
        pointRadius: result.daily.length > 40 ? 1 : 3,
        pointHoverRadius: 6,
        fill: chartCurveView === "ideal",
        tension: 0.32,
      });
    }

    if (chartCurveView === "error_loss") {
      datasets.push({
        label: "Cumulative Error Loss Slippage (₹)",
        data: result.daily.map((d) => d.cumulative_error_loss),
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245, 158, 11, 0.16)",
        borderWidth: 2.5,
        pointRadius: result.daily.length > 40 ? 1 : 3,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.32,
      });
    }

    return { labels, datasets };
  }, [result, chartCurveView]);

  const chartOptions: ChartOptions<"line"> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            color: "#9fb3c8",
            usePointStyle: true,
            boxWidth: 8,
            font: { size: 11, weight: 600 },
          },
        },
        tooltip: {
          backgroundColor: "rgba(7, 20, 38, 0.96)",
          titleColor: "#b7faff",
          bodyColor: "#f7fbff",
          borderColor: "rgba(126, 243, 255, 0.4)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y ?? 0;
              return ` ${ctx.dataset.label}: ${formatCurrency(val)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#9fb3c8", maxRotation: 0, autoSkip: true, font: { size: 10 } },
          border: { display: false },
        },
        y: {
          grid: { color: "rgba(148, 163, 184, 0.14)" },
          ticks: {
            color: "#9fb3c8",
            callback: (v) => formatCurrency(Number(v)),
            font: { size: 10 },
          },
          border: { display: false },
        },
      },
    };
  }, []);

  return (
    <main className="simulation-page">
      <Header
        userName={userInfo.name}
        userEmail={userInfo.email}
        onLogout={handleLogout}
      />

      <div className="simulation-shell">
        {/* Hero Section */}
        <section className="simulation-hero">
          <div>
            <p className="simulation-kicker">Quantitative Model Backtest</p>
            <h1>Strategy Simulation</h1>
            <p>Backtest machine learning &amp; factor models across historical working day ranges with real integer share execution.</p>
          </div>
          <div className="simulation-badge">
            <span className="simulation-badge-dot" />
            <span>Factor Simulation Engine</span>
          </div>
        </section>

        {/* Controls / Parameters Card */}
        <section className="simulation-controls-panel">
          <div className="simulation-controls-title">
            <h2>Simulation Parameters</h2>
            <span className="simulation-controls-hint">
              <Calendar size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              End date must be at least 2 working days before today (latest allowed: {maxAllowedDateStr})
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void executeSimulation();
            }}
            className="simulation-form-grid"
          >
            <div className="simulation-field">
              <label htmlFor="sim-start-date">Start Date</label>
              <input
                id="sim-start-date"
                type="date"
                value={startDate}
                min={MIN_SIMULATION_START_DATE}
                max={endDate || maxAllowedDateStr}
                onChange={(e) => {
                  const val = e.target.value;
                  setStartDate(val);
                  saveSimulationParams({ startDate: val, endDate, capital, modelName });
                }}
                required
              />
            </div>

            <div className="simulation-field">
              <label htmlFor="sim-end-date">End Date</label>
              <input
                id="sim-end-date"
                type="date"
                value={endDate}
                min={startDate || MIN_SIMULATION_START_DATE}
                max={maxAllowedDateStr}
                onChange={(e) => {
                  const val = e.target.value;
                  setEndDate(val);
                  saveSimulationParams({ startDate, endDate: val, capital, modelName });
                }}
                required
              />
            </div>

            <div className="simulation-field">
              <label htmlFor="sim-capital">Initial Capital (₹)</label>
              <input
                id="sim-capital"
                type="number"
                min="1000"
                step="any"
                value={capital === 0 ? "" : capital}
                onChange={(e) => {
                  const val = e.target.value;
                  const num = val === "" ? 0 : Number(val);
                  setCapital(num);
                  saveSimulationParams({ startDate, endDate, capital: num, modelName });
                }}
                required
              />
              <div className="simulation-capital-presets">
                <button
                  type="button"
                  className="simulation-preset-btn"
                  onClick={() => {
                    setCapital(100000);
                    saveSimulationParams({ startDate, endDate, capital: 100000, modelName });
                  }}
                >
                  ₹1L
                </button>
                <button
                  type="button"
                  className="simulation-preset-btn"
                  onClick={() => {
                    setCapital(500000);
                    saveSimulationParams({ startDate, endDate, capital: 500000, modelName });
                  }}
                >
                  ₹5L
                </button>
                <button
                  type="button"
                  className="simulation-preset-btn"
                  onClick={() => {
                    setCapital(1000000);
                    saveSimulationParams({ startDate, endDate, capital: 1000000, modelName });
                  }}
                >
                  ₹10L
                </button>
                <button
                  type="button"
                  className="simulation-preset-btn"
                  onClick={() => {
                    setCapital(2500000);
                    saveSimulationParams({ startDate, endDate, capital: 2500000, modelName });
                  }}
                >
                  ₹25L
                </button>
              </div>
            </div>

            <div className="simulation-field">
              <label htmlFor="sim-model">Model Architecture</label>
              <select
                id="sim-model"
                value={modelName}
                onChange={(e) => {
                  const val = e.target.value;
                  setModelName(val);
                  saveSimulationParams({ startDate, endDate, capital, modelName: val });
                }}
              >
                <option value="attention_factor_longconv">attention_factor_longconv (Default)</option>
              </select>
            </div>

            <div className="simulation-submit-col">
              <button
                type="submit"
                className="simulation-run-btn"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw size={16} className="simulation-spin" />
                    <span>Running Backtest…</span>
                  </>
                ) : (
                  <>
                    <Play size={16} fill="currentColor" />
                    <span>Run Simulation</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {validationError && (
            <div className="simulation-error-box" role="alert">
              <AlertCircle size={16} />
              <span>{validationError}</span>
            </div>
          )}
        </section>

        {/* Demo Fallback Notice */}
        {result?.isDemoFallback && (
          <div className="simulation-demo-notice">
            <Info size={16} />
            <span>
              <strong>Demo Simulation Mode:</strong> Backend endpoint <code>POST /api/simulation/run</code> returned offline/unreachable; results are rendered by the client-side simulation engine matching the live schema.
            </span>
          </div>
        )}

        {/* Results Sections */}
        {result && activeTierSummary && (
          <>
            {/* Tier Switcher & Model Summary Meta */}
            <div className="simulation-tier-switcher-wrap">
              <div className="simulation-tier-tabs" role="tablist" aria-label="Execution Mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={executionTier === "floored"}
                  className={`simulation-tier-tab ${executionTier === "floored" ? "active" : ""}`}
                  onClick={() => setExecutionTier("floored")}
                  title="Real-world integer share execution with cash drag"
                >
                  <CheckCircle2 size={14} />
                  <span>Floored Execution (Real)</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={executionTier === "ideal"}
                  className={`simulation-tier-tab ${executionTier === "ideal" ? "active ideal-active" : ""}`}
                  onClick={() => setExecutionTier("ideal")}
                  title="Theoretical execution with fractional shares"
                >
                  <Layers size={14} />
                  <span>Ideal Benchmark (Fractional)</span>
                </button>
              </div>

              <div className="simulation-tier-meta">
                <span>Model: <strong>{result.model_name || modelName}</strong></span>
                <span>Trading Days: <strong>{result.trading_days} Days</strong></span>
                <span>Period: <strong>{result.requested_start} to {result.requested_end}</strong></span>
              </div>
            </div>

            {/* Summary Metric Cards (Matching Dashboard stats) */}
            <section className="simulation-stat-grid" aria-label="Simulation summary statistics">
              <div className="simulation-stat-card accent">
                <span className="stat-label">Portfolio Value (Final Equity)</span>
                <strong className="stat-value">{formatCurrency(activeTierSummary.final_equity)}</strong>
                <small className="stat-note">
                  Initial Capital: {formatCurrency(result.initial_capital)}
                </small>
              </div>

              <div className={`simulation-stat-card ${activeTierSummary.total_return_pct >= 0 ? "positive" : "negative"}`}>
                <span className="stat-label">Total Profit / Loss</span>
                <strong className={`stat-value ${activeTierSummary.total_return_pct >= 0 ? "positive" : "negative"}`}>
                  {activeTierSummary.total_return_pct >= 0 ? "+" : ""}
                  {formatCurrency(activeTierSummary.final_equity - result.initial_capital)}
                </strong>
                <small className="stat-note">
                  {formatChangePercent(activeTierSummary.total_return_pct)} overall return ({activeTierSummary.annualized_return_pct}% annualized)
                </small>
              </div>

              <div className="simulation-stat-card purple">
                <span className="stat-label">Sharpe Ratio &amp; Risk</span>
                <strong className="stat-value">{activeTierSummary.annualized_sharpe.toFixed(2)}</strong>
                <small className="stat-note">
                  Annualized Volatility: {activeTierSummary.annualized_volatility_pct}%
                </small>
              </div>

              <div className="simulation-stat-card warning">
                <span className="stat-label">Error Loss (Cash Drag)</span>
                <strong className="stat-value">
                  {formatCurrency(result.summary.error_loss.total_error_loss_amount)}
                </strong>
                <small className="stat-note">
                  {result.summary.error_loss.total_error_loss_pct}% slippage vs ideal · Mean unallocated: {formatCurrency(result.summary.error_loss.mean_daily_unallocated_cash)}
                </small>
              </div>
            </section>

            {/* Profit Over Time Chart with curve toggles */}
            <section className="simulation-chart-panel">
              <div className="simulation-chart-header">
                <div>
                  <p className="simulation-kicker">Performance Trajectory</p>
                  <h2>Profit Over Time &amp; Equity Curves</h2>
                </div>
                <div className="simulation-chart-toggles">
                  <button
                    type="button"
                    className={`simulation-chart-toggle-btn ${chartCurveView === "both" ? "active" : ""}`}
                    onClick={() => setChartCurveView("both")}
                  >
                    Compare Both
                  </button>
                  <button
                    type="button"
                    className={`simulation-chart-toggle-btn ${chartCurveView === "floored" ? "active" : ""}`}
                    onClick={() => setChartCurveView("floored")}
                  >
                    Floored Only
                  </button>
                  <button
                    type="button"
                    className={`simulation-chart-toggle-btn ${chartCurveView === "ideal" ? "active" : ""}`}
                    onClick={() => setChartCurveView("ideal")}
                  >
                    Ideal Only
                  </button>
                  <button
                    type="button"
                    className={`simulation-chart-toggle-btn ${chartCurveView === "error_loss" ? "active" : ""}`}
                    onClick={() => setChartCurveView("error_loss")}
                  >
                    Error Loss Drag
                  </button>
                </div>
              </div>
              <div className="simulation-chart-wrap">
                <Line data={chartData} options={chartOptions} />
              </div>
            </section>

            {/* Daily Stock Allocation Table */}
            {selectedDayRecord && (
              <section className="simulation-table-panel">
                <div className="simulation-table-header">
                  <div>
                    <p className="simulation-kicker">Portfolio Holdings</p>
                    <h2>Daily Stock Allocation &amp; Execution</h2>
                  </div>

                  <div className="simulation-day-selector">
                    <div className="simulation-day-picker-item">
                      <label htmlFor="sim-day-calendar">Calendar:</label>
                      <div className="simulation-calendar-input-wrap">
                        <Calendar size={14} className="simulation-calendar-icon" aria-hidden="true" />
                        <input
                          type="date"
                          id="sim-day-calendar"
                          className="simulation-calendar-picker"
                          aria-label="Select simulation trading date from calendar"
                          min={simDateRange.min}
                          max={simDateRange.max}
                          value={selectedDayRecord.date}
                          onChange={(e) => handleCalendarDayChange(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="simulation-day-stepper" aria-label="Step day by day">
                      <button
                        type="button"
                        className="simulation-step-btn"
                        onClick={handlePrevDay}
                        disabled={currentDayIndex <= 0}
                        title="Previous trading day"
                        aria-label="Previous trading day"
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <span className="simulation-day-counter" title="Current trading day index">
                        {currentDayIndex + 1} / {result.daily.length}
                      </span>
                      <button
                        type="button"
                        className="simulation-step-btn"
                        onClick={handleNextDay}
                        disabled={currentDayIndex >= result.daily.length - 1}
                        title="Next trading day"
                        aria-label="Next trading day"
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="simulation-day-picker-item" ref={dayDropdownRef}>
                      <label id="sim-day-select-label">Trading Day:</label>
                      <div className="simulation-custom-select-wrap">
                        <button
                          type="button"
                          id="sim-day-select"
                          className={`simulation-custom-select-trigger ${dayDropdownOpen ? "open" : ""}`}
                          onClick={() => setDayDropdownOpen((prev) => !prev)}
                          aria-haspopup="listbox"
                          aria-expanded={dayDropdownOpen}
                          aria-labelledby="sim-day-select-label"
                        >
                          <span className="simulation-custom-select-label">
                            #{currentDayIndex + 1} · {selectedDayRecord.date} — {formatCurrency(selectedDayRecord.equity_floored)} ({formatChangePercent(selectedDayRecord.return_floored * 100)})
                          </span>
                          <ChevronDown size={14} className={`simulation-custom-select-arrow ${dayDropdownOpen ? "open" : ""}`} aria-hidden="true" />
                        </button>

                        {dayDropdownOpen && (
                          <div className="simulation-custom-select-dropdown" role="listbox" aria-labelledby="sim-day-select-label">
                            {result.daily.map((d, idx) => {
                              const isSelected = (selectedDayDate || selectedDayRecord.date) === d.date;
                              return (
                                <button
                                  key={d.date}
                                  ref={isSelected ? selectedOptionRef : null}
                                  type="button"
                                  className={`simulation-custom-select-option ${isSelected ? "selected" : ""}`}
                                  role="option"
                                  aria-selected={isSelected}
                                  onClick={() => {
                                    setSelectedDayDate(d.date);
                                    setDayDropdownOpen(false);
                                  }}
                                >
                                  <span className="sim-option-text">
                                    #{idx + 1} · {d.date} — {formatCurrency(d.equity_floored)} ({formatChangePercent(d.return_floored * 100)})
                                  </span>
                                  {isSelected && <Check size={14} className="sim-option-check" aria-hidden="true" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="simulation-table-wrap">
                  <table className="simulation-table">
                    <thead>
                      <tr>
                        <th>Stock</th>
                        <th>Target Weight</th>
                        <th>Quantity (Shares)</th>
                        <th>Price</th>
                        <th>Market Value</th>
                        <th>P/L ({executionTier === "floored" ? "Floored" : "Ideal"})</th>
                        <th>Error Loss PnL</th>
                        <th>Unallocated Cash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDayRecord.stocks.map((stock) => {
                        const pnl = executionTier === "floored" ? stock.pnl_floored : stock.pnl_ideal;
                        const isProfit = pnl >= 0;
                        const marketVal = stock.shares_floored * stock.price;

                        return (
                          <tr key={stock.symbol}>
                            <td>
                              <div className="sim-stock-cell">
                                <strong>{stock.symbol}</strong>
                                <span>{stock.name || stock.symbol} {stock.sector ? `· ${stock.sector}` : ""}</span>
                              </div>
                            </td>
                            <td>
                              <span className="sim-weight-badge">{formatSimulationWeight(stock.weight)}</span>
                            </td>
                            <td>
                              <strong>{stock.shares_floored.toLocaleString("en-IN")}</strong>
                              {stock.diff_shares > 0 && (
                                <span className="sim-fractional-note">
                                  +{stock.diff_shares.toFixed(2)} ideal diff
                                </span>
                              )}
                            </td>
                            <td>{formatCurrency(stock.price)}</td>
                            <td>{formatCurrency(marketVal)}</td>
                            <td className={isProfit ? "sim-positive" : "sim-negative"}>
                              {isProfit ? "+" : ""}{formatCurrency(pnl)}
                            </td>
                            <td className="sim-negative">
                              {stock.error_loss_pnl > 0 ? `-${formatCurrency(stock.error_loss_pnl)}` : "₹0.00"}
                            </td>
                            <td>{formatCurrency(stock.unallocated_cash)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
