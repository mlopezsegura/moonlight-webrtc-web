// JavaScript side of the WebAssembly client core (wasm/client_core.c).

const STANDARD_BUTTONS = 17;
const STANDARD_AXES = 4;

// `source` is the URL of client-core.wasm, or its bytes.
export async function loadClientCore(factory = globalThis.createClientCore, source = "client-core.wasm") {
  if (typeof factory !== "function") {
    throw new Error("client-core.js is not loaded");
  }
  // Emscripten 1.39's module object is a thenable that resolves to itself, so awaiting it
  // directly never settles. Wait for the runtime instead and keep the module out of the
  // promise chain.
  const holder = await new Promise((resolve, reject) => {
    const instance = factory({
      // Compiles while the bytes download, and works the same in Node for the tests.
      instantiateWasm(imports, done) {
        const compiled = typeof source === "string"
          ? WebAssembly.instantiateStreaming(fetch(source), imports)
          : WebAssembly.instantiate(source, imports);
        compiled.then((result) => done(result.instance), reject);
        return {};
      },
      onRuntimeInitialized() {
        resolve({ instance });
      },
      onAbort: reject,
      print() {},
      printErr: (text) => console.warn("client core:", text),
    });
  });
  return new ClientCore(holder.instance);
}

export class ClientCore {
  constructor(module) {
    this.module = module;
    this.pointer = module._core_buffer();
    this.size = module._core_buffer_size();
    this.decoder = new TextDecoder();
  }

  bytes(length = this.size) {
    // Views are recreated on each use: the heap is fixed in size, but this stays correct
    // if the module is ever built with memory growth.
    return new Uint8Array(this.module.HEAPU8.buffer, this.pointer, length);
  }

  // HMAC-SHA256 over "moonlight-webrtc-tv-auth-v1:" + nonce, keyed with the client secret.
  authenticationProof(clientSecret, nonce) {
    if (!/^[0-9a-f]{64}$/.test(clientSecret) || !/^[0-9a-f]{64}$/.test(nonce)) {
      throw new Error("Invalid client credentials or nonce");
    }
    const bytes = this.bytes(128);
    for (let index = 0; index < 64; index += 1) {
      bytes[index] = clientSecret.charCodeAt(index);
      bytes[64 + index] = nonce.charCodeAt(index);
    }
    const length = this.module._core_auth_proof();
    if (length !== 64) {
      throw new Error("Authentication proof failed");
    }
    const proof = this.decoder.decode(this.bytes(64).slice());
    bytes.fill(0);
    return proof;
  }

  attachGamepad(slot, controllerId) {
    return this.module._core_gamepad_attach(slot, controllerId) === 1;
  }

  detachGamepad(slot) {
    this.module._core_gamepad_detach(slot);
  }

  invalidateGamepad(slot) {
    this.module._core_gamepad_invalidate(slot);
  }

  // Returns a gamepad-state message, or null when nothing changed and no keepalive is due.
  // Call commitGamepad once the message was actually sent.
  encodeGamepad(slot, gamepad, nowMs) {
    const values = new Float32Array(this.module.HEAPU8.buffer, this.pointer, STANDARD_BUTTONS + STANDARD_AXES);
    const buttons = gamepad.buttons;
    for (let index = 0; index < STANDARD_BUTTONS; index += 1) {
      const button = buttons[index];
      values[index] = button ? (button.pressed ? Math.max(1, button.value) : button.value) : 0;
    }
    const axes = gamepad.axes;
    for (let index = 0; index < STANDARD_AXES; index += 1) {
      values[STANDARD_BUTTONS + index] = typeof axes[index] === "number" ? axes[index] : 0;
    }
    const length = this.module._core_gamepad_encode(slot, nowMs);
    return length > 0 ? this.decoder.decode(this.bytes(length).slice()) : null;
  }

  commitGamepad(slot, nowMs) {
    this.module._core_gamepad_commit(slot, nowMs);
  }
}
