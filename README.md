# Moonlight WebRTC Web

A browser client for [Sunshine-Web-RTC](https://github.com/mlopezsegura/Sunshine-Web-RTC): play games
from your PC in a desktop browser (Chrome, Edge, Firefox) on your local network.

It speaks the same protocol as the
[Moonlight WebRTC TV app](https://github.com/mlopezsegura/moonlight-webrtc-tizen), so Sunshine-Web-RTC
needs no changes. The browser pairs, lists your applications, and streams them, the same way a TV does.

> [!IMPORTANT]
> This is a basic first version. Gamepads work. Keyboard and mouse do not yet: Sunshine-Web-RTC only accepts
> gamepad input from WebRTC clients today. The gamepad's mouse mode (hold **Start**) moves the mouse.

## How it works

```text
Browser                                                  Gaming PC
┌─────────────────────────────────────────┐              ┌──────────────────────┐
│ app.mjs   UI, signaling, WebRTC         │  WebSocket   │                      │
│           native hardware video decode  │ ◄──────────► │  Sunshine-Web-RTC    │
│ WASM core authentication (HMAC-SHA256)  │    WebRTC    │  (port 8000)         │
│           gamepad snapshots             │ ◄──────────► │                      │
└─────────────────────────────────────────┘              └──────────────────────┘
```

**Video and audio use the browser's own WebRTC pipeline.** It decodes in hardware and is the fastest path
a web page has to the screen; a decoder compiled to WebAssembly would run on the CPU, adding latency and
power draw. The client asks the browser to play frames as soon as they are decoded
(`jitterBufferTarget = 0`), since a LAN needs no jitter cushion.

**The WebAssembly core** (`wasm/client_core.c`) does the per-connection and per-poll work:

- **Authentication.** A paired browser proves it holds its secret with an HMAC-SHA256 over the PC's nonce.
  `crypto.subtle` only exists in secure contexts, and a page opened at `http://<lan address>` is not one, so
  the HMAC runs in WebAssembly and works the same everywhere.
- **Gamepad snapshots.** Gamepads are polled every 4 ms. The core maps the Standard Gamepad layout to the
  protocol's buttons, quantizes to Moonlight's resolution, skips unchanged states (with a 250 ms keepalive),
  and writes the JSON message into its own memory. The poll loop allocates almost nothing, so the
  JavaScript garbage collector does not pause the page while it streams.

## Use

Requirements: [Node.js](https://nodejs.org/) 18 or newer, and a PC running Sunshine-Web-RTC with its WebRTC
server enabled.

```sh
npm start
```

Open <http://localhost:8770>, enter the PC's address and port (8000 unless `webrtc_port` was changed), and
select **Connect**.

The first time, the browser shows a four-digit PIN. In Sunshine's Web UI on the PC, open **PIN**, select the
browser and enter the PIN. The browser is then listed with your other clients under **Troubleshooting**,
where it can be disabled or unpaired.

To use the client from another device, serve it on the network with `npm start -- --host 0.0.0.0` and open
`http://<this computer>:8770`. Serve it over **http**, not https: browsers block the `ws://` signaling
connection from https pages.

`?host=<address>&port=<port>` in the URL connects at once.

### While streaming

- Move the mouse to show the toolbar: **Stats**, **Fullscreen**, **Disconnect** and **Quit app**.
- **Disconnect** (or Ctrl+Alt+Shift+Q) leaves the application running; selecting it again resumes it.
- **Quit app** closes the application on the PC.
- Press a button on a gamepad so the browser exposes it. Rumble works where the browser supports it
  (Chrome and Edge, including trigger rumble on Xbox controllers on Windows).

### Settings

Resolution, frame rate, codec, bitrate and HDR are chosen above the application list and remembered.

- Only codecs this browser can receive over WebRTC are offered. AV1 and HEVC give the best picture per bit;
  H.264 works everywhere. HEVC needs a browser with hardware HEVC support for WebRTC.
- The default resolution is the largest mode that fits your screen.
- HDR needs an HDR display, HEVC or AV1 at 1080p or above, and the PC's display in HDR mode.

Browsers cannot send UDP, so PCs are not discovered automatically: enter the address.

## Develop

```text
wasm/client_core.c      WebAssembly core
web/                    the page; web/client-core.{js,wasm} are build outputs, committed
scripts/build-wasm.ps1  builds the core
scripts/serve.mjs       static server
tests/                  core tests
```

Build the core with any Emscripten SDK (`$env:EMSDK`), or by default Samsung's Emscripten 1.39 fork in
`%USERPROFILE%\samsung-emscripten`:

```powershell
npm run build:wasm
npm test
```

The tests check the HMAC against Node's `crypto` and the gamepad encoding.

## Protocol

See [the protocol description](https://github.com/mlopezsegura/moonlight-webrtc-tizen/blob/master/docs/protocol.md)
in the TV app's repository.
