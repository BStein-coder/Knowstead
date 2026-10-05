# Quick start: installing Knowstead

From the download to a running, backed-up installation in about 15 minutes. This is the short version –
every step is explained in depth in the [installation guide](INSTALLATION.en.md).

*[Deutsche Fassung der Installationsanleitung](INSTALLATION.md)*

> **Good to know:** the installer and the command-line tools currently print their messages in
> **German**. This guide gives you the commands that run without any questions and translates the prompts
> you may see. The web interface, the handbook and all e-mails are fully available in English.

## Contents

- [1. What you need](#1-what-you-need)
- [2. Get the package](#2-get-the-package)
- [3. Install](#3-install) – [Linux](#linux) · [Windows](#windows) · [Docker](#docker)
- [4. HTTPS with a reverse proxy](#4-https-with-a-reverse-proxy)
- [5. First setup in the browser](#5-first-setup-in-the-browser)
- [6. Check the installation and the backup](#6-check-the-installation-and-the-backup)
- [7. Updating](#7-updating)
- [Just trying it out?](#just-trying-it-out)

---

## 1. What you need

| | |
| --- | --- |
| **Server** | Linux (Debian 12, Ubuntu 22.04/24.04, RHEL 9 family – also an unprivileged Proxmox LXC container), Windows Server 2019 or newer / Windows 10/11, or Docker |
| **Node.js** | version 24 or newer – nothing else: no database server, no cache, no compiler. The Linux installer can install it for you. |
| **Size** | 2 vCPU, 4 GB RAM and an SSD are enough for up to 100 people; 4 vCPU and 8 GB for up to 500 |
| **Address** | a DNS name such as `wiki.example.com` and a TLS certificate (Caddy fetches public certificates by itself) |
| **Disk** | a **local** disk for the data directory – not a network share (SQLite needs reliable file locks) |

Knowstead is a single Node.js process. It listens on port 3000 behind a reverse proxy that provides HTTPS:

```
Browser ──HTTPS:443──▶ reverse proxy ──HTTP──▶ Knowstead (127.0.0.1:3000) ──▶ data directory
```

Keep the **program folder** (`/opt/knowstead`, `D:\Knowstead`) and the **data directory**
(`/var/lib/knowstead`, `D:\KnowsteadData`) apart – updates replace the program folder, your data stays
where it is.

## 2. Get the package

Download `knowstead-<version>-linux-x64.tar.gz` or `knowstead-<version>-windows-x64.zip` and the `.sha256`
file next to it from the [Releases](https://github.com/BStein-coder/Knowstead/releases) page and verify
the checksum:

```bash
sha256sum -c knowstead-2.0.0-linux-x64.tar.gz.sha256
```

```powershell
Get-FileHash .\knowstead-2.0.0-windows-x64.zip -Algorithm SHA256
```

The packages contain the built user interface and all runtime dependencies. To build one yourself from
the source code: `npm install && npm run build && node scripts/package.mjs --target linux-x64` (the result
is in `release/`; this also works on Windows for a Linux server).

## 3. Install

### Linux

```bash
sudo tar -xzf knowstead-2.0.0-linux-x64.tar.gz -C /opt && sudo mv /opt/knowstead-2.0.0-linux-x64 /opt/knowstead
```

Run the installer without questions – replace the address with yours:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-node --data-dir /var/lib/knowstead --base-url https://wiki.example.com --access local-proxy --install-ocr --ocr-languages eng
```

What this does: installs Node.js 24 if it is missing, creates the system account `knowstead` and the data
directory, writes the configuration (`/opt/knowstead/.env`, readable only by root and the service
account), starts Knowstead once as a test, sets up the hardened systemd service `knowstead`, and installs
Tesseract so that scanned PDFs and images become searchable.

| Option | Meaning |
| --- | --- |
| `--access local-proxy` | the reverse proxy runs on this server (recommended; Knowstead listens on 127.0.0.1 only). Alternatives: `remote-proxy --proxy-address 10.0.0.5`, or `direct` (no HTTPS – tests only) |
| `--install-ocr`, `--ocr-languages eng+deu` | text recognition for scans; languages as Tesseract codes |
| `--install-office` | LibreOffice without a desktop (about 400 MB) – preview of Word, Excel, PowerPoint and Visio files |
| `--dry-run` | only show what would happen |
| `--service none` | no systemd service (start manually with `./start.sh`) |

In a container without `sudo` (Proxmox LXC) run the same commands as root without `sudo`. Control the
service with `systemctl start|stop|restart|status knowstead`; the log is `journalctl -u knowstead -f`.

If you start `sudo bash install.sh` **without** `--unattended`, it asks the same things in German:

| Prompt | Meaning | Answer |
| --- | --- | --- |
| `Datenverzeichnis` | data directory | e.g. `/var/lib/knowstead` |
| `Zugriff: 1 = Reverse-Proxy auf diesem Server …, 2 = Proxy auf anderem Rechner, 3 = direkt ohne HTTPS` | how users reach Knowstead | `1` (proxy on this server), `2` (proxy on another machine) or `3` (direct, tests only) |
| `Port` | internal port | `3000` |
| `Adresse für die Nutzenden` | public address (used in links and e-mails) | `https://wiki.example.com` |
| `Autostart (systemd/none)` | start automatically | `systemd` |
| `Texterkennung (OCR) installieren? (j/n)` | install text recognition | `j` = yes, `n` = no |
| `LibreOffice installieren? (j/n)` | install the Office preview | `j` = yes, `n` = no |

### Windows

1. Extract the ZIP to e.g. `D:\Knowstead` (the program folder – **not** the data directory).
2. Double-click **`Knowstead-Installation.cmd`** and confirm the User Account Control prompt.
3. Follow the wizard (it is in German):

| Page | What to enter |
| --- | --- |
| **Willkommen** (welcome) | checks Node.js 24 and offers to install it with `winget` |
| **Datenverzeichnis** (data directory) | e.g. `D:\KnowsteadData` – a local drive outside the program folder |
| **Erreichbarkeit** (access) | *Reverse-Proxy auf diesem Server* (proxy on this server, recommended), *Proxy auf einem anderen Rechner* (proxy on another machine) or *direkt im Netzwerk* (direct, tests only); public address and port |
| **Betrieb** (operation) | automatic start as *geplante Aufgabe* (scheduled task, no extra software) or *Windows-Dienst mit NSSM*; firewall rule; Microsoft Defender exclusion for the database files |
| **Zusatzfunktionen** (extras) | Tesseract (OCR) and LibreOffice (Office preview) – found or installed with `winget` |
| **Zusammenfassung** → **Installation** → **Fertig** | summary, progress, result; the button *Ersteinrichtung im Browser öffnen* opens the setup |

Or without the wizard, in PowerShell (it asks for administrator rights itself):

```powershell
.\Knowstead-Installation.cmd -Unattended -DataDir D:\KnowsteadData -BaseUrl https://wiki.example.com -Access LocalProxy
```

Control Knowstead with `.\Knowstead-Dienst.cmd status`, `restart`, `stop` and `log -Follow`.

### Docker

```bash
cp .env.example .env
```

Set at least these two values in `.env` – generate the key with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` or `openssl rand -hex 32` and
keep it; it must not change after the first start:

```ini
BASE_URL=https://wiki.example.com
KNOWSTEAD_SECRET=<64 hex characters>
```

```bash
docker compose up -d --build
```

The data lives in the volume `knowstead-data`. The image contains no LibreOffice (no Office preview);
`WITH_OCR=true docker compose up -d --build` includes Tesseract for text recognition.

## 4. HTTPS with a reverse proxy

Knowstead itself speaks HTTP only. The simplest proxy is [Caddy](https://caddyserver.com/) – it obtains
and renews public certificates automatically and passes WebSockets and Server-Sent Events through without
further settings. `Caddyfile`:

```caddyfile
wiki.example.com {
    reverse_proxy 127.0.0.1:3000
    header Strict-Transport-Security "max-age=31536000"
    request_body {
        max_size 2GB
    }
}
```

Whatever proxy you use, it must pass WebSocket upgrades for `/api/v1/collab/…` (editing together), keep
Server-Sent Events on `/api/v1/stream` unbuffered, and forward `Host`, `X-Forwarded-For` and
`X-Forwarded-Proto`. Tested configurations for **nginx, IIS and Apache** are in the
[installation guide, section 7](INSTALLATION.en.md#7-https-and-reverse-proxy).

## 5. First setup in the browser

Open your address. Without any accounts Knowstead shows the setup wizard: choose the name, **English**,
an accent colour, optionally sample content, and create the administrator account.

From another computer the wizard asks for the **setup code** – it protects a freshly started server from
being set up by someone else. It is in the server log (the log is in German; the word to look for is
`Einrichtungscode`):

| Installation | Command |
| --- | --- |
| Linux | `journalctl -u knowstead \| grep Einrichtungscode` |
| Windows | `Select-String -Path D:\KnowsteadData\logs\knowstead.log -Pattern Einrichtungscode` |
| Docker | `docker compose logs knowstead \| grep Einrichtungscode` |

No code is needed on the server itself (`http://localhost:3000/setup`) – from your own machine an SSH
tunnel does the same: `ssh -L 3000:127.0.0.1:3000 admin@your-server`.

Afterwards **Administration → Next steps** lists what is still missing, each with a direct link:
e-mail delivery, the first backup, inviting people, the first space and – optionally – sign-in with
company accounts (Active Directory, Entra ID, SAML).

## 6. Check the installation and the backup

```bash
cd /opt/knowstead && npm run cli -- doctor
```

checks Node.js, the user interface, the data directory, port and address, the server key, the database,
the setup and the backups. The output is German: `läuft` means "running", `Alles in Ordnung` "everything
is fine", `Hinweis` "note" and `Fehler` "error"; each finding comes with a hint what to do.

Knowstead backs up every night at 3 a.m. and keeps seven backups in `<data directory>/backups/`.

1. **Administration → Backups → Back up now** – make the first backup right away.
2. Copy the `backups/` folder to another system regularly.
3. Keep the server key (`secret.key` in the data directory, or `KNOWSTEAD_SECRET`) in your password
   vault. Backups deliberately do not contain it – without it, stored credentials (SMTP, directory,
   connectors) cannot be read.
4. Rehearse a restore once: `npm run cli -- backup:list`, then with the service stopped
   `npm run cli -- restore <backup>`.

## 7. Updating

Copy the new package and its `.sha256` file to the server, then:

```bash
sudo bash /opt/knowstead/update.sh /tmp/knowstead-<version>-linux-x64.tar.gz
```

The script verifies the checksum, prepares the new program next to the old one while Knowstead keeps
running, stops the service, swaps the folders, starts and checks. If the new version does not answer, the
previous one comes back by itself – including the database. `--dry-run` shows the steps without changing
anything; `sudo bash /opt/knowstead/update.sh --rollback` returns to the previous version later.

- **Windows:** `.\Knowstead-Dienst.cmd stop`, extract the new package over the program folder, then
  `.\Knowstead-Installation.cmd -Unattended`.
- **Docker:** `docker compose build --pull && docker compose up -d`.

After an update, open **Administration → Maintenance → Update handbook** once (on Linux `update.sh` does
that for you).

## Just trying it out?

No service, no HTTPS – on your own machine with Node.js 24:

```bash
git clone https://github.com/BStein-coder/Knowstead.git
cd Knowstead
npm install
npm run build
npm start
```

Open `http://localhost:3000`. On Windows a double-click on `start.cmd` does all of that (Linux/macOS:
`./start.sh`).

---

**Next:** e-mail, Active Directory, single sign-on, the Office preview, moving to another server,
installing without internet access and troubleshooting are covered in the
[installation guide](INSTALLATION.en.md); day-to-day administration in the
[handbook](handbook/11-administration.md).
