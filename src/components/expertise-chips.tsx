import type { Expertise } from "@/lib/api";

export function ExpertiseChips({ expertise }: { expertise: Expertise[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {expertise.map((item) => (
        <span key={item.id} className="rounded-md border px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
          {item.label}
        </span>
      ))}
    </div>
  );
}
