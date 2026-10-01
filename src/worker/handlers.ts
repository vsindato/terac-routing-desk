import type { PgBoss } from "pg-boss";
import type { HandlerOutcome, TaskService } from "@/domain/taskService";
import { QUEUES, type JobPayloads, type QueueName } from "@/jobs/jobQueue";

/** Several tasks route at once; each queue processes up to this many jobs in parallel. */
const CONCURRENCY = 5;
const POLLING_INTERVAL_SECONDS = 0.5;

type Handler<N extends QueueName> = (payload: JobPayloads[N]) => Promise<HandlerOutcome>;

async function work<N extends QueueName>(boss: PgBoss, name: N, handle: Handler<N>): Promise<void> {
  await boss.work<JobPayloads[N]>(
    name,
    { localConcurrency: CONCURRENCY, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async ([job]) => {
      const outcome = await handle(job.data);
      console.log(`[worker] ${name} ${JSON.stringify(job.data)} -> ${outcome}`);
    },
  );
}

/**
 * Handlers are thin: the service's attempt and assignment guards make every
 * delivery idempotent, so pg-boss retries and duplicates are harmless.
 */
export async function registerHandlers(boss: PgBoss, service: TaskService): Promise<void> {
  await work(boss, QUEUES.routeTask, ({ attemptId }) => service.dispatchAttempt(attemptId));
  await work(boss, QUEUES.engineResponse, ({ attemptId, result }) => service.applyEngineResponse(attemptId, result));
  await work(boss, QUEUES.contributorResponse, ({ assignmentId, decision }) =>
    service.applyContributorResponse(assignmentId, decision),
  );
}
