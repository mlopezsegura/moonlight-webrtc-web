// Browser client for Sunshine-Web-RTC (protocol version 2).
//
// Video and audio go through the browser's native WebRTC pipeline, which decodes in hardware
// and is the lowest-latency path a page has. The WebAssembly core (core.mjs) handles client
// authentication and gamepad snapshots.
import { loadClientCore } from "./core.mjs";

const PROTOCOL_VERSION = 2;
const BITRATES_KBPS = [10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000];
const GAMEPAD_POLL_MS = 4;
const MAX_BUFFERED_BYTES = 64 * 1024;
const RUMBLE_EFFECT_MS = 5000;
const RUMBLE_REFRESH_MS = 2000;
const IDLE_CURSOR_MS = 2500;
const CODEC_LABELS = { h264: "H.264", hevc: "HEVC", av1: "AV1" };
const CODEC_MIME = { h264: "video/h264", hevc: "video/h265", av1: "video/av1" };

const $ = (id) => document.getElementById(id);

const screens = {
  connect: $("screen-connect"),
  pair: $("screen-pair"),
  library: $("screen-library"),
  stream: $("screen-stream"),
};

const state = {
  core: null,
  socket: null,
  host: "",
  port: 8000,
  serverName: "",
  credentials: null,
  pairing: false,
  capabilities: null,
  apps: [],
  runningAppId: null,
  artwork: new Map(),
  peer: null,
  sessionId: 0,
  sessionState: "idle",
  pendingCandidates: [],
  controlChannel: null,
  gamepadChannel: null,
  pads: new Map(),  // browser gamepad index -> { controllerId, announced, rumble }
  nextControllerId: 1,
  pollTimer: 0,
  statsTimer: 0,
  previousStats: null,
  manualDisconnect: false,
};

// ---------------------------------------------------------------------------------------------
// Storage. Wrapped: storage can be unavailable (private windows, blocked site data).

function load(key, fallback) {
  try {
    const value = localStorage.getItem("mlw." + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    if (value === null) {
      localStorage.removeItem("mlw." + key);
    } else {
      localStorage.setItem("mlw." + key, JSON.stringify(value));
    }
  } catch {
    // Pairing must be repeated next time; nothing else depends on it.
  }
}

const credentialKey = () => `credentials.${state.host}:${state.port}`;

// ---------------------------------------------------------------------------------------------
// UI helpers

function show(name) {
  for (const [key, element] of Object.entries(screens)) {
    element.hidden = key !== name;
  }
  $("disconnect").hidden = name === "connect";
  $("topbar").hidden = name === "stream";
}

function setStatus(id, text, error = false) {
  const element = $(id);
  element.textContent = text || "";
  element.classList.toggle("error", Boolean(error));
}

function send(message) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ version: PROTOCOL_VERSION, ...message }));
  }
}

function clientName() {
  const brands = navigator.userAgentData && navigator.userAgentData.brands;
  const brand = brands && brands.find((entry) => !/not.a.brand|chromium/i.test(entry.brand));
  const browser = brand ? brand.brand : /firefox/i.test(navigator.userAgent) ? "Firefox" : "Browser";
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || "";
  return `${browser} ${platform}`.trim().slice(0, 64);
}

// ---------------------------------------------------------------------------------------------
// Connection and authentication

