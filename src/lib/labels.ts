import type {
  AssignmentStatus,
  AttemptStatus,
  ContributorBehavior,
  EngineScenario,
  Priority,
  TaskStatus,
} from "@/generated/prisma/enums";

export type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone; description: string }> = {
  routing: { label: "Routing", tone: "info", description: "Waiting for the routing engine to respond" },
  offered: { label: "Offered", tone: "progress", description: "Offered to a contributor, waiting for their answer" },
  assigned: { label: "Assigned", tone: "success", description: "A contributor accepted; routing is complete" },
  unmatched: { label: "No match", tone: "warning", description: "The engine found nobody eligible" },
  needs_attention: { label: "Needs attention", tone: "danger", description: "Declined, failed or cancelled; an operator should decide what's next" },
};

export const ATTEMPT_STATUS: Record<AttemptStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "info" },
  matched: { label: "Matched", tone: "success" },
  no_match: { label: "No match", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, { label: string; tone: Tone }> = {
  offered: { label: "Pending", tone: "progress" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  revoked: { label: "Revoked", tone: "neutral" },
};

export const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  urgent: { label: "Urgent", tone: "danger" },
  high: { label: "High", tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
  low: { label: "Low", tone: "neutral" },
};

export const ENGINE_SCENARIOS: Record<EngineScenario, { label: string; description: string }> = {
  random: { label: "Realistic", description: "5–20s to respond; 20% of requests never respond" },
  fast_match: { label: "Fast match", description: "Responds with a match after 5s" },
  slow_match: { label: "Slow match", description: "Responds after 35s, well past the normal window" },
  never_returns: { label: "Never returns", description: "The engine never responds" },
  no_match: { label: "No match", description: "Responds in 5–20s with no match" },
};

export const CONTRIBUTOR_BEHAVIORS: Record<ContributorBehavior, { label: string; description: string }> = {
  auto: { label: "Realistic", description: "Usually accepts; sometimes declines (20%) or fails (10%)" },
  always_accept: { label: "Always accept", description: "The offered contributor accepts" },
  always_decline: { label: "Always decline", description: "The offered contributor declines" },
  fail_before_start: { label: "Fail before start", description: "The contributor drops out before work begins" },
};

export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
