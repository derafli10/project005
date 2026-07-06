import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageSquarePlus, Filter, Ghost } from "lucide-react";
import { baseDb } from "@/lib/db";
import { FeedService } from "@/lib/services/feed.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import type { PostTag } from "@/generated/prisma";
import { FeedPost } from "./components/FeedPost";
import { CreatePostForm } from "./components/CreatePostForm";

/**
 * Valid PostTag values for filter validation.
 */
const VALID_TAGS = new Set<string>([
  "CURHAT_TUGAS",
  "BUTUH_TEMAN_TIM",
  "TANYA_JAWABAN",
  "DISKUSI_UMUM",
]);

/**
 * Tag filter metadata — synced with Requirement 10.8 color mapping.
 */
const TAG_FILTERS: {
  value: PostTag;
  label: string;
  activeClass: string;
  dotClass: string;
}[] = [
  {
    value: "CURHAT_TUGAS",
    label: "#CurhatTugas",
    activeClass:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
    dotClass: "bg-red-500",
  },
  {
    value: "BUTUH_TEMAN_TIM",
    label: "#ButuhTemanTim",
    activeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
    dotClass: "bg-blue-500",
  },
  {
    value: "TANYA_JAWABAN",
    label: "#TanyaJawaban",
    activeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
    dotClass: "bg-emerald-500",
  },
  {
    value: "DISKUSI_UMUM",
    label: "#DiskusiUmum",
    activeClass:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
    dotClass: "bg-zinc-400",
  },
];

interface FeedPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tag?: string }>;
}

/**
 * Anonymous Feed page — Server Component.
 *
 * Requirements 10.1 (feed visible only to ClassRoomMembers),
 * 10.9 (filter by PostTag).
 *
 * Posts are fetched server-side via FeedService.getFeedPosts in reverse
 * chronological order. Tag filtering uses URL searchParams (?tag=CURHAT_TUGAS).
 */
export default async function FeedPage({ params, searchParams }: FeedPageProps) {
  const { id: classRoomId } = await params;
  const { tag: rawTag } = await searchParams;
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

  // Validate tag filter (ignore invalid values)
  const activeTag: PostTag | undefined =
    rawTag && VALID_TAGS.has(rawTag) ? (rawTag as PostTag) : undefined;

  // Fetch posts — FeedService handles membership check + reverse chrono ordering
  let posts: Awaited<ReturnType<typeof FeedService.getFeedPosts>> = [];
  let fetchError: string | null = null;

  try {
    posts = await FeedService.getFeedPosts(userId, classRoomId, activeTag);
  } catch {
    fetchError = "Unable to load feed posts.";
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

      {/* Create post form */}
      <CreatePostForm classRoomId={classRoomId} />

      {/* Tag filter bar — Requirement 10.9 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {t("feed.filter.title")}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* "All" filter */}
          <Link
            href={`/classrooms/${classRoomId}/feed`}
            className={`inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              !activeTag
                ? "border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {t("feed.filter.all")}
          </Link>

          {/* Per-tag filters */}
          {TAG_FILTERS.map((filter) => {
            const isActive = activeTag === filter.value;
            return (
              <Link
                key={filter.value}
                href={`/classrooms/${classRoomId}/feed?tag=${filter.value}`}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? `${filter.activeClass} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950 ${
                        filter.value === "CURHAT_TUGAS"
                          ? "ring-red-300 dark:ring-red-700"
                          : filter.value === "BUTUH_TEMAN_TIM"
                            ? "ring-blue-300 dark:ring-blue-700"
                            : filter.value === "TANYA_JAWABAN"
                              ? "ring-emerald-300 dark:ring-emerald-700"
                              : "ring-zinc-300 dark:ring-zinc-600"
                      }`
                    : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive ? filter.dotClass : "bg-zinc-300 dark:bg-zinc-600"
                  }`}
                />
                {filter.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Feed posts list */}
      {fetchError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/20">
          <p className="text-sm text-red-600 dark:text-red-400">{fetchError}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
            <Ghost className="h-7 w-7 text-zinc-300 dark:text-zinc-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              {t("feed.empty.title")}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {t("feed.empty.message")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <FeedPost
              key={post.id}
              post={{
                id: post.id,
                content: post.content,
                tag: post.tag,
                createdAt: post.createdAt,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
