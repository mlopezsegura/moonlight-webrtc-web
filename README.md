# Moonlight WebRTC Web

### Play your PC games in a web browser, streamed by Sunshine-Web-RTC

**Moonlight WebRTC Web is a browser client for [Sunshine-Web-RTC](https://github.com/mlopezsegura/Sunshine-Web-RTC).
Open it in Chrome or Edge on any computer in your home network, pair it once with a PIN, and play the games on
your gaming PC. Use it straight from the web, or install it as an app.**

<p align="center">
  <a href="https://mlopezsegura.github.io/moonlight-webrtc-web/"><strong>▶ Open Moonlight WebRTC Web</strong></a>
</p>

> [!IMPORTANT]
> **This is an early, basic version.** Gamepads work; **keyboard and mouse do not yet**, because
> Sunshine-Web-RTC currently accepts only gamepad input from WebRTC clients. See [Limitations](#limitations).

---

## Contents

- [What you need](#what-you-need)
- [Use it online](#use-it-online)
- [Install it as an app](#install-it-as-an-app)
- [Run it yourself](#run-it-yourself)
- [Pairing](#pairing)
- [Playing](#playing)
- [Stream settings](#stream-settings)
- [Limitations](#limitations)
- [How it works](#how-it-works)
- [Building and testing](#building-and-testing)
- [Publishing](#publishing)
- [Related projects](#related-projects)

---

## What you need

| Where | What |
| --- | --- |
| **Gaming PC** | [Sunshine-Web-RTC](https://github.com/mlopezsegura/Sunshine-Web-RTC) running, with its WebRTC server enabled (port 8000 by default). Regular Sunshine does **not** work: it has no WebRTC server. |
| **Computer you play on** | A recent desktop browser. Chrome and Edge give the best results (more codecs, rumble, app install). |
| **Network** | Both computers on the same local network. |

Nothing has to be installed on the computer you play on.

---

## Use it online

1. Open **<https://mlopezsegura.github.io/moonlight-webrtc-web/>**.
2. Enter the gaming PC's **IP address** (for example `192.168.1.20`) and port `8000`, then select **Connect**.
3. The browser asks to **look for and connect to devices on your local network**. Choose **Allow**.
4. The first time, pair the browser (see [Pairing](#pairing)). Then choose an application and play.

### Why the browser asks for local network access

The page comes from the internet (GitHub Pages), and the PC is on your home network. Chrome and Edge only let
an internet page talk to devices on your network after you allow it. The same permission also lets the page
use Sunshine-Web-RTC's unencrypted connection (`ws://`).

- If you dismissed or blocked the request, click the icon to the left of the address bar, open
  **Site settings**, set **Local network access** to **Allow**, and connect again. The page shows these steps
  when the connection fails.
- Use the PC's **IP address** or its **`.local` name**. Other host names are blocked from https pages.
- Browsers without that permission block the connection outright; allowing **Insecure content** in Site
  settings unblocks it there. If neither works, [run it yourself](#run-it-yourself).

`?host=<address>&port=<port>` in the URL connects at once, for example
`https://mlopezsegura.github.io/moonlight-webrtc-web/?host=192.168.1.20`.

---

## Install it as an app

Moonlight WebRTC Web is a Progressive Web App. In Chrome or Edge, select **Install app** in the page's top bar,
or the install icon in the address bar. It then opens in its own window, from the Start menu, taskbar or Dock,
like any other application.

The installed app keeps working copies of its files, so it opens instantly, and updates itself when a new
version is published. The local network permission above applies to it too.

---

## Run it yourself

You can also serve the page from your own computer. It then loads over plain http, which needs no permission
from the browser. You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
git clone https://github.com/mlopezsegura/moonlight-webrtc-web.git
cd moonlight-webrtc-web
npm start
```

No `npm install` is needed: the project has no dependencies, and the WebAssembly module is already built.
Open **<http://localhost:8770>**, enter the PC's address and port `8000`, and select **Connect**.

To open it from other computers in your network, serve it on all interfaces with `npm start -- --host 0.0.0.0`
and open `http://<address of that computer>:8770`.

---

## Pairing

Every browser pairs once, like a Moonlight client:

1. The browser shows a **four-digit PIN**.
2. On the gaming PC, open **Sunshine's Web UI** and go to the **PIN** page.
3. Select the browser in the list (it appears with a name such as *Google Chrome Windows*) and enter the PIN.

The browser then goes straight to your application library, now and on every later visit. It appears with
your other clients in Sunshine's Web UI under **Troubleshooting**, where you can disable or unpair it.

The pairing is stored in the browser for that PC's address. Clearing the browser's site data, or using a
private window, means pairing again.

---

## Playing

Select an application to start it, or to resume it if it is already running on the PC (it shows a
**Running** badge). The stream opens in fullscreen.

**Move the mouse** to show the toolbar:

| Button | What it does |
| --- | --- |
| **Stats** | Shows resolution, frame rate, bitrate, decode time, network round-trip time and lost packets. |
| **Fullscreen** | Enters or leaves fullscreen. |
| **Disconnect** | Stops streaming but **leaves the application running** on the PC, so you can resume it. Shortcut: **Ctrl+Alt+Shift+Q**. |
| **Quit app** | Closes the application on the PC. |

**Gamepads:** press any button on the gamepad once so the browser makes it available. Up to 16 gamepads are
supported. Rumble works in Chrome and Edge, including trigger rumble on Xbox controllers on Windows.

**Mouse with a gamepad:** hold **Start** for about a second to switch the gamepad into mouse mode: either stick
moves the pointer, and A, B, X and the bumpers act as mouse buttons. Hold **Start** again to switch back.

---

## Stream settings

The settings appear above the application list and are remembered.

| Setting | Options | Notes |
| --- | --- | --- |
| **Resolution** | 720p, 1080p, 1440p, 4K | Defaults to the largest one that fits your screen. 1440p is marked experimental by Sunshine-Web-RTC. |
| **Frame rate** | 30, 60, 90, 120 FPS | Choose one your monitor can show; more than your monitor's refresh rate only costs bandwidth. |
| **Codec** | AV1, HEVC, H.264 | Only codecs your browser can receive are listed. AV1 and HEVC give a better picture at the same bitrate; H.264 works everywhere. |
| **Bitrate** | 10 to 100 Mbps | Higher looks better but needs a stronger network. Wi-Fi often struggles above 30–50 Mbps. |
| **HDR** | On / Off | Needs an HDR monitor, HEVC or AV1, 1080p or above, and the gaming PC's display in HDR mode. |

---

## Limitations

- **No keyboard or mouse input.** Sunshine-Web-RTC accepts only gamepad input from WebRTC clients today.
  Use a gamepad, or its mouse mode.
- **No automatic discovery.** Browsers cannot send the network broadcast used to find PCs, so you type the
  PC's address.
- **Local network only.** The stream is not encrypted end to end beyond WebRTC's own transport, and pairing
  happens over an unencrypted connection. Do not expose Sunshine-Web-RTC to the internet.
- **Codec support depends on the browser.** Firefox has no HEVC; HEVC in Chrome and Edge needs hardware
  support on the computer you play on.
- **No Wake-on-LAN.** Wake the PC another way before connecting.

---

## How it works

```text
Your browser                                               Gaming PC
┌────────────────────────────────────────────┐             ┌────────────────────────┐
│  Page (app.mjs)                            │  WebSocket  │                        │
│    signaling, library, settings  ─────────────────────────►                       │
│                                            │             │   Sunshine-Web-RTC     │
│  Browser WebRTC                            │   WebRTC    │   capture → encode     │
│    hardware video decode, audio ◄─────────────────────────   → WebRTC             │
│                                            │             │                        │
│  WebAssembly core (client_core.c)          │ DataChannel │                        │
│    authentication, gamepad input ─────────────────────────►  virtual gamepads     │
└────────────────────────────────────────────┘             └────────────────────────┘
```

**Video and audio use the browser's built-in WebRTC.** It decodes video in hardware on the graphics card,
which is the fastest and most efficient path a web page has to the screen. The client asks the browser to
show each frame as soon as it is decoded instead of holding frames in a buffer, since a local network does
not need one.

**The WebAssembly core** (`wasm/client_core.c`, about 25 KB) handles the work where it helps:

- **Authentication.** A paired browser proves it holds its secret by answering a one-time challenge from
  the PC with an HMAC-SHA256. Browsers only offer their cryptography API on secure (`https://` or
  `localhost`) pages, so the core computes it, and pairing works from any address.
- **Gamepad input.** Gamepads are read every 4 ms. The core translates the buttons and sticks, skips
  readings that have not changed (re-sending the current state every 250 ms so it is never lost), and builds
  the message to send. It does this without creating garbage for the browser to clean up, so the page does
  not pause while you play.

The page speaks the same protocol as the Moonlight WebRTC TV app, described in
[the TV app's protocol document](https://github.com/mlopezsegura/moonlight-webrtc-tizen/blob/master/docs/protocol.md).
Sunshine-Web-RTC needs no changes to serve browsers.

---

## Building and testing

```text
wasm/client_core.c       WebAssembly core (C)
web/                     the page: index.html, app.mjs, core.mjs, style.css
web/client-core.js       generated by Emscripten (committed)
web/client-core.wasm     generated by Emscripten (committed)
web/manifest.webmanifest web app manifest; web/sw.js is the service worker
web/icons/               app icons (SVG sources and PNG renders)
scripts/build-wasm.ps1   builds the WebAssembly core
scripts/serve.mjs        dependency-free static web server
tests/core.test.mjs      tests for the WebAssembly core
```

The built WebAssembly files are committed, so you only need to rebuild them after changing
`wasm/client_core.c`. Building needs an [Emscripten](https://emscripten.org/) SDK. The script uses the one in
the `EMSDK` environment variable, or by default Samsung's Emscripten 1.39 in
`%USERPROFILE%\samsung-emscripten`:

```powershell
npm run build:wasm   # rebuild web/client-core.js and web/client-core.wasm
npm test             # run the core's tests with Node.js
```

The tests check the authentication against Node.js's own HMAC-SHA256 and check the gamepad messages.

---

## Related projects

- [Sunshine-Web-RTC](https://github.com/mlopezsegura/Sunshine-Web-RTC): the Sunshine build with a
  WebRTC server that this client connects to.
- [Moonlight WebRTC for Samsung TVs](https://github.com/mlopezsegura/moonlight-webrtc-tizen): the TV
  app that uses the same protocol, based on
  [Moonlight WebRTC by tsoas](https://github.com/tsoas/moonlight-webrtc-tizen).
- [Sunshine](https://github.com/LizardByte/Sunshine) and [Moonlight](https://moonlight-stream.org/): the
  game streaming projects all of this builds on.

---

## Publishing

Every push to `master` that changes `web/` runs [a workflow](.github/workflows/pages.yml) that publishes
`web/` to the `gh-pages` branch, which GitHub Pages serves. When a release changes any file the service worker
caches, increase `VERSION` in `web/sw.js` so installed apps refresh their copies.
