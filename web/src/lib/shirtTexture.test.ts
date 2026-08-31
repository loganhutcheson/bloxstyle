import assert from "node:assert/strict";
import test from "node:test";
import {
  ROBLOX_SHIRT_HEIGHT,
  ROBLOX_SHIRT_WIDTH,
  validateShirtDimensions,
} from "./shirtTexture.ts";

test("accepts the Roblox classic shirt canvas size", () => {
  assert.equal(validateShirtDimensions(ROBLOX_SHIRT_WIDTH, ROBLOX_SHIRT_HEIGHT), null);
});

test("rejects dimensions that cannot map to a classic shirt", () => {
  assert.match(validateShirtDimensions(512, 512) || "", /585 × 559/);
  assert.match(validateShirtDimensions(559, 585) || "", /585 × 559/);
});
