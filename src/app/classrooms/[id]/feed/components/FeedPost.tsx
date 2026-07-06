import type { PostTag } from "@/generated/prisma";
import { MessageSquare } from "lucide-react";

/**
 * Tag display metadata matching Requirement 10.8:
 *   #CurhatTugas=red, #ButuhTemanTim=blue, #TanyaJawaban=green, #DiskusiUmum=gray
 */
const TAG_META: Record<
  PostTag,
  { label: string; badgeClass: string; dotClass: string }
> = {
  CURHAT_TUGAS: {
    label: "#CurhatTugas",
    badgeClass:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/50",
    dotClass: "bg-red-500",
  },
  BUTUH_TEMAN_TIM: {
    label: "#ButuhTemanTim",
    badgeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/50",
    dotClass: "bg-blue-500",
  },
  TANYA_JAWABAN: {
    label: "#TanyaJawaban",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50",
    dotClass: "bg-emerald-500",
  },
  DISKUSI_UMUM: {
    label: "#DiskusiUmum",
    badgeClass:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
    dotClass: "bg-zinc-400",
  },
};

/**
 * Formats a Date into a relative timestamp string (e.g., "2m ago", "3h ago", "5d ago").
 */
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) {
    return "baru saja";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m lalu`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}j lalu`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}h lalu`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}bln lalu`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears}thn lalu`;
}

export interface FeedPostData {
  id: string;
  content: string;
  tag: PostTag;
  createdAt: Date;
}

interface FeedPostProps {
  post: FeedPostData;
}

/**
 * FeedPost — displays a single anonymous feed post card.
 *
 * Requirements 10.2 (anonymous display, no user info),
 * 10.8 (colored PostTag badge).
 *
 * Server Component — no client interactivity needed for display-only.
 */
export function FeedPost({ post }: FeedPostProps) {
  const tagMeta = TAG_META[post.tag];
  const relativeTime = formatRelativeTime(
    post.createdAt instanceof Date ? post.createdAt : new Date(post.createdAt)
  );

  return (
    <article
      id={`feed-post-${post.id}`}
      className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
    >
      {/* Header: Anonymous avatar + timestamp */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Anonymous avatar placeholder — Requirement 10.2: no user info */}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 shadow-inner dark:from-zinc-700 dark:to-zinc-800">
            <MessageSquare className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Anonim
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
              {relativeTime}
            </span>
          </div>
        </div>

        {/* Tag badge — Requirement 10.8 */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tagMeta.badgeClass}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${tagMeta.dotClass}`} />
          {tagMeta.label}
        </span>
      </div>

      {/* Content — max 500 chars, Requirement 10.10 */}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
        {post.content}
      </p>
    </article>
  );
}
