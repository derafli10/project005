"use client";

/**
 * LogoutButton — minimal Client Component leaf.
 *
 * Wraps the canonical `logoutAction` Server Action (src/app/(auth)/actions.ts)
 * behind a button with a pending state. Kept leaf-level so the dashboard nav
 * can stay a Server Component — only this tiny island needs `"use client"`.
 *
 * The visible label is pre-resolved server-side and passed in via `label` so
 * this component stays locale-agnostic until render (Requirement 2.5).
 *
 * Requirements: 1.8, 2.5
 */

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/(auth)/actions";

interface LogoutButtonProps {
  /** Pre-localized button label (e.g. "Logout" / "Keluar"). */
  label: string;
  /** Accessible label for the icon-only mobile variant. */
  ariaLabel: string;
  /** Show only the icon (no text) — used on small screens. */
  iconOnly?: boolean;
}

export function LogoutButton({
  label,
  ariaLabel,
  iconOnly = false,
}: LogoutButtonProps): React.ReactNode {
  const [isPending, startTransition] = useTransition();

  function handleLogout(): void {
    startTransition(async () => {
      await logoutAction();
    });
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      aria-label={ariaLabel}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
      {iconOnly ? null : <span>{label}</span>}
    </button>
  );
}
