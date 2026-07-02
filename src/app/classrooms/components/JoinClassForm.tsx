"use client";

import { useState } from "react";
import { joinClassRoomAction } from "@/app/actions/classroom";
import { Check, Loader2, Sparkles, UserPlus } from "lucide-react";

interface JoinClassFormProps {
  onClose: () => void;
  labels: {
    title: string;
    codeLabel: string;
    codePlaceholder: string;
    submit: string;
    cancel: string;
  };
}

export function JoinClassForm({ onClose, labels }: JoinClassFormProps): React.ReactNode {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [joinedClass, setJoinedClass] = useState<{
    id: string;
    className: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length !== 8) {
      setFieldErrors({ classCode: ["Class code must be exactly 8 characters."] });
      return;
    }

    setLoading(true);
    setError(null);
    setFieldErrors({});

    const result = await joinClassRoomAction(cleanCode);

    setLoading(false);
    if (result.success) {
      setJoinedClass(result.data);
    } else {
      setError(result.error);
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (val.length <= 8) {
      setCode(val);
      if (fieldErrors.classCode) {
        setFieldErrors({});
      }
    }
  };

  if (joinedClass) {
    return (
      <div className="flex flex-col items-center p-6 text-center space-y-6">
        {/* Success Icon */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          <Check className="h-8 w-8 animate-bounce" />
        </div>

        <div>
          <h3 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
            Welcome to Class!
          </h3>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            You have successfully joined the classroom.
          </p>
        </div>

        {/* Display Classroom Name */}
        <div className="w-full rounded-2xl border border-zinc-150 bg-emerald-50/10 p-5 dark:border-zinc-900 dark:bg-zinc-900/30">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-450">
            Joined Class
          </span>
          <p className="mt-1.5 text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {joinedClass.className}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full bg-zinc-950 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-900 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
          {labels.title}
        </h3>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          Enter the 8-character invite code shared by your classmate.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-650 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Class Code Input */}
        <div>
          <label
            htmlFor="classCode"
            className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
          >
            {labels.codeLabel}
          </label>
          <div className="relative mt-1.5">
            <input
              type="text"
              id="classCode"
              name="classCode"
              required
              autoComplete="off"
              value={code}
              onChange={handleInputChange}
              placeholder={labels.codePlaceholder || "E.g. A3F8K9Q2"}
              className={`block w-full rounded-xl border bg-white px-4 py-3 text-center font-mono text-lg font-bold tracking-widest text-zinc-900 shadow-sm focus:outline-none focus:ring-1 dark:bg-zinc-900 dark:text-zinc-50 ${
                fieldErrors.classCode
                  ? "border-red-355 focus:border-red-500 focus:ring-red-500"
                  : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950 dark:border-zinc-800 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
              }`}
            />
          </div>
          {fieldErrors.classCode && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-450">
              {fieldErrors.classCode[0]}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-full px-5 py-2.5 text-xs font-bold text-zinc-500 transition-all hover:bg-zinc-150 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          {labels.cancel}
        </button>

        <button
          type="submit"
          disabled={loading || code.trim().length !== 8}
          className="flex items-center gap-2 rounded-full bg-zinc-950 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{labels.submit}</span>
        </button>
      </div>
    </form>
  );
}
