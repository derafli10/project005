"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * GlobalErrorBoundary
 *
 * Catches JavaScript errors anywhere in their child component tree,
 * logs those errors, and displays a premium fallback UI with recovery action (Retry).
 *
 * Requirements: Design: Error Handling, Task 20.4
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("GlobalErrorBoundary caught an error:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    // Attempt standard recovery by reloading the current route context
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50/30 p-8 text-center dark:border-red-900/50 dark:bg-red-950/10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-650 dark:bg-red-950/30 dark:text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 font-display text-lg font-bold text-zinc-900 dark:text-zinc-50">
            Terjadi Kesalahan / Something Went Wrong
          </h2>
          <p className="mt-2 max-w-md text-sm text-zinc-650 dark:text-zinc-400">
            {this.state.error?.message || "Gagal memproses permintaan. Silakan coba kembali."}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Coba Lagi / Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
