import "server-only";
import type { PgBoss } from "pg-boss";
import { getPrisma } from "@/db/client";
import { TaskQueries } from "@/domain/queries";
import type { TaskService } from "@/domain/taskService";
import { createBoss, ensureQueues, PgBossJobQueue } from "@/jobs/pgBossJobQueue";
import { createTaskService } from "./composition";

interface Container {
  service: TaskService;
  queries: TaskQueries;
}

const globalForContainer = globalThis as unknown as { routingDeskContainer?: Promise<Container> };

async function build(): Promise<Container> {
  const prisma = getPrisma();
  const boss: PgBoss = createBoss(process.env.DATABASE_URL!, "producer");
  await boss.start();
  await ensureQueues(boss);
  return { service: createTaskService(prisma, new PgBossJobQueue(boss)), queries: new TaskQueries(prisma) };
}

/** One container per server process, surviving Next.js hot reloads. */
export function getContainer(): Promise<Container> {
  globalForContainer.routingDeskContainer ??= build().catch((error) => {
    globalForContainer.routingDeskContainer = undefined;
    throw error;
  });
  return globalForContainer.routingDeskContainer;
}
