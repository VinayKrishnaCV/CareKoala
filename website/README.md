# CareKoala download site

The static download page uses local HTML, CSS, fonts, QR generation and theme controls. There is no framework or external QR service.

It covers the Windows PC app and Android Guardian: one-code QR pairing, remote code entry, the score policy, personal trigger words, optional domain blocking, tray operation and startup preferences. Setup explains that an encrypted PC confirmation completes an unlock; a successful send alone does not.

Version 0.4.2 adds persistent light/dark themes, compact download rows and current pairing instructions. The companion apps support ten people, retained enrollment during theme changes, saved unlock completion and working overlay mouse/keyboard input. See the [release notes](../CHANGELOG.md) for details.

## Source and artifacts

Both application source trees are public:

- [Windows PC source](<../boundary-ml 5/electron-app/README.md>)
- [Android Guardian source](../guardian-android/README.md)

The site does not build either application. `build.mjs` reads existing approved artifacts from `release.config.json`, calculates SHA-256 hashes, reads the APK signing-certificate fingerprint and writes `public/`.

Output includes pages, assets, `downloads/SHA256SUMS.txt`, `release.json` and license notices. Local download URLs also copy the installer and APK. Source publication does not upload binaries or deploy the site.

## Build after artifacts are approved

Use Node.js 22 or newer. From the repository root:

```powershell
node website/build.mjs
```

The builder validates its output path before replacing `website/public`. That directory is generated output and is excluded from Git.

Optional arguments:

```powershell
node website/build.mjs --site-url https://example.org/carekoala/ --download-base https://github.com/VinayKrishnaCV/CareKoala/releases/download/v0.4.2/
```

`--site-url` supplies absolute canonical and preview addresses. An HTTPS `--download-base` links to files hosted elsewhere instead of copying them. Those versioned files must already exist; the builder does not upload them.

## Preview and publish

Serve `website/public` over HTTP with a static server. Check desktop and narrow layouts, both themes, setup tabs, checksum-copy buttons and download links. The APK QR appears over HTTP(S); a phone cannot use a PC's `file://` address. Cross-device testing needs a PC address the phone can reach, not `localhost`.

Choose a host that accepts the release file sizes, or host binaries separately. The Windows installer is large because it contains Python, OCR weights and the local model runtime. Keep signing material, pairing codes and device settings out of source and site output.

The 0.4.2 site was checked over local HTTP at desktop and 390-pixel widths, including themes, tabs and APK QR generation. These are local checks, not a public deployment.
