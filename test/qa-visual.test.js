import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareVisionImages, QA_VIEWPORTS } from "../lib/pipeline/steps/qa_visual.js";

test("visual QA covers desktop and both supported mobile widths", () => {
  assert.deepEqual(
    QA_VIEWPORTS.map(({ name, width }) => [name, width]),
    [["desktop", 1440], ["mobile", 390], ["mobile_360", 360]]
  );
});

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
  assert.equal(images.length, 4);
  const tileMetadata = await sharp(images[1].buffer).metadata();
  assert.equal(tileMetadata.width, 1170);
  assert.ok(tileMetadata.height > 3000);
  assert.equal(tileMetadata.format, "jpeg");
});

test("360px audit keeps deterministic coverage without duplicating all vision tiles", async () => {
  const screenshot = await sharp({
    create: {
      width: 360,
      height: 9000,
      channels: 3,
      background: "#ffffff",
    },
  }).png().toBuffer();
  const images = await prepareVisionImages(screenshot, { name: "mobile_360", width: 360, height: 800 });
  assert.equal(images.length, 1);
  assert.equal(images[0].mediaType, "image/jpeg");
});
