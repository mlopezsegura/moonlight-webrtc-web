// Tests the WebAssembly client core. Run with `npm test` after building it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadClientCore } from "../web/core.mjs";

const require = createRequire(import.meta.url);
// Samsung's Emscripten glue resolves host bindings through `self`, which only browsers define.
globalThis.self ??= globalThis;
const core = await loadClientCore(
  require("../web/client-core.js"),
  readFileSync(new URL("../web/client-core.wasm", import.meta.url)),
);

function gamepad(buttons = {}, axes = [0, 0, 0, 0]) {
  const list = [];
  for (let index = 0; index < 17; index += 1) {
    const value = buttons[index] || 0;
    list.push({ pressed: value > 0.5, value });
  }
  return { buttons: list, axes };
}

test("authentication proof matches HMAC-SHA256", () => {
  for (let round = 0; round < 50; round += 1) {
    const secret = randomBytes(32).toString("hex");
    const nonce = randomBytes(32).toString("hex");
    const expected = createHmac("sha256", Buffer.from(secret, "hex"))
      .update("moonlight-webrtc-tv-auth-v1:" + nonce)
      .digest("hex");
    assert.equal(core.authenticationProof(secret, nonce), expected);
  }
});

test("authentication proof rejects malformed input", () => {
  assert.throws(() => core.authenticationProof("ABCD", "00".repeat(32)));
  assert.throws(() => core.authenticationProof("00".repeat(32), "G".repeat(64)));
});

test("gamepad state maps the standard layout", () => {
  assert.ok(core.attachGamepad(0, 7));
  // A, start, d-pad right and guide pressed; left trigger half; left stick full left.
  const text = core.encodeGamepad(0, gamepad({ 0: 1, 9: 1, 15: 1, 16: 1, 6: 0.5 }, [-1, 0.25, 0, 1]), 1000.7);
  const message = JSON.parse(text);
  assert.equal(message.v, 2);
  assert.equal(message.type, "gamepad-state");
  assert.equal(message.controllerId, 7);
  assert.equal(message.seq, 1);
  assert.equal(message.timestampMs, 1000);
  assert.equal(message.buttons, (1 << 0) | (1 << 7) | (1 << 13) | (1 << 14));
  assert.ok(Math.abs(message.leftTrigger - 0.5) < 1 / 255);
  assert.equal(message.rightTrigger, 0);
  assert.equal(message.leftStickX, -1);
  assert.ok(Math.abs(message.leftStickY - 0.25) < 1 / 32767);
  assert.equal(message.rightStickY, 1);
  core.commitGamepad(0, 1000);
});

test("unchanged gamepad state is only resent as a keepalive", () => {
  assert.ok(core.attachGamepad(1, 9));
  const pad = gamepad({ 1: 1 });
  assert.ok(core.encodeGamepad(1, pad, 0));
  core.commitGamepad(1, 0);
  assert.equal(core.encodeGamepad(1, pad, 100), null);
  const keepalive = JSON.parse(core.encodeGamepad(1, pad, 260));
  assert.equal(keepalive.seq, 2);
});

test("a dropped gamepad state is sent again on the next poll", () => {
  assert.ok(core.attachGamepad(2, 11));
  assert.ok(core.encodeGamepad(2, gamepad(), 0));
  core.commitGamepad(2, 0);
  const pressed = gamepad({ 2: 1 });
  assert.ok(core.encodeGamepad(2, pressed, 10));
  // Not committed: the channel was congested.
  const retry = JSON.parse(core.encodeGamepad(2, pressed, 18));
  assert.equal(retry.seq, 2);
  assert.equal(retry.buttons, 1 << 2);
});

test("detached slots encode nothing", () => {
  core.detachGamepad(0);
  assert.equal(core.encodeGamepad(0, gamepad({ 0: 1 }), 5000), null);
  assert.equal(core.encodeGamepad(99, gamepad(), 0), null);
});
