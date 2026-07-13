import Link from "next/link";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { LogoutButton } from "@/app/dashboard/components/LogoutButton";

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

export function DashboardNav({
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
            className="text-sm font-semibold tracking-tight font-display text-zinc-900 dark:text-zinc-50"
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
