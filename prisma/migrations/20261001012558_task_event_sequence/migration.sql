-- DropIndex
DROP INDEX "task_events_task_id_created_at_idx";

-- AlterTable
ALTER TABLE "task_events" ADD COLUMN     "sequence" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "task_events_task_id_sequence_idx" ON "task_events"("task_id", "sequence");
