import type { Tx } from "@/db/tx";
import type { AssignmentStatus } from "@/generated/prisma/client";

/** A contributor who declined or failed a task is never offered it again. */
export const DISQUALIFYING_STATUSES: AssignmentStatus[] = ["declined", "failed"];

/**
 * Contributors who cover every expertise area the task requires and have not
 * previously declined or failed it.
 */
export async function findEligibleContributorIds(tx: Tx, taskId: string): Promise<string[]> {
  const required = await tx.taskExpertise.findMany({ where: { taskId }, select: { expertiseId: true } });
  const contributors = await tx.contributor.findMany({
    where: {
      AND: required.map(({ expertiseId }) => ({ expertise: { some: { expertiseId } } })),
      assignments: { none: { taskId, status: { in: DISQUALIFYING_STATUSES } } },
    },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return contributors.map((contributor) => contributor.id);
}
