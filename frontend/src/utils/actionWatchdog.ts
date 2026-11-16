import { useEffect } from "react";
import { showAppAlert } from "./alertConfig";

export type ActiveActionInfo = {
  id: string;
  name: string;
  startTime: number;
  timeoutMs: number;
  timerId: ReturnType<typeof setTimeout> | null;
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
      console.error("[ActionWatchdog] Error notifying listener:", e);
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
 * Starts tracking a user action (e.g. a button click or form submit).
 * If the action exceeds maxDurationMs without completing, it automatically:
 * 1. Aborts any pending network request associated with the action controller.
 * 2. Emits "reset-stuck-buttons" to unfreeze all buttons and spinners.
 * 3. Shows a user-facing alert so the user knows what happened.
 */
export function startActionWatchdog(
  actionName: string,
  options: {
    maxDurationMs?: number;
    abortController?: AbortController;
    onTimeout?: () => void;
  } = {}
): {
  actionId: string;
  controller: AbortController;
  stop: () => void;
} {
  const actionId = `action_${++actionCounter}_${Date.now()}`;
  const timeoutMs = options.maxDurationMs ?? 15000; // 15 seconds max safety timeout
  const controller = options.abortController ?? new AbortController();
  const startTime = Date.now();

  console.log(
    `%c[User Action] 🖱️ Started: "${actionName}" at ${new Date().toLocaleTimeString()} (Watchdog: ${timeoutMs / 1000}s)`,
    "color: #00d2ff; font-weight: bold; background: rgba(0, 210, 255, 0.1); padding: 2px 6px; border-radius: 4px;"
  );

  const timerId = setTimeout(() => {
    console.warn(
      `%c[Action Watchdog] ⚠️ Action "${actionName}" exceeded ${timeoutMs / 1000}s! Backend did not respond or action stalled. Auto-recovering UI...`,
      "color: #f59e0b; font-weight: bold; background: rgba(245, 158, 11, 0.15); padding: 4px 8px; border-radius: 4px;"
    );

    // Abort network request
    try {
      controller.abort();
    } catch {}

    // Remove from active
    activeActions.delete(actionId);
    notifyListeners();

    // Notify all components to reset stuck loading states
    window.dispatchEvent(
      new CustomEvent("reset-stuck-buttons", {
        detail: { actionName, actionId, timedOut: true },
      })
    );

    // Optional timeout callback
    try {
      options.onTimeout?.();
    } catch {}

    // Alert user so they are not left wondering
    showAppAlert({
      title: "Action Timed Out",
      text: `"${actionName}" took longer than expected and backend did not respond. The button has been unlocked so you can try again.`,
      type: "warning",
      timer: 3500,
    });
  }, timeoutMs);

  const actionInfo: ActiveActionInfo = {
    id: actionId,
    name: actionName,
    startTime,
    timeoutMs,
    timerId,
    abortController: controller,
  };

  activeActions.set(actionId, actionInfo);
  notifyListeners();

  const stop = () => {
    const active = activeActions.get(actionId);
    if (active) {
      if (active.timerId) {
        clearTimeout(active.timerId);
      }
      activeActions.delete(actionId);
      notifyListeners();

      const elapsed = Date.now() - startTime;
      console.log(
        `%c[User Action] ✅ Completed: "${actionName}" in ${elapsed}ms`,
        "color: #20d89b; font-weight: bold; background: rgba(32, 216, 155, 0.1); padding: 2px 6px; border-radius: 4px;"
      );
    }
  };

  return { actionId, controller, stop };
}

/**
 * Universal async execution wrapper.
 * Ensures the action is registered with the watchdog, catches any unhandled error,
 * guarantees loading cleanup, and displays a user notification on failure.
 */
export async function trackAction<T>(
  actionName: string,
  fn: (controller: AbortController) => Promise<T>,
  options: {
    maxDurationMs?: number;
    onError?: (error: unknown) => void;
  } = {}
): Promise<T> {
  const { controller, stop } = startActionWatchdog(actionName, {
    maxDurationMs: options.maxDurationMs,
  });

  try {
    return await fn(controller);
  } catch (error) {
    console.error(
      `%c[User Action Failed] ❌ "${actionName}" threw an error:`,
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
    if (action.timerId) {
      clearTimeout(action.timerId);
    }
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