function connect(host, port) {
  disconnectSocket();
  state.host = host;
  state.port = port;
  state.credentials = load(credentialKey(), null);
  state.manualDisconnect = false;
  save("lastHost", { host, port });
  $("host-label").textContent = `${host}:${port}`;
  setStatus("connect-status", "Connecting…");

  $("insecure-help").hidden = true;
  let socket;
  try {
    socket = new WebSocket(`ws://${host.includes(":") ? `[${host}]` : host}:${port}/`);
  } catch (error) {
    // An https page (GitHub Pages, the installed app) may not open ws:// to another device
    // until the user allows insecure content for the site.
    if (error.name === "SecurityError" && location.protocol === "https:") {
      setStatus("connect-status", "");
      $("insecure-help").hidden = false;
    } else {
      setStatus("connect-status", `Invalid address: ${error.message}`, true);
    }
    return;
  }
  state.socket = socket;
  let opened = false;
  socket.onopen = () => {
    opened = true;
  };
  socket.onmessage = (event) => {
    if (socket !== state.socket) {
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message && message.version === PROTOCOL_VERSION) {
      handleMessage(message);
    }
  };
  socket.onclose = () => {
    if (socket !== state.socket) {
      return;
    }
    state.socket = null;
    closePeer();
    if (!state.manualDisconnect) {
      show("connect");
      setStatus("connect-status", opened
        ? "The connection to the PC was closed."
        : "Could not reach the PC. Check the address, the port, and that Sunshine-Web-RTC is running.", true);
    }
  };
}

function disconnectSocket() {
  state.manualDisconnect = true;
  closePeer();
  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    socket.close();
  }
}

function handleAuthRequired(message) {
  if (message.pairing !== "client-pin") {
    setStatus("connect-status", "This server is the retired Windows Gateway, not Sunshine-Web-RTC.", true);
    disconnectSocket();
    show("connect");
    return;
  }
  const credentials = state.credentials;
  if (credentials && typeof message.nonce === "string") {
    try {
      send({
        type: "authenticate",
        clientId: credentials.clientId,
        proof: state.core.authenticationProof(credentials.clientSecret, message.nonce),
      });
      setStatus("connect-status", "Authenticating…");
      return;
    } catch (error) {
      console.warn("Stored credentials are unusable", error);
      forgetCredentials();
    }
  }
  requestPairing();
}

function forgetCredentials() {
  state.credentials = null;
  save(credentialKey(), null);
}

function requestPairing() {
  const digits = new Uint16Array(1);
  crypto.getRandomValues(digits);
  const pin = String(digits[0] % 10000).padStart(4, "0");
  state.pairing = true;
  $("pair-pin").textContent = pin;
  $("pair-name").textContent = clientName();
  $("pair-new").hidden = true;
  setStatus("pair-status", "Waiting for the PIN to be entered on the PC…");
  show("pair");
  send({ type: "request-pairing", pin, clientName: clientName() });
}

function handlePaired(message) {
  state.pairing = false;
  state.credentials = { clientId: message.clientId, clientSecret: message.clientSecret };
  save(credentialKey(), state.credentials);
  enterLibrary();
}

function handleError(message) {
  const text = message.message || message.code || "Unknown error";
  if (message.requestType === "authenticate") {
    if (message.code === "client-disabled") {
      setStatus("connect-status", "This browser is disabled in Sunshine. Enable it in Troubleshooting → Clients.", true);
      show("connect");
      return;
    }
    forgetCredentials();
    requestPairing();
    return;
  }
  if (message.requestType === "request-pairing") {
    if (message.code === "pairing-cancelled") {
      setStatus("pair-status", "Pairing was declined on the PC.", true);
      $("pair-new").hidden = false;
      return;
    }
    const reason = {
      "incorrect-pin": "The PIN entered was wrong.",
      "pairing-expired": "The PIN expired.",
    }[message.code] || "Pairing failed.";
    requestPairing();
    setStatus("pair-status", `${reason} Enter the new PIN.`, true);
    return;
  }
  if (message.requestType === "start-session" || message.requestType === "switch-session") {
    endStream(`Could not start: ${text}`);
    return;
  }
  if (!screens.stream.hidden) {
    $("stream-message").textContent = text;
  } else {
    setStatus("library-status", text, true);
  }
}

function enterLibrary() {
  show("library");
  setStatus("library-status", "");
  send({ type: "get-apps" });
}

// ---------------------------------------------------------------------------------------------
// Messages

