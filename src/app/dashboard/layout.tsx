import type { ReactNode } from "react";
import Link from "next/link";

import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { LogoutButton } from "./components/LogoutButton";
import { CookedMeter } from "./components/CookedMeter";
import { CookedMeterService } from "@/lib/services/cooked-meter.service";

/**
 * Dashboard layout — Server Component app shell.
 *
 * Owns the persistent navigation (Requirement 14.1: locale switcher, profile,
 * logout visible across the dashboard) and the responsive Bento Grid scaffold
 * into which the four primary widget containers are placed:
 *
 *   Widget A — Task Queue          (tall hero spine, spans rows)
 *   Widget B — Cooked Meter        (supporting, filled in Task 11)
 *   Widget C — Classroom Feed      (supporting, filled in Task 15)
 *   Widget D — Academic Wrapped    (supporting, filled in Task 17)
 *
 * Responsive strategy (Requirement 14.1):
 *   - Mobile  (base):   single column — `grid-cols-1`, widgets stack vertically.
 *   - Tablet  (md):     2 columns.
 *   - Desktop (xl):     4 columns, Widget A is the tall left spine spanning
 *                       2 of the 3 rows so the Queue is always the focal point
 *                       (the product's reason to exist), with B/C/D to the right.
 *
 * The grid is intentionally a scaffold: it renders `children` inside the Task
 * Queue spine and three quiet, labelled placeholder tiles for B/C/D so the
 * layout is coherent today and gets filled by later tasks without restructuring.
 *
 * Requirements: 14.1, 2.5, 1.8
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate — middleware also enforces this; the guard here keeps
  // the deep-link path consistent and guarantees `session.user` for the nav.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const cookedMeterState = await CookedMeterService.getMeterState(session.user.id);

  const displayName =
    (session.user.name?.trim() || session.user.email || "").split(" ")[0] ?? "";
  const targetLocale = locale === "EN" ? "ID" : "EN";

  return (
    <div className="flex min-h-svh flex-col bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <DashboardNav
        appName={t("common.appName")}
        navDashboard={t("nav.dashboard")}
        navClassrooms={t("nav.classrooms")}
        navSettings={t("nav.settings")}
        displayName={displayName}
        profileLabel={t("nav.profile")}
        logoutLabel={t("nav.logout")}
        switcher={{
          ariaLabel: t("locale.switcher.label"),
          switchToHint: t("locale.switcher.switchTo"),
          otherLocaleName:
            targetLocale === "ID"
              ? t("locale.id")
              : t("locale.en"),
        }}
        currentLocale={locale}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Bento Grid scaffold (Requirement 14.1). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-4 xl:grid-rows-[auto_auto_auto] xl:gap-6">
          {/* Widget A — Task Queue. The product's reason to exist: tall left
              spine spanning 2 rows on desktop so the queue is always focal. */}
          <section
            aria-label={t("dashboard.widget.taskQueue")}
            className="md:col-span-2 xl:col-span-2 xl:row-span-2 xl:row-start-1"
          >
            {children}
          </section>

          {/* Widget B — Cooked Meter (Task 11). */}
          <CookedMeter
            initialState={cookedMeterState}
            labels={{
              title: t("cooked.meter.title"),
              currentScore: t("cooked.meter.currentScore"),
              sparkline: t("cooked.meter.sparkline"),
              updatedNow: t("cooked.meter.updatedNow"),
              tierMainCharacter: t("cooked.tier.main_character"),
              tierLetHimCook: t("cooked.tier.let_him_cook"),
              tierSlightlyCooked: t("cooked.tier.slightly_cooked"),
              tierOvercooked: t("cooked.tier.overcooked"),
              locale,
              recoveryTitle: t("recovery.modal.title"),
              recoveryMessage: t("recovery.modal.message"),
              recoveryActivate: t("recovery.modal.activate"),
              recoveryLater: t("recovery.modal.later"),
              recoveryCandidates: t("recovery.modal.candidates"),
              recoveryActivatedTitle: t("recovery.activated"),
              cancel: t("common.cancel"),
            }}
          />

          {/* Widget C — Classroom Feed (Task 15). */}
          <WidgetPlaceholder
            label={t("dashboard.widget.feed")}
            ariaLabel={t("feed.title")}
          />

          {/* Widget D — Academic Wrapped (Task 17). */}
          <WidgetPlaceholder
            label={t("dashboard.widget.wrapped")}
            ariaLabel={t("wrapped.title")}
            className="md:col-span-2 xl:col-span-2"
          />
        </div>
      </main>
    </div>
  );
}

// ─── Navigation ─────────────────────────────────────────────────────────────

interface DashboardNavProps {
  appName: string;
  navDashboard: string;
  navClassrooms: string;
  navSettings: string;
  displayName: string;
  profileLabel: string;
  logoutLabel: string;
  switcher: {
    ariaLabel: string;
    switchToHint: string;
    otherLocaleName: string;
  };
  currentLocale: "EN" | "ID";
}

function DashboardNav({
  appName,
  navDashboard,
  navClassrooms,
  navSettings,
  displayName,
  profileLabel,
  logoutLabel,
  switcher,
  currentLocale,
}: DashboardNavProps): React.ReactNode {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand + primary nav */}
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            {appName}
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
            <NavLink href="/dashboard" label={navDashboard} />
            <NavLink href="/classrooms" label={navClassrooms} />
            <NavLink href="/settings" label={navSettings} />
          </nav>
        </div>

        {/* Profile + locale + logout */}
        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher currentLocale={currentLocale} labels={switcher} />
          <div className="hidden items-center gap-2 sm:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
              <span aria-hidden="true">
                {displayName.charAt(0).toUpperCase() || "·"}
              </span>
            </div>
            <span
              className="max-w-[10ch] truncate text-sm font-medium text-zinc-700 dark:text-zinc-300"
              title={profileLabel}
            >
              {displayName}
            </span>
          </div>
          <LogoutButton
            label={logoutLabel}
            ariaLabel={logoutLabel}
            iconOnly
          />
        </div>
      </div>

      {/* Secondary nav row — visible only on mobile where the primary row is
          collapsed into the brand. */}
      <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-900 sm:hidden">
        <nav className="flex items-center gap-1" aria-label="Primary">
          <NavLink href="/dashboard" label={navDashboard} />
          <NavLink href="/classrooms" label={navClassrooms} />
          <NavLink href="/settings" label={navSettings} />
        </nav>
      </div>
    </header>
  );
}

function NavLink({ href, label }: { href: string; label: string }): React.ReactNode {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      {label}
    </Link>
  );
}

// ─── Widget placeholder ─────────────────────────────────────────────────────

/**
 * Quiet placeholder tile for widgets B/C/D that are owned by later tasks.
 * Keeps the Bento layout coherent today; gets replaced by the real widget
 * component in Tasks 11/15/17 without restructuring the grid.
 */
function WidgetPlaceholder({
  label,
  ariaLabel,
  className = "",
}: {
  label: string;
  ariaLabel: string;
  className?: string;
}): React.ReactNode {
  return (
    <aside
      aria-label={ariaLabel}
      className={`flex min-h-[10rem] flex-col rounded-2xl border border-dashed border-zinc-200 bg-white/60 p-5 dark:border-zinc-800 dark:bg-zinc-950/40 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {label}
        </h3>
      </div>
    </aside>
  );
}
