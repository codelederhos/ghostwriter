import test from "node:test";
import assert from "node:assert/strict";
import { qaBlocksAutopublish } from "../lib/pipeline/steps/qa.js";

test("a critical gate failure blocks auto-publish even with a high score", () => {
  const qa = {
    score: 9,
    gate: {
      status: "needs_revision",
      checks: [{ id: "image_quality", severity: "critical", passed: false }],
    },
  };
  assert.equal(qaBlocksAutopublish(qa, 7), true);
});

test("a passing gate above the minimum score may auto-publish", () => {
  const qa = {
    score: 9,
    gate: {
      status: "ready_for_approval",
      checks: [{ id: "image_quality", severity: "critical", passed: true }],
    },
  };
  assert.equal(qaBlocksAutopublish(qa, 7), false);
});
