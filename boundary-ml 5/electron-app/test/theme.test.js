const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../renderer/theme.js"),
  "utf8",
);
function mount(saved, dark = false, unavailable = false) {
  const values = new Map(saved ? [["carekoala-theme", saved]] : []);
  const listeners = {};
  const attrs = {};
  const root = { dataset: {} };
  const button = {
    setAttribute(key, value) {
      attrs[key] = value;
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
  };
  const system = {
    matches: dark,
    addEventListener(name, callback) {
      listeners.system = callback;
    },
  };
  vm.runInNewContext(source, {
    document: {
      documentElement: root,
      getElementById() {
        return button;
      },
      addEventListener(name, callback) {
        listeners[name] = callback;
      },
    },
    window: {
      matchMedia() {
        return system;
      },
    },
    localStorage: {
      getItem(key) {
        if (unavailable) throw Error("Unavailable");
        return values.get(key);
      },
      setItem(key, value) {
        if (unavailable) throw Error("Unavailable");
        values.set(key, value);
      },
    },
  });
  listeners.DOMContentLoaded();
  return { root, attrs, values, system, listeners };
}
test("theme follows the system until explicitly selected and survives reload", () => {
  const page = mount(null, true);
  assert.equal(page.root.dataset.theme, "dark");
  assert.equal(page.attrs["aria-label"], "Use light theme");
  page.system.matches = false;
  page.listeners.system();
  assert.equal(page.root.dataset.theme, "light");
  page.listeners.click();
  assert.equal(page.attrs["aria-pressed"], "true");
  page.listeners.system();
  assert.equal(page.root.dataset.theme, "dark");
  assert.equal(
    mount(page.values.get("carekoala-theme")).root.dataset.theme,
    "dark",
  );
});
test("theme rejects invalid preferences and remains usable without browser storage", () => {
  assert.equal(mount("invalid", true).root.dataset.theme, "dark");
  const page = mount(null, false, true);
  page.listeners.click();
  assert.equal(page.root.dataset.theme, "dark");
});
test("desktop and download site share the theme implementation", () => {
  assert.equal(
    source,
    fs.readFileSync(
      path.join(__dirname, "../../../website/src/assets/theme.js"),
      "utf8",
    ),
  );
});
const css = fs.readFileSync(
  path.join(__dirname, "../renderer/styles.css"),
  "utf8",
);
function luminance(hex) {
  const values = hex
    .replace("#", "")
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test("both themes meet contrast requirements for text, controls and focus indicators", () => {
  for (const selector of [":root", ':root[data-theme="dark"]']) {
    const block = css.slice(css.indexOf(selector)).split("}")[0];
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    for (const background of ["canvas", "surface", "surface-alt"]) {
      for (const foreground of ["ink", "muted", "error"])
        assert.ok(
          contrast(tokens[foreground], tokens[background]) >= 4.5,
          `${selector} ${foreground} on ${background}`,
        );
      assert.ok(
        contrast(tokens.focus, tokens[background]) >= 3,
        `${selector} focus`,
      );
      assert.ok(
        contrast(tokens.border, tokens[background]) >= 3,
        `${selector} border`,
      );
    }
    assert.ok(
      contrast(tokens["on-accent"], tokens.accent) >= 4.5,
      `${selector} button`,
    );
  }
});