function handleMessage(message) {
  switch (message.type) {
    case "auth-required":
      handleAuthRequired(message);
      break;
    case "authenticated":
      enterLibrary();
      break;
    case "paired":
      handlePaired(message);
      break;
    case "gateway-status":
      state.serverName = message.gatewayName || "";
      state.runningAppId = message.runningAppId == null ? null : String(message.runningAppId);
      $("host-label").textContent = `${state.serverName || state.host} · ${state.host}:${state.port}`;
      renderApps();
      break;
    case "capabilities":
      state.capabilities = message;
      renderSettings();
      break;
    case "apps": {
      state.apps = Array.isArray(message.apps) ? message.apps : [];
      const running = state.apps.find((app) => app.running);
      state.runningAppId = running ? String(running.id) : null;
      renderApps();
      break;
    }
    case "app-artwork":
      handleArtwork(message);
      break;
    case "session-status":
      handleSessionStatus(message);
      break;
    case "host-session-status":
      handleHostSessionStatus(message);
      break;
    case "offer":
      handleOffer(message);
      break;
    case "candidate":
      handleRemoteCandidate(message);
      break;
    case "error":
      handleError(message);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Settings

function browserCodecs() {
  const supported = new Set();
  const capabilities = window.RTCRtpReceiver && RTCRtpReceiver.getCapabilities
    ? RTCRtpReceiver.getCapabilities("video") : null;
  for (const codec of (capabilities && capabilities.codecs) || []) {
    const mime = codec.mimeType.toLowerCase();
    for (const [name, wanted] of Object.entries(CODEC_MIME)) {
      if (mime === wanted) {
        supported.add(name);
      }
    }
  }
  return supported;
}

function displaySupportsHdr() {
  return window.matchMedia && matchMedia("(dynamic-range: high)").matches;
}

function fillSelect(select, options, selected) {
  select.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    return option;
  }));
  const values = options.map(([value]) => String(value));
  select.value = values.includes(String(selected)) ? String(selected) : values[0] || "";
}

function modes() {
  return (state.capabilities && Array.isArray(state.capabilities.videoModes)) ? state.capabilities.videoModes : [];
}

function currentMode() {
  const [width, height] = $("setting-mode").value.split("x").map(Number);
  return modes().find((mode) => mode.width === width && mode.height === height);
}

// The default mode is the largest one that fits the screen in physical pixels.
function defaultModeKey() {
  const width = screen.width * (window.devicePixelRatio || 1);
  const height = screen.height * (window.devicePixelRatio || 1);
  const fitting = modes().filter((mode) => mode.width <= width + 1 && mode.height <= height + 1);
  const mode = fitting[fitting.length - 1] || modes()[0];
  return mode ? `${mode.width}x${mode.height}` : "";
}

function renderSettings() {
  const saved = load("settings", {});
  fillSelect($("setting-mode"),
    modes().map((mode) => [`${mode.width}x${mode.height}`, `${mode.height}p${mode.experimental ? " (experimental)" : ""}`]),
    saved.mode || defaultModeKey());
  renderModeSettings(saved);
}

function renderModeSettings(saved = load("settings", {})) {
  const mode = currentMode();
  if (!mode) {
    return;
  }
  const rates = Array.isArray(mode.frameRates) && mode.frameRates.length ? mode.frameRates : [mode.fps || 60];
  fillSelect($("setting-fps"), rates.map((fps) => [fps, `${fps} FPS`]), saved.fps || (rates.includes(60) ? 60 : rates[0]));

  const available = browserCodecs();
  const codecs = (mode.codecs || []).filter((codec) => available.has(codec));
  // AV1 then HEVC give the best picture per bit; H.264 is the fallback every browser decodes.
  const preferred = ["av1", "hevc", "h264"].find((codec) => codecs.includes(codec));
  fillSelect($("setting-codec"), codecs.map((codec) => [codec, CODEC_LABELS[codec] || codec]), saved.codec || preferred);
  if (!codecs.length) {
    setStatus("library-status", "This browser cannot decode any codec the PC offers at this resolution.", true);
  }

  fillSelect($("setting-bitrate"), BITRATES_KBPS.map((kbps) => [kbps, `${kbps / 1000} Mbps`]),
    saved.bitrateKbps || mode.defaultBitrateKbps);
  renderHdrSetting(saved.hdr);
}

