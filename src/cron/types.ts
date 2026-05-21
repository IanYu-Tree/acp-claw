export interface ScheduledTask {
  name: string;
  schedule: string;
  prompt: string;
  chatId?: string;
  oneShot: boolean;
  enabled: boolean;
  createdAt: string;
  lastRun: string | null;
  nextRun: string | null;
}

export interface CronConfig {
  tasks: ScheduledTask[];
}
