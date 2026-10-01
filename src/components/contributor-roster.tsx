"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExpertiseChips } from "@/components/expertise-chips";
import { ToneBadge } from "@/components/tone-badge";
import { api, POLL_INTERVAL_MS, queryKeys } from "@/lib/api";
import { ASSIGNMENT_STATUS } from "@/lib/labels";

/** Read-only: contributors act only through the simulation, never through this UI. */
export function ContributorRoster() {
  const { data: contributors, error, isPending } = useQuery({
    queryKey: queryKeys.contributors,
    queryFn: api.listContributors,
    refetchInterval: POLL_INTERVAL_MS * 2,
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading contributors…</p>;
  if (error) return <p className="text-sm text-rose-600">Could not load contributors: {error.message}</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {contributors.map((contributor) => (
        <section key={contributor.id} className="flex flex-col gap-3 rounded-xl border bg-background p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">{contributor.name}</h2>
              <p className="text-xs text-muted-foreground">{contributor.email}</p>
            </div>
            <ExpertiseChips expertise={contributor.expertise} />
          </div>
          {contributor.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assignments yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {contributor.assignments.map((assignment) => (
                <li key={assignment.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/tasks/${assignment.taskId}`} className="truncate hover:underline">
                    {assignment.taskTitle}
                  </Link>
                  <ToneBadge tone={ASSIGNMENT_STATUS[assignment.status].tone}>{ASSIGNMENT_STATUS[assignment.status].label}</ToneBadge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
