import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { classRoomService } from "@/lib/services/classroom.service";
import { baseDb } from "@/lib/db";
import { createTranslator, formatDate } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import { ClassRoomsClient, type ClassroomView } from "./components/ClassRoomsClient";

export const metadata: Metadata = {
  title: "Classrooms | Project005",
  description: "Join or create classrooms to coordinate tasks with classmates.",
};

export default async function ClassRoomsPage() {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  // 1. Fetch user's classrooms
  const memberships = await classRoomService.getUserClassRooms(userId);

  // 2. Fetch membership counts in a single performant group-by query
  const classroomIds = memberships.map((m) => m.classRoom.id);
  const countMap = new Map<string, number>();

  if (classroomIds.length > 0) {
    const memberCounts = await baseDb.classRoomMember.groupBy({
      by: ["classRoomId"],
      where: { classRoomId: { in: classroomIds } },
      _count: { userId: true },
    });

    memberCounts.forEach((c) => {
      countMap.set(c.classRoomId, c._count.userId);
    });
  }

  // 3. Format the view data
  const formattedClassRooms: ClassroomView[] = memberships.map((m) => ({
    classRoom: m.classRoom,
    memberCount: countMap.get(m.classRoom.id) ?? 1,
    joinedAt: formatDate(m.membership.joinedAt, locale),
  }));

  return (
    <ClassRoomsClient
      classRooms={formattedClassRooms}
      labels={{
        title: t("classroom.title"),
        createClass: t("classroom.create"),
        joinClass: t("classroom.join"),
        memberCount: t("classroom.memberCount"),
        joinedAt: t("classroom.joinedAt"),
        sksLabel: t("classroom.create.sksLabel"),
        emptyTitle: t("classroom.empty.title"),
        emptyMessage: t("classroom.empty.message"),
        copySuccess: t("toast.copied"),
        cancel: t("common.cancel"),
        createModalTitle: t("classroom.create"),
        joinModalTitle: t("classroom.join"),
        classNameLabel: t("classroom.create.nameLabel"),
        classNamePlaceholder: t("classroom.create.namePlaceholder"),
        sksWeightLabel: t("classroom.create.sksLabel"),
        codeLabel: t("classroom.create.codeLabel"),
        codePlaceholder: t("classroom.join.codePlaceholder"),
        submit: t("common.submit"),
      }}
    />
  );
}
