import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { DEMO_STORY_TODAY } from "@/db/demo-project";
import { projects, tasks } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { cleanupDemoCopies, createDemoCopy, newVisitorToken, validVisitorToken } from "./demo";
import { listProjects } from "./projects";

let db: Db;
const alice = newVisitorToken();
const bob = newVisitorToken();

beforeEach(() => {
  db = createDb(":memory:");
});

describe("demo copies", () => {
  test("each visitor gets an active demo copy that starts on the first milestone date", () => {
    const id = createDemoCopy(db, alice);
    const project = db.select().from(projects).where(eq(projects.id, id)).get()!;
    assert.equal(project.ownerToken, alice);
    assert.equal(project.isDemo, true);
    assert.equal(project.status, "active");
    assert.equal(project.demoToday, DEMO_STORY_TODAY);
    assert.ok(db.select().from(tasks).where(eq(tasks.projectId, id)).all().length >= 14);
    assert.notEqual(createDemoCopy(db, alice), id);
  });

  test("lists only the visitor's own projects plus shared ones", () => {
    const shared = seedDemoProject(db);
    const mine = createDemoCopy(db, alice);
    const theirs = createDemoCopy(db, bob);
    assert.deepEqual(listProjects(db, alice).map((p) => p.id).sort(), [shared, mine].sort());
    assert.deepEqual(listProjects(db, bob).map((p) => p.id).sort(), [shared, theirs].sort());
    assert.deepEqual(listProjects(db, null).map((p) => p.id), [shared]);
    assert.equal(listProjects(db, alice).find((p) => p.id === mine)!.isDemo, true);
  });

  test("demo copies older than 24 hours are removed; other projects stay", () => {
    const shared = seedDemoProject(db);
    const old = createDemoCopy(db, alice);
    const fresh = createDemoCopy(db, bob);
    db.update(projects).set({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() }).where(eq(projects.id, old)).run();
    db.update(projects).set({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() }).where(eq(projects.id, shared)).run();
    assert.equal(cleanupDemoCopies(db), 1);
    const ids = db.select({ id: projects.id }).from(projects).all().map((p) => p.id);
    assert.deepEqual(ids.sort(), [shared, fresh].sort());
    assert.equal(db.select().from(tasks).where(eq(tasks.projectId, old)).all().length, 0);
  });

  test("visitor tokens are validated", () => {
    assert.equal(validVisitorToken(alice), true);
    assert.equal(validVisitorToken("short"), false);
    assert.equal(validVisitorToken(undefined), false);
  });
});
