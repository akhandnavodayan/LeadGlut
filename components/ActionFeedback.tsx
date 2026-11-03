"use client";

type ActionFeedbackProps = {
  state: "idle" | "loading" | "success" | "error";
  message?: string;
};

export function ActionFeedback({ state, message }: ActionFeedbackProps) {
  if (state === "idle") return null;
  return (
    <div className="action-feedback-backdrop" role="status" aria-live="polite">
      <div className={`action-feedback-card action-feedback-${state}`}>
        <div className="action-feedback-mark">
          {state === "loading" ? (
            <span className="action-feedback-spinner" />
          ) : state === "success" ? (
            <span className="action-feedback-check">✓</span>
          ) : (
            <span className="action-feedback-error-mark">!</span>
          )}
        </div>
        <strong>{state === "loading" ? "LeadGlut" : state === "success" ? "Done" : "Something went wrong"}</strong>
        <span>{message || (state === "loading" ? "Please wait while we finish this action." : state === "success" ? "Action completed successfully." : "Please try again.")}</span>
      </div>
    </div>
  );
}
