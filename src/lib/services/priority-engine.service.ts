import { Task } from "@/generated/prisma";

export class PriorityEngineService {
  /**
   * Calculates time urgency (0-10000 basis points) based on deadline.
   */
  static calculateTimeUrgency(deadlineAt: Date): number {
    const now = new Date();
    const msDiff = deadlineAt.getTime() - now.getTime();
    const hoursDiff = msDiff / (1000 * 60 * 60);

    if (hoursDiff < 24) return 10000;
    if (hoursDiff <= 168) {
      // 1-7 days: exponential decay
      const days = hoursDiff / 24;
      return Math.floor(10000 * Math.exp(-0.3 * (days - 1)));
    }
    // >7 days: linear
    return Math.max(0, 5000 - Math.floor((hoursDiff - 168) * 10));
  }

  /**
   * Calculates final priority score.
   */
  static calculatePriorityScore(sksWeight: number, taskWeight: number, timeUrgency: number): number {
    // formula: (sksWeight × 2000 × 0.4) + (taskWeight × 0.4) + (timeUrgency × 0.2)
    const sksComponent = sksWeight * 2000 * 0.4;
    const taskComponent = taskWeight * 0.4;
    const timeComponent = timeUrgency * 0.2;
    return Math.floor(sksComponent + taskComponent + timeComponent);
  }

  /**
   * Batch calculates priority scores.
   */
  static batchCalculate(tasks: Task[]): { taskId: string; priorityScore: number }[] {
    return tasks.map((task) => {
      const urgency = this.calculateTimeUrgency(task.deadlineAt);
      const score = this.calculatePriorityScore(task.sksWeight, task.taskWeight, urgency);
      return { taskId: task.id, priorityScore: score };
    });
  }

  /**
   * Generates micro prompt based on score.
   */
  static generateMicroPrompt(priorityScore: number): string {
    if (priorityScore >= 8000) return "SLA BREACH IMMINENT! DO THIS NOW!";
    if (priorityScore >= 5000) return "High priority, get to it soon.";
    return "Chill, but keep an eye on it.";
  }
}
