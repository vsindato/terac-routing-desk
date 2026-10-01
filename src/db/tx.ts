import type { Prisma } from "@/generated/prisma/client";

/** The client handed to `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;

/**
 * Serialises every state change for one task. Prisma has no `FOR UPDATE` API,
 * so the lock is taken with raw SQL and the rest of the transaction uses the
 * typed client.
 */
export async function lockTask(tx: Tx, taskId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}
