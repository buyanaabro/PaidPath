import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RawPlan } from "./schema";
import { allocateCents, normalizePlan, PlanValidationError } from "./validate";

const task = (key: string, dependsOn: string[] = [], durationDays = 3) => ({
  key,
  name: `Task ${key}`,
  durationDays,
  dependsOn,
});

const phase = (name: string, tasks = [task("a")], sharePercent = 50) => ({
  name,
  tasks,
  milestone: { name: `${name} done`, sharePercent },
});

const plan = (phases: RawPlan["phases"]): RawPlan => ({ projectName: "Test", phases });

describe("allocateCents", () => {
  test("parts always sum exactly to the total", () => {
    for (const [total, weights] of [
      [700_000, [20, 35, 45]],
      [100_000, [1, 1, 1]],
      [12_345, [33, 33, 34]],
      [500_00, [0, -5, Number.NaN]],
    ] as const) {
      const parts = allocateCents(total, [...weights]);
      assert.equal(parts.reduce((a, b) => a + b, 0), total, `total ${total}`);
      assert.ok(parts.every((p) => p >= 0));
    }
  });

  test("bills whole dollars when the budget is whole dollars", () => {
    assert.ok(allocateCents(100_000, [1, 1, 1]).every((p) => p % 100 === 0));
  });
});

describe("normalizePlan", () => {
  test("drops forward, unknown and cross-phase dependencies (acyclic)", () => {
    const result = normalizePlan(
      plan([
        phase("One", [task("a", ["b"]), task("b", ["a", "ghost"]), task("c", ["c", "a", "a"])]),
        phase("Two", [task("x", ["a"])]),
      ]),
      100_000,
    );
    const [one, two] = result.phases;
    assert.deepEqual(one.tasks.map((t) => t.dependsOn), [[], ["a"], ["a"]]);
    assert.deepEqual(two.tasks[0].dependsOn, []);
  });

  test("clamps durations and fixes duplicate keys and blank names", () => {
    const result = normalizePlan(
      plan([
        phase("One", [task("a", [], 0), { ...task("a", [], 42.6), name: "   " }]),
        phase("Two", [task("b", [], 2.4)]),
      ]),
      100_000,
    );
    const [first, second] = result.phases[0].tasks;
    assert.equal(first.durationDays, 1);
    assert.equal(second.durationDays, 10);
    assert.notEqual(first.key, second.key);
    assert.equal(second.name, "Task 2");
    assert.equal(result.phases[1].tasks[0].durationDays, 2);
  });

  test("bounds phase and task counts", () => {
    const many = Array.from({ length: 8 }, (_, i) => task(`t${i}`));
    const result = normalizePlan(
      plan(Array.from({ length: 7 }, (_, i) => phase(`P${i}`, many))),
      500_000,
    );
    assert.equal(result.phases.length, 5);
    assert.ok(result.phases.every((p) => p.tasks.length <= 6));
    assert.ok(result.phases.reduce((n, p) => n + p.tasks.length, 0) <= 25);
  });

  test("milestone amounts sum exactly to the budget", () => {
    const result = normalizePlan(
      plan([phase("A", undefined, 30), phase("B", undefined, 30), phase("C", undefined, 30)]),
      1_000_000,
    );
    const total = result.phases.reduce((n, p) => n + p.milestone.amountCents, 0);
    assert.equal(total, 1_000_000);
  });

  test("rejects plans with fewer than two usable phases", () => {
    assert.throws(
      () => normalizePlan(plan([phase("Only"), phase("Empty", [])]), 100_000),
      PlanValidationError,
    );
  });
});
