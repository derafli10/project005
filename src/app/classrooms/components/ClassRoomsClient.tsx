"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, UserPlus, Users, Calendar, Copy, Check, LogOut, BookOpen } from "lucide-react";
import { CreateClassForm } from "./CreateClassForm";
import { JoinClassForm } from "./JoinClassForm";
import type { ClassRoom, Locale } from "@/generated/prisma";

export interface ClassroomView {
  classRoom: ClassRoom;
  memberCount: number;
  joinedAt: string; // Formatted date
}

export interface ClassRoomsClientLabels {
  title: string;
  createClass: string;
  joinClass: string;
  memberCount: string;
  joinedAt: string;
  sksLabel: string;
  emptyTitle: string;
  emptyMessage: string;
  copySuccess: string;
  cancel: string;
  createModalTitle: string;
  joinModalTitle: string;
  classNameLabel: string;
  classNamePlaceholder: string;
  sksWeightLabel: string;
  codeLabel: string;
  codePlaceholder: string;
  submit: string;
}

interface ClassRoomsClientProps {
  classRooms: ClassroomView[];
  labels: ClassRoomsClientLabels;
}

export function ClassRoomsClient({ classRooms, labels }: ClassRoomsClientProps): React.ReactNode {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<"create" | "join" | null>(null);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      // Quiet fail if browser block clipboard
    }
  };

  return (
    <div className="space-y-6">
      {/* Header section with Premium design */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {labels.emptyMessage}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveModal("join")}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-850"
          >
            <UserPlus className="h-4 w-4" />
            <span>{labels.joinClass}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal("create")}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-900 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <Plus className="h-4 w-4" />
            <span>{labels.createClass}</span>
          </button>
        </div>
      </div>

      {/* Main Grid View */}
      {classRooms.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-5">
          {classRooms.map(({ classRoom, memberCount, joinedAt }) => {
            const isCopied = copiedCode === classRoom.classCode;
            return (
              <motion.div
                key={classRoom.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className="group relative flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
              >
                {/* Class Title & Details */}
                <div className="mb-4">
                  <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <BookOpen className="h-3 w-3" />
                    <span>SKS {classRoom.sksWeight}</span>
                  </span>
                  <h3 className="mt-2 text-base font-bold text-zinc-900 dark:text-zinc-50 group-hover:text-zinc-950 dark:group-hover:text-white">
                    {classRoom.className}
                  </h3>
                </div>

                {/* Class Code Card (Interactive) */}
                <div className="mt-auto rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/50">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        {labels.codeLabel}
                      </span>
                      <p className="font-mono text-sm font-semibold tracking-wider text-zinc-800 dark:text-zinc-200">
                        {classRoom.classCode}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(classRoom.classCode)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                        isCopied
                          ? "border-emerald-200 bg-emerald-550/10 text-emerald-600 dark:border-emerald-900/30 dark:text-emerald-400"
                          : "border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200"
                      }`}
                      aria-label="Copy class code"
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Meta footer */}
                <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-[11px] text-zinc-500 dark:border-zinc-900 dark:text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    <span>
                      {labels.memberCount.replace("{count}", String(memberCount))}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {labels.joinedAt} {joinedAt}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* Empty State with premium design */
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200 bg-white/40 py-16 text-center dark:border-zinc-800 dark:bg-zinc-950/20">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
            <BookOpen className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {labels.emptyTitle}
          </h3>
          <p className="mt-1 max-w-[32ch] text-xs text-zinc-500 dark:text-zinc-400">
            {labels.emptyMessage}
          </p>
        </div>
      )}

      {/* Modal overlays with AnimatePresence */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            >
              {activeModal === "create" ? (
                <CreateClassForm
                  onClose={() => setActiveModal(null)}
                  labels={{
                    title: labels.createModalTitle,
                    nameLabel: labels.classNameLabel,
                    namePlaceholder: labels.classNamePlaceholder,
                    sksLabel: labels.sksWeightLabel,
                    submit: labels.submit,
                    cancel: labels.cancel,
                  }}
                />
              ) : (
                <JoinClassForm
                  onClose={() => setActiveModal(null)}
                  labels={{
                    title: labels.joinModalTitle,
                    codeLabel: labels.codeLabel,
                    codePlaceholder: labels.codePlaceholder,
                    submit: labels.submit,
                    cancel: labels.cancel,
                  }}
                />
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
