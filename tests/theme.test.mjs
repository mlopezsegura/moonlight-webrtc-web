// Tests the themes in web/theme.js: the default must stay the client's original look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../web/theme.js", import.meta.url), "utf8");
const context = {};
vm.runInNewContext(source, context);
const Theme = context.MoonlightTheme;
const plain = (value) => JSON.parse(JSON.stringify(value));

// The colors style.css had before themes existed.
const ORIGINAL = {
  bg: "#0f1115", surface: "#181b22", surface2: "#222631", border: "#333949", text: "#e8eaf0", muted: "#9aa1b2",
  accent: "#5b8cff", onAccent: "#ffffff", danger: "#e5484d", dangerText: "#ffb4b6", artFrom: "#2a3142", artTo: "#161a22",
  helpBg: "#241f12", helpBorder: "#5b4a1f", helpText: "#f1e3c0", helpLink: "#ffd77a",
};

test("nothing stored gives the original look", () => {
  for (const stored of [null, undefined, {}, { theme: "nope" }, "garbage"]) {
    const values = Theme.tokens(stored);
    assert.equal(values.scheme, "dark");
    for (const [key, color] of Object.entries(ORIGINAL)) {
      assert.equal(values[key], color, `${key} for ${JSON.stringify(stored)}`);
    }
  }
});

test("style.css defaults match Midnight", () => {
  const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
  const property = { surface2: "surface-2", onAccent: "on-accent", dangerText: "danger-text", artFrom: "art-from",
    artTo: "art-to", helpBg: "help-bg", helpBorder: "help-border", helpText: "help-text", helpLink: "help-link" };
  for (const [key, color] of Object.entries(ORIGINAL)) {
    assert.match(css, new RegExp(`--${property[key] || key}: ${color};`), key);
  }
});

test("every theme yields valid colors with readable text", () => {
  for (const name of [...Object.keys(Theme.THEMES), "auto"]) {
    for (const prefersLight of [false, true]) {
      const values = Theme.tokens({ theme: name }, prefersLight);
      for (const [key, color] of Object.entries(values)) {
        if (key !== "scheme") {
          assert.match(color, /^#[0-9a-f]{6}$/, `${name}.${key}`);
        }
      }
      assert.ok(Theme.contrast(values.text, values.bg) >= 7, `${name} text on bg`);
      assert.ok(Theme.contrast(values.muted, values.surface) >= 4.5, `${name} muted on surface`);
      assert.ok(Theme.contrast(values.onAccent, values.accent) >= 3, `${name} text on accent`);
    }
  }
});

test("auto follows the system", () => {
  assert.equal(Theme.tokens({ theme: "auto" }, false).bg, Theme.THEMES.midnight.bg);
  assert.equal(Theme.tokens({ theme: "auto" }, true).bg, Theme.THEMES.light.bg);
  assert.equal(Theme.tokens({ theme: "auto" }, true).scheme, "light");
});

test("custom colors override the theme and re-derive what depends on them", () => {
  const values = Theme.tokens({ theme: "midnight", colors: { accent: "#ffd400", bg: "#FAFAFA", text: "#101010" } });
  assert.equal(values.accent, "#ffd400");
  assert.equal(values.onAccent, "#111111");
  assert.equal(values.bg, "#fafafa");
  assert.equal(values.scheme, "light");
  assert.notEqual(values.muted, ORIGINAL.muted);
  assert.equal(values.surface, ORIGINAL.surface);
});

test("invalid stored values are dropped", () => {
  assert.deepEqual(plain(Theme.normalize({ theme: "plum", colors: { accent: "red", bg: "#12345", text: "#abcdef", evil: "#000000" } })),
    { theme: "plum", colors: { text: "#abcdef" } });
});
