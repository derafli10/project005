"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ExternalLink, X } from "lucide-react";
import { getUnreadNotificationsAction } from "@/app/actions/task";

/** Auto-dismiss delay in milliseconds. */
const AUTO_DISMISS_MS = 8_000;
/** Max shown-notification IDs to persist in localStorage. */
const MAX_STORED_IDS = 200;

interface ActiveToast {
  id: string;
  taskId: string;
  message: string;
}

export interface InAppNotificationsProps {
  notificationUpdatedTemplate: string;
  viewHistoryLabel: string;
}

export function InAppNotifications({
  notificationUpdatedTemplate,
  viewHistoryLabel,
}: InAppNotificationsProps): React.ReactNode {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Schedule auto-dismiss for a toast.
  const scheduleDismiss = useCallback((id: string) => {
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      dismissTimers.current.delete(id);
    }, AUTO_DISMISS_MS);
    dismissTimers.current.set(id, timer);
  }, []);

  // Cleanup all auto-dismiss timers on unmount.
  useEffect(() => {
    const timers = dismissTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    // Safe initialization on mount to avoid SSR hydration mismatches
    let initialShown: string[] = [];
    try {
      const stored = localStorage.getItem("project005_shown_notifications");
      initialShown = stored ? JSON.parse(stored) : [];
    } catch {
      // Ignore storage errors
    }

    const shownRef = new Set<string>(initialShown);

    const poll = async () => {
      try {
        const res = await getUnreadNotificationsAction();
        if (res.success && res.data) {
          const newToasts: ActiveToast[] = [];
          const updatedShown = [...shownRef];

          for (const item of res.data) {
            if (!shownRef.has(item.id)) {
              shownRef.add(item.id);
              updatedShown.push(item.id);

              const message = notificationUpdatedTemplate
                .replace("{title}", item.taskTitle)
                .replace("{name}", item.editorName);

              newToasts.push({
                id: item.id,
                taskId: item.taskId,
                message,
              });
            }
          }

          if (newToasts.length > 0) {
            // Cap stored IDs to prevent unbounded localStorage growth.
            const capped = updatedShown.slice(-MAX_STORED_IDS);
            try {
              localStorage.setItem(
                "project005_shown_notifications",
                JSON.stringify(capped),
              );
            } catch {
              // Ignore storage errors
            }
            setToasts((prev) => [...prev, ...newToasts]);
            // Schedule auto-dismiss for each new toast.
            for (const toast of newToasts) {
              scheduleDismiss(toast.id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to poll notifications:", err);
      }
    };

    poll(); // Run initial check
    const interval = setInterval(poll, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [notificationUpdatedTemplate, scheduleDismiss]);

  const handleDismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    // Clear any pending auto-dismiss timer for this toast.
    const timer = dismissTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.current.delete(id);
    }
  }, []);

  const handleToastClick = (taskId: string, toastId: string) => {
    // Dismiss the clicked toast
    handleDismiss(toastId);

    // Find and scroll to the specific task card
    const el = document.getElementById(`task-card-${taskId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });

      // Add a quick premium focus/flash effect
      el.classList.add("ring-2", "ring-emerald-500", "ring-offset-2");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-emerald-500", "ring-offset-2");
      }, 2000);

      // Trigger custom event to expand the edit history timeline automatically
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(`open-history-${taskId}`));
      }, 300);
    }
  };

  return (
    <div
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-3 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="w-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl pointer-events-auto dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <Bell className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {toast.message}
                </p>

                <button
                  type="button"
                  onClick={() => handleToastClick(toast.taskId, toast.id)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 transition-colors dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  <span>{viewHistoryLabel}</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
            </div>

              <button
                type="button"
                onClick={() => handleDismiss(toast.id)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Auto-dismiss countdown bar */}
            <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <motion.div
                className="h-full bg-emerald-500 dark:bg-emerald-400"
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: AUTO_DISMISS_MS / 1000, ease: "linear" }}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
