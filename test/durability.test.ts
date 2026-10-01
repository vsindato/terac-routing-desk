import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";
import { TaskService } from "@/domain/taskService";
import { createBoss, ensureQueues, PgBossJobQueue } from "@/jobs/pgBossJobQueue";
import { SimulatedRoutingEngine } from "@/routing/routingEngine";
import { RandomSelectionStrategy } from "@/routing/selectionStrategy";
import { ContributorSimulator } from "@/simulation/contributorSimulator";
import { registerHandlers } from "@/worker/handlers";
import { reconcileUndispatchedAttempts } from "@/worker/reconcile";
import { createTestDb, resetDatabase, seedCatalog, taskInput, waitFor } from "./support";

/**
 * End to end with the real pg-boss queue: a worker is stopped while a delayed
 * engine response is outstanding, and a brand-new worker finishes the job.
 */
const db = createTestDb();
const url = process.env.TEST_DATABASE_URL!;
const bosses: PgBoss[] = [];

function serviceFor(boss: PgBoss) {
  const queue = new PgBossJobQueue(boss);
  return new TaskService({
    db,
    queue,
    engine: new SimulatedRoutingEngine(queue, new RandomSelectionStrategy(), { minDelayMs: 1_500, maxDelayMs: 1_500, slowDelayMs: 1_500 }),
    contributors: new ContributorSimulator(queue, { minDelayMs: 200, maxDelayMs: 200 }),
  });
}

async function startWorker(): Promise<PgBoss> {
  const boss = createBoss(url, "worker");
  bosses.push(boss);
  await boss.start();
  await ensureQueues(boss);
  await registerHandlers(boss, serviceFor(boss));
  return boss;
}

beforeAll(async () => {
  await resetDatabase(db);
  await seedCatalog(db);
  const boss = createBoss(url, "worker");
  await boss.start();
  await boss.deleteAllJobs();
  await boss.stop();
});

afterAll(async () => {
  await Promise.all(bosses.map((boss) => boss.stop({ graceful: false }).catch(() => undefined)));
  await db.$disconnect();
});

describe("durability across a worker restart", () => {
  it("finishes routing after the worker that dispatched it is gone", async () => {
    const firstWorker = await startWorker();
    const { taskId } = await serviceFor(firstWorker).submitTask(taskInput({ scenario: "slow_match" }));

    await waitFor(() => db.routingAttempt.findFirst({ where: { taskId, dispatchedAt: { not: null } } }));
    await firstWorker.stop({ graceful: false });

    const attempt = await db.routingAttempt.findFirstOrThrow({ where: { taskId } });
    expect(attempt.status).toBe("pending");
    expect(attempt.respondedAt).toBeNull();

    await startWorker();
    const task = await waitFor(async () => {
      const current = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      return current.status === "assigned" ? current : null;
    });
    expect(task.status).toBe("assigned");
  });

  it("re-enqueues dispatch for a pending attempt whose job was lost", async () => {
    const worker = await startWorker();
    await worker.offWork("route-task");
    const { taskId } = await serviceFor(worker).submitTask(taskInput());
    await worker.deleteAllJobs("route-task");

    expect(await reconcileUndispatchedAttempts(db, new PgBossJobQueue(worker))).toBe(1);
    await startWorker();
    await waitFor(() => db.routingAttempt.findFirst({ where: { taskId, dispatchedAt: { not: null } } }));
  });
});
