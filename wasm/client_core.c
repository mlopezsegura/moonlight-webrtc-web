// Client core for the Moonlight WebRTC browser client.
//
// The browser already decodes the stream in hardware through its native WebRTC pipeline, so
// this module holds the work that runs on every connection or every input poll:
//   - the HMAC-SHA256 proof that authenticates a paired client. crypto.subtle only exists in
//     secure contexts, and a page opened at http://<lan address> is not one;
//   - gamepad snapshots: mapping the Standard Gamepad layout to the protocol's button bits,
//     quantizing to Moonlight's resolution, change detection and JSON encoding, all without
//     allocating, so a 250 Hz poll loop creates no garbage for the JavaScript GC.
//
// JavaScript and the module exchange data through one static buffer (core_buffer).

#include <stdint.h>
#include <string.h>

#define EXPORT __attribute__((used, visibility("default")))

#define BUFFER_SIZE 4096
#define MAX_CONTROLLERS 16
#define STANDARD_BUTTONS 17
#define STANDARD_AXES 4
#define KEEPALIVE_MS 250.0

static _Alignas(16) uint8_t buffer[BUFFER_SIZE];

EXPORT uint8_t *core_buffer(void) {
  return buffer;
}

EXPORT int core_buffer_size(void) {
  return BUFFER_SIZE;
}

// ---------------------------------------------------------------------------------------------
// SHA-256 and HMAC-SHA256

typedef struct {
  uint32_t state[8];
  uint64_t length;
  uint8_t block[64];
  uint32_t used;
} sha256_t;

static const uint32_t K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

static uint32_t rotr(uint32_t value, int bits) {
  return (value >> bits) | (value << (32 - bits));
}

