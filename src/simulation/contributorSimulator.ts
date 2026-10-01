import type { ContributorBehavior } from "@/generated/prisma/client";
import type { Tx } from "@/db/tx";
import { QUEUES, type JobQueue } from "@/jobs/jobQueue";

export type ContributorDecision = "accept" | "decline" | "fail";

export interface ContributorTiming {
  minDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_CONTRIBUTOR_TIMING: ContributorTiming = { minDelayMs: 2_000, maxDelayMs: 6_000 };

/** Under `auto`, most contributors accept; some decline or drop out before starting. */
const AUTO_DECLINE_PROBABILITY = 0.2;
const AUTO_FAIL_PROBABILITY = 0.1;

/**
 * Stands in for contributors, who have no UI in this exercise. Each offer gets
 * a delayed, durable `contributor-response` job.
 */
export class ContributorSimulator {
  constructor(
    private readonly queue: JobQueue,
    private readonly timing: ContributorTiming = DEFAULT_CONTRIBUTOR_TIMING,
    private readonly random: () => number = Math.random,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async offer(tx: Tx, offer: { assignmentId: string; behavior: ContributorBehavior }): Promise<ContributorDecision> {
    const decision = this.decide(offer.behavior);
    const { minDelayMs, maxDelayMs } = this.timing;
    const delayMs = minDelayMs + this.random() * (maxDelayMs - minDelayMs);
    await this.queue.enqueue(
      tx,
      QUEUES.contributorResponse,
      { assignmentId: offer.assignmentId, decision },
      { startAfter: new Date(this.now().getTime() + delayMs) },
    );
    return decision;
  }

  decide(behavior: ContributorBehavior): ContributorDecision {
    switch (behavior) {
      case "always_accept":
        return "accept";
      case "always_decline":
        return "decline";
      case "fail_before_start":
        return "fail";
      case "auto": {
        const roll = this.random();
        if (roll < AUTO_FAIL_PROBABILITY) return "fail";
        if (roll < AUTO_FAIL_PROBABILITY + AUTO_DECLINE_PROBABILITY) return "decline";
        return "accept";
      }
    }
  }
}
