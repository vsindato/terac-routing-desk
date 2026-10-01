import { PgBoss, fromPrisma } from "pg-boss";
import type { Tx } from "@/db/tx";
import { QUEUES, type EnqueueOptions, type JobPayloads, type JobQueue, type QueueName } from "./jobQueue";

const QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 1,
  retryBackoff: true,
  expireInSeconds: 60,
};

export type BossRole = "producer" | "worker";

/**
 * The Next.js process only produces jobs, so it skips pg-boss maintenance and
 * scheduling; the worker process owns those.
 */
export function createBoss(connectionString: string, role: BossRole): PgBoss {
  const boss = new PgBoss({
    connectionString,
    max: role === "producer" ? 2 : 10,
    supervise: role === "worker",
    schedule: false,
  });
  boss.on("error", (error) => console.error(`[pg-boss:${role}]`, error));
  return boss;
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, QUEUE_OPTIONS);
  }
}

export class PgBossJobQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  async enqueue<N extends QueueName>(tx: Tx, name: N, payload: JobPayloads[N], options?: EnqueueOptions): Promise<void> {
    await this.boss.send(name, payload, { startAfter: options?.startAfter, db: fromPrisma(tx) });
  }
}