static void sha256_block(sha256_t *ctx, const uint8_t *data) {
  uint32_t w[64];
  for (int i = 0; i < 16; ++i) {
    w[i] = (uint32_t) data[i * 4] << 24 | (uint32_t) data[i * 4 + 1] << 16 | (uint32_t) data[i * 4 + 2] << 8 | data[i * 4 + 3];
  }
  for (int i = 16; i < 64; ++i) {
    const uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    const uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = ctx->state[0], b = ctx->state[1], c = ctx->state[2], d = ctx->state[3];
  uint32_t e = ctx->state[4], f = ctx->state[5], g = ctx->state[6], h = ctx->state[7];
  for (int i = 0; i < 64; ++i) {
    const uint32_t t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
    const uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  ctx->state[0] += a;
  ctx->state[1] += b;
  ctx->state[2] += c;
  ctx->state[3] += d;
  ctx->state[4] += e;
  ctx->state[5] += f;
  ctx->state[6] += g;
  ctx->state[7] += h;
}

static void sha256_init(sha256_t *ctx) {
  static const uint32_t initial[8] = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  };
  memcpy(ctx->state, initial, sizeof(initial));
  ctx->length = 0;
  ctx->used = 0;
}

static void sha256_update(sha256_t *ctx, const uint8_t *data, uint32_t size) {
  ctx->length += size;
  while (size > 0) {
    uint32_t take = 64 - ctx->used;
    if (take > size) {
      take = size;
    }
    memcpy(ctx->block + ctx->used, data, take);
    ctx->used += take;
    data += take;
    size -= take;
    if (ctx->used == 64) {
      sha256_block(ctx, ctx->block);
      ctx->used = 0;
    }
  }
}

static void sha256_final(sha256_t *ctx, uint8_t digest[32]) {
  const uint64_t bits = ctx->length * 8;
  const uint8_t pad = 0x80;
  const uint8_t zero = 0;
  sha256_update(ctx, &pad, 1);
  while (ctx->used != 56) {
    sha256_update(ctx, &zero, 1);
  }
  uint8_t length[8];
  for (int i = 0; i < 8; ++i) {
    length[i] = (uint8_t) (bits >> (56 - i * 8));
  }
  sha256_update(ctx, length, 8);
  for (int i = 0; i < 8; ++i) {
    digest[i * 4] = (uint8_t) (ctx->state[i] >> 24);
    digest[i * 4 + 1] = (uint8_t) (ctx->state[i] >> 16);
    digest[i * 4 + 2] = (uint8_t) (ctx->state[i] >> 8);
    digest[i * 4 + 3] = (uint8_t) ctx->state[i];
  }
}

// Keys are at most 64 bytes here (the client secret is 32), so no key hashing is needed.
static void hmac_sha256(const uint8_t *key, uint32_t key_size, const uint8_t *message, uint32_t message_size, uint8_t digest[32]) {
  uint8_t pad[64];
  uint8_t inner[32];
  sha256_t ctx;

  for (int i = 0; i < 64; ++i) {
    pad[i] = (uint8_t) ((i < (int) key_size ? key[i] : 0) ^ 0x36);
  }
  sha256_init(&ctx);
  sha256_update(&ctx, pad, 64);
  sha256_update(&ctx, message, message_size);
  sha256_final(&ctx, inner);

  for (int i = 0; i < 64; ++i) {
    pad[i] = (uint8_t) ((i < (int) key_size ? key[i] : 0) ^ 0x5c);
  }
  sha256_init(&ctx);
  sha256_update(&ctx, pad, 64);
  sha256_update(&ctx, inner, 32);
  sha256_final(&ctx, digest);
}

static int hex_value(uint8_t c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  return -1;
}

static void to_hex(const uint8_t *bytes, int size, uint8_t *out) {
  static const char digits[] = "0123456789abcdef";
  for (int i = 0; i < size; ++i) {
    out[i * 2] = (uint8_t) digits[bytes[i] >> 4];
    out[i * 2 + 1] = (uint8_t) digits[bytes[i] & 15];
  }
}

static const char PROOF_LABEL[] = "moonlight-webrtc-tv-auth-v1:";

// Input:  buffer[0..63] the client secret, buffer[64..127] the server nonce, both lower-case hex.
// Output: buffer[0..63] the proof in lower-case hex.
// Returns 64, or -1 when either input is not 64 lower-case hex digits.
EXPORT int core_auth_proof(void) {
  uint8_t secret[32];
  for (int i = 0; i < 32; ++i) {
    const int high = hex_value(buffer[i * 2]);
    const int low = hex_value(buffer[i * 2 + 1]);
    if (high < 0 || low < 0) {
      return -1;
    }
    secret[i] = (uint8_t) (high << 4 | low);
  }
  uint8_t message[sizeof(PROOF_LABEL) - 1 + 64];
  memcpy(message, PROOF_LABEL, sizeof(PROOF_LABEL) - 1);
  for (int i = 0; i < 64; ++i) {
    if (hex_value(buffer[64 + i]) < 0) {
      return -1;
    }
    message[sizeof(PROOF_LABEL) - 1 + i] = buffer[64 + i];
  }
  uint8_t digest[32];
  hmac_sha256(secret, sizeof(secret), message, sizeof(message), digest);
  to_hex(digest, 32, buffer);
  memset(secret, 0, sizeof(secret));
  return 64;
}

// ---------------------------------------------------------------------------------------------
// Gamepad snapshots

// Standard Gamepad button index -> protocol button bit. Indexes 6 and 7 are the triggers,
// which travel as analog values instead.
static const int8_t BUTTON_BITS[STANDARD_BUTTONS] = {
  0,  // 0 A / Cross
  1,  // 1 B / Circle
  2,  // 2 X / Square
  3,  // 3 Y / Triangle
  4,  // 4 left bumper
  5,  // 5 right bumper
  -1,  // 6 left trigger
  -1,  // 7 right trigger
  6,  // 8 back / select
  7,  // 9 start
  8,  // 10 left stick
  9,  // 11 right stick
  10,  // 12 d-pad up
  11,  // 13 d-pad down
  12,  // 14 d-pad left
  13,  // 15 d-pad right
  14,  // 16 guide / home
};

typedef struct {
  uint32_t buttons;
  int32_t left_trigger;  // 0..255
  int32_t right_trigger;
  int32_t sticks[STANDARD_AXES];  // -32767..32767
} pad_state_t;

typedef struct {
  int active;
  uint32_t controller_id;
  uint64_t sequence;
  double last_sent_ms;
  pad_state_t last;  // last state sent
  pad_state_t pending;  // state of the last encoded message, sent once committed
} controller_t;

static controller_t controllers[MAX_CONTROLLERS];

static int32_t quantize(float value, int32_t scale, float minimum) {
  if (!(value == value)) {  // NaN
    return 0;
  }
  if (value < minimum) {
    value = minimum;
  } else if (value > 1.0f) {
    value = 1.0f;
  }
  const float scaled = value * (float) scale;
  return (int32_t) (scaled < 0 ? scaled - 0.5f : scaled + 0.5f);
}

static uint8_t *write_text(uint8_t *out, const char *text) {
  while (*text) {
    *out++ = (uint8_t) *text++;
  }
  return out;
}

static uint8_t *write_uint(uint8_t *out, uint64_t value) {
  char digits[20];
  int count = 0;
  do {
    digits[count++] = (char) ('0' + value % 10);
    value /= 10;
  } while (value);
  while (count) {
    *out++ = (uint8_t) digits[--count];
  }
  return out;
}

// Writes numerator / denominator with up to six decimals, without trailing zeros.
static uint8_t *write_fraction(uint8_t *out, int32_t numerator, int32_t denominator) {
  if (numerator < 0) {
    *out++ = '-';
    numerator = -numerator;
  }
  const uint64_t scaled = ((uint64_t) numerator * 1000000u + (uint64_t) denominator / 2) / (uint64_t) denominator;
  out = write_uint(out, scaled / 1000000u);
  uint32_t fraction = (uint32_t) (scaled % 1000000u);
  if (fraction) {
    *out++ = '.';
    int digits = 6;
    while (fraction % 10 == 0) {
      fraction /= 10;
      --digits;
    }
    char text[6];
    for (int i = digits - 1; i >= 0; --i) {
      text[i] = (char) ('0' + fraction % 10);
      fraction /= 10;
    }
    for (int i = 0; i < digits; ++i) {
      *out++ = (uint8_t) text[i];
    }
  }
  return out;
}

// Starts tracking a controller in a slot (the browser's gamepad index).
EXPORT int core_gamepad_attach(int slot, uint32_t controller_id) {
  if (slot < 0 || slot >= MAX_CONTROLLERS) {
    return 0;
  }
  memset(&controllers[slot], 0, sizeof(controller_t));
  controllers[slot].active = 1;
  controllers[slot].controller_id = controller_id;
  controllers[slot].last_sent_ms = -KEEPALIVE_MS;
  return 1;
}

EXPORT void core_gamepad_detach(int slot) {
  if (slot >= 0 && slot < MAX_CONTROLLERS) {
    controllers[slot].active = 0;
  }
}

// Input:  buffer as float[21]: the values of Standard Gamepad buttons 0..16 (a pressed digital
//         button is 1), then axes 0..3.
// Output: buffer holds a `gamepad-state` JSON message.
// Returns the message length, or 0 when nothing changed and no keepalive is due.
// The sequence number only advances when the caller confirms the send with
// core_gamepad_commit, so a snapshot dropped on a congested channel is not counted.
EXPORT int core_gamepad_encode(int slot, double now_ms) {
  if (slot < 0 || slot >= MAX_CONTROLLERS || !controllers[slot].active) {
    return 0;
  }
  controller_t *controller = &controllers[slot];
  const float *values = (const float *) buffer;

  pad_state_t state;
  memset(&state, 0, sizeof(state));
  for (int i = 0; i < STANDARD_BUTTONS; ++i) {
    if (BUTTON_BITS[i] >= 0 && values[i] > 0.5f) {
      state.buttons |= 1u << BUTTON_BITS[i];
    }
  }
  state.left_trigger = quantize(values[6], 255, 0.0f);
  state.right_trigger = quantize(values[7], 255, 0.0f);
  for (int i = 0; i < STANDARD_AXES; ++i) {
    state.sticks[i] = quantize(values[STANDARD_BUTTONS + i], 32767, -1.0f);
  }

  const int changed = memcmp(&state, &controller->last, sizeof(state)) != 0;
  if (!changed && now_ms - controller->last_sent_ms < KEEPALIVE_MS) {
    return 0;
  }
  controller->pending = state;

  uint8_t *out = buffer;
  out = write_text(out, "{\"v\":2,\"type\":\"gamepad-state\",\"controllerId\":");
  out = write_uint(out, controller->controller_id);
  out = write_text(out, ",\"seq\":");
  out = write_uint(out, controller->sequence + 1);
  out = write_text(out, ",\"timestampMs\":");
  out = write_uint(out, now_ms > 0 ? (uint64_t) now_ms : 0);
  out = write_text(out, ",\"buttons\":");
  out = write_uint(out, state.buttons);
  out = write_text(out, ",\"leftTrigger\":");
  out = write_fraction(out, state.left_trigger, 255);
  out = write_text(out, ",\"rightTrigger\":");
  out = write_fraction(out, state.right_trigger, 255);
  out = write_text(out, ",\"leftStickX\":");
  out = write_fraction(out, state.sticks[0], 32767);
  out = write_text(out, ",\"leftStickY\":");
  out = write_fraction(out, state.sticks[1], 32767);
  out = write_text(out, ",\"rightStickX\":");
  out = write_fraction(out, state.sticks[2], 32767);
  out = write_text(out, ",\"rightStickY\":");
  out = write_fraction(out, state.sticks[3], 32767);
  out = write_text(out, "}");
  return (int) (out - buffer);
}

// Records that the message from the last core_gamepad_encode for this slot was sent.
EXPORT void core_gamepad_commit(int slot, double now_ms) {
  if (slot >= 0 && slot < MAX_CONTROLLERS && controllers[slot].active) {
    controllers[slot].sequence += 1;
    controllers[slot].last_sent_ms = now_ms;
    controllers[slot].last = controllers[slot].pending;
  }
}

// Forgets the last state so the next encode is sent even if nothing changed.
EXPORT void core_gamepad_invalidate(int slot) {
  if (slot >= 0 && slot < MAX_CONTROLLERS) {
    memset(&controllers[slot].last, 0xff, sizeof(pad_state_t));
  }
}
