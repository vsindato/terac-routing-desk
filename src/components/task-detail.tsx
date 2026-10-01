"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { ExpertiseChips } from "@/components/expertise-chips";
import { RoutingClock } from "@/components/routing-clock";
import { TaskActions } from "@/components/task-actions";
import { TaskTimeline } from "@/components/task-timeline";
import { ToneBadge } from "@/components/tone-badge";
import { useNow } from "@/hooks/useNow";
import { api, POLL_INTERVAL_MS, queryKeys, type TaskDetailData } from "@/lib/api";
import { ASSIGNMENT_STATUS, ATTEMPT_STATUS, ENGINE_SCENARIOS, PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatClock, formatDuration, secondsBetween } from "@/lib/time";

type Attempt = TaskDetailData["attempts"][number];

const CAUSE_EVENT_TYPES = new Set(["offer_declined", "offer_failed", "routing_cancelled", "assignment_revoked", "engine_no_match"]);

export function TaskDetail({ taskId }: { taskId: string }) {
  const now = useNow();
  const { data: task, error, isPending } = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: () => api.getTask(taskId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading task…</p>;
  if (error || !task) return <p className="text-sm text-rose-600">Could not load task: {error?.message}</p>;

  const status = TASK_STATUS[task.status];
  const priority = PRIORITY[task.priority];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> All tasks
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
          <ToneBadge tone={priority.tone}>{priority.label}</ToneBadge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <ExpertiseChips expertise={task.expertise} />
          <span>Created {formatDuration(secondsBetween(task.createdAt, now))} ago</span>
        </div>
        {task.description && <p className="max-w-3xl text-sm text-muted-foreground">{task.description}</p>}
      </div>

      <section className="flex flex-col gap-4 rounded-xl border bg-background p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">What&apos;s happening</h2>
          <CurrentState task={task} now={now} />
        </div>
        <TaskActions task={task} />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <AttemptsCard task={task} now={now} />
          <AssignmentsCard task={task} />
        </div>
        <section className="flex flex-col gap-4 rounded-xl border bg-background p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold">History</h2>
          <TaskTimeline task={task} />
        </section>
      </div>
    </div>
  );
}

function CurrentState({ task, now }: { task: TaskDetailData; now: number }) {
  const active = task.activeAssignment;
  const lastCause = [...task.events].reverse().find((event) => CAUSE_EVENT_TYPES.has(event.type));

  switch (task.status) {
    case "routing":
      return task.currentAttempt ? (
        <div className="flex max-w-xl flex-col gap-1">
          <RoutingClock attempt={task.currentAttempt} now={now} />
          <p className="text-sm text-muted-foreground">
            There is no way to tell a slow request from one that will never return. Keep waiting, or stop waiting and decide
            what to do next.
          </p>
        </div>
      ) : null;
    case "offered":
      return (
        <p className="text-sm text-muted-foreground">
          Offered to <span className="font-medium text-foreground">{active?.contributor.name}</span>{" "}
          {active && `${formatDuration(secondsBetween(active.offeredAt, now))} ago`}; waiting for their answer.
        </p>
      );
    case "assigned":
      return (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{active?.contributor.name}</span> accepted. Routing is complete.
        </p>
      );
    case "unmatched":
    case "needs_attention":
      return (
        <p className="text-sm text-muted-foreground">
          {lastCause ? <span className="font-medium text-foreground">{lastCause.message}.</span> : null} Reroute it, or offer it
          directly to an eligible contributor. Anyone who declined or failed this task won&apos;t be offered it again.
        </p>
      );
  }
}

function AttemptsCard({ task, now }: { task: TaskDetailData; now: number }) {
  const [revealFate, setRevealFate] = useState(false);
  const names = new Map([
    ...task.candidates.map((c) => [c.id, c.name] as const),
    ...task.assignments.map((a) => [a.contributor.id, a.contributor.name] as const),
  ]);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Routing attempts</h2>
        <button
          onClick={() => setRevealFate((value) => !value)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title="Show what the simulated engine decided. An operator would never see this."
        >
          {revealFate ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
          {revealFate ? "Hide" : "Reveal"} simulated fate
        </button>
      </div>
      {task.attempts.length === 0 && <p className="text-sm text-muted-foreground">Never routed by the engine.</p>}
      {task.attempts.map((attempt, index) => (
        <AttemptRow
          key={attempt.id}
          attempt={attempt}
          number={task.attempts.length - index}
          now={now}
          revealFate={revealFate}
          nameOf={(id) => names.get(id) ?? "unknown contributor"}
        />
      ))}
    </section>
  );
}

function AttemptRow(props: { attempt: Attempt; number: number; now: number; revealFate: boolean; nameOf: (id: string) => string }) {
  const { attempt, number, now, revealFate, nameOf } = props;
  const status = ATTEMPT_STATUS[attempt.status];
  const response = attempt.respondedAt ? secondsBetween(attempt.createdAt, new Date(attempt.respondedAt)) : null;

  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Attempt {number}</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>Started</dt>
        <dd>{formatClock(attempt.createdAt)} · {ENGINE_SCENARIOS[attempt.scenario].label} scenario</dd>
        <dt>Eligible</dt>
        <dd>{attempt.dispatchedAt ? `${attempt.eligibleCount} contributor(s)` : "Not yet dispatched"}</dd>
        <dt>Response</dt>
        <dd>
          {response === null
            ? attempt.status === "pending"
              ? `None yet (${formatDuration(secondsBetween(attempt.createdAt, now))})`
              : "None received"
            : `After ${formatDuration(response)}${attempt.responseIgnored ? " · ignored (arrived after the operator moved on)" : ""}`}
        </dd>
        {attempt.resolutionReason && (
          <>
            <dt>Outcome</dt>
            <dd>{attempt.resolutionReason}</dd>
          </>
        )}
        {revealFate && (
          <>
            <dt className="text-violet-700 dark:text-violet-400">Fate</dt>
            <dd className="text-violet-700 dark:text-violet-400">{describeFate(attempt.simulatedFate, nameOf)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function describeFate(fate: unknown, nameOf: (id: string) => string): string {
  if (!fate || typeof fate !== "object") return "Not decided yet (not dispatched)";
  const value = fate as { responds: boolean; delayMs?: number; outcome?: { kind: string; contributorId?: string } };
  if (!value.responds) return "The engine will never respond to this request";
  const outcome = value.outcome?.kind === "match" ? `match ${nameOf(value.outcome.contributorId!)}` : "no match";
  return `Responds after ${formatDuration(Math.round((value.delayMs ?? 0) / 1000))} with ${outcome}`;
}

function AssignmentsCard({ task }: { task: TaskDetailData }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-background p-5">
      <h2 className="text-sm font-semibold">Offers</h2>
      {task.assignments.length === 0 && <p className="text-sm text-muted-foreground">No contributor has been offered this task.</p>}
      {task.assignments.map((assignment) => {
        const status = ASSIGNMENT_STATUS[assignment.status];
        return (
          <div key={assignment.id} className="flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{assignment.contributor.name}</span>
              <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
            </div>
            <p className="text-xs text-muted-foreground">
              {assignment.source === "engine" ? "Matched by engine" : "Assigned by operator"} · offered {formatClock(assignment.offeredAt)}
              {assignment.endedReason && ` · ${assignment.endedReason}`}
            </p>
          </div>
        );
      })}
    </section>
  );
}
