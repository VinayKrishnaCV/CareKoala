(function () {
  "use strict";

  const storageKey = "carekoala-theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = null;

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {}

  function apply() {
    const theme = preference || (system.matches ? "dark" : "light");
    root.dataset.theme = theme;
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    const dark = theme === "dark";
    toggle.setAttribute(
      "aria-label",
      dark ? "Use light theme" : "Use dark theme",
    );
    toggle.setAttribute("title", dark ? "Use light theme" : "Use dark theme");
    toggle.setAttribute("aria-pressed", String(dark));
  }

  apply();
  system.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.getElementById("theme-toggle")?.addEventListener("click", () => {
      preference = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(storageKey, preference);
      } catch {}
      apply();
    });
  });
})();
