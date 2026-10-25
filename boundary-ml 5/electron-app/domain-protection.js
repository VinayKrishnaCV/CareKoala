const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
class DomainProtection {
  async status() {
    if (process.platform !== "win32")
      return {
        enabled: false,
        message: "Domain protection currently supports Windows.",
      };
    const hosts = await fs.readFile(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "drivers",
        "etc",
        "hosts",
      ),
      "utf8",
    );
    const block = hosts.match(
      /# BEGIN CAREKOALA DOMAIN PROTECTION\r?\n([\s\S]*?)# END CAREKOALA DOMAIN PROTECTION/,
    );
    const count = block
      ? block[1]
          .split(/\r?\n/)
          .filter((line) => line.startsWith("0.0.0.0 "))
          .reduce((n, line) => n + line.trim().split(/\s+/).length - 1, 0)
      : 0;
    let last = {};
    try {
      last = JSON.parse(
        await fs.readFile(
          path.join(
            process.env.ProgramFiles || "C:\\Program Files",
            "CareKoalaDomainProtection",
            "status.json",
          ),
          "utf8",
        ),
      );
    } catch {}
    return {
      enabled: !!block,
      count,
      updated: last.updated,
      message: block
        ? "Windows domain blocking enabled" +
          (last.scheduled ? "; daily updater installed." : ".")
        : "Domain blocking is off.",
    };
  }
  async change(mode) {
    if (!["Enable", "Update", "Disable"].includes(mode))
      throw Error("Invalid domain-protection action.");
    if (process.platform !== "win32") throw Error("Windows is required.");
    if (this.pending)
      throw Error("A domain protection update is already running.");
    this.pending = true;
    try {
      const helper = path
        .join(__dirname, "windows", "DomainProtection.ps1")
        .replaceAll("'", "''");

      const script = `$p=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${helper}" -Mode ${mode}'; exit $p.ExitCode`;
      await new Promise((resolve, reject) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          { windowsHide: true, stdio: "ignore" },
        );
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(
                Error(
                  "Domain protection was not changed successfully. Allow the Windows administrator prompt and check the network; the previous list is retained on download failure.",
                ),
              ),
        );
      });
      return this.status();
    } finally {
      this.pending = false;
    }
  }
}
module.exports = { DomainProtection };
