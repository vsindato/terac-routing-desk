import type { Tx } from "@/db/tx";
import type { EngineResult } from "@/routing/routingEngine";
import type { ContributorDecision } from "@/simulation/contributorSimulator";

export const QUEUES = {
  routeTask: "route-task",
  engineResponse: "engine-response",
  contributorResponse: "contributor-response",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  "route-task": { attemptId: string };
  "engine-response": { attemptId: string; result: EngineResult };
  "contributor-response": { assignmentId: string; decision: ContributorDecision };
}

export interface EnqueueOptions {
  startAfter?: Date;
}

/**
 * Enqueues background jobs inside the caller's transaction, so a job exists
 * if and only if the state change that needs it was committed.
 */
export interface JobQueue {
  enqueue<N extends QueueName>(tx: Tx, name: N, payload: JobPayloads[N], options?: EnqueueOptions): Promise<void>;
}
