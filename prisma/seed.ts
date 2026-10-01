import "dotenv/config";
import { createPrismaClient } from "../src/db/client";
import type {
  AssignmentStatus,
  AttemptStatus,
  ContributorBehavior,
  Priority,
  TaskStatus,
} from "../src/generated/prisma/client";
import type { NewTaskEvent } from "../src/domain/events";
import { ROUTING_WINDOW_MS } from "../src/routing/routingEngine";

const prisma = createPrismaClient(process.env.DATABASE_URL!);

const EXPERTISE = [
  { id: "finance", label: "Finance" },
  { id: "healthcare", label: "Healthcare" },
  { id: "data_analysis", label: "Data analysis" },
  { id: "operations", label: "Operations" },
];

const CONTRIBUTORS = [
  { name: "Ava Chen", expertise: ["finance", "data_analysis"] },
  { name: "Ben Okafor", expertise: ["healthcare"] },
  { name: "Carla Ruiz", expertise: ["healthcare", "operations"] },
  { name: "Dev Patel", expertise: ["data_analysis"] },
  { name: "Elena Rossi", expertise: ["finance"] },
  { name: "Femi Adeyemi", expertise: ["operations", "data_analysis"] },
  { name: "Grace Kim", expertise: ["healthcare", "data_analysis"] },
  { name: "Hiro Tanaka", expertise: ["finance", "operations"] },
];

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);
const secondsAfter = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE task_events, assignments, routing_attempts, task_expertise, tasks,
              contributor_expertise, contributors, expertise CASCADE`,
  );
}

async function seedCatalog(): Promise<Map<string, string>> {
  await prisma.expertise.createMany({ data: EXPERTISE });
  const idsByName = new Map<string, string>();
  for (const contributor of CONTRIBUTORS) {
    const created = await prisma.contributor.create({
      data: {
        name: contributor.name,
        email: `${contributor.name.split(" ")[0].toLowerCase()}@contributors.terac.dev`,
        expertise: { create: contributor.expertise.map((expertiseId) => ({ expertiseId })) },
      },
    });
    idsByName.set(contributor.name, created.id);
  }
  return idsByName;
}

/** Builds a task's rows and audit trail directly, as if it had already been through the system. */
class TaskHistoryBuilder {
  private events: NewTaskEvent[] = [];
  readonly taskId: string;

  private constructor(taskId: string) {
    this.taskId = taskId;
  }

  static async create(spec: {
    title: string;
    description: string;
    priority: Priority;
    status: TaskStatus;
    expertise: string[];
    createdAt: Date;
    contributorBehavior?: ContributorBehavior;
  }) {
    const task = await prisma.task.create({
      data: {
        title: spec.title,
        description: spec.description,
        priority: spec.priority,
        status: spec.status,
        contributorBehavior: spec.contributorBehavior ?? "auto",
        createdAt: spec.createdAt,
        expertise: { create: spec.expertise.map((expertiseId) => ({ expertiseId })) },
      },
    });
    const builder = new TaskHistoryBuilder(task.id);
    builder.event({ type: "task_created", actor: "operator", message: `Task created: ${spec.title}`, createdAt: spec.createdAt });
    return builder;
  }

  event(event: Omit<NewTaskEvent, "taskId">) {
    this.events.push({ ...event, taskId: this.taskId });
  }

  async attempt(spec: {
    status: AttemptStatus;
    createdAt: Date;
    eligible: string[];
    simulatedFate: object;
    respondedAt?: Date;
    response?: object;
    responseIgnored?: boolean;
    resolvedAt?: Date;
    resolutionReason?: string;
    current?: boolean;
  }) {
    const attempt = await prisma.routingAttempt.create({
      data: {
        taskId: this.taskId,
        status: spec.status,
        eligibleContributorIds: spec.eligible,
        simulatedFate: spec.simulatedFate,
        dispatchedAt: secondsAfter(spec.createdAt, 1),
        expectedBy: new Date(spec.createdAt.getTime() + ROUTING_WINDOW_MS.max),
        respondedAt: spec.respondedAt,
        response: spec.response,
        responseIgnored: spec.responseIgnored ?? false,
        resolvedAt: spec.resolvedAt,
        resolutionReason: spec.resolutionReason,
        createdAt: spec.createdAt,
      },
    });
    if (spec.current ?? true) {
      await prisma.task.update({ where: { id: this.taskId }, data: { currentAttemptId: attempt.id } });
    }
    this.event({ type: "routing_requested", actor: "operator", message: "Submitted for routing", attemptId: attempt.id, createdAt: spec.createdAt });
    this.event({
      type: "routing_dispatched",
      actor: "engine",
      message: `Routing engine received the request with ${spec.eligible.length} eligible contributor(s)`,
      attemptId: attempt.id,
      createdAt: secondsAfter(spec.createdAt, 1),
    });
    return attempt.id;
  }

  async assignment(spec: {
    contributorId: string;
    attemptId: string;
    status: AssignmentStatus;
    offeredAt: Date;
    respondedAt?: Date;
    endedReason?: string;
  }) {
    const assignment = await prisma.assignment.create({
      data: { ...spec, taskId: this.taskId, source: "engine" },
    });
    return assignment.id;
  }

  async save() {
    await prisma.taskEvent.createMany({ data: this.events });
  }
}

async function seedTasks(contributors: Map<string, string>) {
  const id = (name: string) => contributors.get(name)!;

  // 1. Routine assignment: matched and accepted.
  {
    const createdAt = minutesAgo(42);
    const task = await TaskHistoryBuilder.create({
      title: "Q3 revenue reconciliation",
      description: "Reconcile Q3 revenue across billing and the general ledger.",
      priority: "high",
      status: "assigned",
      expertise: ["finance"],
      createdAt,
    });
    const respondedAt = secondsAfter(createdAt, 12);
    const eligible = [id("Ava Chen"), id("Elena Rossi"), id("Hiro Tanaka")];
    const attemptId = await task.attempt({
      status: "matched",
      createdAt,
      eligible,
      simulatedFate: { responds: true, delayMs: 11_000, outcome: { kind: "match", contributorId: id("Elena Rossi") } },
      respondedAt,
      response: { kind: "match", contributorId: id("Elena Rossi") },
      resolvedAt: respondedAt,
      resolutionReason: "Engine matched Elena Rossi",
    });
    const acceptedAt = secondsAfter(respondedAt, 4);
    const assignmentId = await task.assignment({ contributorId: id("Elena Rossi"), attemptId, status: "accepted", offeredAt: respondedAt, respondedAt: acceptedAt });
    task.event({ type: "engine_matched", actor: "engine", message: "Engine matched Elena Rossi", attemptId, assignmentId, createdAt: respondedAt });
    task.event({ type: "offer_sent", actor: "system", message: "Offer sent to Elena Rossi", attemptId, assignmentId, createdAt: respondedAt });
    task.event({ type: "offer_accepted", actor: "contributor", message: "Elena Rossi accepted the assignment (simulated)", assignmentId, createdAt: acceptedAt });
    await task.save();
  }

  // 2. Recovery: the only healthcare match so far declined.
  {
    const createdAt = minutesAgo(18);
    const task = await TaskHistoryBuilder.create({
      title: "Clinical trial site feasibility review",
      description: "Assess three candidate sites for patient recruitment capacity.",
      priority: "urgent",
      status: "needs_attention",
      expertise: ["healthcare"],
      createdAt,
      contributorBehavior: "always_decline",
    });
    const respondedAt = secondsAfter(createdAt, 9);
    const eligible = [id("Ben Okafor"), id("Carla Ruiz"), id("Grace Kim")];
    const attemptId = await task.attempt({
      status: "matched",
      createdAt,
      eligible,
      simulatedFate: { responds: true, delayMs: 8_000, outcome: { kind: "match", contributorId: id("Ben Okafor") } },
      respondedAt,
      response: { kind: "match", contributorId: id("Ben Okafor") },
      resolvedAt: respondedAt,
      resolutionReason: "Engine matched Ben Okafor",
    });
    const declinedAt = secondsAfter(respondedAt, 5);
    const assignmentId = await task.assignment({
      contributorId: id("Ben Okafor"),
      attemptId,
      status: "declined",
      offeredAt: respondedAt,
      respondedAt: declinedAt,
      endedReason: "Contributor declined",
    });
    task.event({ type: "engine_matched", actor: "engine", message: "Engine matched Ben Okafor", attemptId, assignmentId, createdAt: respondedAt });
    task.event({ type: "offer_sent", actor: "system", message: "Offer sent to Ben Okafor", attemptId, assignmentId, createdAt: respondedAt });
    task.event({ type: "offer_declined", actor: "contributor", message: "Ben Okafor declined the assignment (simulated)", assignmentId, createdAt: declinedAt });
    await task.save();
  }

  // 3. Unresolved routing: dispatched minutes ago and silent ever since.
  {
    const createdAt = minutesAgo(3);
    const task = await TaskHistoryBuilder.create({
      title: "Hospital staffing model",
      description: "Model nurse staffing levels against seasonal admissions.",
      priority: "urgent",
      status: "routing",
      expertise: ["healthcare", "operations"],
      createdAt,
    });
    await task.attempt({
      status: "pending",
      createdAt,
      eligible: [id("Carla Ruiz")],
      simulatedFate: { responds: false },
    });
    await task.save();
  }

  // 4. No match: nobody covers both finance and healthcare.
  {
    const createdAt = minutesAgo(25);
    const task = await TaskHistoryBuilder.create({
      title: "Pharma pricing benchmark",
      description: "Benchmark list prices for five specialty drugs against peers.",
      priority: "normal",
      status: "unmatched",
      expertise: ["finance", "healthcare"],
      createdAt,
    });
    const respondedAt = secondsAfter(createdAt, 7);
    const attemptId = await task.attempt({
      status: "no_match",
      createdAt,
      eligible: [],
      simulatedFate: { responds: true, delayMs: 6_000, outcome: { kind: "no_match" } },
      respondedAt,
      response: { kind: "no_match" },
      resolvedAt: respondedAt,
      resolutionReason: "Engine found no match",
    });
    task.event({ type: "engine_no_match", actor: "engine", message: "Engine found no matching contributor", attemptId, createdAt: respondedAt });
    await task.save();
  }

  // 5. Recovery: accepted contributor failed before work began.
  {
    const createdAt = minutesAgo(12);
    const task = await TaskHistoryBuilder.create({
      title: "Patient cohort churn analysis",
      description: "Identify drivers of drop-off in the 2025 diabetes cohort.",
      priority: "high",
      status: "needs_attention",
      expertise: ["healthcare", "data_analysis"],
      createdAt,
      contributorBehavior: "fail_before_start",
    });
    const respondedAt = secondsAfter(createdAt, 15);
    const attemptId = await task.attempt({
      status: "matched",
      createdAt,
      eligible: [id("Grace Kim")],
      simulatedFate: { responds: true, delayMs: 14_000, outcome: { kind: "match", contributorId: id("Grace Kim") } },
      respondedAt,
      response: { kind: "match", contributorId: id("Grace Kim") },
      resolvedAt: respondedAt,
      resolutionReason: "Engine matched Grace Kim",
    });
    const failedAt = secondsAfter(respondedAt, 3);
    const assignmentId = await task.assignment({
      contributorId: id("Grace Kim"),
      attemptId,
      status: "failed",
      offeredAt: respondedAt,
      respondedAt: failedAt,
      endedReason: "Contributor became unavailable before work began",
    });
    task.event({ type: "engine_matched", actor: "engine", message: "Engine matched Grace Kim", attemptId, assignmentId, createdAt: respondedAt });
    task.event({ type: "offer_sent", actor: "system", message: "Offer sent to Grace Kim", attemptId, assignmentId, createdAt: respondedAt });
    task.event({
      type: "offer_failed",
      actor: "contributor",
      message: "Grace Kim became unavailable before work began (simulated)",
      assignmentId,
      createdAt: failedAt,
    });
    await task.save();
  }

  // 6. Human intervention: operator rerouted a slow request, then the original came back late.
  {
    const createdAt = minutesAgo(30);
    const task = await TaskHistoryBuilder.create({
      title: "Vendor onboarding process audit",
      description: "Map the vendor onboarding steps and flag bottlenecks.",
      priority: "low",
      status: "assigned",
      expertise: ["operations"],
      createdAt,
    });
    const eligible = [id("Carla Ruiz"), id("Femi Adeyemi"), id("Hiro Tanaka")];
    const rerouteAt = secondsAfter(createdAt, 40);
    const firstAttemptId = await task.attempt({
      status: "superseded",
      createdAt,
      eligible,
      simulatedFate: { responds: true, delayMs: 55_000, outcome: { kind: "match", contributorId: id("Carla Ruiz") } },
      respondedAt: secondsAfter(createdAt, 55),
      response: { kind: "match", contributorId: id("Carla Ruiz") },
      responseIgnored: true,
      resolvedAt: rerouteAt,
      resolutionReason: "Operator rerouted",
      current: false,
    });
    task.event({
      type: "routing_superseded",
      actor: "operator",
      message: "Operator rerouted after 40s without a response",
      attemptId: firstAttemptId,
      createdAt: rerouteAt,
    });
    const secondRespondedAt = secondsAfter(rerouteAt, 6);
    const secondAttemptId = await task.attempt({
      status: "matched",
      createdAt: rerouteAt,
      eligible,
      simulatedFate: { responds: true, delayMs: 6_000, outcome: { kind: "match", contributorId: id("Hiro Tanaka") } },
      respondedAt: secondRespondedAt,
      response: { kind: "match", contributorId: id("Hiro Tanaka") },
      resolvedAt: secondRespondedAt,
      resolutionReason: "Engine matched Hiro Tanaka",
    });
    const assignmentId = await task.assignment({
      contributorId: id("Hiro Tanaka"),
      attemptId: secondAttemptId,
      status: "accepted",
      offeredAt: secondRespondedAt,
      respondedAt: secondsAfter(secondRespondedAt, 3),
    });
    task.event({ type: "engine_matched", actor: "engine", message: "Engine matched Hiro Tanaka", attemptId: secondAttemptId, assignmentId, createdAt: secondRespondedAt });
    task.event({ type: "offer_sent", actor: "system", message: "Offer sent to Hiro Tanaka", attemptId: secondAttemptId, assignmentId, createdAt: secondRespondedAt });
    task.event({
      type: "engine_response_ignored",
      actor: "engine",
      message: "Late response from an earlier request (matched Carla Ruiz) was ignored because the operator had rerouted",
      attemptId: firstAttemptId,
      createdAt: secondsAfter(createdAt, 55),
    });
    task.event({
      type: "offer_accepted",
      actor: "contributor",
      message: "Hiro Tanaka accepted the assignment (simulated)",
      assignmentId,
      createdAt: secondsAfter(secondRespondedAt, 3),
    });
    await task.save();
  }
}

async function main() {
  await reset();
  const contributors = await seedCatalog();
  await seedTasks(contributors);
  console.log(`Seeded ${EXPERTISE.length} expertise areas, ${CONTRIBUTORS.length} contributors and 6 tasks.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
