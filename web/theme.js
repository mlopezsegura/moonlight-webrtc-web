// Themes and custom colors. A classic script loaded in <head>, so the chosen colors are in place
// before the page first paints. app.mjs uses window.MoonlightTheme to show and change them.
//
// The choice is stored as "mlw.appearance" = { theme, colors: { accent, bg, surface, text } }.
// "midnight" with no custom colors is the client's original look, and the default.
(function (root) {
  "use strict";

  const STORAGE_KEY = "mlw.appearance";
  const DEFAULT_THEME = "midnight";

  // Every theme sets the base colors; the rest is derived from them unless a theme sets it too.
  const THEMES = {
    midnight: {
      label: "Midnight (default)", scheme: "dark",
      bg: "#0f1115", surface: "#181b22", text: "#e8eaf0", accent: "#5b8cff",
      surface2: "#222631", border: "#333949", muted: "#9aa1b2", onAccent: "#ffffff",
      danger: "#e5484d", dangerText: "#ffb4b6", artFrom: "#2a3142", artTo: "#161a22",
    },
    black: {
      label: "Black", scheme: "dark",
      bg: "#000000", surface: "#0c0d10", text: "#eceef2", accent: "#5b8cff",
      surface2: "#17191e", border: "#2a2d35", muted: "#959baa",
    },
    light: {
      label: "Light", scheme: "light",
      bg: "#f3f4f7", surface: "#ffffff", text: "#1a1d24", accent: "#2f6bff",
      surface2: "#eceef3", border: "#cdd2dc", muted: "#5b6273",
      danger: "#d93036", dangerText: "#b3242a", artFrom: "#e4e8f0", artTo: "#ced4e0",
      helpBg: "#fff6dc", helpBorder: "#e3c463", helpText: "#4a3a0e", helpLink: "#8a5600",
    },
    graphite: {
      label: "Graphite", scheme: "dark",
      bg: "#151515", surface: "#1f1f1f", text: "#ececec", accent: "#f0a030",
      surface2: "#2a2a2a", border: "#3b3b3b", muted: "#a3a3a3",
    },
    forest: {
      label: "Forest", scheme: "dark",
      bg: "#0d1411", surface: "#151f1a", text: "#e5eee8", accent: "#3ecf8e",
      surface2: "#1e2a24", border: "#2e3f36", muted: "#94a69b",
    },
    plum: {
      label: "Plum", scheme: "dark",
      bg: "#130f17", surface: "#1c1621", text: "#f0e8f3", accent: "#e0609a",
      surface2: "#271e2e", border: "#3a2d44", muted: "#aa9bb3",
    },
    contrast: {
      label: "High contrast", scheme: "dark",
      bg: "#000000", surface: "#000000", text: "#ffffff", accent: "#ffd400",
      surface2: "#121212", border: "#ffffff", muted: "#e0e0e0", onAccent: "#000000",
      danger: "#ff5c5c", dangerText: "#ff9e9e",
    },
  };

  // "auto" follows the system: Midnight when it is dark, Light when it is light.
  const AUTO = { label: "Match system", dark: "midnight", light: "light" };

  // The colors a user can pick themselves.
  const CUSTOM_KEYS = ["accent", "bg", "surface", "text"];

  // CSS custom property for each token.
  const PROPERTIES = {
    bg: "--bg", surface: "--surface", surface2: "--surface-2", border: "--border", text: "--text",
    muted: "--muted", accent: "--accent", onAccent: "--on-accent", danger: "--danger", dangerText: "--danger-text",
    artFrom: "--art-from", artTo: "--art-to",
    helpBg: "--help-bg", helpBorder: "--help-border", helpText: "--help-text", helpLink: "--help-link",
  };

  const HEX = /^#[0-9a-f]{6}$/i;

  function rgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function hex(channels) {
    return "#" + channels.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");
  }

  // `amount` of `b` into `a`.
  function mix(a, b, amount) {
    const from = rgb(a);
    const to = rgb(b);
    return hex(from.map((c, i) => c + (to[i] - c) * amount));
  }

  // WCAG relative luminance.
  function luminance(color) {
    const [r, g, b] = rgb(color).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }

  // Text color that reads best on `color`.
  function readableOn(color) {
    return contrast(color, "#ffffff") >= contrast(color, "#111111") ? "#ffffff" : "#111111";
  }

  function normalize(appearance) {
    const value = appearance && typeof appearance === "object" ? appearance : {};
    const theme = value.theme === "auto" || Object.hasOwn(THEMES, value.theme) ? value.theme : DEFAULT_THEME;
    const colors = {};
    for (const key of CUSTOM_KEYS) {
      const color = value.colors && value.colors[key];
      if (typeof color === "string" && HEX.test(color)) {
        colors[key] = color.toLowerCase();
      }
    }
    return { theme, colors };
  }

  function resolveTheme(theme, prefersLight) {
    return theme === "auto" ? (prefersLight ? AUTO.light : AUTO.dark) : theme;
  }

  // Every token for an appearance. Tokens a theme does not set, and those a custom color changes,
  // are derived from the base colors.
  function tokens(appearance, prefersLight = false) {
    const { theme, colors } = normalize(appearance);
    const base = THEMES[resolveTheme(theme, prefersLight)];
    const custom = (key) => Object.hasOwn(colors, key);
    const pick = (key, derived, dependsOn) =>
      base[key] !== undefined && !dependsOn.some(custom) ? base[key] : derived();

    const bg = colors.bg || base.bg;
    const surface = colors.surface || base.surface;
    const text = colors.text || base.text;
    const accent = colors.accent || base.accent;
    const light = luminance(bg) > 0.4;
    const surface2 = pick("surface2", () => mix(surface, text, 0.06), ["surface", "text"]);
    const danger = base.danger || THEMES.midnight.danger;

    return {
      scheme: custom("bg") ? (light ? "light" : "dark") : base.scheme,
      bg, surface, text, accent, surface2, danger,
      border: pick("border", () => mix(surface2, text, 0.14), ["surface", "text"]),
      muted: pick("muted", () => mix(text, bg, 0.35), ["text", "bg"]),
      onAccent: pick("onAccent", () => readableOn(accent), ["accent"]),
      dangerText: pick("dangerText", () => mix(danger, light ? "#000000" : "#ffffff", 0.35), ["bg"]),
      artFrom: pick("artFrom", () => mix(surface2, text, 0.05), ["surface", "text"]),
      artTo: pick("artTo", () => mix(surface, bg, 0.5), ["surface", "bg"]),
      helpBg: pick("helpBg", () => (light ? "#fff6dc" : "#241f12"), ["bg"]),
      helpBorder: pick("helpBorder", () => (light ? "#e3c463" : "#5b4a1f"), ["bg"]),
      helpText: pick("helpText", () => (light ? "#4a3a0e" : "#f1e3c0"), ["bg"]),
      helpLink: pick("helpLink", () => (light ? "#8a5600" : "#ffd77a"), ["bg"]),
    };
  }

  function load() {
    try {
      return normalize(JSON.parse(root.localStorage.getItem(STORAGE_KEY)));
    } catch {
      return normalize(null);
    }
  }

  function save(appearance) {
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(appearance)));
    } catch {
      // The choice lasts until the page closes.
    }
  }

  const systemLight = root.matchMedia ? root.matchMedia("(prefers-color-scheme: light)") : null;
  let current = load();

  function apply(appearance = current) {
    current = normalize(appearance);
    const values = tokens(current, Boolean(systemLight && systemLight.matches));
    const element = root.document.documentElement;
    for (const [key, property] of Object.entries(PROPERTIES)) {
      element.style.setProperty(property, values[key]);
    }
    element.style.colorScheme = values.scheme;
    element.dataset.theme = resolveTheme(current.theme, Boolean(systemLight && systemLight.matches));
    const meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = values.bg;
    }
    return values;
  }

  root.MoonlightTheme = {
    THEMES, AUTO, DEFAULT_THEME, CUSTOM_KEYS,
    normalize, tokens, contrast, load, save, apply,
    current: () => current,
    systemPrefersLight: () => Boolean(systemLight && systemLight.matches),
  };

  if (root.document) {
    apply();
    if (systemLight) {
      systemLight.addEventListener("change", () => {
        if (current.theme === "auto") {
          apply();
        }
      });
    }
  }
})(globalThis);
