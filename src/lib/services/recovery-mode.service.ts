import "server-only";

import { baseDb } from "@/lib/db";
import { PriorityEngineService } from "./priority-engine.service";
import type { Task } from "@/generated/prisma";
import { ValidationError, NotFoundError } from "@/lib/errors/domain-errors";

const MOTIVATIONAL_MESSAGES = [
  "The academic comeback is about to be legendary. Let's cook! ⚡",
  "No cap, you got this. One small step at a time. 🚀",
  "We're breaking this down so you don't break down. Let's get it! 💪",
  "Real main character energy. Time to lock in! 🔒",
  "Your stress levels are temporary, but the glory of finishing is forever. Let's cook! 🔥"
];

export class RecoveryModeService {
  /**
   * Identifies top 3 Parent Tasks (isSubTask=false) with taskWeight > 3000 basis points.
   * Sorts JIT by priority score descending.
   */
  static async getCandidateTasksForRecovery(
    userId: string,
    now: Date = new Date()
  ): Promise<Task[]> {
    const progressRows = await baseDb.userTaskProgress.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        task: {
          isSubTask: false,
          taskWeight: { gt: 3000 },
        },
      },
      select: {
        task: true,
      },
    });

    const tasks = progressRows.map((r) => r.task);
    if (tasks.length === 0) {
      return [];
    }

    const scored = PriorityEngineService.batchCalculate(tasks, now);
    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    return scored.slice(0, 3).map((s) => s.task);
  }

  /**
   * Activate Recovery Mode for the specified parent tasks (user consent required).
   */
  static async activateRecoveryMode(
    userId: string,
    taskIdsToBreakdown: string[],
    now: Date = new Date()
  ): Promise<{
    activatedAt: Date;
    tasksBreakdown: Array<{
      parentTask: Task;
      subTasks: Task[];
    }>;
    motivationalText: string;
  }> {
    if (!taskIdsToBreakdown || taskIdsToBreakdown.length === 0) {
      throw new ValidationError("At least one taskId must be selected for breakdown", {
        field: "taskIdsToBreakdown",
      });
    }

    const tasksBreakdown: Array<{
      parentTask: Task;
      subTasks: Task[];
    }> = [];

    for (const taskId of taskIdsToBreakdown) {
      const parentTask = await baseDb.task.findUnique({
        where: { id: taskId },
      });
      if (!parentTask) {
        throw new NotFoundError("Task", taskId);
      }

      const progress = await baseDb.userTaskProgress.findUnique({
        where: {
          userId_taskId: { userId, taskId },
        },
      });
      if (!progress) {
        throw new ValidationError("Task not associated with user progress", {
          field: "taskId",
        });
      }

      const subTasks = await this.breakdownTask(taskId, userId, now);
      tasksBreakdown.push({
        parentTask,
        subTasks,
      });
    }

    const motivationalText = await this.getMotivationalText();

    return {
      activatedAt: new Date(),
      tasksBreakdown,
      motivationalText,
    };
  }

  /**
   * Breaks down a single parent task into 3-5 subtasks (specifically 4).
   * Deadlines spaced 1-2 days apart (1 day each).
   * Proportional weight distribution.
   */
  static async breakdownTask(
    taskId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<Task[]> {
    const parentTask = await baseDb.task.findUnique({
      where: { id: taskId },
    });
    if (!parentTask) {
      throw new NotFoundError("Task", taskId);
    }

    const numSubTasks = 4;
    const baseWeight = Math.floor(parentTask.taskWeight / numSubTasks);

    const subTasks: Task[] = [];

    await baseDb.$transaction(async (tx) => {
      for (let i = 0; i < numSubTasks; i++) {
        const daysOffset = i + 1;
        const subDeadline = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000);

        const weight =
          i === numSubTasks - 1
            ? parentTask.taskWeight - baseWeight * (numSubTasks - 1)
            : baseWeight;

        const subTask = await tx.task.create({
          data: {
            title: `${parentTask.title} (Part ${i + 1})`,
            description: `Recovery breakdown part ${i + 1} of: ${parentTask.title}`,
            sksWeight: parentTask.sksWeight,
            taskWeight: weight,
            deadlineAt: subDeadline,
            isSubTask: true,
            parentTaskId: taskId,
            creatorId: parentTask.creatorId,
            classRoomId: parentTask.classRoomId,
          },
        });

        await tx.userTaskProgress.create({
          data: {
            userId,
            taskId: subTask.id,
            status: "PENDING",
          },
        });

        subTasks.push(subTask);
      }
    });

    return subTasks;
  }

  /**
   * Check if all SubTasks of a parent task are completed and mark parent as completed.
   */
  static async checkParentCompletion(
    parentTaskId: string,
    userId: string
  ): Promise<boolean> {
    const subTasks = await baseDb.task.findMany({
      where: { parentTaskId },
      select: { id: true },
    });

    if (subTasks.length === 0) {
      return false;
    }

    const subTaskIds = subTasks.map((t) => t.id);
    const subProgress = await baseDb.userTaskProgress.findMany({
      where: {
        userId,
        taskId: { in: subTaskIds },
      },
      select: { status: true },
    });

    const allCompleted =
      subProgress.length === subTaskIds.length &&
      subProgress.every((p) => p.status === "COMPLETED");

    if (allCompleted) {
      await baseDb.userTaskProgress.update({
        where: {
          userId_taskId: { userId, taskId: parentTaskId },
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      return true;
    }

    return false;
  }

  /**
   * Get random motivational text.
   */
  static async getMotivationalText(): Promise<string> {
    const idx = Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length);
    const msg = MOTIVATIONAL_MESSAGES[idx];
    return msg ?? "Let's cook! ⚡";
  }
}

export const recoveryModeService = RecoveryModeService;
