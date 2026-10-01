import { getContainer } from "@/server/container";
import { handle } from "@/server/http";

export async function GET() {
  return handle(async () => {
    const { queries } = await getContainer();
    return Response.json(await queries.listContributors());
  });
}
