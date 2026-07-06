"use client";

import { useState, useCallback } from "react";
import { createFeedPostAction } from "@/app/actions/feed";
import type { PostTag } from "@/generated/prisma";
import { Send, Loader2, Tag, AlertCircle } from "lucide-react";

/**
 * Tag metadata: display labels, enum values, and badge colors.
 * Colors follow Requirement 10.8:
 *   #CurhatTugas=red, #ButuhTemanTim=blue, #TanyaJawaban=green, #DiskusiUmum=gray
 */
const TAG_OPTIONS: {
  value: PostTag;
  label: string;
  colorClass: string;
}[] = [
  {
    value: "CURHAT_TUGAS",
    label: "#CurhatTugas",
    colorClass:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900",
  },
  {
    value: "BUTUH_TEMAN_TIM",
    label: "#ButuhTemanTim",
    colorClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900",
  },
  {
    value: "TANYA_JAWABAN",
    label: "#TanyaJawaban",
    colorClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900",
  },
  {
    value: "DISKUSI_UMUM",
    label: "#DiskusiUmum",
    colorClass:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
  },
];

const MAX_CHARS = 500;

interface CreatePostFormProps {
  classRoomId: string;
}

export function CreatePostForm({ classRoomId }: CreatePostFormProps) {
  const [content, setContent] = useState("");
  const [selectedTag, setSelectedTag] = useState<PostTag | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const charCount = content.length;
  const isOverLimit = charCount > MAX_CHARS;
  const canSubmit = content.trim().length > 0 && selectedTag !== "" && !isOverLimit && !loading;

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      // Clear content-related errors on change
      if (fieldErrors.content) {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.content;
          return next;
        });
      }
      if (error) setError(null);
    },
    [fieldErrors.content, error]
  );

  const handleTagSelect = useCallback(
    (tag: PostTag) => {
      setSelectedTag(tag);
      // Clear tag-related errors on selection
      if (fieldErrors.tag) {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.tag;
          return next;
        });
      }
      if (error) setError(null);
    },
    [fieldErrors.tag, error]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTag) {
      setError("Pilih kategori post dulu ya!");
      setFieldErrors({ tag: ["Pilih kategori post dulu ya!"] });
      return;
    }

    if (!content.trim()) return;
    if (isOverLimit) return;

    setLoading(true);
    setError(null);
    setFieldErrors({});

    const result = await createFeedPostAction(
      classRoomId,
      content.trim(),
      selectedTag as PostTag
    );

    setLoading(false);

    if (result.success) {
      setContent("");
      setSelectedTag("");
    } else {
      setError(result.error);
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow focus-within:shadow-md dark:border-zinc-800 dark:bg-zinc-950">
        {/* Anonymous indicator */}
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800">
            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">?</span>
          </div>
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
            Posting sebagai Anonim
          </span>
        </div>

        {/* Textarea */}
        <textarea
          id="create-post-content"
          value={content}
          onChange={handleContentChange}
          placeholder="Tulis sesuatu yang ingin kamu share..."
          rows={3}
          maxLength={MAX_CHARS + 50} /* Allow slight overflow for UX, validation catches it */
          className={`w-full resize-none rounded-xl border bg-zinc-50 px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-400 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600 dark:focus:border-zinc-600 dark:focus:bg-zinc-950 ${
            isOverLimit
              ? "border-red-300 dark:border-red-800"
              : fieldErrors.content
                ? "border-red-300 dark:border-red-800"
                : "border-zinc-200"
          }`}
        />

        {/* Character count */}
        <div className="mt-1.5 flex items-center justify-between">
          {fieldErrors.content && (
            <p className="text-xs text-red-500">{fieldErrors.content[0]}</p>
          )}
          <div className="ml-auto">
            <span
              className={`text-xs font-mono tabular-nums ${
                isOverLimit
                  ? "font-semibold text-red-500"
                  : charCount > MAX_CHARS * 0.9
                    ? "text-amber-500"
                    : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              {charCount}/{MAX_CHARS}
            </span>
          </div>
        </div>
      </div>

      {/* Tag selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Pilih kategori <span className="text-red-400">*</span>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {TAG_OPTIONS.map((opt) => {
            const isActive = selectedTag === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleTagSelect(opt.value)}
                className={`inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? `${opt.colorClass} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950 ${
                        opt.value === "CURHAT_TUGAS"
                          ? "ring-red-300 dark:ring-red-700"
                          : opt.value === "BUTUH_TEMAN_TIM"
                            ? "ring-blue-300 dark:ring-blue-700"
                            : opt.value === "TANYA_JAWABAN"
                              ? "ring-emerald-300 dark:ring-emerald-700"
                              : "ring-zinc-300 dark:ring-zinc-600"
                      }`
                    : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {fieldErrors.tag && (
          <div className="flex items-center gap-1.5 text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            <span>{fieldErrors.tag[0]}</span>
          </div>
        )}
      </div>

      {/* Error + Submit row */}
      <div className="flex items-center justify-between">
        {error && !fieldErrors.tag && (
          <div className="flex items-center gap-1.5 text-xs text-red-500">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="ml-auto">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:opacity-30"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Posting...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>Post</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
