-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('routing', 'offered', 'assigned', 'unmatched', 'needs_attention');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('pending', 'matched', 'no_match', 'cancelled', 'superseded');

-- CreateEnum
CREATE TYPE "EngineScenario" AS ENUM ('random', 'fast_match', 'slow_match', 'never_returns', 'no_match');

-- CreateEnum
CREATE TYPE "ContributorBehavior" AS ENUM ('auto', 'always_accept', 'always_decline', 'fail_before_start');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('offered', 'accepted', 'declined', 'failed', 'revoked');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('engine', 'operator');

-- CreateEnum
CREATE TYPE "EventActor" AS ENUM ('system', 'engine', 'operator', 'contributor');

-- CreateTable
CREATE TABLE "expertise" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "expertise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributor_expertise" (
    "contributor_id" UUID NOT NULL,
    "expertise_id" TEXT NOT NULL,

    CONSTRAINT "contributor_expertise_pkey" PRIMARY KEY ("contributor_id","expertise_id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "status" "TaskStatus" NOT NULL,
    "contributor_behavior" "ContributorBehavior" NOT NULL DEFAULT 'auto',
    "current_attempt_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_expertise" (
    "task_id" UUID NOT NULL,
    "expertise_id" TEXT NOT NULL,

    CONSTRAINT "task_expertise_pkey" PRIMARY KEY ("task_id","expertise_id")
);

-- CreateTable
CREATE TABLE "routing_attempts" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'pending',
    "scenario" "EngineScenario" NOT NULL DEFAULT 'random',
    "eligible_contributor_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "simulated_fate" JSONB,
    "dispatched_at" TIMESTAMP(3),
    "expected_by" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "response" JSONB,
    "response_ignored" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolution_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "contributor_id" UUID NOT NULL,
    "attempt_id" UUID,
    "source" "AssignmentSource" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'offered',
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "ended_reason" TEXT,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor" "EventActor" NOT NULL,
    "message" TEXT NOT NULL,
    "attempt_id" UUID,
    "assignment_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contributors_email_key" ON "contributors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_current_attempt_id_key" ON "tasks"("current_attempt_id");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "routing_attempts_task_id_idx" ON "routing_attempts"("task_id");

-- CreateIndex
CREATE INDEX "assignments_task_id_idx" ON "assignments"("task_id");

-- CreateIndex
CREATE INDEX "assignments_contributor_id_idx" ON "assignments"("contributor_id");

-- CreateIndex
CREATE INDEX "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "contributor_expertise" ADD CONSTRAINT "contributor_expertise_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributor_expertise" ADD CONSTRAINT "contributor_expertise_expertise_id_fkey" FOREIGN KEY ("expertise_id") REFERENCES "expertise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_current_attempt_id_fkey" FOREIGN KEY ("current_attempt_id") REFERENCES "routing_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_expertise" ADD CONSTRAINT "task_expertise_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_expertise" ADD CONSTRAINT "task_expertise_expertise_id_fkey" FOREIGN KEY ("expertise_id") REFERENCES "expertise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_attempts" ADD CONSTRAINT "routing_attempts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "routing_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
