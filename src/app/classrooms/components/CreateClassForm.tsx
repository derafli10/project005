"use client";

import { useState } from "react";
import { createClassRoomAction } from "@/app/actions/classroom";
import { Copy, Check, Loader2, Sparkles, BookOpen } from "lucide-react";

interface CreateClassFormProps {
  onClose: () => void;
  labels: {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    sksLabel: string;
    submit: string;
    cancel: string;
  };
}

export function CreateClassForm({ onClose, labels }: CreateClassFormProps): React.ReactNode {
  const [name, setName] = useState("");
  const [sksWeight, setSksWeight] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [createdClass, setCreatedClass] = useState<{
    id: string;
    className: string;
    classCode: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    setFieldErrors({});

    const result = await createClassRoomAction(name, sksWeight);

    setLoading(false);
    if (result.success) {
      setCreatedClass(result.data);
    } else {
      setError(result.error);
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
    }
  };

  const handleCopyCode = async () => {
    if (!createdClass) return;
    try {
      await navigator.clipboard.writeText(createdClass.classCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback silent fail
    }
  };

  if (createdClass) {
    return (
      <div className="flex flex-col items-center p-6 text-center space-y-6">
        {/* Animated Celebration Icon */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          <Sparkles className="h-8 w-8 animate-pulse" />
        </div>

        <div>
          <h3 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
            Class Created Successfully!
          </h3>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Share the code below with your classmates to get them joined.
          </p>
        </div>

        {/* Display Code Prominently */}
        <div className="w-full rounded-2xl border border-zinc-100 bg-zinc-50/50 p-5 dark:border-zinc-900 dark:bg-zinc-900/30">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Classroom Code
          </span>
          <div className="mt-1 flex items-center justify-center gap-3">
            <span className="font-mono text-3xl font-extrabold tracking-widest text-zinc-900 dark:text-zinc-550">
              {createdClass.classCode}
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                copied
                  ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400"
                  : "border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200"
              }`}
              aria-label="Copy class code"
            >
              {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Display Class Details */}
        <div className="flex items-center gap-2 rounded-lg bg-zinc-100/50 px-3 py-1.5 text-xs text-zinc-650 dark:bg-zinc-800/50 dark:text-zinc-300">
          <BookOpen className="h-3.5 w-3.5" />
          <span className="font-medium">{createdClass.className}</span>
          <span className="text-zinc-300 dark:text-zinc-600">•</span>
          <span className="font-bold">SKS {sksWeight}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full bg-zinc-950 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-900 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-550">
          {labels.title}
        </h3>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          Set up a new space to share academic tasks.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-650 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Class Name Input */}
        <div>
          <label
            htmlFor="className"
            className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
          >
            {labels.nameLabel}
          </label>
          <input
            type="text"
            id="className"
            name="className"
            required
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={labels.namePlaceholder}
            className={`mt-1.5 block w-full rounded-xl border bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:outline-none focus:ring-1 dark:bg-zinc-900 dark:text-zinc-50 ${
              fieldErrors.name
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950 dark:border-zinc-800 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
            }`}
          />
          {fieldErrors.name && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-450">
              {fieldErrors.name[0]}
            </p>
          )}
        </div>

        {/* SKS Weight Dropdown */}
        <div>
          <label
            htmlFor="sksWeight"
            className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
          >
            {labels.sksLabel}
          </label>
          <select
            id="sksWeight"
            name="sksWeight"
            value={sksWeight}
            onChange={(e) => setSksWeight(Number(e.target.value))}
            className="mt-1.5 block w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
          >
            {[1, 2, 3, 4, 5].map((val) => (
              <option key={val} value={val}>
                {val} SKS
              </option>
            ))}
          </select>
          {fieldErrors.sksWeight && (
            <p className="mt-1 text-[11px] text-red-650 dark:text-red-450">
              {fieldErrors.sksWeight[0]}
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
          disabled={loading || !name.trim()}
          className="flex items-center gap-2 rounded-full bg-zinc-950 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-250"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{labels.submit}</span>
        </button>
      </div>
    </form>
  );
}
