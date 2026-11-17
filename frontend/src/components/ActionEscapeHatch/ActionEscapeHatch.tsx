import { useEffect, useState } from "react";
import {
  subscribeToActiveActions,
  resetAllStuckActions,
  type ActiveActionInfo,
} from "../../utils/actionWatchdog";
import "./ActionEscapeHatch.css";

export default function ActionEscapeHatch() {
  const [activeActions, setActiveActions] = useState<ActiveActionInfo[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = subscribeToActiveActions((actions) => {
      setActiveActions(actions);
      if (actions.length === 0) {
        setElapsedSeconds(0);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (activeActions.length === 0) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const earliestStartTime = Math.min(...activeActions.map((a) => a.startTime));
      const secs = Math.max(1, Math.floor((Date.now() - earliestStartTime) / 1000));
      setElapsedSeconds(secs);
    }, 500);

    return () => clearInterval(interval);
  }, [activeActions]);

  // Don't show anything for the first 3.5 seconds to avoid flickering on fast responses
  if (activeActions.length === 0 || elapsedSeconds < 4) {
    return null;
  }

  const latestAction = activeActions[activeActions.length - 1];

  return (
    <aside
      className="escape-hatch-container"
      role="status"
      aria-live="polite"
      aria-label="Pending action status and emergency cancel"
    >
      <div className="escape-hatch-spinner" aria-hidden="true" />
      <div className="escape-hatch-text">
        <span>Processing:</span>
        <span className="escape-hatch-action-name" title={latestAction.name}>
          {latestAction.name}
        </span>
        <span className="escape-hatch-timer">({elapsedSeconds}s)</span>
      </div>
      <button
        type="button"
        className="escape-hatch-btn"
        onClick={() => resetAllStuckActions("user_clicked_escape_hatch")}
        title="Force cancel and unlock button"
      >
        Cancel &amp; Unfreeze
      </button>
    </aside>
  );
}
