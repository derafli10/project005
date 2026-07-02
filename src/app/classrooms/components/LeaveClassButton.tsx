"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { leaveClassRoomAction } from "@/app/actions/classroom";
import { LogOut, Loader2 } from "lucide-react";

interface LeaveClassButtonProps {
  classRoomId: string;
  className: string;
  labels: {
    leave: string;
    confirm: string;
    cancel: string;
  };
}

export function LeaveClassButton({
  classRoomId,
  className,
  labels,
}: LeaveClassButtonProps): React.ReactNode {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLeave = async () => {
    setLoading(true);
    setError(null);

    const result = await leaveClassRoomAction(classRoomId);

    if (result.success) {
      router.push("/classrooms");
    } else {
      setLoading(false);
      setError(result.error);
      setShowConfirm(false);
    }
  };

  if (showConfirm) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-red-100 bg-red-50/50 p-4 dark:border-red-950/30 dark:bg-red-950/10">
        <p className="text-xs font-semibold text-red-800 dark:text-red-300">
          {labels.confirm}
        </p>
        {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => setShowConfirm(false)}
            disabled={loading}
            className="rounded-full bg-white border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={handleLeave}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-full bg-red-650 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            <span>Leave</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowConfirm(true)}
      className="flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 shadow-sm transition-all hover:bg-red-50 hover:border-red-200 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-red-950/20 dark:hover:border-red-900"
    >
      <LogOut className="h-4 w-4" />
      <span>{labels.leave}</span>
    </button>
  );
}
