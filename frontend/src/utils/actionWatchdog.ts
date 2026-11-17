import { useEffect } from "react";
import { showAppAlert } from "./alertConfig";

export type ActiveActionInfo = {
  id: string;
  name: string;
  startTime: number;
  abortController?: AbortController;
};

// Global registry of all currently pending user actions (button clicks, form submits)
const activeActions = new Map<string, ActiveActionInfo>();
let actionCounter = 0;

type ActionWatchdogListener = (actions: ActiveActionInfo[]) => void;
const listeners = new Set<ActionWatchdogListener>();

function notifyListeners() {
  const currentList = Array.from(activeActions.values());
  listeners.forEach((listener) => {
    try {
      listener(currentList);
    } catch (e) {
      console.error("[ActionTracker] Error notifying listener:", e);
    }
  });
}

/**
 * Subscribes a callback to changes in the active actions list.
 */
export function subscribeToActiveActions(listener: ActionWatchdogListener): () => void {
  listeners.add(listener);
  listener(Array.from(activeActions.values()));
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns all currently active tracked actions.
 */
export function getActiveActions(): ActiveActionInfo[] {
  return Array.from(activeActions.values());
}

/**
 * Tracks a user action (e.g. a button click or form submit).
 * Keeps a live timer running so you can verify the request went out and see
 * how long it takes, WITHOUT ever timing out or blocking the request.
 */
export function startActionWatchdog(
  actionName: string,
  options: {
    abortController?: AbortController;
  } = {}
): {
  actionId: string;
  controller: AbortController;
  stop: () => void;
} {
  const actionId = `action_${++actionCounter}_${Date.now()}`;
  const controller = options.abortController ?? new AbortController();
  const startTime = Date.now();

  console.log(
    `%c[User Action Tracker] 🚀 Started: "${actionName}" at ${new Date().toLocaleTimeString()} | Request sent`,
    "color: #00d2ff; font-weight: bold; background: rgba(0, 210, 255, 0.1); padding: 2px 6px; border-radius: 4px;"
  );

  const actionInfo: ActiveActionInfo = {
    id: actionId,
    name: actionName,
    startTime,
    abortController: controller,
  };

  activeActions.set(actionId, actionInfo);
  notifyListeners();

  const stop = () => {
    const active = activeActions.get(actionId);
    if (active) {
      activeActions.delete(actionId);
      notifyListeners();

      const elapsed = Date.now() - startTime;
      console.log(
        `%c[User Action Tracker] 🏁 Completed: "${actionName}" in ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`,
        "color: #20d89b; font-weight: bold; background: rgba(32, 216, 155, 0.1); padding: 2px 6px; border-radius: 4px;"
      );
    }
  };

  return { actionId, controller, stop };
}

/**
 * Universal async execution wrapper.
 * Tracks when the action started and finished with timer metrics, catches unhandled errors,
 * and guarantees loading state cleanup WITHOUT ever aborting or blocking on timeout.
 */
export async function trackAction<T>(
  actionName: string,
  fn: (controller: AbortController) => Promise<T>,
  options: {
    onError?: (error: unknown) => void;
  } = {}
): Promise<T> {
  const { controller, stop } = startActionWatchdog(actionName);

  try {
    return await fn(controller);
  } catch (error) {
    console.error(
      `%c[User Action Error] ❌ "${actionName}" failed:`,
      "color: #ff5e6d; font-weight: bold; background: rgba(255, 94, 109, 0.1); padding: 2px 6px; border-radius: 4px;",
      error
    );

    // Guarantee stuck button reset on error
    window.dispatchEvent(
      new CustomEvent("reset-stuck-buttons", {
        detail: { actionName, error },
      })
    );

    if (options.onError) {
      options.onError(error);
    } else {
      const msg = error instanceof Error ? error.message : "Action failed. Please try again.";
      showAppAlert({
        title: "Action Failed",
        text: msg,
        type: "error",
        timer: 3000,
      });
    }

    throw error;
  } finally {
    stop();
  }
}

/**
 * Emergency reset: Aborts all in-flight tracked actions and unfreezes every button.
 */
export function resetAllStuckActions(reason = "user_cancel"): void {
  console.log(
    `%c[Action Watchdog] 🔄 Force-resetting all active actions (${activeActions.size} active). Reason: ${reason}`,
    "color: #00d2ff; font-weight: bold; background: rgba(0, 210, 255, 0.15); padding: 4px 8px; border-radius: 4px;"
  );

  activeActions.forEach((action) => {
    try {
      action.abortController?.abort();
    } catch {}
  });

  activeActions.clear();
  notifyListeners();

  window.dispatchEvent(
    new CustomEvent("reset-stuck-buttons", {
      detail: { reason, timestamp: Date.now() },
    })
  );

  showAppAlert({
    title: "UI Restored",
    text: "Stuck action cancelled and all buttons have been unlocked.",
    type: "info",
    timer: 2000,
  });
}

/**
 * React hook to auto-reset local loading / submitting state if a stuck action is cancelled or timed out.
 */
export function useResetStuckAction(onReset: () => void): void {
  useEffect(() => {
    const handleReset = () => {
      try {
        onReset();
      } catch (e) {
        console.error("[useResetStuckAction] Error executing reset callback:", e);
      }
    };

    window.addEventListener("reset-stuck-buttons", handleReset);
    return () => {
      window.removeEventListener("reset-stuck-buttons", handleReset);
    };
  }, [onReset]);
}

// ── Global Unhandled Error & Promise Rejection Safeguard ──
// If an unexpected error occurs during a click event, automatically unfreeze the UI.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    console.error(
      "%c[Global Error Safeguard] ⚠️ Unhandled Promise Rejection:",
      "color: #ff5e6d; font-weight: bold;",
      event.reason
    );

    if (activeActions.size > 0) {
      console.warn("[Global Error Safeguard] Active actions detected during unhandled rejection. Resetting stuck buttons...");
      window.dispatchEvent(
        new CustomEvent("reset-stuck-buttons", {
          detail: { error: event.reason },
        })
      );
    }
  });

  window.addEventListener("error", (event) => {
    console.error(
      "%c[Global Error Safeguard] ⚠️ Uncaught Runtime Error:",
      "color: #ff5e6d; font-weight: bold;",
      event.error || event.message
    );

    if (activeActions.size > 0) {
      console.warn("[Global Error Safeguard] Active actions detected during runtime error. Resetting stuck buttons...");
      window.dispatchEvent(
        new CustomEvent("reset-stuck-buttons", {
          detail: { error: event.error },
        })
      );
    }
  });
}
