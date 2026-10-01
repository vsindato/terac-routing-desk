import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/domain/errors";
import { type Catalog, createHarness, createTestDb, resetDatabase, seedCatalog, taskInput } from "./support";

const db = createTestDb();
let catalog: Catalog;
let harness: ReturnType<typeof createHarness>;

beforeEach(async () => {
  await resetDatabase(db);
  catalog = await seedCatalog(db);
  harness = createHarness(db);
});

afterAll(() => db.$disconnect());

const getTask = (id: string) => db.task.findUniqueOrThrow({ where: { id } });
const attemptsFor = (taskId: string) => db.routingAttempt.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
const eventTypes = async (taskId: string) =>
  (await db.taskEvent.findMany({ where: { taskId }, orderBy: { sequence: "asc" } })).map((event) => event.type);

describe("routine assignment", () => {
  it("routes, offers and assigns a task, recording each step", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    expect((await getTask(taskId)).status).toBe("routing");

    expect(await harness.dispatch()).toEqual(["applied"]);
    expect(await harness.engineResponds()).toEqual(["applied"]);
    expect((await getTask(taskId)).status).toBe("offered");

    expect(await harness.contributorResponds()).toEqual(["applied"]);
    expect((await getTask(taskId)).status).toBe("assigned");

    const assignment = await db.assignment.findFirstOrThrow({ where: { taskId } });
    expect(assignment).toMatchObject({ contributorId: catalog.aliceFinance, status: "accepted", source: "engine" });
    expect(await eventTypes(taskId)).toEqual([
      "task_created",
      "routing_requested",
      "routing_dispatched",
      "engine_matched",
      "offer_sent",
      "offer_accepted",
    ]);
  });

  it("enqueues the engine response with the scenario's delay", async () => {
    await harness.service.submitTask(taskInput({ scenario: "slow_match" }));
    const before = Date.now();
    await harness.dispatch();
    const [job] = harness.queue.pending("engine-response");
    expect(job.startAfter!.getTime() - before).toBeGreaterThanOrEqual(450);
  });
});

describe("unresolved routing", () => {
  it("leaves a never-returning request pending until the operator acts", async () => {
    const { taskId } = await harness.service.submitTask(taskInput({ scenario: "never_returns" }));
    await harness.dispatch();

    expect(harness.queue.pending("engine-response")).toHaveLength(0);
    expect((await getTask(taskId)).status).toBe("routing");

    await harness.service.cancelRouting(taskId);
    expect((await getTask(taskId)).status).toBe("needs_attention");
    expect((await attemptsFor(taskId))[0].status).toBe("cancelled");
  });
});

describe("late engine responses", () => {
  it("ignores a response for an attempt the operator superseded by rerouting, and logs it", async () => {
    const { taskId } = await harness.service.submitTask(taskInput({ scenario: "slow_match" }));
    await harness.dispatch();
    const [lateResponse] = harness.queue.take("engine-response");

    await harness.service.rerouteTask(taskId, { scenario: "never_returns", contributorBehavior: "always_accept" });
    const outcome = await harness.service.applyEngineResponse(lateResponse.payload.attemptId, lateResponse.payload.result);

    expect(outcome).toBe("ignored");
    const [first, second] = await attemptsFor(taskId);
    expect(first).toMatchObject({ status: "superseded", responseIgnored: true });
    expect(first.respondedAt).not.toBeNull();
    expect(second.status).toBe("pending");
    expect((await getTask(taskId)).status).toBe("routing");
    expect(await db.assignment.count({ where: { taskId } })).toBe(0);
    expect(await eventTypes(taskId)).toContain("engine_response_ignored");
  });

  it("ignores a response that arrives after the operator cancelled routing", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await harness.dispatch();
    await harness.service.cancelRouting(taskId);

    expect(await harness.engineResponds()).toEqual(["ignored"]);
    expect((await getTask(taskId)).status).toBe("needs_attention");
  });

  it("ignores a response once the operator has assigned someone directly", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await harness.dispatch();
    await harness.service.assignManually(taskId, catalog.bobFinance, "always_accept");

    expect(await harness.engineResponds()).toEqual(["ignored"]);
    const active = await db.assignment.findMany({ where: { taskId, status: { in: ["offered", "accepted"] } } });
    expect(active.map((assignment) => assignment.contributorId)).toEqual([catalog.bobFinance]);
  });
});

