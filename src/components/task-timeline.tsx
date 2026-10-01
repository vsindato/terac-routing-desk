import type { TaskDetailData } from "@/lib/api";
import type { Tone } from "@/lib/labels";
import { ToneBadge } from "@/components/tone-badge";
import { formatClock, formatDuration, secondsBetween } from "@/lib/time";
import { cn } from "@/lib/utils";

const ACTOR_TONE: Record<TaskDetailData["events"][number]["actor"], Tone> = {
  operator: "info",
  engine: "progress",
  contributor: "success",
  system: "neutral",
};

const WARNING_TYPES = new Set(["engine_response_ignored", "contributor_response_ignored", "routing_superseded", "routing_cancelled"]);
const DANGER_TYPES = new Set(["offer_declined", "offer_failed", "engine_no_match", "assignment_revoked"]);

/** The full audit trail, oldest first, with each event tied to its routing attempt. */
export function TaskTimeline({ task }: { task: TaskDetailData }) {
  const attemptNumber = new Map(task.attempts.map((attempt, index) => [attempt.id, task.attempts.length - index]));

  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {task.events.map((event) => (
        <li key={event.id} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-muted-foreground",
              WARNING_TYPES.has(event.type) && "bg-amber-500",
              DANGER_TYPES.has(event.type) && "bg-rose-500",
              event.type === "offer_accepted" && "bg-emerald-500",
            )}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatClock(event.createdAt)}</span>
            <span className="tabular-nums">+{formatDuration(secondsBetween(task.createdAt, new Date(event.createdAt)))}</span>
            <ToneBadge tone={ACTOR_TONE[event.actor]}>{event.actor}</ToneBadge>
            {event.attemptId && attemptNumber.has(event.attemptId) && <span>Attempt {attemptNumber.get(event.attemptId)}</span>}
          </div>
          <p className="mt-0.5 text-sm">{event.message}</p>
        </li>
      ))}
    </ol>
  );
}
