// =================================================================
// ErrorBoundary — Catch React render errors and show fallback UI
// =================================================================

"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
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

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="p-6 max-w-md mx-auto text-center space-y-3">
          <p className="text-sm font-medium text-loom-text">Something went wrong</p>
          <p className="text-xs text-loom-muted font-mono break-all">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="loom-btn-primary text-xs"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
