import type { Db } from "@/db/client";
import { TaskService } from "@/domain/taskService";
import type { JobQueue } from "@/jobs/jobQueue";
import { SimulatedRoutingEngine } from "@/routing/routingEngine";
import { createSelectionStrategy } from "@/routing/selectionStrategy";
import { ContributorSimulator } from "@/simulation/contributorSimulator";

/** Wires the default production graph. Tests build their own with fakes and fast timings. */
export function createTaskService(db: Db, queue: JobQueue): TaskService {
  return new TaskService({
    db,
    queue,
    engine: new SimulatedRoutingEngine(queue, createSelectionStrategy("random")),
    contributors: new ContributorSimulator(queue),
  });
}
