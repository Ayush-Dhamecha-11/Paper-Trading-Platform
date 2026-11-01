type DataStateProps = {
  status: "loading" | "error";
  title: string;
  message: string;
  onRetry?: () => void;
};

export default function DataState({
  status,
  title,
  message,
  onRetry,
}: Readonly<DataStateProps>) {
  return (
    <section className={`data-state data-state-${status}`} role="status" aria-live="polite">
      <div className="data-state-indicator" aria-hidden="true">
        {status === "loading" ? "..." : "!"}
      </div>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}