function renderHdrSetting(wanted) {
  const mode = currentMode();
  const codec = $("setting-codec").value;
  const possible = Boolean(mode && mode.hdrSupported && (mode.hdrCodecs || []).includes(codec) && displaySupportsHdr());
  const checkbox = $("setting-hdr");
  checkbox.disabled = !possible;
  checkbox.checked = possible && Boolean(wanted === undefined ? checkbox.checked : wanted);
  checkbox.parentElement.title = possible ? "Needs the PC's display in HDR mode"
    : "Needs an HDR display, and HEVC or AV1 at 1080p or above";
}

function currentSettings() {
  const mode = currentMode();
  return {
    mode: mode ? `${mode.width}x${mode.height}` : "",
    fps: Number($("setting-fps").value),
    codec: $("setting-codec").value,
    bitrateKbps: Number($("setting-bitrate").value),
    hdr: $("setting-hdr").checked,
  };
}

function storeSettings() {
  save("settings", currentSettings());
}

// ---------------------------------------------------------------------------------------------
// Applications

function renderApps() {
  const container = $("apps");
  container.replaceChildren(...state.apps.map((app) => {
    const id = String(app.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "app";
    button.title = id === state.runningAppId ? `Resume ${app.title}` : `Start ${app.title}`;
    const artwork = state.artwork.get(id);
    let art;
    if (artwork) {
      art = document.createElement("img");
      art.src = artwork;
      art.alt = "";
    } else {
      art = document.createElement("div");
      art.textContent = (app.title || "?").trim().charAt(0).toUpperCase();
      if (!state.artwork.has(id)) {
        state.artwork.set(id, null);
        send({ type: "get-app-artwork", appId: id });
      }
    }
    art.className = "art";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = app.title || `App ${id}`;
    button.append(art, title);
    if (id === state.runningAppId) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Running";
      button.append(badge);
    }
    button.addEventListener("click", () => startSession(app));
    return button;
  }));
  if (!state.apps.length) {
    setStatus("library-status", "Loading applications…");
  } else if ($("library-status").textContent === "Loading applications…") {
    setStatus("library-status", "");
  }
}

function handleArtwork(message) {
  const id = String(message.appId);
  if (!message.available || typeof message.data !== "string" || !/^image\/(png|jpeg|webp)$/.test(message.mimeType)) {
    return;
  }
  state.artwork.set(id, `data:${message.mimeType};base64,${message.data}`);
  renderApps();
}

function handleHostSessionStatus(message) {
  const texts = {
    stopping: "Stopping the running application…",
    switching: "Switching applications…",
    resuming: "Resuming…",
    starting: "Starting…",
    stopped: "Application stopped.",
    failed: message.message || "The PC could not complete the operation.",
  };
  setStatus("library-status", texts[message.state] || "", message.state === "failed");
  if (message.state === "stopped" || message.state === "failed") {
    send({ type: "get-apps" });
  }
}

// ---------------------------------------------------------------------------------------------
// Session

function startSession(app) {
  const settings = currentSettings();
  const mode = currentMode();
  if (!mode || !settings.codec) {
    setStatus("library-status", "Choose a resolution and codec first.", true);
    return;
  }
  storeSettings();
  const appId = String(app.id);
  const video = {
    width: mode.width,
    height: mode.height,
    fps: settings.fps,
    codec: settings.codec,
    bitrateKbps: settings.bitrateKbps,
    hdr: settings.hdr,
  };
  // Starting a different app while one runs must stop the running one first.
  const type = state.runningAppId && state.runningAppId !== appId ? "switch-session" : "start-session";
  if (type === "switch-session" && !confirm(`Quit the running application and start ${app.title}?`)) {
    return;
  }
  $("stream-title").textContent = `${app.title} · ${mode.height}p${settings.fps} ${CODEC_LABELS[settings.codec]}${settings.hdr ? " HDR" : ""}`;
  $("stream-message").textContent = "Starting…";
  show("stream");
  // Must run inside the click so the browser grants fullscreen and audio playback.
  enterFullscreen();
  $("video").play().catch(() => {});
  send({ type, appId, video, audio: { channels: 2 } });
}

