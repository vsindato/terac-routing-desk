import type { EventActor, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/db/tx";

export const EVENT_TYPES = [
  "task_created",
  "routing_requested",
  "routing_dispatched",
  "engine_matched",
  "engine_no_match",
  "engine_response_ignored",
  "routing_cancelled",
  "routing_superseded",
  "offer_sent",
  "offer_accepted",
  "offer_declined",
  "offer_failed",
  "contributor_response_ignored",
  "assignment_revoked",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface NewTaskEvent {
  taskId: string;
  type: EventType;
  actor: EventActor;
  message: string;
  attemptId?: string;
  assignmentId?: string;
  payload?: Prisma.InputJsonValue;
  createdAt?: Date;
}

export async function recordEvent(tx: Tx, event: NewTaskEvent): Promise<void> {
  await tx.taskEvent.create({ data: event });
}
