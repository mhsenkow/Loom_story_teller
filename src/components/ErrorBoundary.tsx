// =================================================================
// ErrorBoundary — Catch React render errors and show fallback UI
// =================================================================

"use client";

import { Component, type ReactNode } from "react";
import { deployMismatchFromError, markReloadOnce } from "@/lib/deployVersionGuard";
import { requestHelp } from "@/lib/changelog";
import { useLoomStore } from "@/lib/store";
import { viewModeName } from "@/lib/viewModes";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
  resetKeys?: readonly unknown[];
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError) return;
    const prevKeys = prevProps.resetKeys ?? [];
    const nextKeys = this.props.resetKeys ?? [];
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some((key, index) => !Object.is(key, prevKeys[index]));
    if (changed) this.setState({ hasError: false, error: null });
  }

  recoverToExplorer = () => {
    useLoomStore.setState({
      viewMode: "explorer",
      activeChart: null,
      vegaSpec: null,
      shareSheetOpen: false,
      panelTab: "stats",
    });
    this.setState({ hasError: false, error: null });
  };

  reportIssue = () => {
    const message = this.state.error?.message ?? "Unknown render error";
    requestHelp({
      tab: "feedback",
      feedbackTitle: "Loom crashed while rendering",
      feedbackBody: `What happened:\n\n\nError:\n${message}`,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      const deploy = deployMismatchFromError(this.state.error);
      return (
        <div className="p-6 max-w-md mx-auto text-center space-y-3" role="alert" aria-live="assertive">
          <p className="text-sm font-medium text-loom-text">
            {deploy ? "Loom was updated" : "Something went wrong"}
          </p>
          <p className="text-xs text-loom-muted leading-relaxed">
            {deploy?.message ?? `Loom caught a rendering problem. You can recover to ${viewModeName("explorer")}, then report it with the current error details attached.`}
          </p>
          {deploy?.canReload ? (
            <button
              type="button"
              onClick={() => {
                markReloadOnce();
                window.location.reload();
              }}
              className="loom-btn-primary text-xs"
            >
              Reload Loom
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                type="button"
                onClick={this.recoverToExplorer}
                className="loom-btn-primary text-xs"
              >
                Try again in {viewModeName("explorer")}
              </button>
              <button
                type="button"
                onClick={this.reportIssue}
                className="loom-btn-ghost text-xs border border-loom-border"
              >
                Report this
              </button>
            </div>
          )}
          {!deploy && (
            <details className="text-left rounded border border-loom-border bg-loom-elevated/40 px-3 py-2">
              <summary className="cursor-pointer text-2xs text-loom-muted">Error details</summary>
              <p className="mt-2 text-2xs text-loom-muted break-words">{this.state.error.message}</p>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