function handleSessionStatus(message) {
  state.sessionState = message.state;
  if (typeof message.sessionId === "number") {
    state.sessionId = message.sessionId;
  }
  const texts = {
    starting: "Starting…",
    "starting-webrtc": "Connecting…",
    "connecting-sunshine": "Connecting…",
    "starting-moonlight": "Starting the stream…",
    stopping: "Stopping…",
  };
  if (message.state === "streaming") {
    $("stream-message").textContent = state.peer && state.peer.connectionState === "connected" ? "" : "Connecting…";
  } else if (message.state === "error") {
    endStream(message.message || "The stream stopped with an error.");
  } else if (message.state === "idle") {
    if (!screens.stream.hidden) {
      endStream("");
    }
  } else if (texts[message.state] && !screens.stream.hidden) {
    $("stream-message").textContent = texts[message.state];
  }
}

function stopSession() {
  send({ type: "stop-session" });
  endStream("");
}

function quitApp() {
  if (!confirm("Quit the application on the PC? Unsaved progress will be lost.")) {
    return;
  }
  closePeer();
  send({ type: "stop-host-session" });
  leaveStreamScreen();
  setStatus("library-status", "Stopping the running application…");
}

function endStream(errorText) {
  closePeer();
  if (!screens.stream.hidden) {
    leaveStreamScreen();
  }
  setStatus("library-status", errorText, Boolean(errorText));
  send({ type: "get-apps" });
}

function leaveStreamScreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  show(state.socket ? "library" : "connect");
}

// ---------------------------------------------------------------------------------------------
// WebRTC

function createPeer(sessionId) {
  closePeer();
  state.sessionId = sessionId;
  state.pendingCandidates = [];
  const peer = new RTCPeerConnection({ iceServers: [] });
  state.peer = peer;
  const stream = new MediaStream();
  $("video").srcObject = stream;

  peer.ontrack = (event) => {
    // Play frames as soon as they are decoded: the LAN needs no jitter cushion, and every
    // millisecond held here is input latency.
    try {
      if ("jitterBufferTarget" in event.receiver) {
        event.receiver.jitterBufferTarget = 0;
      }
      if ("playoutDelayHint" in event.receiver) {
        event.receiver.playoutDelayHint = 0;
      }
    } catch {
      // Older engines expose neither; their default buffering still works.
    }
    stream.addTrack(event.track);
    $("video").play().catch(() => {});
  };
  peer.ondatachannel = (event) => {
    const channel = event.channel;
    if (channel.label === "control") {
      state.controlChannel = channel;
      channel.onopen = () => announceGamepads();
      channel.onmessage = (message) => handleControlMessage(message.data);
      if (channel.readyState === "open") {
        announceGamepads();
      }
    } else if (channel.label === "gamepad") {
      state.gamepadChannel = channel;
    } else {
      channel.close();
    }
  };
  peer.onicecandidate = (event) => {
    if (event.candidate && event.candidate.candidate) {
      send({ type: "candidate", sessionId, candidate: event.candidate.candidate, mid: event.candidate.sdpMid });
    }
  };
  peer.onconnectionstatechange = () => {
    if (peer !== state.peer) {
      return;
    }
    if (peer.connectionState === "connected") {
      $("stream-message").textContent = "";
      startGamepadLoop();
      startStats();
    } else if (peer.connectionState === "failed") {
      $("stream-message").textContent = "The connection to the PC was lost.";
    }
  };
  return peer;
}

