import type { Db } from "@/db/client";
import { QUEUES, type JobQueue } from "@/jobs/jobQueue";

/**
 * Re-enqueues dispatch for any pending attempt the engine never received.
 * Jobs are enqueued in the same transaction as the attempt, so this only
 * matters if a job was lost (e.g. it exhausted its retries); dispatch is
 * idempotent, so an extra job is harmless.
 */
export async function reconcileUndispatchedAttempts(db: Db, queue: JobQueue): Promise<number> {
  const attempts = await db.routingAttempt.findMany({
    where: { status: "pending", dispatchedAt: null },
    select: { id: true },
  });
  for (const attempt of attempts) {
    await db.$transaction((tx) => queue.enqueue(tx, QUEUES.routeTask, { attemptId: attempt.id }));
  }
  return attempts.length;
}
