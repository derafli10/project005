"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { toastVariants } from "@/lib/motion-variants";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/**
 * ToastProvider
 *
 * Implements a global toast notification system displaying success, info, and error
 * toasts with auto-dismiss and close buttons, utilizing Framer Motion transitions.
 *
 * Requirements: Design: Error Handling, Task 20.4
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", duration = 5000) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, message, type, duration }]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          removeToast(id);
        }, duration);
        timers.current.set(id, timer);
      }
    },
    [removeToast]
  );

  const success = useCallback((msg: string, dur?: number) => toast(msg, "success", dur), [toast]);
  const error = useCallback((msg: string, dur?: number) => toast(msg, "error", dur), [toast]);
  const info = useCallback((msg: string, dur?: number) => toast(msg, "info", dur), [toast]);

  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach((t) => clearTimeout(t));
      currentTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}
      <div className="fixed inset-x-0 bottom-4 z-55 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              role="alert"
              aria-live="assertive"
              variants={toastVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg ${
                t.type === "success"
                  ? "border-emerald-200 bg-white text-emerald-800 dark:border-emerald-900/50 dark:bg-zinc-900 dark:text-emerald-300"
                  : t.type === "error"
                    ? "border-red-200 bg-white text-red-800 dark:border-red-900/50 dark:bg-zinc-900 dark:text-red-300"
                    : "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
              }`}
            >
              {t.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
              {t.type === "error" && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
              {t.type === "info" && <Info className="h-4 w-4 text-blue-500 shrink-0" />}
              
              <span className="text-xs font-semibold">{t.message}</span>
              
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="ml-auto rounded-md p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-850"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
