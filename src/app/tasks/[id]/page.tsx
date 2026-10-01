import { TaskDetail } from "@/components/task-detail";

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  return <TaskDetail taskId={id} />;
}
