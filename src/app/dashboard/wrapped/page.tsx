import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { academicWrappedService } from "@/lib/services/academic-wrapped.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

import { WrappedGalleryClient } from "./WrappedGalleryClient";

/**
 * Academic Wrapped Page — Server Component.
 *
 * Displays a gallery of the user's past Academic Wrapped cards with sharing
 * functionality. Fetches wrapped history server-side and passes to client
 * component for interactive Web Share API / download functionality.
 *
 * Requirements: 11.9
 */
export default async function WrappedPage() {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Fetch user's wrapped card history (last 10 weeks)
  const wrappedCards = await academicWrappedService.getUserWrappedHistory(
    session.user.id,
    10
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("wrapped.title")}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("dashboard.widget.wrapped")}
        </p>
      </div>

      {/* Wrapped Gallery */}
      <WrappedGalleryClient
        initialWrapped={wrappedCards}
        labels={{
          weekRange: t("wrapped.weekRange"),
          savedCredits: t("wrapped.savedCredits"),
          tasksCompleted: t("wrapped.tasksCompleted"),
          highestTier: t("wrapped.highestTier"),
          streak: t("wrapped.streak"),
          streakDays: t("wrapped.streakDays"),
          shareStory: t("wrapped.shareStory"),
          download: t("common.download"),
          emptyTitle: t("wrapped.empty.title"),
          emptyMessage: t("wrapped.empty.message"),
        }}
        locale={locale}
      />
    </div>
  );
}
