import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { submitTaskSchema } from "@/server/schemas";

export async function GET() {
  return handle(async () => {
    const { queries } = await getContainer();
    return Response.json(await queries.listTasks());
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = submitTaskSchema.parse(await request.json());
    const { service } = await getContainer();
    const { taskId } = await service.submitTask(input);
    return Response.json({ taskId }, { status: 202 });
  });
}
