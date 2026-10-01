export interface SelectionContext {
  taskId: string;
  eligibleContributorIds: string[];
}

/** Picks the one contributor to offer a task to, or null when nobody is eligible. */
export interface ContributorSelectionStrategy {
  readonly name: string;
  select(context: SelectionContext): string | null;
}

export class RandomSelectionStrategy implements ContributorSelectionStrategy {
  readonly name = "random";

  constructor(private readonly random: () => number = Math.random) {}

  select({ eligibleContributorIds }: SelectionContext): string | null {
    if (eligibleContributorIds.length === 0) return null;
    const index = Math.floor(this.random() * eligibleContributorIds.length);
    return eligibleContributorIds[index];
  }
}

const STRATEGY_FACTORIES = {
  random: () => new RandomSelectionStrategy(),
} satisfies Record<string, () => ContributorSelectionStrategy>;

export type SelectionStrategyName = keyof typeof STRATEGY_FACTORIES;

export function createSelectionStrategy(name: SelectionStrategyName = "random"): ContributorSelectionStrategy {
  return STRATEGY_FACTORIES[name]();
}