async function handleOffer(message) {
  if (typeof message.sessionId !== "number" || typeof message.sdp !== "string") {
    return;
  }
  const peer = state.peer && state.sessionId === message.sessionId ? state.peer : createPeer(message.sessionId);
  try {
    await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
    for (const candidate of state.pendingCandidates.splice(0)) {
      await peer.addIceCandidate(candidate).catch((error) => console.warn("addIceCandidate", error));
    }
    await peer.setLocalDescription(await peer.createAnswer());
    send({ type: "answer", sessionId: message.sessionId, sdp: peer.localDescription.sdp });
  } catch (error) {
    console.error("WebRTC offer failed", error);
    send({ type: "stop-session" });
    endStream(`This browser could not accept the stream: ${error.message}`);
  }
}

async function handleRemoteCandidate(message) {
  if (!state.peer || message.sessionId !== state.sessionId || typeof message.candidate !== "string") {
    return;
  }
  const candidate = { candidate: message.candidate, sdpMid: message.mid };
  if (!state.peer.remoteDescription) {
    state.pendingCandidates.push(candidate);
    return;
  }
  await state.peer.addIceCandidate(candidate).catch((error) => console.warn("addIceCandidate", error));
}

function closePeer() {
  stopGamepadLoop();
  stopStats();
  for (const pad of state.pads.values()) {
    stopRumble(pad);
  }
  state.pads.clear();
  state.controlChannel = null;
  state.gamepadChannel = null;
  if (state.peer) {
    const peer = state.peer;
    state.peer = null;
    peer.ontrack = peer.ondatachannel = peer.onicecandidate = peer.onconnectionstatechange = null;
    peer.close();
  }
  const video = $("video");
  if (video.srcObject) {
    video.srcObject = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Gamepads

function vibrationEffects(gamepad) {
  const actuator = gamepad.vibrationActuator;
  if (!actuator) {
    return [];
  }
  return Array.isArray(actuator.effects) ? actuator.effects : [actuator.type];
}

function announceGamepad(gamepad) {
  const channel = state.controlChannel;
  if (!gamepad || !channel || channel.readyState !== "open" || gamepad.index >= 16) {
    return;
  }
  let pad = state.pads.get(gamepad.index);
  if (pad && pad.announced) {
    return;
  }
  const effects = vibrationEffects(gamepad);
  pad = { controllerId: state.nextControllerId++, announced: false, rumble: null, rumbleTimer: 0 };
  channel.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "gamepad-connected",
    controllerId: pad.controllerId,
    index: gamepad.index,
    browserIndex: gamepad.index,
    id: gamepad.id.slice(0, 512),
    mapping: gamepad.mapping || "",
    buttons: Math.min(gamepad.buttons.length, 64),
    axes: Math.min(gamepad.axes.length, 16),
    dualRumble: effects.includes("dual-rumble"),
    triggerRumble: effects.includes("trigger-rumble"),
  }));
  pad.announced = true;
  state.pads.set(gamepad.index, pad);
  state.core.attachGamepad(gamepad.index, pad.controllerId);
}

function announceGamepads() {
  for (const gamepad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (gamepad && gamepad.connected) {
      announceGamepad(gamepad);
    }
  }
}

function forgetGamepad(index) {
  const pad = state.pads.get(index);
  if (!pad) {
    return;
  }
  stopRumble(pad);
  state.pads.delete(index);
  state.core.detachGamepad(index);
  const channel = state.controlChannel;
  if (channel && channel.readyState === "open") {
    channel.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "gamepad-disconnected", controllerId: pad.controllerId }));
  }
}

