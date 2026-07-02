import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen, Users, Calendar, ArrowLeft, MessageSquare, Shield } from "lucide-react";
import { baseDb } from "@/lib/db";
import { createTranslator, formatDate } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import { LeaveClassButton } from "../components/LeaveClassButton";

interface ClassroomDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ClassroomDetailPage({ params }: ClassroomDetailPageProps) {
  const { id } = await params;
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  // 1. Fetch classroom details along with memberships and user profiles
  const classRoom = await baseDb.classRoom.findUnique({
    where: { id },
    include: {
      memberships: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!classRoom) {
    notFound();
  }

  // 2. Security Check: Verify user is a member of the classroom
  const isMember = classRoom.memberships.some((m) => m.userId === userId);
  if (!isMember) {
    redirect("/classrooms");
  }

  // 3. Determine if current user is the classroom creator or system admin
  const isCreatorOrAdmin = classRoom.creatorId === userId || session.user.role === "ADMIN";

  // 4. Map & Anonymize members list (Requirement 8.6)
  const members = classRoom.memberships.map((m, index) => {
    const isSelf = m.userId === userId;
    const isCreator = m.userId === classRoom.creatorId;

    let displayName = "";
    if (isSelf) {
      displayName = m.user.name || m.user.email || "You";
    } else if (isCreatorOrAdmin) {
      displayName = m.user.name || m.user.email || `Member ${index + 1}`;
    } else {
      displayName = `Member ${index + 1}`;
    }

    return {
      userId: m.userId,
      name: displayName,
      isSelf,
      isCreator,
      joinedAt: formatDate(m.joinedAt, locale),
    };
  });

  return (
    <div className="space-y-8">
      {/* Back button */}
      <div>
        <Link
          href="/classrooms"
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-550 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t("common.back")}</span>
        </Link>
      </div>

      {/* Hero section */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-550 dark:bg-zinc-800 dark:text-zinc-400">
              <BookOpen className="h-3 w-3" />
              <span>SKS {classRoom.sksWeight}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-550 dark:bg-zinc-800 dark:text-zinc-400">
              <Users className="h-3 w-3" />
              <span>{t("classroom.memberCount").replace("{count}", String(members.length))}</span>
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
            {classRoom.className}
          </h1>
          <p className="font-mono text-sm tracking-wider text-zinc-500 dark:text-zinc-400">
            {t("classroom.create.codeLabel")}: <span className="font-bold text-zinc-800 dark:text-zinc-200">{classRoom.classCode}</span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/classrooms/${classRoom.id}/feed`}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-900 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <MessageSquare className="h-4 w-4" />
            <span>{t("classroom.detail.openFeed")}</span>
          </Link>

          {/* Creators cannot leave their classroom as per Requirement 8.10 */}
          {classRoom.creatorId !== userId && (
            <LeaveClassButton
              classRoomId={classRoom.id}
              className={classRoom.className}
              labels={{
                leave: t("classroom.leave"),
                confirm: t("classroom.leave.confirm"),
                cancel: t("common.cancel"),
              }}
            />
          )}
        </div>
      </div>

      {/* Details & Members layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Members List Section */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {t("classroom.detail.members")}
          </h2>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className="flex items-center justify-between p-4 transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 font-bold text-zinc-650 dark:bg-zinc-900 dark:text-zinc-400">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {member.name} {member.isSelf && <span className="text-xs text-zinc-400 font-normal">(You)</span>}
                      </p>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        {t("classroom.joinedAt")} {member.joinedAt}
                      </p>
                    </div>
                  </div>

                  {member.isCreator && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                      <Shield className="h-3 w-3" />
                      <span>Admin</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Metadata Sidebar Card */}
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-550">
            Classroom Info
          </h3>
          <div className="mt-4 space-y-4 text-xs">
            <div className="flex justify-between border-b border-zinc-100 pb-2 dark:border-zinc-900">
              <span className="text-zinc-500 dark:text-zinc-400">Created Date</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {formatDate(classRoom.createdAt, locale)}
              </span>
            </div>
            <div className="flex justify-between border-b border-zinc-100 pb-2 dark:border-zinc-900">
              <span className="text-zinc-500 dark:text-zinc-400">SKS Credit Weight</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {classRoom.sksWeight} SKS
              </span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-zinc-500 dark:text-zinc-400">Anonymity Level</span>
              <span className="font-semibold text-zinc-850 dark:text-zinc-200">
                {isCreatorOrAdmin ? "Visible to Admin" : "Anonymized"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