describe("idempotent delivery", () => {
  it("does not create a second assignment when the same engine response is delivered twice", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await harness.dispatch();
    const [job] = harness.queue.take("engine-response");

    expect(await harness.service.applyEngineResponse(job.payload.attemptId, job.payload.result)).toBe("applied");
    expect(await harness.service.applyEngineResponse(job.payload.attemptId, job.payload.result)).toBe("duplicate");
    expect(await db.assignment.count({ where: { taskId } })).toBe(1);
  });

  it("dispatches an attempt only once", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    const [job] = harness.queue.take("route-task");

    expect(await harness.service.dispatchAttempt(job.payload.attemptId)).toBe("applied");
    expect(await harness.service.dispatchAttempt(job.payload.attemptId)).toBe("duplicate");
    expect(harness.queue.pending("engine-response")).toHaveLength(1);
    expect((await eventTypes(taskId)).filter((type) => type === "routing_dispatched")).toHaveLength(1);
  });

  it("reports a job for a deleted attempt as missing instead of failing", async () => {
    expect(await harness.service.dispatchAttempt("00000000-0000-0000-0000-000000000000")).toBe("missing");
  });
});

describe("recovery after a decline or failure", () => {
  it("never offers the task again to a contributor who declined it", async () => {
    const { taskId } = await harness.service.submitTask(taskInput({ contributorBehavior: "always_decline" }));
    await harness.dispatch();
    await harness.engineResponds();
    await harness.contributorResponds();
    expect((await getTask(taskId)).status).toBe("needs_attention");

    await harness.service.rerouteTask(taskId, { scenario: "fast_match", contributorBehavior: "always_accept" });
    await harness.dispatch();
    const [, second] = await attemptsFor(taskId);
    expect(second.eligibleContributorIds).toEqual([catalog.bobFinance]);

    await harness.engineResponds();
    await harness.contributorResponds();
    const accepted = await db.assignment.findFirstOrThrow({ where: { taskId, status: "accepted" } });
    expect(accepted.contributorId).toBe(catalog.bobFinance);
  });

  it("rejects a direct assignment to a contributor who failed the task", async () => {
    const { taskId } = await harness.service.submitTask(taskInput({ contributorBehavior: "fail_before_start" }));
    await harness.dispatch();
    await harness.engineResponds();
    await harness.contributorResponds();

    await expect(harness.service.assignManually(taskId, catalog.aliceFinance, "always_accept")).rejects.toMatchObject({
      code: "not_eligible",
    });
  });

  it("rejects a direct assignment to someone without the required expertise", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await expect(harness.service.assignManually(taskId, catalog.caraHealth, "always_accept")).rejects.toBeInstanceOf(DomainError);
  });
});

describe("no match", () => {
  it("marks the task unmatched when nobody has every required expertise", async () => {
    const { taskId } = await harness.service.submitTask(taskInput({ expertiseIds: ["finance", "healthcare"] }));
    await harness.dispatch();

    expect((await attemptsFor(taskId))[0].eligibleContributorIds).toEqual([]);
    await harness.engineResponds();
    expect((await getTask(taskId)).status).toBe("unmatched");
    expect((await attemptsFor(taskId))[0].status).toBe("no_match");
  });
});

describe("operator revokes an open offer", () => {
  it("ignores the contributor's answer once the offer was revoked", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await harness.dispatch();
    await harness.engineResponds();
    await harness.service.revokeAssignment(taskId);

    expect(await harness.contributorResponds()).toEqual(["ignored"]);
    expect((await getTask(taskId)).status).toBe("needs_attention");
    expect(await eventTypes(taskId)).toContain("contributor_response_ignored");
  });

  it("refuses to reroute a task that is already assigned", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await harness.dispatch();
    await harness.engineResponds();
    await harness.contributorResponds();

    await expect(
      harness.service.rerouteTask(taskId, { scenario: "fast_match", contributorBehavior: "always_accept" }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("database invariants", () => {
  it("allows at most one active assignment per task", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    await harness.dispatch();
    await harness.engineResponds();

    const secondOffer = db.assignment.create({
      data: { taskId, contributorId: catalog.bobFinance, source: "operator" },
    });
    await expect(secondOffer).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  it("allows at most one pending routing attempt per task", async () => {
    const { taskId } = await harness.service.submitTask(taskInput());
    const secondAttempt = db.routingAttempt.create({ data: { taskId, expectedBy: new Date() } });
    await expect(secondAttempt).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });
});
