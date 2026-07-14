/**
 * Monitoring and Error Tracking Utility
 *
 * Simulates integration with Sentry (or other error tracking services) and
 * provides performance monitoring wrappers for DB/API execution, custom logging
 * for external API failures, and uptime monitoring for cron jobs.
 *
 * Task 21.4.
 */

interface ErrorContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id: string; email?: string };
}

export class MonitoringService {
  /** Capture and log an exception with Sentry-like metadata tags and context */
  static captureException(error: Error | unknown, context?: ErrorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    
    // In a real setup: Sentry.captureException(err, { tags: context?.tags, extra: context?.extra, user: context?.user })
    console.error(`[MONITORING ERROR] [${err.name}]: ${err.message}`, {
      stack: err.stack,
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    });
  }

  /** Specific log handler for external API communication failures (e.g., Twilio, Telegram, CDN) */
  static logExternalApiFailure(
    service: string,
    action: string,
    error: Error | unknown,
    metadata?: Record<string, unknown>
  ): void {
    const err = error instanceof Error ? error : new Error(String(error));
    
    this.captureException(err, {
      tags: {
        category: "external-api-failure",
        service,
        action,
      },
      extra: {
        ...metadata,
        failedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Monitor performance of critical queries or operations.
   * Logs warnings if execution exceeds threshold.
   */
  static async monitorPerformance<T>(
    operationName: string,
    operation: () => Promise<T>,
    slowThresholdMs = 100 // default warning threshold
  ): Promise<T> {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      const duration = performance.now() - start;
      if (duration > slowThresholdMs) {
        console.warn(
          `[PERFORMANCE WARNING] Operation "${operationName}" took ${duration.toFixed(2)}ms (Threshold: ${slowThresholdMs}ms)`
        );
      }
    }
  }

  /**
   * Ping/log uptime heartbeat for scheduled tasks.
   * Can be wired to automated healthchecks (e.g., BetterUptime, Cronitor).
   */
  static logCronHeartbeat(cronType: string, status: "success" | "failed" | "started", details?: Record<string, unknown>): void {
    console.info(`[CRON HEARTBEAT] [${cronType}] status=${status}`, {
      timestamp: new Date().toISOString(),
      ...details,
    });
  }
}
