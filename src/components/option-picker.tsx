import { cn } from "@/lib/utils";

/** A compact single-choice list of labelled options with descriptions. */
export function OptionPicker<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: Record<T, { label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(options) as T[]).map((key) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === key}
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-lg border px-3 py-2 text-left transition-colors",
            value === key ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "hover:bg-muted/40",
          )}
        >
          <div className="text-sm font-medium">{options[key].label}</div>
          <div className="text-xs text-muted-foreground">{options[key].description}</div>
        </button>
      ))}
    </div>
  );
}
