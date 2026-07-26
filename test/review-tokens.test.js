import test from "node:test";
import assert from "node:assert/strict";
import {
  adminPreviewToken,
  adminPublishToken,
  postIdFromDeterministicToken,
} from "../lib/review/tokens.js";

test("review tokens keep preview and publish capabilities separate", () => {
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "test-only-review-token-key";
  try {
    const postId = "11111111-2222-4333-8444-555555555555";
    const preview = adminPreviewToken(postId);
    const publish = adminPublishToken(postId);
    assert.equal(postIdFromDeterministicToken("preview", preview), postId);
    assert.equal(postIdFromDeterministicToken("publish", publish), postId);
    assert.equal(postIdFromDeterministicToken("publish", preview), null);
    assert.equal(postIdFromDeterministicToken("preview", `${preview.slice(0, -1)}0`), null);
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  }
});
