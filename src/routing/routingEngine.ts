import type { EngineScenario } from "@/generated/prisma/client";
import type { Tx } from "@/db/tx";
import { QUEUES, type JobQueue } from "@/jobs/jobQueue";
import type { ContributorSelectionStrategy } from "./selectionStrategy";

/** The simulated engine's normal response window. Never shown to the operator as a deadline. */
export const ROUTING_WINDOW_MS = { min: 5_000, max: 20_000 } as const;
export const NEVER_RESPONDS_PROBABILITY = 0.2;

export type EngineResult = { kind: "match"; contributorId: string } | { kind: "no_match" };

/** What the simulated engine decided when it received a request. Debug information only. */
export type EngineFate = { responds: true; delayMs: number; outcome: EngineResult } | { responds: false };

export interface RoutingRequest {
  attemptId: string;
  taskId: string;
  scenario: EngineScenario;
  eligibleContributorIds: string[];
}

/**
 * The boundary to the routing engine. Submitting is fire-and-forget: the
 * engine may later deliver an `engine-response` for the attempt, or never.
 * A real engine adapter would call an external API here and return a null fate.
 */
export interface RoutingEngine {
  submit(tx: Tx, request: RoutingRequest): Promise<EngineFate | null>;
}

export interface SimulationTiming {
  minDelayMs: number;
  maxDelayMs: number;
  /** Used by the `slow_match` scenario: deliberately outside the normal window. */
  slowDelayMs: number;
}

export const DEFAULT_TIMING: SimulationTiming = {
  minDelayMs: ROUTING_WINDOW_MS.min,
  maxDelayMs: ROUTING_WINDOW_MS.max,
  slowDelayMs: 35_000,
};

export class SimulatedRoutingEngine implements RoutingEngine {
  constructor(
    private readonly queue: JobQueue,
    private readonly strategy: ContributorSelectionStrategy,
    private readonly timing: SimulationTiming = DEFAULT_TIMING,
    private readonly random: () => number = Math.random,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(tx: Tx, request: RoutingRequest): Promise<EngineFate> {
    const fate = this.decideFate(request);
    if (fate.responds) {
      await this.queue.enqueue(
        tx,
        QUEUES.engineResponse,
        { attemptId: request.attemptId, result: fate.outcome },
        { startAfter: new Date(this.now().getTime() + fate.delayMs) },
      );
    }
    return fate;
  }

  decideFate(request: RoutingRequest): EngineFate {
    switch (request.scenario) {
      case "never_returns":
        return { responds: false };
      case "no_match":
        return { responds: true, delayMs: this.normalDelay(), outcome: { kind: "no_match" } };
      case "fast_match":
        return { responds: true, delayMs: this.timing.minDelayMs, outcome: this.select(request) };
      case "slow_match":
        return { responds: true, delayMs: this.timing.slowDelayMs, outcome: this.select(request) };
      case "random":
        if (this.random() < NEVER_RESPONDS_PROBABILITY) return { responds: false };
        return { responds: true, delayMs: this.normalDelay(), outcome: this.select(request) };
    }
  }

  private select(request: RoutingRequest): EngineResult {
    const contributorId = this.strategy.select({
      taskId: request.taskId,
      eligibleContributorIds: request.eligibleContributorIds,
    });
    return contributorId ? { kind: "match", contributorId } : { kind: "no_match" };
  }

  private normalDelay(): number {
    const { minDelayMs, maxDelayMs } = this.timing;
    return Math.round(minDelayMs + this.random() * (maxDelayMs - minDelayMs));
  }
}
