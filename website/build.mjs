import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  await fs.readFile(path.join(here, "release.config.json"), "utf8"),
);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const siteUrl = withSlash(option("--site-url", config.siteUrl));
const downloadBase = withSlash(option("--download-base", config.downloadBase));
const src = path.join(here, "src"),
  out = path.join(here, "public");
const local = !/^https?:\/\//.test(downloadBase);

function withSlash(value) {
  return value && !value.endsWith("/") ? value + "/" : value || "";
}
const resolve = (p) => path.resolve(here, p);
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function size(bytes) {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit ? `${value.toFixed(1)} ${units[unit]}` : `${bytes} bytes`;
}
const date = (d) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

function apkCertificateSha256(apk) {
  let eocd = apk.length - 22;
  while (eocd >= 0 && apk.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw Error("APK: no end of central directory");
  const centralDirectory = apk.readUInt32LE(eocd + 16);
  if (
    apk.toString("latin1", centralDirectory - 16, centralDirectory) !==
    "APK Sig Block 42"
  )
    throw Error("APK is not signed with scheme v2+");
  const blockSize = Number(apk.readBigUInt64LE(centralDirectory - 24));
  let at = centralDirectory - blockSize - 8 + 8;
  const end = centralDirectory - 24;
  while (at < end) {
    const length = Number(apk.readBigUInt64LE(at)),
      id = apk.readUInt32LE(at + 8);
    if (id === 0x7109871a) {
      let p = at + 12 + 4;
      p += 4;
      p += 4;
      p += 4 + apk.readUInt32LE(p);
      p += 4;
      const certLength = apk.readUInt32LE(p);
      return createHash("sha256")
        .update(apk.subarray(p + 4, p + 4 + certLength))
        .digest("hex");
    }
    at += 8 + length;
  }
  throw Error("APK: no v2 signature block");
}

async function artifact(kind, version, source, publishedName) {
  const stat = await fs.stat(source);
  const name = publishedName.replace("{version}", version);
  return {
    kind,
    version,
    name,
    source,
    bytes: stat.size,
    size: size(stat.size),
    date: date(stat.mtime),
    iso: stat.mtime.toISOString().slice(0, 10),
    sha256: await sha256(source),
    url: downloadBase + encodeURIComponent(name),
  };
}

const desktopVersion = JSON.parse(
  await fs.readFile(resolve(config.desktop.packageJson), "utf8"),
).version;
const guardianVersion = /versionName\s+'([^']+)'/.exec(
  await fs.readFile(resolve(config.guardian.gradle), "utf8"),
)[1];
const desktopPath = resolve(
  config.desktop.artifact.replace("{version}", desktopVersion),
);
const desktop = await artifact(
  "windows",
  desktopVersion,
  desktopPath,
  path.basename(desktopPath),
);
const guardian = await artifact(
  "android",
  guardianVersion,
  resolve(config.guardian.artifact),
  config.guardian.publishedName,
);
guardian.certSha256 = apkCertificateSha256(await fs.readFile(guardian.source));

const expectedOutput = path.resolve(here, "public");
if (
  path.resolve(out) !== expectedOutput ||
  path.dirname(expectedOutput) !== here
)
  throw Error("Invalid website output directory");
const outputInfo = await fs.lstat(expectedOutput).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (outputInfo?.isSymbolicLink())
  throw Error("Website output cannot be a symbolic link");
await fs.rm(expectedOutput, { recursive: true, force: true });
await fs.cp(src, out, { recursive: true });
await fs.mkdir(path.join(out, "downloads"), { recursive: true });
if (local) {
  for (const file of [desktop, guardian]) {
    const target = path.join(out, "downloads", file.name);
    try {
      await fs.link(file.source, target);
    } catch {
      await fs.copyFile(file.source, target);
    }
  }
}
await fs.writeFile(
  path.join(out, "downloads", "SHA256SUMS.txt"),
  `${desktop.sha256}  ${desktop.name}\n${guardian.sha256}  ${guardian.name}\n`,
);
await fs.mkdir(path.join(out, "notices"), { recursive: true });
for (const name of [
  "THIRD-PARTY-NOTICES.txt",
  "LLAMA-3.2-COMMUNITY-LICENSE.txt",
  "LLAMA-3.2-ACCEPTABLE-USE-POLICY.md",
])
  await fs.copyFile(
    path.join(resolve(config.notices), name),
    path.join(out, "notices", name),
  );
await fs.writeFile(
  path.join(out, "release.json"),
  JSON.stringify(
    {
      version: desktop.version,
      released: desktop.iso,
      files: [desktop, guardian].map(
        ({ kind, version, name, url, bytes, sha256 }) => ({
          platform: kind,
          version,
          name,
          url,
          bytes,
          sha256,
        }),
      ),
      guardianSigningCertificateSha256: guardian.certSha256,
    },
    null,
    2,
  ) + "\n",
);
await fs.writeFile(path.join(out, ".nojekyll"), "");

const values = {
  "site.url": siteUrl,
  "site.home": siteUrl || "./",
  "repo.url": config.repoUrl.replace(/\/$/, ""),
  "sums.url": "downloads/SHA256SUMS.txt",
  ...Object.fromEntries(
    ["version", "name", "url", "size", "sha256", "date"].flatMap((key) => [
      [`desktop.${key}`, desktop[key]],
      [`guardian.${key}`, guardian[key]],
    ]),
  ),
  "desktop.file": desktop.name,
  "guardian.file": guardian.name,
  "guardian.certSha256": guardian.certSha256,
};
for (const page of ["index.html", "404.html"]) {
  const file = path.join(out, page);
  let html = await fs.readFile(file, "utf8");

  if (!siteUrl)
    html = html
      .replace(/\s*<link rel="canonical"[^>]*>/, "")
      .replace(/\s*<meta property="og:image"[^>]*>/, "")
      .replace(
        /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        "",
      );
  html = html.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    if (!(key in values))
      throw Error(`Unknown placeholder ${match} in ${page}`);
    return values[key];
  });
  await fs.writeFile(file, html);
}
console.log(`Built ${path.relative(process.cwd(), out)}`);
for (const f of [desktop, guardian])
  console.log(`  ${f.name}  ${f.size}  sha256 ${f.sha256}`);
console.log(`  Guardian signing certificate sha256 ${guardian.certSha256}`);
console.log(
  local
    ? "  Binaries copied into public/downloads/."
    : `  Upload both binaries to ${downloadBase}`,
);
