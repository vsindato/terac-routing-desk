import { createPrismaClient, type Db } from "@/db/client";
import type { Tx } from "@/db/tx";
import { TaskService, type HandlerOutcome, type SubmitTaskInput } from "@/domain/taskService";
import type { EnqueueOptions, JobPayloads, JobQueue, QueueName } from "@/jobs/jobQueue";
import { SimulatedRoutingEngine } from "@/routing/routingEngine";
import { RandomSelectionStrategy } from "@/routing/selectionStrategy";
import { ContributorSimulator } from "@/simulation/contributorSimulator";

export function createTestDb(): Db {
  return createPrismaClient(process.env.TEST_DATABASE_URL!);
}

export async function resetDatabase(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE task_events, assignments, routing_attempts, task_expertise, tasks,
              contributor_expertise, contributors, expertise CASCADE`,
  );
}

export interface Catalog {
  aliceFinance: string;
  bobFinance: string;
  caraHealth: string;
}

/** Two finance contributors and one healthcare contributor. Names sort in that order. */
export async function seedCatalog(db: Db): Promise<Catalog> {
  await db.expertise.createMany({
    data: [
      { id: "finance", label: "Finance" },
      { id: "healthcare", label: "Healthcare" },
    ],
  });
  const create = (name: string, expertiseId: string) =>
    db.contributor.create({
      data: { name, email: `${name.split(" ")[0].toLowerCase()}@test.dev`, expertise: { create: [{ expertiseId }] } },
    });
  const [alice, bob, cara] = [
    await create("Alice Finance", "finance"),
    await create("Bob Finance", "finance"),
    await create("Cara Health", "healthcare"),
  ];
  return { aliceFinance: alice.id, bobFinance: bob.id, caraHealth: cara.id };
}

interface RecordedJob<N extends QueueName = QueueName> {
  name: N;
  payload: JobPayloads[N];
  startAfter?: Date;
}

/** Captures jobs instead of running them, so tests decide exactly when (and whether) each one is delivered. */
export class RecordingJobQueue implements JobQueue {
  private jobs: RecordedJob[] = [];

  async enqueue<N extends QueueName>(_tx: Tx, name: N, payload: JobPayloads[N], options?: EnqueueOptions): Promise<void> {
    this.jobs.push({ name, payload, startAfter: options?.startAfter } as RecordedJob);
  }

  pending<N extends QueueName>(name: N): RecordedJob<N>[] {
    return this.jobs.filter((job): job is RecordedJob<N> => job.name === name);
  }

  take<N extends QueueName>(name: N): RecordedJob<N>[] {
    const taken = this.pending(name);
    this.jobs = this.jobs.filter((job) => job.name !== name);
    return taken;
  }
}

/**
 * A TaskService wired with a recording queue and a deterministic random source.
 * `random = () => 0` makes the selection strategy pick the first eligible
 * contributor (alphabetical by name).
 */
export function createHarness(db: Db, random: () => number = () => 0) {
  const queue = new RecordingJobQueue();
  const service = new TaskService({
    db,
    queue,
    engine: new SimulatedRoutingEngine(queue, new RandomSelectionStrategy(random), { minDelayMs: 100, maxDelayMs: 200, slowDelayMs: 500 }, random),
    contributors: new ContributorSimulator(queue, { minDelayMs: 10, maxDelayMs: 20 }, random),
  });

  const deliverAll = async <N extends QueueName>(name: N, handle: (payload: JobPayloads[N]) => Promise<HandlerOutcome>) => {
    const outcomes: HandlerOutcome[] = [];
    for (const job of queue.take(name)) outcomes.push(await handle(job.payload));
    return outcomes;
  };

  return {
    queue,
    service,
    dispatch: () => deliverAll("route-task", ({ attemptId }) => service.dispatchAttempt(attemptId)),
    engineResponds: () => deliverAll("engine-response", ({ attemptId, result }) => service.applyEngineResponse(attemptId, result)),
    contributorResponds: () =>
      deliverAll("contributor-response", ({ assignmentId, decision }) => service.applyContributorResponse(assignmentId, decision)),
  };
}

export function taskInput(overrides: Partial<SubmitTaskInput> = {}): SubmitTaskInput {
  return {
    title: "Test task",
    priority: "normal",
    expertiseIds: ["finance"],
    scenario: "fast_match",
    contributorBehavior: "always_accept",
    ...overrides,
  };
}

export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
