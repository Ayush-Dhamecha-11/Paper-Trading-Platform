import { authenticatedFetch, getBackendBaseUrl, logBackendResponse } from "./authUtils";

export type SimulationModelName =
  | "attention_factor_longconv"
  | "factor_momentum"
  | "lstm_factor"
  | string;

export type BackendSimulationRequest = {
  start_date: string;
  end_date: string;
  initial_capital: number;
  model_name?: string;
};

export type SimulationStockPosition = {
    symbol: string;
    name?: string;
    sector?: string;
    weight: number; // e.g. 0.15 for 15%
    price: number;
    shares_ideal: number;
    shares_floored: number;
    diff_shares: number;
    unallocated_cash: number;
    pnl_ideal: number;
    pnl_floored: number;
    error_loss_pnl: number;
  };

export type SimulationDailyRecord = {
  date: string;
  equity_ideal: number;
  equity_floored: number;
  return_ideal: number;
  return_floored: number;
  error_loss_pnl: number;
  error_loss_return: number;
  cumulative_error_loss: number;
  unallocated_cash: number;
  unallocated_cash_pct: number;
  stocks: SimulationStockPosition[];
};

export type SimulationPerformanceTier = {
    initial_capital: number;
    final_equity: number;
    total_return_pct: number;
    annualized_return_pct: number;
    annualized_volatility_pct: number;
    annualized_sharpe: number;
  };

export type SimulationErrorLossSummary = {
  total_error_loss_amount: number;
  total_error_loss_pct: number;
  mean_daily_unallocated_cash: number;
  mean_daily_unallocated_cash_pct: number;
};

export type BackendSimulationResponse = {
  status: "success" | string;
  requested_start: string;
  requested_end: string;
  initial_capital: number;
  trading_days: number;
  model_name?: string;
  summary: {
    ideal: SimulationPerformanceTier;
    floored: SimulationPerformanceTier;
    error_loss: SimulationErrorLossSummary;
  };
  daily: SimulationDailyRecord[];
};

export type SimulationExecutionResult = BackendSimulationResponse & {
  isDemoFallback: boolean;
};

/**
 * Checks whether a given Date is on a weekend (Saturday or Sunday).
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Returns the most recent working day (today if weekday, or previous Friday if weekend).
 */
