import type { Task } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatDuration, secondsBetween } from "@/lib/time";

/** If the worker hasn't picked a request up by now, it is probably not running. */
const UNDISPATCHED_WARNING_S = 5;

type Attempt = NonNullable<Task["currentAttempt"]>;

export type RoutingPhase = "queued" | "stuck_in_queue" | "waiting";

export function routingPhase(attempt: Attempt, now: number): RoutingPhase {
  if (attempt.dispatchedAt) return "waiting";
  return secondsBetween(attempt.createdAt, now) > UNDISPATCHED_WARNING_S ? "stuck_in_queue" : "queued";
}

const PHASE_COPY: Record<RoutingPhase, (elapsed: string) => string> = {
  queued: () => "Queued for the routing engine",
  stuck_in_queue: (elapsed) => `Not yet picked up after ${elapsed}. Is the worker running?`,
  waiting: (elapsed) => `Waiting on the routing engine · ${elapsed}`,
};

/**
 * The operator cannot know whether a pending request is slow or will never
 * return, so this only reports elapsed time and makes no judgement about it.
 * The one warning is about our own worker, which we can observe.
 */
export function RoutingClock({ attempt, now }: { attempt: Attempt; now: number }) {
  const phase = routingPhase(attempt, now);
  const elapsed = formatDuration(secondsBetween(attempt.createdAt, now));

  return (
    <p className={cn("text-xs tabular-nums", phase === "stuck_in_queue" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      {PHASE_COPY[phase](elapsed)}
    </p>
  );
}
