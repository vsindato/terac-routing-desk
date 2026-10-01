import type { Db } from "@/db/client";
import { lockTask, type Tx } from "@/db/tx";
import {
  Prisma,
  type Assignment,
  type ContributorBehavior,
  type EngineScenario,
  type Priority,
  type RoutingAttempt,
  type Task,
} from "@/generated/prisma/client";
import { QUEUES, type JobQueue } from "@/jobs/jobQueue";
import { ROUTING_WINDOW_MS, type EngineResult, type RoutingEngine } from "@/routing/routingEngine";
import type { ContributorDecision, ContributorSimulator } from "@/simulation/contributorSimulator";
import { findEligibleContributorIds } from "./eligibility";
import { DomainError, invalidTransition, notFound } from "./errors";
import { recordEvent } from "./events";

export interface SubmitTaskInput {
  title: string;
  description?: string;
  priority: Priority;
  expertiseIds: string[];
  scenario: EngineScenario;
  contributorBehavior: ContributorBehavior;
}

export interface RerouteOptions {
  scenario: EngineScenario;
  contributorBehavior: ContributorBehavior;
}

/** What a background handler did with a delivery. Used for logging and tests. */
export type HandlerOutcome = "applied" | "ignored" | "duplicate" | "missing";

export interface TaskServiceDeps {
  db: Db;
  queue: JobQueue;
  engine: RoutingEngine;
  contributors: ContributorSimulator;
  now?: () => Date;
}

const ACTIVE_ASSIGNMENT = { status: { in: ["offered", "accepted"] } } satisfies Prisma.AssignmentWhereInput;

/**
 * Every state change to a task goes through here. Each command runs in one
 * transaction holding the task's row lock, writes its audit events, and
 * enqueues follow-up jobs in that same transaction.
 */
export class TaskService {
  private readonly db: Db;
  private readonly queue: JobQueue;
  private readonly engine: RoutingEngine;
  private readonly contributors: ContributorSimulator;
  private readonly now: () => Date;

  constructor(deps: TaskServiceDeps) {
    this.db = deps.db;
    this.queue = deps.queue;
    this.engine = deps.engine;
    this.contributors = deps.contributors;
    this.now = deps.now ?? (() => new Date());
  }

  // ---- Operator commands -------------------------------------------------

