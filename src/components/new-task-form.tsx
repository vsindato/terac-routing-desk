"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { OptionPicker } from "@/components/option-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ContributorBehavior, EngineScenario, Priority } from "@/generated/prisma/enums";
import { api, queryKeys } from "@/lib/api";
import { CONTRIBUTOR_BEHAVIORS, ENGINE_SCENARIOS, PRIORITIES, PRIORITY } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function NewTaskForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: expertise = [] } = useQuery({ queryKey: queryKeys.expertise, queryFn: api.listExpertise });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [expertiseIds, setExpertiseIds] = useState<string[]>([]);
  const [scenario, setScenario] = useState<EngineScenario>("random");
  const [contributorBehavior, setContributorBehavior] = useState<ContributorBehavior>("auto");

  const submit = useMutation({
    mutationFn: api.submitTask,
    onSuccess: ({ taskId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast.success("Task submitted for routing");
      router.push(`/tasks/${taskId}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleExpertise = (id: string) =>
    setExpertiseIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate({ title, description: description || undefined, priority, expertiseIds, scenario, contributorBehavior });
      }}
    >
      <section className="flex flex-col gap-5 rounded-xl border bg-background p-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Hospital readmissions analysis" required minLength={3} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context for the contributor" />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Required expertise</Label>
          <p className="text-xs text-muted-foreground">Only contributors with every selected area are eligible.</p>
          <div className="flex flex-wrap gap-2">
            {expertise.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={expertiseIds.includes(item.id)}
                onClick={() => toggleExpertise(item.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  expertiseIds.includes(item.id) ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Priority</Label>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={priority === value}
                onClick={() => setPriority(value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  priority === value ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {PRIORITY[value].label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5 rounded-xl border border-dashed bg-background p-6">
        <div>
          <h2 className="text-sm font-semibold">Simulation controls</h2>
          <p className="text-xs text-muted-foreground">
            Demo-only: choose how the simulated routing engine and the offered contributor will behave for this task.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Routing engine</Label>
          <OptionPicker name="Routing engine" value={scenario} options={ENGINE_SCENARIOS} onChange={setScenario} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Contributor response</Label>
          <OptionPicker name="Contributor response" value={contributorBehavior} options={CONTRIBUTOR_BEHAVIORS} onChange={setContributorBehavior} />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submit.isPending || expertiseIds.length === 0 || title.trim().length < 3}>
          {submit.isPending ? "Submitting…" : "Submit for routing"}
        </Button>
      </div>
    </form>
  );
}
