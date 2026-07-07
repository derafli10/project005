import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { baseDb } from "@/lib/db";
import { FeedService } from "@/lib/services/feed.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import { FeedClient } from "./components/FeedClient";

interface FeedPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Anonymous Feed page — Server Component.
 *
 * Requirements 10.1 (feed visible only to ClassRoomMembers),
 * 10.9 (filter by PostTag).
 *
 * Fetches initial posts server-side for fast initial render,
 * then delegates filtering and real-time updates to FeedClient.
 */
export default async function FeedPage({ params }: FeedPageProps) {
  const { id: classRoomId } = await params;
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  // Verify classroom exists
  const classRoom = await baseDb.classRoom.findUnique({
    where: { id: classRoomId },
    select: { id: true, className: true },
  });

  if (!classRoom) {
    notFound();
  }

  // Fetch initial posts (all tags)
  let initialPosts: any[] = [];
  try {
    const rawPosts = await FeedService.getFeedPosts(userId, classRoomId);
    initialPosts = rawPosts.map((post) => ({
      id: post.id,
      content: post.content,
      tag: post.tag,
      createdAt: post.createdAt,
    }));
  } catch (err) {
    // If user is not authorized, FeedService will throw AuthorizationError.
    // Let's redirect to classroom page which will handle authorization.
    redirect(`/classrooms/${classRoomId}`);
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/classrooms/${classRoomId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t("common.back")}</span>
          </Link>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              {t("feed.title")}
            </h1>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {classRoom.className}
            </p>
          </div>
        </div>
      </div>

      {/* Interactive client component */}
      <FeedClient
        classRoomId={classRoomId}
        initialPosts={initialPosts}
        translations={{
          filterTitle: t("feed.filter.title"),
          filterAll: t("feed.filter.all"),
          emptyTitle: t("feed.empty.title"),
          emptyMessage: t("feed.empty.message"),
        }}
      />
    </div>
  );
}