function pollGamepads() {
  const channel = state.gamepadChannel;
  if (!channel || channel.readyState !== "open") {
    return;
  }
  const now = performance.now();
  const gamepads = navigator.getGamepads();
  for (const [index, pad] of state.pads) {
    const gamepad = gamepads[index];
    if (!gamepad || !gamepad.connected) {
      forgetGamepad(index);
      continue;
    }
    const message = state.core.encodeGamepad(index, gamepad, now);
    // A snapshot dropped on a congested channel is replaced by the next poll; queuing it
    // would only deliver stale input later.
    if (message && channel.bufferedAmount < MAX_BUFFERED_BYTES) {
      channel.send(message);
      state.core.commitGamepad(index, now);
    }
  }
}

function startGamepadLoop() {
  if (!state.pollTimer && navigator.getGamepads) {
    announceGamepads();
    state.pollTimer = setInterval(pollGamepads, GAMEPAD_POLL_MS);
  }
}

function stopGamepadLoop() {
  clearInterval(state.pollTimer);
  state.pollTimer = 0;
}

function handleControlMessage(data) {
  let message;
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }
  if (!message || message.v !== PROTOCOL_VERSION || message.type !== "rumble") {
    return;
  }
  for (const [index, pad] of state.pads) {
    if (pad.controllerId === message.controllerId) {
      pad.rumble = message;
      playRumble(index, pad);
    }
  }
}

// The protocol carries rumble as a level that holds until changed, while browser effects
// have a duration, so a running effect is renewed before it ends.
function playRumble(index, pad) {
  clearTimeout(pad.rumbleTimer);
  const gamepad = navigator.getGamepads()[index];
  const actuator = gamepad && gamepad.vibrationActuator;
  const rumble = pad.rumble;
  if (!actuator || !rumble) {
    return;
  }
  const effects = vibrationEffects(gamepad);
  const strong = Number(rumble.strongMagnitude) || 0;
  const weak = Number(rumble.weakMagnitude) || 0;
  const left = Number(rumble.leftTrigger) || 0;
  const right = Number(rumble.rightTrigger) || 0;
  if (!strong && !weak && !left && !right) {
    actuator.reset && actuator.reset().catch(() => {});
    return;
  }
  const params = { duration: RUMBLE_EFFECT_MS, strongMagnitude: strong, weakMagnitude: weak };
  const effect = (left || right) && effects.includes("trigger-rumble") ? "trigger-rumble" : "dual-rumble";
  if (effect === "trigger-rumble") {
    params.leftTrigger = left;
    params.rightTrigger = right;
  }
  actuator.playEffect(effect, params).catch(() => {});
  pad.rumbleTimer = setTimeout(() => playRumble(index, pad), RUMBLE_REFRESH_MS);
}

function stopRumble(pad) {
  clearTimeout(pad.rumbleTimer);
  pad.rumble = null;
}

window.addEventListener("gamepadconnected", (event) => {
  if (state.pollTimer) {
    announceGamepad(event.gamepad);
  }
});
window.addEventListener("gamepaddisconnected", (event) => forgetGamepad(event.gamepad.index));

// ---------------------------------------------------------------------------------------------
// Statistics

function startStats() {
  stopStats();
  state.previousStats = null;
  state.statsTimer = setInterval(updateStats, 1000);
}

function stopStats() {
  clearInterval(state.statsTimer);
  state.statsTimer = 0;
}

