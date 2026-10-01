import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { taskActionSchema } from "@/server/schemas";

export async function POST(request: Request, context: RouteContext<"/api/tasks/[id]/actions">) {
  return handle(async () => {
    const { id } = await context.params;
    const action = taskActionSchema.parse(await request.json());
    const { service } = await getContainer();

    switch (action.action) {
      case "cancel_routing":
        await service.cancelRouting(id);
        break;
      case "reroute":
        await service.rerouteTask(id, { scenario: action.scenario, contributorBehavior: action.contributorBehavior });
        break;
      case "assign":
        await service.assignManually(id, action.contributorId, action.contributorBehavior);
        break;
      case "revoke":
        await service.revokeAssignment(id);
        break;
    }
    return Response.json({ ok: true });
  });
}
