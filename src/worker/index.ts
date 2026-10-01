import "dotenv/config";
import { createPrismaClient } from "@/db/client";
import { createBoss, ensureQueues, PgBossJobQueue } from "@/jobs/pgBossJobQueue";
import { createTaskService } from "@/server/composition";
import { registerHandlers } from "./handlers";
import { reconcileUndispatchedAttempts } from "./reconcile";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

  const prisma = createPrismaClient(connectionString);
  const boss = createBoss(connectionString, "worker");
  await boss.start();
  await ensureQueues(boss);

  const queue = new PgBossJobQueue(boss);
  const service = createTaskService(prisma, queue);

  const reconciled = await reconcileUndispatchedAttempts(prisma, queue);
  if (reconciled > 0) console.log(`[worker] re-enqueued dispatch for ${reconciled} undispatched attempt(s)`);

  await registerHandlers(boss, service);
  console.log("[worker] ready");

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, stopping`);
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