async function updateStats() {
  if (!state.peer || $("stats").hidden) {
    return;
  }
  const report = await state.peer.getStats();
  let video = null;
  let pair = null;
  const codecs = new Map();
  report.forEach((entry) => {
    if (entry.type === "inbound-rtp" && entry.kind === "video") {
      video = entry;
    } else if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded") {
      pair = entry;
    } else if (entry.type === "codec") {
      codecs.set(entry.id, entry);
    }
  });
  if (!video) {
    return;
  }
  const previous = state.previousStats;
  state.previousStats = video;
  const delta = (field) => (previous ? (video[field] || 0) - (previous[field] || 0) : 0);
  const seconds = previous ? (video.timestamp - previous.timestamp) / 1000 : 0;
  const decoded = delta("framesDecoded");
  const emitted = delta("jitterBufferEmittedCount");
  const codec = codecs.get(video.codecId);
  const lines = [
    `${video.frameWidth || "?"}x${video.frameHeight || "?"}  ${video.framesPerSecond || 0} FPS  ${codec ? codec.mimeType.replace("video/", "") : ""}`,
    `Bitrate        ${seconds ? ((delta("bytesReceived") * 8) / seconds / 1e6).toFixed(1) : "-"} Mbps`,
    `Decode         ${decoded ? ((delta("totalDecodeTime") * 1000) / decoded).toFixed(2) : "-"} ms/frame`,
    `Jitter buffer  ${emitted ? ((delta("jitterBufferDelay") * 1000) / emitted).toFixed(1) : "-"} ms`,
    `Network RTT    ${pair && pair.currentRoundTripTime != null ? (pair.currentRoundTripTime * 1000).toFixed(1) : "-"} ms`,
    `Lost packets   ${video.packetsLost || 0}   Dropped frames ${video.framesDropped || 0}`,
    `Decoder        ${video.decoderImplementation || "-"}${video.powerEfficientDecoder ? " (hardware)" : ""}`,
    `Gamepads       ${state.pads.size}`,
  ];
  $("stats").textContent = lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Stream screen

function enterFullscreen() {
  if (!document.fullscreenElement && screens.stream.requestFullscreen) {
    screens.stream.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  }
}

let idleTimer = 0;
function markActive() {
  screens.stream.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => screens.stream.classList.add("idle"), IDLE_CURSOR_MS);
}
screens.stream.addEventListener("mousemove", markActive);

$("stream-stop").addEventListener("click", stopSession);
$("stream-quit").addEventListener("click", quitApp);
$("stream-fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    enterFullscreen();
  }
});
$("stream-stats-toggle").addEventListener("click", () => {
  $("stats").hidden = !$("stats").hidden;
  if (!$("stats").hidden) {
    $("stats").textContent = "…";
    updateStats();
  }
});

// Ctrl+Alt+Shift+Q disconnects, as in Moonlight.
document.addEventListener("keydown", (event) => {
  if (!screens.stream.hidden && event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyQ") {
    event.preventDefault();
    stopSession();
  }
});

// ---------------------------------------------------------------------------------------------
// Startup

$("connect-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const host = $("host").value.trim().replace(/^\[|\]$/g, "");
  const port = Number($("port").value);
  if (!host || !(port >= 1 && port <= 65535)) {
    return;
  }
  connect(host, port);
});
$("disconnect").addEventListener("click", () => {
  disconnectSocket();
  show("connect");
  setStatus("connect-status", "");
});
$("pair-new").addEventListener("click", requestPairing);
$("setting-mode").addEventListener("change", () => {
  renderModeSettings({ ...currentSettings(), fps: Number($("setting-fps").value), codec: $("setting-codec").value });
  storeSettings();
});
$("setting-codec").addEventListener("change", () => {
  renderHdrSetting();
  storeSettings();
});
for (const id of ["setting-fps", "setting-bitrate", "setting-hdr"]) {
  $(id).addEventListener("change", storeSettings);
}

// The browser offers installation once the manifest and service worker are in place.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("install").hidden = false;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("install").hidden = true;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) {
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $("install").hidden = true;
});

async function main() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker", error));
  }
  show("connect");
  const last = load("lastHost", null);
  if (last) {
    $("host").value = last.host;
    $("port").value = last.port;
  }
  if (!window.RTCPeerConnection) {
    setStatus("connect-status", "This browser does not support WebRTC.", true);
    return;
  }
  try {
    state.core = await loadClientCore();
  } catch (error) {
    setStatus("connect-status", `The WebAssembly core failed to load: ${error.message}`, true);
    return;
  }
  const params = new URLSearchParams(location.search);
  if (params.get("host")) {
    $("host").value = params.get("host");
    $("port").value = params.get("port") || 8000;
    connect($("host").value, Number($("port").value));
  }
}

main();
