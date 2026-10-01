import type { Db } from "@/db/client";
import type {
  Assignment,
  AssignmentSource,
  AssignmentStatus,
  AttemptStatus,
  ContributorBehavior,
  EngineScenario,
  EventActor,
  Priority,
  RoutingAttempt,
  TaskStatus,
} from "@/generated/prisma/client";
import { findEligibleContributorIds } from "./eligibility";

// Read models are plain JSON-friendly shapes; dates are ISO strings once serialised.

export interface ExpertiseView {
  id: string;
  label: string;
}

export interface AttemptView {
  id: string;
  status: AttemptStatus;
  scenario: EngineScenario;
  createdAt: Date;
  dispatchedAt: Date | null;
  expectedBy: Date;
  respondedAt: Date | null;
  responseIgnored: boolean;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  eligibleCount: number;
  simulatedFate: unknown;
}

export interface AssignmentView {
  id: string;
  status: AssignmentStatus;
  source: AssignmentSource;
  contributor: { id: string; name: string };
  attemptId: string | null;
  offeredAt: Date;
  respondedAt: Date | null;
  endedReason: string | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  contributorBehavior: ContributorBehavior;
  createdAt: Date;
  expertise: ExpertiseView[];
  currentAttempt: AttemptView | null;
  activeAssignment: AssignmentView | null;
  attemptCount: number;
}

export interface TaskEventView {
  id: string;
  type: string;
  actor: EventActor;
  message: string;
  attemptId: string | null;
  assignmentId: string | null;
  createdAt: Date;
}

export interface CandidateView {
  id: string;
  name: string;
  expertise: ExpertiseView[];
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface TaskDetail extends TaskSummary {
  description: string | null;
  attempts: AttemptView[];
  assignments: AssignmentView[];
  events: TaskEventView[];
  candidates: CandidateView[];
}

export interface ContributorView {
  id: string;
  name: string;
  email: string;
  expertise: ExpertiseView[];
  assignments: { id: string; status: AssignmentStatus; taskId: string; taskTitle: string; offeredAt: Date }[];
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const assignmentInclude = { contributor: { select: { id: true, name: true } } } as const;

type AssignmentRow = Assignment & { contributor: { id: string; name: string } };

function toAttemptView(attempt: RoutingAttempt): AttemptView {
  return {
    id: attempt.id,
    status: attempt.status,
    scenario: attempt.scenario,
    createdAt: attempt.createdAt,
    dispatchedAt: attempt.dispatchedAt,
    expectedBy: attempt.expectedBy,
    respondedAt: attempt.respondedAt,
    responseIgnored: attempt.responseIgnored,
    resolvedAt: attempt.resolvedAt,
    resolutionReason: attempt.resolutionReason,
    eligibleCount: attempt.eligibleContributorIds.length,
    simulatedFate: attempt.simulatedFate,
  };
}

function toAssignmentView(assignment: AssignmentRow): AssignmentView {
  return {
    id: assignment.id,
    status: assignment.status,
    source: assignment.source,
    contributor: assignment.contributor,
    attemptId: assignment.attemptId,
    offeredAt: assignment.offeredAt,
    respondedAt: assignment.respondedAt,
    endedReason: assignment.endedReason,
  };
}

export class TaskQueries {
  constructor(private readonly db: Db) {}

  async listExpertise(): Promise<ExpertiseView[]> {
    return this.db.expertise.findMany({ orderBy: { label: "asc" } });
  }

  async listTasks(): Promise<TaskSummary[]> {
    const tasks = await this.db.task.findMany({
      include: {
        expertise: { include: { expertise: true } },
        currentAttempt: true,
        assignments: { where: { status: { in: ["offered", "accepted"] } }, include: assignmentInclude },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return tasks
      .map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        contributorBehavior: task.contributorBehavior,
        createdAt: task.createdAt,
        expertise: task.expertise.map(({ expertise }) => expertise),
        currentAttempt: task.currentAttempt ? toAttemptView(task.currentAttempt) : null,
        activeAssignment: task.assignments[0] ? toAssignmentView(task.assignments[0]) : null,
        attemptCount: task._count.attempts,
      }))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }

  async getTask(taskId: string): Promise<TaskDetail | null> {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: {
        expertise: { include: { expertise: true } },
        currentAttempt: true,
        attempts: { orderBy: { createdAt: "desc" } },
        assignments: { include: assignmentInclude, orderBy: { offeredAt: "desc" } },
        events: { orderBy: [{ createdAt: "asc" }, { sequence: "asc" }] },
      },
    });
    if (!task) return null;

    const assignments = task.assignments.map(toAssignmentView);
    const active = assignments.find((assignment) => assignment.status === "offered" || assignment.status === "accepted");
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      contributorBehavior: task.contributorBehavior,
      createdAt: task.createdAt,
      expertise: task.expertise.map(({ expertise }) => expertise),
      currentAttempt: task.currentAttempt ? toAttemptView(task.currentAttempt) : null,
      activeAssignment: active ?? null,
      attemptCount: task.attempts.length,
      attempts: task.attempts.map(toAttemptView),
      assignments,
      events: task.events.map((event) => ({
        id: event.id,
        type: event.type,
        actor: event.actor,
        message: event.message,
        attemptId: event.attemptId,
        assignmentId: event.assignmentId,
        createdAt: event.createdAt,
      })),
      candidates: await this.listCandidates(task.id, task.expertise.map(({ expertiseId }) => expertiseId)),
    };
  }

  async listContributors(): Promise<ContributorView[]> {
    const contributors = await this.db.contributor.findMany({
      include: {
        expertise: { include: { expertise: true } },
        assignments: { include: { task: { select: { id: true, title: true } } }, orderBy: { offeredAt: "desc" } },
      },
      orderBy: { name: "asc" },
    });
    return contributors.map((contributor) => ({
      id: contributor.id,
      name: contributor.name,
      email: contributor.email,
      expertise: contributor.expertise.map(({ expertise }) => expertise),
      assignments: contributor.assignments.map((assignment) => ({
        id: assignment.id,
        status: assignment.status,
        taskId: assignment.task.id,
        taskTitle: assignment.task.title,
        offeredAt: assignment.offeredAt,
      })),
    }));
  }

  /** Everyone with at least one relevant skill, with the reason they can or cannot be assigned. */
  private async listCandidates(taskId: string, requiredExpertise: string[]): Promise<CandidateView[]> {
    const [eligibleIds, contributors] = await Promise.all([
      findEligibleContributorIds(this.db, taskId),
      this.db.contributor.findMany({
        where: { expertise: { some: { expertiseId: { in: requiredExpertise } } } },
        include: {
          expertise: { include: { expertise: true } },
          assignments: { where: { taskId, status: { in: ["declined", "failed"] } }, select: { status: true } },
        },
        orderBy: { name: "asc" },
      }),
    ]);
    const eligible = new Set(eligibleIds);
    return contributors.map((contributor) => {
      const skills = contributor.expertise.map(({ expertise }) => expertise);
      const missing = requiredExpertise.filter((id) => !skills.some((skill) => skill.id === id));
      const previous = contributor.assignments[0]?.status;
      const ineligibleReason = previous
        ? `Previously ${previous} this task`
        : missing.length > 0
          ? `Missing ${missing.join(", ")}`
          : null;
      return { id: contributor.id, name: contributor.name, expertise: skills, eligible: eligible.has(contributor.id), ineligibleReason };
    });
  }
}
