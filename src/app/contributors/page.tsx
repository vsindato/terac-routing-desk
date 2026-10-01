import { ContributorRoster } from "@/components/contributor-roster";

export default function ContributorsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Contributors</h1>
        <p className="text-sm text-muted-foreground">
          Who can take which work, and every offer they have received. Contributor responses are simulated.
        </p>
      </div>
      <ContributorRoster />
    </div>
  );
}
