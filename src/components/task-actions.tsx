"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { OptionPicker } from "@/components/option-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ContributorBehavior, EngineScenario } from "@/generated/prisma/enums";
import { api, queryKeys, type TaskDetailData } from "@/lib/api";
import { CONTRIBUTOR_BEHAVIORS, ENGINE_SCENARIOS } from "@/lib/labels";
import type { TaskActionRequest } from "@/server/schemas";
import { cn } from "@/lib/utils";

function useTaskAction(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: TaskActionRequest) => api.act(taskId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contributors });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function TaskActions({ task }: { task: TaskDetailData }) {
  const action = useTaskAction(task.id);
  const isRouting = task.status === "routing";
  const isAssigned = task.status === "assigned";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {isRouting && (
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate({ action: "cancel_routing" }, { onSuccess: () => toast.success("Routing cancelled") })}
          >
            Stop waiting
          </Button>
        )}
        {!isAssigned && <RerouteDialog task={task} />}
        {!isAssigned && <AssignDialog task={task} />}
        {task.activeAssignment && (
          <Button
            variant="destructive"
            disabled={action.isPending}
            onClick={() => action.mutate({ action: "revoke" }, { onSuccess: () => toast.success("Assignment revoked") })}
          >
            Revoke {task.activeAssignment.status === "accepted" ? "assignment" : "offer"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {isRouting &&
          "Any action ends the outstanding request. If the engine responds later, its response is recorded and ignored."}
        {isAssigned && "Routing is complete. Revoke the assignment to route this task again."}
        {task.status === "offered" && "Rerouting or assigning someone else withdraws the open offer."}
      </p>
    </div>
  );
}

function RerouteDialog({ task }: { task: TaskDetailData }) {
  const action = useTaskAction(task.id);
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<EngineScenario>("random");
  const [behavior, setBehavior] = useState<ContributorBehavior>("auto");
  const excluded = task.candidates.filter((candidate) => candidate.ineligibleReason?.startsWith("Previously"));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={task.status === "routing" ? "outline" : "default"} />}>
        {task.status === "routing" ? "Reroute now" : "Route again"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send to the routing engine again</DialogTitle>
          <DialogDescription>
            A new routing request starts now.
            {task.status === "routing" && " The current request is superseded; if it responds later, the response is ignored."}
            {excluded.length > 0 && ` ${excluded.map((c) => c.name).join(", ")} will be excluded because they previously declined or failed this task.`}
          </DialogDescription>
        </DialogHeader>
        <SimulationFields scenario={scenario} onScenario={setScenario} behavior={behavior} onBehavior={setBehavior} />
        <DialogFooter>
          <Button
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { action: "reroute", scenario, contributorBehavior: behavior },
                { onSuccess: () => { setOpen(false); toast.success("Task resubmitted for routing"); } },
              )
            }
          >
            Reroute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ task }: { task: TaskDetailData }) {
  const action = useTaskAction(task.id);
  const [open, setOpen] = useState(false);
  const [contributorId, setContributorId] = useState<string | null>(null);
  const [behavior, setBehavior] = useState<ContributorBehavior>("auto");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>Assign directly</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Offer the task to a specific contributor</DialogTitle>
          <DialogDescription>
            Skips the routing engine. Any pending request is superseded and any open offer is withdrawn.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {task.candidates.length === 0 && <p className="text-sm text-muted-foreground">Nobody has any of the required expertise.</p>}
          {task.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={!candidate.eligible}
              onClick={() => setContributorId(candidate.id)}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                contributorId === candidate.id ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/40",
                !candidate.eligible && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <span className="font-medium">{candidate.name}</span>
              <span className="text-xs text-muted-foreground">
                {candidate.eligible ? candidate.expertise.map((e) => e.label).join(", ") : candidate.ineligibleReason}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Simulated contributor response</span>
          <OptionPicker name="Contributor response" value={behavior} options={CONTRIBUTOR_BEHAVIORS} onChange={setBehavior} />
        </div>
        <DialogFooter>
          <Button
            disabled={!contributorId || action.isPending}
            onClick={() =>
              contributorId &&
              action.mutate(
                { action: "assign", contributorId, contributorBehavior: behavior },
                { onSuccess: () => { setOpen(false); toast.success("Offer sent"); } },
              )
            }
          >
            Send offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimulationFields(props: {
  scenario: EngineScenario;
  onScenario: (value: EngineScenario) => void;
  behavior: ContributorBehavior;
  onBehavior: (value: ContributorBehavior) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Simulated routing engine</span>
        <OptionPicker name="Routing engine" value={props.scenario} options={ENGINE_SCENARIOS} onChange={props.onScenario} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Simulated contributor response</span>
        <OptionPicker name="Contributor response" value={props.behavior} options={CONTRIBUTOR_BEHAVIORS} onChange={props.onBehavior} />
      </div>
    </div>
  );
}
