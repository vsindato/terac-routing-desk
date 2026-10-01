"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExpertiseChips } from "@/components/expertise-chips";
import { RoutingClock, routingPhase } from "@/components/routing-clock";
import { ToneBadge } from "@/components/tone-badge";
import { useNow } from "@/hooks/useNow";
import { api, POLL_INTERVAL_MS, queryKeys, type Task } from "@/lib/api";
import { ASSIGNMENT_STATUS, PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDuration, secondsBetween } from "@/lib/time";
import { cn } from "@/lib/utils";

type FilterId = "all" | "attention" | "routing" | "offered" | "assigned";

function needsOperator(task: Task, now: number): boolean {
  if (task.status === "needs_attention" || task.status === "unmatched") return true;
  return task.status === "routing" && task.currentAttempt !== null && routingPhase(task.currentAttempt, now) === "stuck_in_queue";
}

const FILTERS: { id: FilterId; label: string; matches: (task: Task, now: number) => boolean }[] = [
  { id: "all", label: "All", matches: () => true },
  { id: "attention", label: "Needs a decision", matches: needsOperator },
  { id: "routing", label: "Routing", matches: (task) => task.status === "routing" },
  { id: "offered", label: "Offered", matches: (task) => task.status === "offered" },
  { id: "assigned", label: "Assigned", matches: (task) => task.status === "assigned" },
];

export function TaskBoard() {
  const now = useNow();
  const [filter, setFilter] = useState<FilterId>("all");
  const { data: tasks, error, isPending } = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: api.listTasks,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, tasks?.filter((task) => f.matches(task, now)).length ?? 0])),
    [tasks, now],
  );
  const activeFilter = FILTERS.find((f) => f.id === filter)!;
  const visible = tasks?.filter((task) => activeFilter.matches(task, now)) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Live view of every task. A pending routing request may be slow or may never return, and there is no way to tell
          which, so nothing is auto-failed: you decide when to stop waiting.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
              filter === f.id ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
              f.id === "attention" && counts.attention > 0 && filter !== f.id && "border-rose-300 text-rose-700 dark:text-rose-400",
            )}
          >
            {f.label}
            <span className="text-xs tabular-nums opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Task</th>
              <th className="px-4 py-2.5 font-medium">Priority</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Contributor</th>
              <th className="px-4 py-2.5 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {isPending && <EmptyRow>Loading tasks…</EmptyRow>}
            {error && <EmptyRow>Could not load tasks: {error.message}</EmptyRow>}
            {tasks && visible.length === 0 && <EmptyRow>No tasks here.</EmptyRow>}
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} now={now} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskRow({ task, now }: { task: Task; now: number }) {
  const status = TASK_STATUS[task.status];
  const priority = PRIORITY[task.priority];
  const attention = needsOperator(task, now);

  return (
    <tr className={cn("border-b last:border-0 hover:bg-muted/40", attention && "bg-rose-50/40 dark:bg-rose-950/10")}>
      <td className="px-4 py-3">
        <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
          {task.title}
        </Link>
        <div className="mt-1.5">
          <ExpertiseChips expertise={task.expertise} />
        </div>
      </td>
      <td className="px-4 py-3">
        <ToneBadge tone={priority.tone}>{priority.label}</ToneBadge>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <ToneBadge tone={status.tone} className="w-fit">
            {status.label}
          </ToneBadge>
          {task.status === "routing" && task.currentAttempt && <RoutingClock attempt={task.currentAttempt} now={now} />}
          {task.attemptCount > 1 && <span className="text-xs text-muted-foreground">Routing attempt {task.attemptCount}</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        {task.activeAssignment ? (
          <div className="flex flex-col gap-1">
            <span>{task.activeAssignment.contributor.name}</span>
            <ToneBadge tone={ASSIGNMENT_STATUS[task.activeAssignment.status].tone} className="w-fit">
              {ASSIGNMENT_STATUS[task.activeAssignment.status].label}
            </ToneBadge>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
        {formatDuration(secondsBetween(task.createdAt, now))}
      </td>
    </tr>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
