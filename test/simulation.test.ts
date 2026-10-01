import { describe, expect, it } from "vitest";
import { NEVER_RESPONDS_PROBABILITY, SimulatedRoutingEngine, type RoutingRequest } from "@/routing/routingEngine";
import { RandomSelectionStrategy } from "@/routing/selectionStrategy";
import { ContributorSimulator } from "@/simulation/contributorSimulator";
import { RecordingJobQueue } from "./support";

const timing = { minDelayMs: 5_000, maxDelayMs: 20_000, slowDelayMs: 35_000 };

function engineWith(random: () => number) {
  return new SimulatedRoutingEngine(new RecordingJobQueue(), new RandomSelectionStrategy(random), timing, random);
}

function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return { attemptId: "a", taskId: "t", scenario: "random", eligibleContributorIds: ["c1", "c2"], ...overrides };
}

describe("SimulatedRoutingEngine", () => {
  it("never responds when the roll falls inside the 20% band", () => {
    const fate = engineWith(() => NEVER_RESPONDS_PROBABILITY - 0.01).decideFate(request());
    expect(fate).toEqual({ responds: false });
  });

  it("otherwise responds within the 5-20s window", () => {
    const fate = engineWith(() => 0.5).decideFate(request());
    expect(fate).toMatchObject({ responds: true, delayMs: 12_500 });
  });

  it("reports no match when nobody is eligible", () => {
    const fate = engineWith(() => 0.5).decideFate(request({ scenario: "fast_match", eligibleContributorIds: [] }));
    expect(fate).toEqual({ responds: true, delayMs: 5_000, outcome: { kind: "no_match" } });
  });

  it("follows forced scenarios regardless of chance", () => {
    const engine = engineWith(() => 0.99);
    expect(engine.decideFate(request({ scenario: "never_returns" }))).toEqual({ responds: false });
    expect(engine.decideFate(request({ scenario: "slow_match" }))).toMatchObject({ responds: true, delayMs: 35_000 });
    expect(engine.decideFate(request({ scenario: "no_match" }))).toMatchObject({ outcome: { kind: "no_match" } });
  });

  it("schedules a response job only when it will respond", async () => {
    const queue = new RecordingJobQueue();
    const engine = new SimulatedRoutingEngine(queue, new RandomSelectionStrategy(() => 0), timing, () => 0);
    const tx = {} as never;

    await engine.submit(tx, request({ scenario: "never_returns" }));
    expect(queue.pending("engine-response")).toHaveLength(0);

    await engine.submit(tx, request({ scenario: "fast_match" }));
    expect(queue.pending("engine-response")[0].payload).toEqual({ attemptId: "a", result: { kind: "match", contributorId: "c1" } });
  });
});

describe("RandomSelectionStrategy", () => {
  it("picks according to the random source and returns null when nobody is eligible", () => {
    expect(new RandomSelectionStrategy(() => 0.99).select({ taskId: "t", eligibleContributorIds: ["a", "b"] })).toBe("b");
    expect(new RandomSelectionStrategy(() => 0).select({ taskId: "t", eligibleContributorIds: [] })).toBeNull();
  });
});

describe("ContributorSimulator", () => {
  it("honours forced behaviours", () => {
    const simulator = new ContributorSimulator(new RecordingJobQueue(), undefined, () => 0.99);
    expect(simulator.decide("always_accept")).toBe("accept");
    expect(simulator.decide("always_decline")).toBe("decline");
    expect(simulator.decide("fail_before_start")).toBe("fail");
  });

  it("mostly accepts under realistic behaviour", () => {
    const decide = (roll: number) => new ContributorSimulator(new RecordingJobQueue(), undefined, () => roll).decide("auto");
    expect(decide(0.05)).toBe("fail");
    expect(decide(0.2)).toBe("decline");
    expect(decide(0.5)).toBe("accept");
  });
});
