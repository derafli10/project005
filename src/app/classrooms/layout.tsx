import type { ReactNode } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import { DashboardNav } from "@/components/DashboardNav";

export default async function ClassRoomsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

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
        {children}
      </main>
    </div>
  );
}
