(function () {
  "use strict";
  const root = document.documentElement;
  root.classList.add("js");
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "android"
    : /Windows NT/i.test(ua)
      ? "windows"
      : /iPhone|iPad|iPod/i.test(ua) ||
          (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
        ? "ios"
        : /Mac OS X/.test(ua)
          ? "mac"
          : /CrOS|Linux/i.test(ua)
            ? "linux"
            : "other";
  root.dataset.os = os;
  const notes = {
    windows: "Windows 10/11, 64-bit installer.",
    android: "Android Guardian APK.",
    ios: "iOS is not supported. Guardian requires Android 8 or newer.",
    mac: "macOS is not supported. The desktop application requires Windows.",
    linux: "Linux is not supported. The desktop application requires Windows.",
  };
  const note = document.getElementById("os-note");
  if (note && notes[os]) {
    note.textContent = notes[os];
    note.hidden = false;
  }

  for (const group of document.querySelectorAll("[data-tabs]")) {
    const tabs = Array.from(group.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.getAttribute("aria-controls")).hidden =
          !selected;
      }
      if (focus) tab.focus();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (event) => {
        const next =
          event.key === "ArrowRight"
            ? index + 1
            : event.key === "ArrowLeft"
              ? index - 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : null;
        if (next === null) return;
        event.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], true);
      });
    });
    select(os === "android" ? tabs[1] : tabs[0], false);
  }

  function fallback(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.className = "clipboard-fallback";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {}
    area.remove();
    return copied;
  }

  for (const button of document.querySelectorAll("[data-copy]")) {
    const label = button.textContent;
    button.addEventListener("click", async () => {
      const text = document
        .getElementById(button.dataset.copy)
        .textContent.trim();
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {}
      }
      if (!copied) copied = fallback(text);
      if (copied) {
        button.textContent = "Copied";
        button.setAttribute("data-done", "");
        setTimeout(() => {
          button.textContent = label;
          button.removeAttribute("data-done");
        }, 2000);
      }
    });
  }

  const qr = document.getElementById("qr");
  const link = document.getElementById("download-android");
  if (
    qr &&
    link &&
    /^https?:$/.test(location.protocol) &&
    os !== "android" &&
    typeof window.qrcode === "function"
  ) {
    const target = new URL(link.getAttribute("href"), location.href).href;
    const code = window.qrcode(0, "M");
    code.addData(target);
    code.make();
    document.getElementById("qr-code").innerHTML = code.createSvgTag({
      cellSize: 4,
      margin: 4,
      scalable: true,
      title: "Guardian APK download QR code",
    });
    qr.hidden = false;
  }
})();
