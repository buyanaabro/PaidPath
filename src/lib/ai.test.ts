import assert from "node:assert/strict";
import { test } from "node:test";
import { copilotModelChain, modelChain } from "./ai";

test("copilot tries Flash-Lite first; plan generation keeps its chain", () => {
  assert.deepEqual(copilotModelChain(), ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]);
  assert.equal(modelChain()[0], "gemini-3.5-flash");
});
