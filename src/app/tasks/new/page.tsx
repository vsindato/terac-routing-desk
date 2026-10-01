import { NewTaskForm } from "@/components/new-task-form";

export default function NewTaskPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New task</h1>
        <p className="text-sm text-muted-foreground">
          Submitting returns immediately. Routing continues in the background and survives a page refresh or server restart.
        </p>
      </div>
      <NewTaskForm />
    </div>
  );
}
