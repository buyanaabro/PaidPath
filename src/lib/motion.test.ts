import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rubberband } from "./motion";

describe("rubberband", () => {
  it("returns less than the overshoot", () => {
    const overshoot = 80;
    const resisted = rubberband(overshoot, 140);
    assert.ok(resisted < overshoot);
    assert.ok(resisted > 0);
  });
});
