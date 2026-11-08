// Tests the keyboard and mouse packets against the layouts in moonlight-common-c's Input.h.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEY_CODES, KeyboardMouse, MODIFIER_CTRL, MODIFIER_EXTENDED, MODIFIER_SHIFT,
  horizontalScrollPacket, keyboardPacket, mouseButtonPacket, relativeMovePacket, scrollPacket, wheelUnits,
} from "../web/input.mjs";

const bytes = (buffer) => [...new Uint8Array(buffer)];

function header(buffer) {
  const view = new DataView(buffer);
  return { size: view.getUint32(0, false), magic: view.getUint32(4, true), length: buffer.byteLength };
}

test("keyboard packets match NV_KEYBOARD_PACKET", () => {
  const buffer = keyboardPacket(true, 0x41, MODIFIER_SHIFT | MODIFIER_CTRL);
  assert.deepEqual(header(buffer), { size: 10, magic: 0x03, length: 14 });
  assert.deepEqual(bytes(buffer).slice(8), [0x00, 0x41, 0x00, 0x03, 0x00, 0x00]);
  assert.equal(header(keyboardPacket(false, 0x41, 0)).magic, 0x04);
});

test("mouse packets match the Moonlight layouts", () => {
  const move = relativeMovePacket(-2, 70000);
  assert.deepEqual(header(move), { size: 8, magic: 0x07, length: 12 });
  assert.equal(new DataView(move).getInt16(8, false), -2);
  assert.equal(new DataView(move).getInt16(10, false), 32767);

  assert.deepEqual(bytes(mouseButtonPacket(true, 3)), [0, 0, 0, 5, 0x08, 0, 0, 0, 3]);
  assert.equal(header(mouseButtonPacket(false, 3)).magic, 0x09);

  const scroll = scrollPacket(-120);
  assert.deepEqual(header(scroll), { size: 10, magic: 0x0a, length: 14 });
  assert.equal(new DataView(scroll).getInt16(8, false), -120);
  assert.equal(new DataView(scroll).getInt16(10, false), -120);

  const hscroll = horizontalScrollPacket(240);
  assert.deepEqual(header(hscroll), { size: 6, magic: 0x55000001, length: 10 });
  assert.equal(new DataView(hscroll).getInt16(8, false), 240);
});

test("physical keys map to US-layout virtual-key codes", () => {
  assert.equal(KEY_CODES.KeyA, 0x41);
  assert.equal(KEY_CODES.Digit0, 0x30);
  assert.equal(KEY_CODES.F12, 0x7b);
  assert.equal(KEY_CODES.Numpad7, 0x67);
  assert.equal(KEY_CODES.Semicolon, 0xba);  // Ñ on a Spanish keyboard
  assert.equal(KEY_CODES.IntlBackslash, 0xe2);  // the < > key
  assert.equal(KEY_CODES.AltRight, 0xa5);
});

test("wheel notches become 120 units", () => {
  assert.equal(wheelUnits(100, 0), 120);
  assert.equal(wheelUnits(3, 1), 120);
  assert.equal(wheelUnits(1, 2), 120);
});

test("KeyboardMouse sends each change once and releases everything it holds", () => {
  const sent = [];
  const input = new KeyboardMouse((packet) => sent.push(new DataView(packet)));
  const key = (code, extra = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });

  assert.equal(input.key(key("KeyW"), true), true);
  assert.equal(input.key(key("KeyW"), true), true);  // auto-repeat: the PC repeats on its own
  assert.equal(input.key(key("NumpadEnter"), true), true);
  assert.equal(input.key(key("Unidentified"), true), false);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].getUint8(11), MODIFIER_EXTENDED);

  input.move(0.6, 0);
  assert.equal(sent.length, 2);
  input.move(0.6, -1.2);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].getInt16(8, false), 1);
  assert.equal(sent[2].getInt16(10, false), -1);

  input.button(0, true);
  input.button(0, true);
  input.button(7, true);
  assert.equal(sent.length, 4);

  input.wheel({ deltaY: 100, deltaX: 0, deltaMode: 0 });
  assert.equal(sent[4].getInt16(8, false), -120);

  sent.length = 0;
  input.releaseAll();
  assert.deepEqual(sent.map((view) => view.getUint32(4, true)), [0x04, 0x04, 0x09]);
  input.releaseAll();
  assert.equal(sent.length, 3);
});
