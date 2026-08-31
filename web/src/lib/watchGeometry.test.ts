import assert from "node:assert/strict";
import test from "node:test";

import {
  computeWatchCrop,
  computeWatchGeometry,
  computeWrappedWatchGeometry,
  validateWatchGeometry,
  WATCH_FACE_DIAMETER,
} from "./watchGeometry.ts";

test("centers a 50px watch face on the guide", () => {
  const geometry = computeWatchGeometry({ x: 100, y: 80 }, { x: 200, y: 80 });
  assert.deepEqual(geometry.center, { x: 150, y: 80 });
  assert.equal(geometry.faceDiameter, WATCH_FACE_DIAMETER);
  assert.equal(geometry.angle, 0);
  assert.equal(validateWatchGeometry(geometry, 585, 559), null);
});

test("supports diagonal guides and creates a contained square crop", () => {
  const geometry = computeWatchGeometry({ x: 100, y: 100 }, { x: 180, y: 180 });
  const crop = computeWatchCrop(geometry, 585, 559);
  assert.equal(crop.size >= 130, true);
  assert.equal(crop.x >= 0 && crop.x + crop.size <= 585, true);
  assert.equal(crop.y >= 0 && crop.y + crop.size <= 559, true);
});

test("rejects short and clipped guides", () => {
  const short = computeWatchGeometry({ x: 100, y: 100 }, { x: 130, y: 100 });
  assert.match(validateWatchGeometry(short, 585, 559) || "", /at least 70/);

  const clipped = computeWatchGeometry({ x: 5, y: 5 }, { x: 105, y: 5 });
  assert.match(validateWatchGeometry(clipped, 585, 559) || "", /fits on the texture/);
});

test("wraps a watch face across opposite edges of an arm strip", () => {
  const geometry = computeWrappedWatchGeometry(
    { x: 225, y: 410 },
    { x: 305, y: 410 },
    { faceDiameter: 60, strapWidth: 18, wrapOffset: 20 },
  );

  assert.ok(geometry);
  assert.equal(geometry.clipRect?.width, 259);
  assert.equal(geometry.faceDiameter, 60);
  assert.equal(geometry.strapWidth, 18);
  assert.equal(geometry.faceCenters?.length, 2);
  assert.equal(validateWatchGeometry(geometry, 585, 559), null);
});

test("moves the face around the arm loop without changing band coverage", () => {
  const base = computeWrappedWatchGeometry(
    { x: 80, y: 410 },
    { x: 160, y: 410 },
    { faceDiameter: 40, strapWidth: 12, wrapOffset: 0 },
  );
  const rotated = computeWrappedWatchGeometry(
    { x: 80, y: 410 },
    { x: 160, y: 410 },
    { faceDiameter: 72, strapWidth: 28, wrapOffset: 64 },
  );

  assert.ok(base && rotated);
  assert.notEqual(base.center.x, rotated.center.x);
  assert.equal(base.start.x, rotated.start.x);
  assert.equal(base.end.x, rotated.end.x);
  assert.equal(rotated.faceDiameter, 72);
  assert.equal(rotated.strapWidth, 28);
});
