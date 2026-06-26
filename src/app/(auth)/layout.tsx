import type { ReactNode } from "react";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

/**
 * Shared shell for the `(auth)` route group — `/login` and `/register`.
 *
 * Renders a centred, locale-aware card on a tinted background so the two auth
 * pages only need to provide their heading and form. All visible chrome
 * (app name, tagline) is resolved through `getTranslation` so the page text
 * follows the active locale (Requirement 2.5).
 *
 * Requirements: 1.1, 1.2, 2.5
 */
export default async function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const t = createTranslator(locale);

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <p className="text-sm font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("common.appName")}
          </p>
          <h1 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t("common.appTagline")}
          </h1>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