  async submitTask(input: SubmitTaskInput): Promise<{ taskId: string }> {
    return this.transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: "routing",
          contributorBehavior: input.contributorBehavior,
          expertise: { create: input.expertiseIds.map((expertiseId) => ({ expertiseId })) },
        },
      });
      await recordEvent(tx, { taskId: task.id, type: "task_created", actor: "operator", message: `Task created: ${task.title}` });
      await this.startAttempt(tx, task.id, input.scenario, "Submitted for routing");
      return { taskId: task.id };
    });
  }

  async cancelRouting(taskId: string): Promise<void> {
    await this.withLockedTask(taskId, async (tx, task) => {
      if (task.status !== "routing") throw invalidTransition("Only a task that is routing can have routing cancelled");
      const attempt = await this.endPendingAttempt(tx, task.id, "cancelled", "Operator cancelled routing");
      await tx.task.update({ where: { id: task.id }, data: { status: "needs_attention" } });
      await recordEvent(tx, {
        taskId,
        type: "routing_cancelled",
        actor: "operator",
        message: `Operator cancelled routing after ${this.waitedFor(attempt)} without a response`,
        attemptId: attempt?.id,
      });
    });
  }

  async rerouteTask(taskId: string, options: RerouteOptions): Promise<void> {
    await this.withLockedTask(taskId, async (tx, task) => {
      if (task.status === "assigned") throw invalidTransition("Revoke the accepted assignment before rerouting");
      await this.clearInFlightWork(tx, task.id, "Operator rerouted");
      await tx.task.update({ where: { id: task.id }, data: { contributorBehavior: options.contributorBehavior } });
      await this.startAttempt(tx, task.id, options.scenario, "Operator resubmitted for routing");
    });
  }

  async assignManually(taskId: string, contributorId: string, contributorBehavior: ContributorBehavior): Promise<void> {
    await this.withLockedTask(taskId, async (tx, task) => {
      if (task.status === "assigned") throw invalidTransition("Revoke the accepted assignment before assigning someone else");
      const eligible = await findEligibleContributorIds(tx, task.id);
      if (!eligible.includes(contributorId)) {
        throw new DomainError("not_eligible", "Contributor lacks the required expertise or has already declined or failed this task");
      }
      await this.clearInFlightWork(tx, task.id, "Operator assigned a contributor directly");
      const contributor = await tx.contributor.findUniqueOrThrow({ where: { id: contributorId } });
      await tx.task.update({ where: { id: task.id }, data: { contributorBehavior } });
      await this.offer(tx, { taskId: task.id, contributorId, attemptId: null, behavior: contributorBehavior }, {
        actor: "operator",
        message: `Operator offered the task directly to ${contributor.name}`,
      });
    });
  }

  async revokeAssignment(taskId: string): Promise<void> {
    await this.withLockedTask(taskId, async (tx, task) => {
      const revoked = await this.revokeActiveAssignment(tx, task.id, "Operator revoked the assignment");
      if (!revoked) throw invalidTransition("Task has no active assignment to revoke");
      await tx.task.update({ where: { id: task.id }, data: { status: "needs_attention" } });
    });
  }

  // ---- Background deliveries --------------------------------------------

  /** Hands a pending attempt to the routing engine. Safe to run more than once. */
  async dispatchAttempt(attemptId: string): Promise<HandlerOutcome> {
    return this.withLockedAttempt(attemptId, async (tx, attempt) => {
      if (attempt.status !== "pending") return "ignored";
      if (attempt.dispatchedAt) return "duplicate";
      const eligibleContributorIds = await findEligibleContributorIds(tx, attempt.taskId);
      const fate = await this.engine.submit(tx, {
        attemptId: attempt.id,
        taskId: attempt.taskId,
        scenario: attempt.scenario,
        eligibleContributorIds,
      });
      await tx.routingAttempt.update({
        where: { id: attempt.id },
        data: {
          dispatchedAt: this.now(),
          eligibleContributorIds,
          simulatedFate: fate ?? Prisma.DbNull,
        },
      });
      await recordEvent(tx, {
        taskId: attempt.taskId,
        type: "routing_dispatched",
        actor: "engine",
        message: `Routing engine received the request with ${eligibleContributorIds.length} eligible contributor(s)`,
        attemptId: attempt.id,
        payload: { eligibleContributorIds },
      });
      return "applied";
    });
  }

  /**
   * Applies the engine's answer only if its attempt is still the live one.
   * A response for a cancelled or superseded attempt is kept for the audit
   * trail but changes nothing.
   */
  async applyEngineResponse(attemptId: string, result: EngineResult): Promise<HandlerOutcome> {
    return this.withLockedAttempt(attemptId, async (tx, attempt) => {
      if (attempt.respondedAt) return "duplicate";
      const respondedAt = this.now();
      await tx.routingAttempt.update({ where: { id: attempt.id }, data: { respondedAt, response: result } });

      const matchedName = result.kind === "match" ? await this.contributorName(tx, result.contributorId) : null;
      const description = matchedName ? `matched ${matchedName}` : "no match";
      if (attempt.status !== "pending") {
        await tx.routingAttempt.update({ where: { id: attempt.id }, data: { responseIgnored: true } });
        await recordEvent(tx, {
          taskId: attempt.taskId,
          type: "engine_response_ignored",
          actor: "engine",
          message: `Late response (${description}) arrived ${this.waitedFor(attempt, respondedAt)} after the request and was ignored: ${attempt.resolutionReason ?? attempt.status}`,
          attemptId: attempt.id,
          payload: result,
        });
        return "ignored";
      }

      if (result.kind === "no_match") {
        await this.resolveAttempt(tx, attempt.id, "no_match", "Engine found no match");
        await tx.task.update({ where: { id: attempt.taskId }, data: { status: "unmatched" } });
        await recordEvent(tx, {
          taskId: attempt.taskId,
          type: "engine_no_match",
          actor: "engine",
          message: "Engine found no matching contributor",
          attemptId: attempt.id,
        });
        return "applied";
      }

      await this.resolveAttempt(tx, attempt.id, "matched", `Engine ${description}`);
      const task = await tx.task.findUniqueOrThrow({ where: { id: attempt.taskId } });
      await recordEvent(tx, {
        taskId: task.id,
        type: "engine_matched",
        actor: "engine",
        message: `Engine ${description}`,
        attemptId: attempt.id,
        payload: result,
      });
      await this.offer(tx, { taskId: task.id, contributorId: result.contributorId, attemptId: attempt.id, behavior: task.contributorBehavior }, {
        actor: "system",
        message: `Offer sent to ${matchedName}`,
      });
      return "applied";
    });
  }

  /** Applies a (simulated) contributor's answer to an offer that is still open. */
  async applyContributorResponse(assignmentId: string, decision: ContributorDecision): Promise<HandlerOutcome> {
    const assignment = await this.db.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) return "missing";

    return this.transaction(async (tx) => {
      await lockTask(tx, assignment.taskId);
      const current = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { contributor: true } });
      const name = current.contributor.name;

      if (current.respondedAt) return "duplicate";
      if (current.status !== "offered") {
        await recordEvent(tx, {
          taskId: current.taskId,
          type: "contributor_response_ignored",
          actor: "contributor",
          message: `${name} tried to ${decision} an offer that was already ${current.status} (simulated)`,
          assignmentId,
        });
        return "ignored";
      }

      const respondedAt = this.now();
      if (decision === "accept") {
        await tx.assignment.update({ where: { id: assignmentId }, data: { status: "accepted", respondedAt } });
        await tx.task.update({ where: { id: current.taskId }, data: { status: "assigned" } });
        await recordEvent(tx, { taskId: current.taskId, type: "offer_accepted", actor: "contributor", message: `${name} accepted the assignment (simulated)`, assignmentId });
        return "applied";
      }

      const ended =
        decision === "decline"
          ? { status: "declined" as const, reason: "Contributor declined", type: "offer_declined" as const, message: `${name} declined the assignment (simulated)` }
          : { status: "failed" as const, reason: "Contributor became unavailable before work began", type: "offer_failed" as const, message: `${name} became unavailable before work began (simulated)` };
      await tx.assignment.update({ where: { id: assignmentId }, data: { status: ended.status, respondedAt, endedReason: ended.reason } });
      await tx.task.update({ where: { id: current.taskId }, data: { status: "needs_attention" } });
      await recordEvent(tx, { taskId: current.taskId, type: ended.type, actor: "contributor", message: ended.message, assignmentId });
      return "applied";
    });
  }

  // ---- Building blocks ---------------------------------------------------

  private async startAttempt(tx: Tx, taskId: string, scenario: EngineScenario, message: string): Promise<RoutingAttempt> {
    const createdAt = this.now();
    const attempt = await tx.routingAttempt.create({
      data: { taskId, scenario, createdAt, expectedBy: new Date(createdAt.getTime() + ROUTING_WINDOW_MS.max) },
    });
    await tx.task.update({ where: { id: taskId }, data: { status: "routing", currentAttemptId: attempt.id } });
    await recordEvent(tx, { taskId, type: "routing_requested", actor: "operator", message, attemptId: attempt.id, payload: { scenario } });
    await this.queue.enqueue(tx, QUEUES.routeTask, { attemptId: attempt.id });
    return attempt;
  }

  private async resolveAttempt(tx: Tx, attemptId: string, status: "matched" | "no_match", reason: string) {
    await tx.routingAttempt.update({
      where: { id: attemptId },
      data: { status, resolvedAt: this.now(), resolutionReason: reason },
    });
  }

  private async endPendingAttempt(
    tx: Tx,
    taskId: string,
    status: "cancelled" | "superseded",
    reason: string,
  ): Promise<RoutingAttempt | null> {
    const attempt = await tx.routingAttempt.findFirst({ where: { taskId, status: "pending" } });
    if (!attempt) return null;
    return tx.routingAttempt.update({
      where: { id: attempt.id },
      data: { status, resolvedAt: this.now(), resolutionReason: reason },
    });
  }

  /** Ends whatever is in flight (a pending request or an open offer) before the operator takes over. */
  private async clearInFlightWork(tx: Tx, taskId: string, reason: string): Promise<void> {
    const superseded = await this.endPendingAttempt(tx, taskId, "superseded", reason);
    if (superseded) {
      await recordEvent(tx, {
        taskId,
        type: "routing_superseded",
        actor: "operator",
        message: `${reason} after ${this.waitedFor(superseded)} without a response; a late response will be ignored`,
        attemptId: superseded.id,
      });
    }
    await this.revokeActiveAssignment(tx, taskId, reason);
  }

  private async revokeActiveAssignment(tx: Tx, taskId: string, reason: string): Promise<Assignment | null> {
    const active = await tx.assignment.findFirst({ where: { taskId, ...ACTIVE_ASSIGNMENT }, include: { contributor: true } });
    if (!active) return null;
    const revoked = await tx.assignment.update({
      where: { id: active.id },
      data: { status: "revoked", endedReason: reason },
    });
    await recordEvent(tx, {
      taskId,
      type: "assignment_revoked",
      actor: "operator",
      message: `${reason}: ${active.status} assignment for ${active.contributor.name} revoked`,
      assignmentId: active.id,
    });
    return revoked;
  }

  private async offer(
    tx: Tx,
    offer: { taskId: string; contributorId: string; attemptId: string | null; behavior: ContributorBehavior },
    event: { actor: "system" | "operator"; message: string },
  ): Promise<void> {
    const assignment = await tx.assignment.create({
      data: {
        taskId: offer.taskId,
        contributorId: offer.contributorId,
        attemptId: offer.attemptId,
        source: offer.attemptId ? "engine" : "operator",
        offeredAt: this.now(),
      },
    });
    await tx.task.update({ where: { id: offer.taskId }, data: { status: "offered" } });
    await recordEvent(tx, {
      taskId: offer.taskId,
      type: "offer_sent",
      actor: event.actor,
      message: event.message,
      attemptId: offer.attemptId ?? undefined,
      assignmentId: assignment.id,
    });
    await this.contributors.offer(tx, { assignmentId: assignment.id, behavior: offer.behavior });
  }

  private async contributorName(tx: Tx, contributorId: string): Promise<string> {
    const contributor = await tx.contributor.findUnique({ where: { id: contributorId }, select: { name: true } });
    return contributor?.name ?? "an unknown contributor";
  }

  private waitedFor(attempt: RoutingAttempt | null, until: Date = this.now()): string {
    if (!attempt) return "0s";
    return `${Math.round((until.getTime() - attempt.createdAt.getTime()) / 1000)}s`;
  }

  private async withLockedTask<T>(taskId: string, work: (tx: Tx, task: Task) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      if (!(await lockTask(tx, taskId))) throw notFound("Task");
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      return work(tx, task);
    });
  }

  private async withLockedAttempt(
    attemptId: string,
    work: (tx: Tx, attempt: RoutingAttempt) => Promise<HandlerOutcome>,
  ): Promise<HandlerOutcome> {
    const attempt = await this.db.routingAttempt.findUnique({ where: { id: attemptId }, select: { taskId: true } });
    if (!attempt) return "missing";
    return this.transaction(async (tx) => {
      await lockTask(tx, attempt.taskId);
      const current = await tx.routingAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      return work(tx, current);
    });
  }

  /** Runs a transaction, turning partial-unique-index violations into a domain conflict. */
  private async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.$transaction(work);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DomainError("conflict", "Another change to this task happened at the same time. Refresh and try again.");
      }
      throw error;
    }
  }
}
