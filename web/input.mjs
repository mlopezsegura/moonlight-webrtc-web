// Keyboard and mouse for Sunshine-Web-RTC's "input" DataChannel.
//
// Each event becomes the same Moonlight input packet a native Moonlight client sends, so Sunshine
// handles it exactly like Moonlight's: keys by Windows virtual-key code of their US-layout
// position (the PC's own layout gives them meaning), relative mouse motion while the pointer is
// captured, buttons and high-resolution wheel.

// Packet types (moonlight-common-c Input.h).
export const KEY_DOWN = 0x03;
export const KEY_UP = 0x04;
export const MOUSE_MOVE_REL = 0x07;
export const MOUSE_BUTTON_DOWN = 0x08;
export const MOUSE_BUTTON_UP = 0x09;
export const SCROLL = 0x0a;
export const HSCROLL = 0x55000001;

export const MODIFIER_SHIFT = 0x01;
export const MODIFIER_CTRL = 0x02;
export const MODIFIER_ALT = 0x04;
export const MODIFIER_META = 0x08;
export const MODIFIER_EXTENDED = 0x10;

const WHEEL_DELTA = 120;  // One wheel notch in Moonlight scroll units.

// KeyboardEvent.code (the physical key) -> Windows virtual-key code of that key on a US layout.
export const KEY_CODES = (() => {
  const map = {
    Escape: 0x1b, Backquote: 0xc0, Minus: 0xbd, Equal: 0xbb, Backspace: 0x08, Tab: 0x09,
    BracketLeft: 0xdb, BracketRight: 0xdd, Backslash: 0xdc, CapsLock: 0x14, Semicolon: 0xba,
    Quote: 0xde, Enter: 0x0d, Comma: 0xbc, Period: 0xbe, Slash: 0xbf, Space: 0x20,
    IntlBackslash: 0xe2, IntlRo: 0xc1, IntlYen: 0xdc,
    ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
    AltLeft: 0xa4, AltRight: 0xa5, MetaLeft: 0x5b, MetaRight: 0x5c, ContextMenu: 0x5d,
    PrintScreen: 0x2c, ScrollLock: 0x91, Pause: 0x13,
    Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
    ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
    NumLock: 0x90, NumpadDivide: 0x6f, NumpadMultiply: 0x6a, NumpadSubtract: 0x6d, NumpadAdd: 0x6b,
    NumpadEnter: 0x0d, NumpadDecimal: 0x6e,
    KanaMode: 0x15, Lang1: 0x15, Lang2: 0x19, Convert: 0x1c, NonConvert: 0x1d,
    AudioVolumeMute: 0xad, AudioVolumeDown: 0xae, AudioVolumeUp: 0xaf,
    MediaTrackNext: 0xb0, MediaTrackPrevious: 0xb1, MediaStop: 0xb2, MediaPlayPause: 0xb3,
  };
  for (let i = 0; i < 26; i++) {
    map[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i;
  }
  for (let i = 0; i < 10; i++) {
    map[`Digit${i}`] = 0x30 + i;
    map[`Numpad${i}`] = 0x60 + i;
  }
  for (let i = 1; i <= 24; i++) {
    map[`F${i}`] = 0x6f + i;
  }
  return map;
})();

// Keys that share a virtual-key code with another key, or sit in the extended (0xE0) block.
const EXTENDED_KEYS = new Set([
  "NumpadEnter", "NumpadDivide", "ControlRight", "AltRight", "MetaLeft", "MetaRight", "ContextMenu",
  "Insert", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
]);

// MouseEvent.button -> Moonlight button (left, middle, right, back, forward).
const MOUSE_BUTTONS = [0x01, 0x02, 0x03, 0x04, 0x05];

function packet(magic, payloadSize) {
  const view = new DataView(new ArrayBuffer(8 + payloadSize));
  view.setUint32(0, 4 + payloadSize, false);
  view.setUint32(4, magic, true);
  return view;
}

const clamp16 = (value) => Math.max(-32768, Math.min(32767, value));

export function keyboardPacket(down, keyCode, modifiers) {
  const view = packet(down ? KEY_DOWN : KEY_UP, 6);
  view.setUint8(8, 0);  // flags: the code is normalized to the US layout
  view.setInt16(9, keyCode, true);
  view.setUint8(11, modifiers);
  return view.buffer;
}

export function relativeMovePacket(deltaX, deltaY) {
  const view = packet(MOUSE_MOVE_REL, 4);
  view.setInt16(8, clamp16(deltaX), false);
  view.setInt16(10, clamp16(deltaY), false);
  return view.buffer;
}

export function mouseButtonPacket(down, button) {
  const view = packet(down ? MOUSE_BUTTON_DOWN : MOUSE_BUTTON_UP, 1);
  view.setUint8(8, button);
  return view.buffer;
}

export function scrollPacket(amount) {
  const view = packet(SCROLL, 6);
  view.setInt16(8, clamp16(amount), false);
  view.setInt16(10, clamp16(amount), false);
  return view.buffer;
}

export function horizontalScrollPacket(amount) {
  const view = packet(HSCROLL, 2);
  view.setInt16(8, clamp16(amount), false);
  return view.buffer;
}

export function modifiersOf(event) {
  return (event.shiftKey ? MODIFIER_SHIFT : 0) | (event.ctrlKey ? MODIFIER_CTRL : 0) |
    (event.altKey ? MODIFIER_ALT : 0) | (event.metaKey ? MODIFIER_META : 0);
}

// Wheel delta in Moonlight units, positive up/right. Browsers report 100 px (or 3 lines) per notch.
export function wheelUnits(delta, deltaMode) {
  const notches = deltaMode === 1 ? delta / 3 : deltaMode === 2 ? delta : delta / 100;
  return notches * WHEEL_DELTA;
}

// Turns DOM events into packets and keeps what is held, so it can all be released at once.
export class KeyboardMouse {
  constructor(send) {
    this.send = send;
    this.keys = new Map();  // code -> virtual-key code, for keys held on the PC
    this.buttons = new Set();
    this.moveX = 0;
    this.moveY = 0;
    this.scrollY = 0;
    this.scrollX = 0;
  }

  key(event, down) {
    const keyCode = KEY_CODES[event.code];
    if (keyCode === undefined) {
      return false;
    }
    if (down) {
      // The PC repeats held keys itself, as for Moonlight.
      if (this.keys.has(event.code)) {
        return true;
      }
      this.keys.set(event.code, keyCode);
    } else if (!this.keys.delete(event.code)) {
      return true;
    }
    const modifiers = modifiersOf(event) | (EXTENDED_KEYS.has(event.code) ? MODIFIER_EXTENDED : 0);
    this.send(keyboardPacket(down, keyCode, modifiers));
    return true;
  }

  // Motion arrives in fractions of a pixel on scaled displays; whole pixels go out, the rest waits.
  move(movementX, movementY) {
    this.moveX += movementX;
    this.moveY += movementY;
    const deltaX = Math.trunc(this.moveX);
    const deltaY = Math.trunc(this.moveY);
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    this.moveX -= deltaX;
    this.moveY -= deltaY;
    this.send(relativeMovePacket(deltaX, deltaY));
  }

  button(domButton, down) {
    const button = MOUSE_BUTTONS[domButton];
    if (!button || this.buttons.has(button) === down) {
      return;
    }
    if (down) {
      this.buttons.add(button);
    } else {
      this.buttons.delete(button);
    }
    this.send(mouseButtonPacket(down, button));
  }

  wheel(event) {
    this.scrollY -= wheelUnits(event.deltaY, event.deltaMode);
    this.scrollX += wheelUnits(event.deltaX, event.deltaMode);
    const amountY = Math.trunc(this.scrollY);
    const amountX = Math.trunc(this.scrollX);
    if (amountY !== 0) {
      this.scrollY -= amountY;
      this.send(scrollPacket(amountY));
    }
    if (amountX !== 0) {
      this.scrollX -= amountX;
      this.send(horizontalScrollPacket(amountX));
    }
  }

  releaseAll() {
    for (const [code, keyCode] of this.keys) {
      this.send(keyboardPacket(false, keyCode, EXTENDED_KEYS.has(code) ? MODIFIER_EXTENDED : 0));
    }
    this.keys.clear();
    for (const button of this.buttons) {
      this.send(mouseButtonPacket(false, button));
    }
    this.buttons.clear();
    this.moveX = this.moveY = this.scrollX = this.scrollY = 0;
  }
}
