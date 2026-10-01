import { notFound } from "@/domain/errors";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";

export async function GET(_request: Request, context: RouteContext<"/api/tasks/[id]">) {
  return handle(async () => {
    const { id } = await context.params;
    const { queries } = await getContainer();
    const task = await queries.getTask(id);
    if (!task) throw notFound("Task");
    return Response.json(task);
  });
}
