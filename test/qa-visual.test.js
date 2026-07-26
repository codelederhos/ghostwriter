import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareVisionImages } from "../lib/pipeline/steps/qa_visual.js";

test("long mobile screenshots keep readable-width tiles instead of one narrow full-page image", async () => {
  const screenshot = await sharp({
    create: {
      width: 390,
      height: 9000,
      channels: 3,
      background: "#ffffff",
    },
  }).png().toBuffer();
  const images = await prepareVisionImages(screenshot, { name: "mobile", width: 390, height: 844 });
  assert.equal(images.length, 5);
  const tileMetadata = await sharp(images[1].buffer).metadata();
  assert.equal(tileMetadata.width, 1170);
  assert.ok(tileMetadata.height > 3000);
});