export function getLatestWorkingDay(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (isWeekend(d)) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * Calculates the maximum allowed end date for a simulation:
 * Must be at least 2 working days before today's working day.
 */
export function getMaxSimulationEndDate(workingDaysBack = 2): Date {
  const current = getLatestWorkingDay(new Date());
  let count = 0;
  while (count < workingDaysBack) {
    current.setDate(current.getDate() - 1);
    if (!isWeekend(current)) {
      count++;
    }
  }
  return current;
}

/**
 * Formats a Date object to YYYY-MM-DD string in local time.
 */
export function formatDateToISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const MIN_SIMULATION_START_DATE = "2013-01-01";
export const SIMULATION_PARAMS_STORAGE_KEY = "sim_saved_params";
export const SIMULATION_RESULT_STORAGE_KEY = "sim_saved_result";

export type SavedSimulationParams = {
  startDate: string;
  endDate: string;
  capital: number;
  modelName: string;
};

export function getSavedSimulationParams(): SavedSimulationParams | null {
  try {
    const raw = sessionStorage.getItem(SIMULATION_PARAMS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedSimulationParams;
  } catch {
    return null;
  }
}

export function saveSimulationParams(params: SavedSimulationParams): void {
  try {
    sessionStorage.setItem(SIMULATION_PARAMS_STORAGE_KEY, JSON.stringify(params));
  } catch {
    // ignore
  }
}

export function getSavedSimulationResult(): SimulationExecutionResult | null {
  try {
    const raw = sessionStorage.getItem(SIMULATION_RESULT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SimulationExecutionResult;
  } catch {
    return null;
  }
}

export function saveSimulationResult(result: SimulationExecutionResult): void {
  try {
    sessionStorage.setItem(SIMULATION_RESULT_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // ignore
  }
}

// Module-level in-flight promise to track running simulations across page navigations
export let inFlightSimulationPromise: Promise<SimulationExecutionResult> | null = null;
export let inFlightSimulationParams: SavedSimulationParams | null = null;

/**
 * Validates simulation input parameters:
 * - Start date must be strictly earlier than end date.
 * - Start date cannot be before 1st January 2013.
 * - End date must be on or before the maximum allowed simulation date (at least 2 working days prior).
 * - Capital must be a positive number.
 */
export function validateSimulationParams(
  startDateStr: string,
  endDateStr: string,
  capital: number
): { valid: boolean; error?: string } {
  if (!startDateStr || !endDateStr) {
    return { valid: false, error: "Please select both a start date and an end date." };
  }

  if (startDateStr < MIN_SIMULATION_START_DATE) {
    return {
      valid: false,
      error: "Start date cannot be before 1st January 2013 (backend data begins in 2013).",
    };
  }

  const startDate = new Date(`${startDateStr}T00:00:00`);
  const endDate = new Date(`${endDateStr}T00:00:00`);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { valid: false, error: "Invalid date format. Please select valid dates." };
  }

  if (startDate >= endDate) {
    return {
      valid: false,
      error: "Start date must be earlier than end date.",
    };
  }

  const maxAllowedDate = getMaxSimulationEndDate(2);
  maxAllowedDate.setHours(23, 59, 59, 999);

  if (endDate > maxAllowedDate) {
    const formattedMax = formatDateToISO(maxAllowedDate);
    return {
      valid: false,
      error: `End date must be at least 2 working days before today (latest allowed: ${formattedMax}).`,
    };
  }

  if (capital <= 0 || isNaN(capital)) {
    return { valid: false, error: "Initial capital must be a positive amount." };
  }

  return { valid: true };
}

/**
 * Returns default parameters:
 * - End date: 2 working days ago
 * - Start date: ~92 days before the end date (quarterly simulation window)
 * - Initial Capital: ₹10,00,000 (10 Lakhs)
 * - Model: attention_factor_longconv
 */
  export function getDefaultSimulationDates(): {
    startDate: string;
    endDate: string;
    defaultCapital: number;
    defaultModel: string;
  } {
    const endDateObj = getMaxSimulationEndDate(2);
    const startDateObj = new Date(endDateObj);
    startDateObj.setDate(startDateObj.getDate() - 92);
    while (isWeekend(startDateObj)) {
      startDateObj.setDate(startDateObj.getDate() - 1);
    }

    return {
      startDate: formatDateToISO(startDateObj),
      endDate: formatDateToISO(endDateObj),
      defaultCapital: 1000000,
      defaultModel: "attention_factor_longconv",
    };
  }

  /**
   * Formats a weight value to percentage string:
   * Handles decimal fractions (e.g. 0.15 -> "15.00%") and percentages (e.g. 15 -> "15.00%").
   */
    export function formatSimulationWeight(weight?: number): string {
      if (weight == null || isNaN(weight)) return "--";
      const pct = (weight > 0 && weight <= 1.0) ? weight * 100 : weight;
      return `${pct.toFixed(2)}%`;
    }

    /**
     * Executes simulation via POST /api/simulation/run.
     * If backend fails, is unreachable, or returns an error, seamlessly activates the demo simulation engine.
     * Caches in-flight execution and results so page transitions preserve state.
     */
    export function runSimulation(
      req: BackendSimulationRequest
    ): Promise<SimulationExecutionResult> {
      const currentParams: SavedSimulationParams = {
        startDate: req.start_date,
        endDate: req.end_date,
        capital: req.initial_capital,
        modelName: req.model_name || "attention_factor_longconv",
      };
      saveSimulationParams(currentParams);
      inFlightSimulationParams = currentParams;

      const promise = (async (): Promise<SimulationExecutionResult> => {
        try {
          const backendBaseUrl = getBackendBaseUrl();
          const url = `${backendBaseUrl}/api/simulation/run`;

          const payload: BackendSimulationRequest = {
            start_date: req.start_date,
            end_date: req.end_date,
            initial_capital: req.initial_capital,
            model_name: req.model_name || "attention_factor_longconv",
          };

          let result: SimulationExecutionResult;
          try {
            const response = await authenticatedFetch(
              url,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              },
              "POST /api/simulation/run"
            );

            logBackendResponse(response, "POST /api/simulation/run");

            if (response.ok) {
              const data = (await response.json()) as Partial<BackendSimulationResponse>;
              if (data && data.summary && Array.isArray(data.daily)) {
                result = {
                  status: data.status || "success",
                  requested_start: data.requested_start || req.start_date,
                  requested_end: data.requested_end || req.end_date,
                  initial_capital: data.initial_capital ?? req.initial_capital,
                  trading_days: data.trading_days ?? data.daily.length,
                  model_name: data.model_name || req.model_name,
                  summary: data.summary as BackendSimulationResponse["summary"],
                  daily: data.daily,
                  isDemoFallback: false,
                };
                saveSimulationResult(result);
                return result;
              }
            }
          } catch (error) {
            console.warn("Backend /api/simulation/run unavailable, engaging demo simulation process:", error);
          }

          // Fallback demo simulation process
          result = generateDemoSimulation(payload);
          saveSimulationResult(result);
          return result;
        } finally {
          inFlightSimulationPromise = null;
          inFlightSimulationParams = null;
        }
      })();

      inFlightSimulationPromise = promise;
      return promise;
    }

/**
 * Deterministic pseudo-random generator based on seed string.
 */
function createSeededRandom(seed: string) {
        let h = 1779033703 ^ seed.length;
        for (let i = 0; i < seed.length; i++) {
          h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
          h = (h << 13) | (h >>> 19);
        }
        return () => {
          h = Math.imul(h ^ (h >>> 16), 2246822507);
          h = Math.imul(h ^ (h >>> 13), 3266489909);
          return ((h ^= h >>> 16) >>> 0) / 4294967296;
        };
      }

      /**
       * Generates an institutional-grade demo simulation response matching the exact backend output schema.
       */
        export function generateDemoSimulation(
          req: BackendSimulationRequest
        ): SimulationExecutionResult {
          const { start_date, end_date, initial_capital, model_name = "attention_factor_longconv" } = req;
          const rng = createSeededRandom(`${start_date}_${end_date}_${initial_capital}_${model_name}`);

  const stockPortfolioDefinitions = [
            { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", weight: 0.18, basePrice: 2450.0 },
            { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", weight: 0.16, basePrice: 3820.0 },
            { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking", weight: 0.15, basePrice: 1650.0 },
            { symbol: "INFY", name: "Infosys", sector: "IT", weight: 0.14, basePrice: 1560.0 },
            { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Banking", weight: 0.13, basePrice: 1240.0 },
            { symbol: "ITC", name: "ITC Limited", sector: "FMCG", weight: 0.12, basePrice: 445.0 },
            { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", weight: 0.12, basePrice: 1520.0 },
          ];

          // Calculate working days
          const startObj = new Date(`${start_date}T00:00:00`);
          const endObj = new Date(`${end_date}T00:00:00`);

            const tradingDates: string[] = [];
            const cur = new Date(startObj);
            while (cur <= endObj) {
              if (!isWeekend(cur)) {
                tradingDates.push(formatDateToISO(cur));
              }
              cur.setDate(cur.getDate() + 1);
            }

            const tradingDays = Math.max(1, tradingDates.length);

            // Return targets based on model & duration
            const targetReturnPctIdeal = 14.25 + (rng() - 0.5) * 2.5; // ~13% - 15.5%
            const totalErrorLossPct = 0.63 + (rng() - 0.5) * 0.15; // ~0.55% - 0.70%
            const targetReturnPctFloored = targetReturnPctIdeal - totalErrorLossPct;

              const finalEquityIdeal = Math.round(initial_capital * (1 + targetReturnPctIdeal / 100));
              const finalEquityFloored = Math.round(initial_capital * (1 + targetReturnPctFloored / 100));
              const totalErrorLossAmount = finalEquityIdeal - finalEquityFloored;

              const daily: SimulationDailyRecord[] = [];
              let cumulativeError = 0;
              let runningEquityIdeal = initial_capital;
              let runningEquityFloored = initial_capital;

              for (let dIdx = 0; dIdx < tradingDates.length; dIdx++) {
                const dateStr = tradingDates[dIdx];
                const progress = dIdx / (tradingDays - 1 || 1);

                // Realistic market day return with gentle volatility
                const dayMarketReturn = ((rng() - 0.48) * 0.016) + (targetReturnPctIdeal / 100 / tradingDays);
                const dayErrorLossReturn = 0.0003 + (rng() * 0.0002);
                const dayReturnFloored = dayMarketReturn - dayErrorLossReturn;

                runningEquityIdeal = Math.round(runningEquityIdeal * (1 + dayMarketReturn));
                const dayErrorLossPnl = Math.round(runningEquityIdeal * dayErrorLossReturn);
                cumulativeError += dayErrorLossPnl;
                runningEquityFloored = runningEquityIdeal - cumulativeError;

                // Daily stock breakdown
                let totalUnallocatedCash = 0;
                const stocks: SimulationStockPosition[] = stockPortfolioDefinitions.map((stockDef) => {
                  // Dynamic simulated price progression
                  const priceVariation = 1 + (progress * 0.12) + ((rng() - 0.5) * 0.03);
                  const currentPrice = Math.round(stockDef.basePrice * priceVariation * 10) / 10;

                const allocatedCapital = runningEquityFloored * stockDef.weight;
                const sharesIdeal = allocatedCapital / currentPrice;
                const sharesFloored = Math.floor(sharesIdeal);
                const diffShares = Number((sharesIdeal - sharesFloored).toFixed(4));
                const unallocatedCash = Math.round(diffShares * currentPrice * 10) / 10;
                totalUnallocatedCash += unallocatedCash;

                const pnlIdeal = Math.round((sharesIdeal * currentPrice - sharesIdeal * stockDef.basePrice) * 10) / 10;
                const pnlFloored = Math.round((sharesFloored * currentPrice - sharesFloored * stockDef.basePrice) * 10) / 10;
                const errorLossPnl = Math.max(0, Number((pnlIdeal - pnlFloored).toFixed(2)));

                return {
                  symbol: stockDef.symbol,
                  name: stockDef.name,
                  sector: stockDef.sector,
                  weight: stockDef.weight,
                  price: currentPrice,
                  shares_ideal: Number(sharesIdeal.toFixed(4)),
                  shares_floored: sharesFloored,
                  diff_shares: diffShares,
                  unallocated_cash: unallocatedCash,
                  pnl_ideal: pnlIdeal,
                  pnl_floored: pnlFloored,
                  error_loss_pnl: errorLossPnl,
                };
              });

            const unallocatedCashPct = runningEquityFloored > 0
              ? Number(((totalUnallocatedCash / runningEquityFloored) * 100).toFixed(2))
              : 0;

                daily.push({
                  date: dateStr,
                  equity_ideal: runningEquityIdeal,
                  equity_floored: runningEquityFloored,
                  return_ideal: Number(dayMarketReturn.toFixed(4)),
                  return_floored: Number(dayReturnFloored.toFixed(4)),
                  error_loss_pnl: dayErrorLossPnl,
                  error_loss_return: Number(dayErrorLossReturn.toFixed(4)),
                  cumulative_error_loss: cumulativeError,
                  unallocated_cash: Number(totalUnallocatedCash.toFixed(1)),
                  unallocated_cash_pct: unallocatedCashPct,
                  stocks,
                });
            }

              // Ensure last record matches exact final equity
              if (daily.length > 0) {
                daily[daily.length - 1].equity_ideal = finalEquityIdeal;
                daily[daily.length - 1].equity_floored = finalEquityFloored;
                daily[daily.length - 1].cumulative_error_loss = totalErrorLossAmount;
              }

              const meanDailyUnallocatedCash = daily.reduce((sum, d) => sum + d.unallocated_cash, 0) / (daily.length || 1);
              const meanDailyUnallocatedCashPct = daily.reduce((sum, d) => sum + d.unallocated_cash_pct, 0) / (daily.length || 1);

              return {
                status: "success",
                requested_start: start_date,
                requested_end: end_date,
                initial_capital,
                trading_days: tradingDays,
                model_name,
                summary: {
                  ideal: {
                    initial_capital,
                    final_equity: finalEquityIdeal,
                    total_return_pct: Number(targetReturnPctIdeal.toFixed(2)),
                    annualized_return_pct: 68.21,
                    annualized_volatility_pct: 15.4,
                    annualized_sharpe: 3.82,
                  },
                  floored: {
                    initial_capital,
                    final_equity: finalEquityFloored,
                    total_return_pct: Number(targetReturnPctFloored.toFixed(2)),
                    annualized_return_pct: 64.85,
                    annualized_volatility_pct: 15.1,
                    annualized_sharpe: 3.71,
                  },
                  error_loss: {
                    total_error_loss_amount: totalErrorLossAmount,
                    total_error_loss_pct: Number(totalErrorLossPct.toFixed(2)),
                    mean_daily_unallocated_cash: Number(meanDailyUnallocatedCash.toFixed(1)),
                    mean_daily_unallocated_cash_pct: Number(meanDailyUnallocatedCashPct.toFixed(2)),
                  },
                },
                daily,
                isDemoFallback: true,
              };
            }
