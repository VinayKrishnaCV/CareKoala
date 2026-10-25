# Windows domain protection

CareKoala uses the Windows hosts resolver as a lightweight domain sinkhole. No
DNS daemon, kernel driver, or extra npm firewall library runs in memory. The
maintained [StevenBlack unified hosts list](https://github.com/StevenBlack/hosts)
supplies adware and malware domains, including contributed scam/phishing entries.
The optional social, political, adult and gambling categories are not enabled.

Enable requests Windows UAC for a narrow PowerShell helper. It downloads and
validates the list, preserves existing hosts entries, installs its updater under
Program Files, and schedules a daily SYSTEM update. Windows blocks listed names
immediately and after CareKoala exits. Update failures retain the previous list.
Disable removes only the CareKoala block and its scheduled task. A first-install
backup is retained in Program Files/CareKoalaDomainProtection.

Entries are compressed to nine domains per hosts line, following upstream's
Windows performance guidance. The Windows DNS Client service is left enabled.

This is domain blocking, not a packet firewall or a guarantee against all scams.
It cannot stop existing open connections, direct IP traffic, an app that bypasses
the Windows resolver, new/unlisted threats, or an administrator changing hosts.
There is no screen-text or browsing-history upload. The list provider sees update
requests. ntfy.sh and the list endpoint are excluded to retain alert delivery.

Upstream code is not copied. The list is downloaded at runtime; upstream ownership
and source licenses remain with their authors. The StevenBlack project code is MIT licensed;
the combined list has individual source licenses documented in
[its source directory](https://github.com/StevenBlack/hosts/tree/master/data).
