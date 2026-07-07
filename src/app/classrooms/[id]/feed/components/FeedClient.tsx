"use client";

import { useState, useTransition } from "react";
import type { PostTag } from "@/generated/prisma";
import { Filter, Ghost, Loader2 } from "lucide-react";
import { CreatePostForm } from "./CreatePostForm";
import { FeedPost, type FeedPostData } from "./FeedPost";
import { getFeedPostsAction } from "@/app/actions/feed";

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

interface FeedClientProps {
  classRoomId: string;
  initialPosts: FeedPostData[];
  translations: {
    filterTitle: string;
    filterAll: string;
    emptyTitle: string;
    emptyMessage: string;
  };
}

export function FeedClient({
  classRoomId,
  initialPosts,
  translations,
}: FeedClientProps) {
  const [posts, setPosts] = useState<FeedPostData[]>(initialPosts);
  const [activeTag, setActiveTag] = useState<PostTag | "">("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = async (tag: PostTag | "") => {
    setError(null);
    const result = await getFeedPostsAction(classRoomId, tag || undefined);
    if (result.success) {
      setPosts(
        (result.data || []).map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
        }))
      );
      setActiveTag(tag);
    } else {
      setError(result.error);
    }
  };

  const handleFilterClick = (tag: PostTag | "") => {
    if (tag === activeTag) return;
    startTransition(async () => {
      await fetchPosts(tag);
    });
  };

  const handlePostCreated = () => {
    startTransition(async () => {
      await fetchPosts(activeTag);
    });
  };

  return (
    <div className="space-y-6">
      {/* Create post form */}
      <CreatePostForm classRoomId={classRoomId} onPostCreated={handlePostCreated} />

      {/* Tag filter bar — Requirement 10.9 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {translations.filterTitle}
          </span>
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
        </div>

        <div className="flex flex-wrap gap-2">
          {/* "All" filter */}
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleFilterClick("")}
            className={`inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              !activeTag
                ? "border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {translations.filterAll}
          </button>

          {/* Per-tag filters */}
          {TAG_FILTERS.map((filter) => {
            const isActive = activeTag === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                disabled={isPending}
                onClick={() => handleFilterClick(filter.value)}
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
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed posts list */}
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/20">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
            <Ghost className="h-7 w-7 text-zinc-300 dark:text-zinc-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              {translations.emptyTitle}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {translations.emptyMessage}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <FeedPost key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
