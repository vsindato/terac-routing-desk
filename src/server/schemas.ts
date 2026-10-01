import { z } from "zod";
import { ContributorBehavior, EngineScenario, Priority } from "@/generated/prisma/enums";

const scenario = z.enum(EngineScenario).default("random");
const contributorBehavior = z.enum(ContributorBehavior).default("auto");

export const submitTaskSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(120),
  description: z.string().trim().max(1000).optional(),
  priority: z.enum(Priority).default("normal"),
  expertiseIds: z.array(z.string()).min(1, "Pick at least one area of expertise"),
  scenario,
  contributorBehavior,
});

export const taskActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel_routing") }),
  z.object({ action: z.literal("reroute"), scenario, contributorBehavior }),
  z.object({ action: z.literal("assign"), contributorId: z.uuid(), contributorBehavior }),
  z.object({ action: z.literal("revoke") }),
]);

export type SubmitTaskRequest = z.input<typeof submitTaskSchema>;
export type TaskActionRequest = z.input<typeof taskActionSchema>;
