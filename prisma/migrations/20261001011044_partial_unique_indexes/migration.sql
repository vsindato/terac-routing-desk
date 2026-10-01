-- Prisma's schema language cannot express partial indexes, so these invariants
-- are maintained here by hand. See the header comment in schema.prisma.

-- A task has at most one active assignee (offered or accepted).
CREATE UNIQUE INDEX "assignments_one_active_per_task"
  ON "assignments" ("task_id")
  WHERE "status" IN ('offered', 'accepted');

-- A task has at most one routing request in flight.
CREATE UNIQUE INDEX "routing_attempts_one_pending_per_task"
  ON "routing_attempts" ("task_id")
  WHERE "status" = 'pending';
