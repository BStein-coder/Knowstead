# Installation guide

*[Deutsche Fassung](INSTALLATION.md) · Short version: [QUICKSTART.md](QUICKSTART.md)*

This guide takes you to a production installation of Knowstead: providing the program, running it as a
service, making it reachable over HTTPS, setting it up and securing it. The fastest way is the
[installation assistant](#guided-installation-recommended) – it asks for everything it needs and takes
care of configuration, automatic start, firewall and checks. Sections 4 to 6 describe the same steps by
hand. Everything about day-to-day operation is in the [administration guide](ADMINISTRATION.md) (German)
and in the [handbook](handbook/11-administration.md).

**Time needed:** about 15 minutes with the assistant, plus certificate and reverse proxy; 30–60 minutes by hand.

> **Language:** the installer (`install.sh`, the Windows wizard), `update.sh`, the command-line tool and
> the server log currently print their messages in **German**. The web interface, the handbook and all
> e-mails are fully available in English. Wherever this guide quotes program output or wizard labels, it
> shows the German text exactly as printed, with the English meaning next to it.

## Contents

- [Quick start for trying it out](#quick-start-for-trying-it-out)
- [Guided installation (recommended)](#guided-installation-recommended)
  – [Windows](#windows) · [Linux](#linux) · [Proxmox VE (LXC container)](#proxmox-ve-lxc-container)
1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Decide before installing](#3-decide-before-installing)
4. [Installation on Windows](#4-installation-on-windows)
5. [Installation on Linux](#5-installation-on-linux)
6. [Installation with Docker](#6-installation-with-docker)
7. [HTTPS and reverse proxy](#7-https-and-reverse-proxy)
8. [First setup in the browser](#8-first-setup-in-the-browser)
9. [Optional integrations](#9-optional-integrations)
10. [Setting up and testing backups](#10-setting-up-and-testing-backups)
11. [Updates and moving](#11-updates-and-moving)
12. [Checklist after the installation](#12-checklist-after-the-installation)
13. [Troubleshooting the installation](#13-troubleshooting-the-installation)
14. [Reference: settings in the `.env`](#14-reference-settings-in-the-env)

---

## Quick start for trying it out

For a test on your own machine – no service, no HTTPS:

1. Install [Node.js 24 or newer](https://nodejs.org/).
2. Put the program folder somewhere, e.g. `D:\Knowstead` or `~/knowstead`.
3. **Windows:** double-click `start.cmd`. **Linux/macOS:** `./start.sh`.
4. The browser opens `http://localhost:3000` – the wizard creates the first administrator account.

On the first start the script installs the dependencies and builds the user interface (a few minutes;
with the [installation package](#getting-the-program) this is not needed). For production use the
[installation assistant](#guided-installation-recommended).

---

## Guided installation (recommended)

The assistant sets up Knowstead on the server completely and checks the result: data directory,
configuration (`.env`), dependencies and user interface, trial start, automatic start, permissions,
firewall, antivirus exclusion and – if present – text recognition and Office preview. After that only the
HTTPS certificate at the reverse proxy ([section 7](#7-https-and-reverse-proxy)) and the first setup in
the browser are missing. You can run it again at any time to change settings or to finish an update;
existing values and the server key are kept.

### Getting the program

| Way | When |
| --- | --- |
| **Installation package** from the GitHub releases: `knowstead-<version>-windows-x64.zip` or `knowstead-<version>-linux-x64.tar.gz` | recommended – user interface already built, runtime parts only; no npm download and no build on the server |
| Build the package yourself: `npm run build`, then `node scripts/package.mjs --target linux-x64` (or `windows-x64`, `linux-arm64`) | before the first release or with your own changes – also on Windows for a Linux server; the result is in `release/` |
| Source code (Git or ZIP of the repository) | for development or your own changes – dependencies and user interface are installed and built on the first run (internet access for npm) |

The checksum is in the `.sha256` file next to each package:

```powershell
Get-FileHash .\knowstead-2.0.1-windows-x64.zip -Algorithm SHA256
```

```bash
sha256sum -c knowstead-2.0.1-linux-x64.tar.gz.sha256
```

A package is made for the operating system it was built for. If it is extracted on a different system
anyway, the first start installs the matching dependencies (internet access required).

### Windows

1. Extract the package to e.g. `D:\Knowstead` (the program folder – **not** the future data directory).
2. Double-click **`Knowstead-Installation.cmd`** and confirm the User Account Control prompt.
3. The pages of the wizard (the wizard is in German):

| Page | Content |
| --- | --- |
| **Willkommen** (welcome) | checks Node.js 24 – if it is missing, a button installs the LTS version via `winget`; detects an existing installation and pre-fills all values |
| **Datenverzeichnis** (data directory) | e.g. `D:\KnowsteadDaten` – a local drive, outside the program folder; shows the free space |
| **Erreichbarkeit** (access) | *Reverse-Proxy auf diesem Server* (reverse proxy on this server – recommended, Knowstead listens on 127.0.0.1 only), *Proxy auf einem anderen Rechner* (proxy on another machine, with its IP address) or *direkt im Netzwerk* (directly in the network, for tests only); address for the users and port |
| **Betrieb** (operation) | automatic start as a **scheduled task** (*geplante Aufgabe*, no extra software), as a **Windows service with NSSM** or no automatic start; firewall rule; exclusion of the database files in Microsoft Defender |
| **Zusatzfunktionen** (extras) | Tesseract (text recognition) and LibreOffice (Office preview) are looked for and switched on if you wish. If they are missing, the wizard installs them with `winget` when ticked – Tesseract including German and English language data |
| **Zusammenfassung** (summary) | all steps to check before anything is changed |
| **Installation** | progress and the complete log (saved under `<data directory>\logs\installation-*.log`) |
| **Fertig** (done) | result of the check and **„Ersteinrichtung im Browser öffnen“** ("open the first setup in the browser") – on the server itself without a setup code |

**Automatic start as a scheduled task:** the task `\Knowstead\Knowstead` starts at system start under the
account *Local Service* – without sign-in, without a password and with read permission on the program
folder and modify permission on the data directory only. After a failure it restarts Knowstead after one
minute. Knowstead writes its log itself to `<data directory>\logs\knowstead.log` (10 MB, five older
files). Always stop it in an orderly way with `Knowstead-Dienst.cmd stop` – not with "End" in Task
Scheduler, which kills the process.

**Controlling Knowstead:**

```powershell
.\Knowstead-Dienst.cmd status          # mode of operation, reachability, database state
.\Knowstead-Dienst.cmd restart
.\Knowstead-Dienst.cmd log -Follow     # show the log continuously
```

**Without questions** – for scripts, software distribution and updates. Values that are not given come
from the existing `.env`, otherwise from the defaults:

| Parameter | Meaning |
| --- | --- |
| `-Unattended` | run without the graphical interface |
| `-DataDir D:\KnowsteadDaten` | data directory |
| `-BaseUrl https://knowstead.firma.de` | address for the users |
| `-Port 3000` | port |
| `-Access LocalProxy` \| `RemoteProxy` \| `Direct` | access (`-ProxyAddress 10.0.0.5` with `RemoteProxy`) |
| `-Service Task` \| `Nssm` \| `None` | automatic start (`-NssmPath C:\Tools\nssm\nssm.exe` with `Nssm`) |
| `-NoFirewall`, `-NoDefenderExclusion` | skip the firewall rule or the antivirus exclusion |
| `-InstallTesseract`, `-InstallLibreOffice` | install the extra programs with `winget` if they are missing, and switch them on (`-OcrLanguages deu+eng+fra` for more text recognition languages) |
| `-TesseractPath …`, `-LibreOfficePath …` | switch on extra programs that are installed in another place |
| `-WhatIf` | only show what would happen |
| `-Uninstall` | remove automatic start, firewall rule and exclusions – program and data stay |

The extra programs are not a requirement: if one of them cannot be installed or registered, the wizard
sets up Knowstead without that function and shows at the end, under **Hinweise** ("notes"), what is still
open. If the setup fails after the wizard has stopped a running Knowstead, it starts it again.

```powershell
.\Knowstead-Installation.cmd -Unattended -DataDir D:\KnowsteadDaten -BaseUrl https://knowstead.firma.de -Access LocalProxy
```

### Linux

```bash
sudo tar -xzf knowstead-2.0.1-linux-x64.tar.gz -C /opt && sudo mv /opt/knowstead-2.0.1-linux-x64 /opt/knowstead
```

```bash
cd /opt/knowstead && sudo bash install.sh
```

The script asks for the same values as on Windows – with dialogs if `whiptail` is installed, otherwise
in the terminal. It creates the system account `knowstead` and the data directory (default
`/var/lib/knowstead`), writes the `.env` (readable only by root and the service account), makes a trial
start, sets up the hardened systemd service `knowstead` and opens the port in `ufw` or `firewalld` if
needed. If Node.js 24 is missing, the script offers to install it from the NodeSource package source
(without questions: `--install-node`; by hand see [section 5.1](#51-install-nodejs)).

The questions in the terminal, in German, and what to answer:

| Prompt | Meaning | Answer |
| --- | --- | --- |
| `Datenverzeichnis` | data directory | an absolute path, e.g. `/var/lib/knowstead` |
| `Zugriff: 1 = Reverse-Proxy auf diesem Server (empfohlen), 2 = Proxy auf anderem Rechner, 3 = direkt ohne HTTPS` | how users reach Knowstead | `1` reverse proxy on this server (recommended), `2` proxy on another machine, `3` directly without HTTPS |
| `IP-Adresse des Proxys` | IP address of the proxy (only with `2`) | e.g. `10.0.0.5` |
| `Port` | internal port | `3000` |
| `Adresse für die Nutzenden` | address for the users (appears in links and e-mails) | e.g. `https://knowstead.firma.de` |
| `Autostart (systemd/none)` | automatic start | `systemd` or `none` |
| `… (j/n)` | yes/no question | `j` (*ja*) = yes, `n` (*nein*) = no; Enter takes the default in square brackets |

It also asks about the two **extra programs** and installs them, if you wish, from the package source of
the distribution (`apt` on Debian and Ubuntu, `dnf` on RHEL, Rocky, Alma and Fedora):

| Question | Default | What is installed | Without questions |
| --- | --- | --- | --- |
| **Texterkennung (OCR) installieren?** (install text recognition?) | yes | Tesseract with the language data for German and English, about 25 MB – makes scanned PDFs and images searchable | `--install-ocr`, further languages with `--ocr-languages deu+eng+fra` |
| **LibreOffice installieren?** (install LibreOffice?) | no | LibreOffice without a graphical interface including fonts, about 400 MB – preview for Word, Excel, PowerPoint and Visio | `--install-office` |

If a program is already there, the script only asks whether the function should be switched on; if
Tesseract lacks some language data, it offers to install them. The packages are downloaded **before** a
running service is stopped; the script never removes existing packages (`apt-get --no-remove`).

The extra programs are not a requirement. If one of them cannot be installed or registered (no internet
access, package not in the package source, language data missing, LibreOffice only as a snap), the script
sets up Knowstead without that function and states at the end, under **Hinweise** ("notes"), what is
still open and how to catch up. If the setup aborts for another reason after the service has been
stopped, the script starts the service again – an update does not leave Knowstead stopped.

**Adding them later** to an existing installation – all other settings stay as they are:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-ocr --install-office
```

```bash
sudo bash install.sh --unattended --data-dir /var/lib/knowstead --base-url https://knowstead.firma.de --access local-proxy
```

`bash install.sh --help` shows further options (among them `--access remote-proxy --proxy-address 10.0.0.5`,
`--service none`, `--install-ocr`, `--install-office`, `--ocr-path`, `--office-path`, `--dry-run`,
`--uninstall`).

**First setup without a setup code** on a server without a browser – through an SSH tunnel from your own
machine:

```bash
ssh -L 3000:127.0.0.1:3000 admin@knowstead-server
```

Then open `http://localhost:3000/setup` in the browser. Control the service with
`systemctl start|stop|restart|status knowstead`, read the log with `journalctl -u knowstead -f`.

### Proxmox VE (LXC container)

Knowstead runs well in an unprivileged LXC container – without Docker and without a VM of its own.
`install.sh` copes with the particularities of a container: it runs as root without `sudo`, installs
Node.js if you wish and checks which protection options are available for the service.

**1. Create the container** (*Create CT*):

| Setting | Recommendation |
| --- | --- |
| Template | `debian-12-standard` or `debian-13-standard` (Ubuntu 24.04 works as well) |
| Unprivileged container | yes |
| Nesting (*Options → Features*) | yes – usually preset for new containers; without nesting the service runs without `PrivateTmp`/`ProtectSystem` |
| Cores / memory | 2 / 2048 MB for up to about 100 people, 4096 MB with LibreOffice |
| Disk | 16 GB or more – database, attachments and backups are under `/var/lib/knowstead` |
| Network | fixed IP address or DHCP reservation, DNS name e.g. `knowstead.firma.de` |
| Start at boot (*Options*) | yes |

If you want to grow the data separately, create a *Mount Point* with the path `/var/lib/knowstead` before
the installation. Set its *Backup* option so that the Proxmox backup includes it.

**2. Bring the program into the container.** All commands in the console of the container (Proxmox
interface → container → *Console*, or on the host `pct enter <CT-ID>`):

```bash
apt update && apt install -y curl
```

```bash
cd /opt && curl -fLO https://github.com/BStein-coder/Knowstead/releases/download/v2.0.1/knowstead-2.0.1-linux-x64.tar.gz
```

No release on GitHub yet? Then build the package on the Windows machine that has the program folder and
copy it into the container via the Proxmox host:

```powershell
cd D:\Knowstead
npm run build
node scripts/package.mjs --target linux-x64
scp release\knowstead-2.0.1-linux-x64.tar.gz root@proxmox:/tmp/
```

```bash
pct push <CT-ID> /tmp/knowstead-2.0.1-linux-x64.tar.gz /opt/knowstead-2.0.1-linux-x64.tar.gz
```

The package contains the user interface and the runtime parts for Linux; owner and permissions are
correct even if it was built on Windows. Then extract it in the container:

```bash
cd /opt && tar -xzf knowstead-2.0.1-linux-x64.tar.gz && mv knowstead-2.0.1-linux-x64 knowstead
```

**3. Install:**

```bash
cd /opt/knowstead && bash install.sh
```

The assistant asks whether Node.js 24 should be installed and then for the same values as on any Linux
server. For access there are usually two ways in Proxmox environments:

| Setup | Choice in the assistant | Setting up the proxy |
| --- | --- | --- |
| Reverse proxy in another container or VM (Nginx Proxy Manager, Traefik, Caddy) | *Reverse-Proxy auf einem anderen Rechner* (reverse proxy on another machine) with the IP address of the proxy | target `http://<IP of the Knowstead container>:3000`; in Nginx Proxy Manager switch on **Websockets Support** and, for large attachments, enter `client_max_body_size 2G;` under *Advanced* |
| Caddy in the same container | *Reverse-Proxy auf diesem Server* (reverse proxy on this server) | `apt install -y caddy`, the Caddyfile from [section 7.1](#71-caddy--the-simplest-option) to `/etc/caddy/Caddyfile`, then `systemctl reload caddy` |

**4. First setup:** open the public address in the browser, e.g. `https://knowstead.firma.de/setup`.
`journalctl -u knowstead | grep Einrichtungscode` in the container console shows the setup code
(*Einrichtungscode*).

**Notes on operation:**

- **Time zone:** containers often run in UTC. The nightly backup follows the time zone – check with
  `timedatectl`, change with `timedatectl set-timezone Europe/Berlin` and `systemctl restart knowstead`.
- **Backup:** the Proxmox backup captures program and data. In addition Knowstead creates its own backups
  under `/var/lib/knowstead/backups`, which are consistent in every case – so they are also part of every
  Proxmox backup. To restore individual backups use `npm run cli -- restore`
  ([section 10](#10-setting-up-and-testing-backups)).
- **Update:** create a snapshot first (`pct snapshot <CT-ID> vor-update`, on storage with snapshot
  support such as ZFS or LVM-thin), copy the new package together with its `.sha256` file into the
  container (`pct push <CT-ID> knowstead-<version>-linux-x64.tar.gz /tmp/knowstead-<version>-linux-x64.tar.gz`)
  and run `bash /opt/knowstead/update.sh /tmp/knowstead-<version>-linux-x64.tar.gz` in the container
  console – the script verifies, swaps, starts and checks, and brings the previous version back if the
  new one does not run ([section 11](#11-updates-and-moving); the way for installations before 1.8.0,
  which do not have the script yet, is described there as well).
- If `install.sh` reports „Schutzoptionen nicht verfügbar“ ("protection options not available"),
  *nesting* is missing: switch it on, restart the container and run `bash install.sh --unattended`
  again – after that the options are back in the service file.
- **Text recognition and Office preview:** `bash install.sh --unattended --install-ocr --install-office`
  installs Tesseract and LibreOffice in the container and switches both on. For LibreOffice give the
  container 4096 MB of memory and about 500 MB more disk space.

### Checking the installation at any time

```bash
npm run cli -- doctor
```

checks Node.js, the built user interface, the data directory (writable, free space, not a network share),
port, address and proxy setting, the server key, the database state, the first setup and the backups –
with a hint what to do. `--json` returns the result in machine-readable form; the exit code is `1` if an
error was found. The output is German: `läuft` means "running", `läuft nicht` "not running",
`Alles in Ordnung` "everything is fine", `Hinweis` "note" and `Fehler` "error".

### After the installation

After the first setup, **Administration → Next steps** guides you through everything that is still
missing for operation – with the current state and a direct jump to the matching setting: HTTPS address,
automatic start, e-mail delivery, first backup, inviting people, creating the first space and,
optionally, sign-in with company accounts (Active Directory, Entra ID, SAML) and text
recognition/Office preview. As long as items are open, a note in the administration overview reminds you.

---

## 1. Overview

Knowstead is **a single Node.js process**: it serves the web interface and the REST API and stores
everything in an SQLite database in the data directory. There is no separate database server, no cache
service and no queue.

```
 Browser ──HTTPS:443──▶ reverse proxy ──HTTP──▶ Knowstead (Node.js, 127.0.0.1:3000) ──▶ data directory
                      (Caddy, nginx, IIS,                                           knowstead.db
                       Apache: certificate)                                         uploads/  backups/
                                                                                    secret.key
 optional:  SMTP server · Active Directory/LDAP · LibreOffice (Office preview) · draw.io · AI provider
```

| Folder | Content | Back up? |
| --- | --- | --- |
| **Program folder** (e.g. `D:\Knowstead`, `/opt/knowstead`) | program files, `node_modules`, the built user interface `web/dist`, `.env` | `.env` yes, the rest can be reinstalled |
| **Data directory** (e.g. `D:\KnowsteadDaten`, `/var/lib/knowstead`) | database, attachments, backups, previews, server key | **yes – the most important thing** |

> [!TIP]
> The data directory belongs **outside** the program folder (`DATA_DIR`). Then the program folder can be
> replaced safely during updates.

---

## 2. Requirements

### Software

| Component | Requirement |
| --- | --- |
| Operating system | Windows Server 2019/2022/2025 or Windows 10/11 · Linux (e.g. Debian 12, Ubuntu 22.04/24.04, RHEL 9) · macOS (for tests) · or Docker |
| **Node.js** | **version 24 or newer** (LTS recommended). No further runtimes, databases or compilers are needed. |
| Reverse proxy | for HTTPS: Caddy, nginx, IIS with URL Rewrite and ARR, or Apache 2.4.47 or newer |
| Users' browsers | current versions of Edge, Chrome, Firefox or Safari |
| Internet access during installation | for `npm` (package source registry.npmjs.org) – without internet see [Servers without internet access](#servers-without-internet-access) |

### Hardware

| Size | Server | Note |
| --- | --- | --- |
| up to 100 people | 2 vCPU, 4 GB RAM, SSD | also as a VM next to other services |
| up to 500 people | 4 vCPU, 8 GB RAM, SSD | a VM of its own is recommended |
| more than 500 people | 8 vCPU, 16 GB RAM, NVMe SSD | test beforehand on the target hardware with `node scripts/loadtest.mjs` |

- **Disk space:** database and attachments, plus the backups (one copy of the database per backup and,
  optionally, the attachments). With LibreOffice for the Office preview plan 1–2 GB of additional RAM.
- The data directory belongs on a **local SSD**, **not** on a network share (SMB/NFS) – SQLite needs
  reliable file locks.

### Network

| Connection | Purpose |
| --- | --- |
| inbound **443/TCP** (and 80 for the redirect) | access for the users through the reverse proxy |
| internal **3000/TCP** | only between proxy and Knowstead – do not expose it to the outside |
| outbound SMTP (25/465/587) | sending e-mail (optional) |
| outbound LDAPS (636) or LDAP (389) | Active Directory (optional) |
| outbound HTTPS | AI provider, webhooks, API connectors, draw.io in the browser (each optional) |

The proxy must pass **WebSockets** (editing together) and **Server-Sent Events** (live updates) through –
the example configurations in [section 7](#7-https-and-reverse-proxy) take care of that.

---

## 3. Decide before installing

| Decision | Example | Note |
| --- | --- | --- |
| Address (DNS name) | `https://knowstead.firma.de` | is entered as `BASE_URL` and appears in all links and e-mails |
| TLS certificate | internal certification authority, Let's Encrypt or purchased | Caddy can fetch public certificates automatically |
| Data directory | `D:\KnowsteadDaten` or `/var/lib/knowstead` | local SSD, outside the program folder |
| Service account | local account `knowstead` | needs write permission on the data directory only (and, for updates, on the program folder) |
| Server key | `KNOWSTEAD_SECRET` **or** the automatically generated `secret.key` | encrypts stored credentials; **do not change it after the first start** |
| E-mail | SMTP server, sender, account if needed | for forgotten passwords, invitations, notifications |
| Sign-in | local accounts and/or Active Directory | for AD: a service account with read permission, LDAPS certificate |

**Generating the server key** (if `KNOWSTEAD_SECRET` is to be used – recommended for Docker and for
keeping it separately in a password vault):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. Installation on Windows

> [!TIP]
> The [installation assistant](#windows) does steps 4.2 to 4.6 automatically. This section describes them
> by hand – for your own requirements or to follow what happens.

Example paths: program in `D:\Knowstead`, data in `D:\KnowsteadDaten`. All commands in a
**PowerShell as administrator**.

### 4.1 Install Node.js

```powershell
winget install OpenJS.NodeJS.LTS
```

Alternatively use the installer from [nodejs.org](https://nodejs.org/). Then open a **new** PowerShell
and check:

```powershell
node --version    # v24.x or newer
```

### 4.2 Create program and data directories

1. Extract or copy the program files to `D:\Knowstead` (the file `package.json` is then directly in
   `D:\Knowstead`).
2. Create the data directory:

   ```powershell
   New-Item -ItemType Directory -Force D:\KnowsteadDaten, D:\KnowsteadDaten\logs
   ```

### 4.3 Configuration

Copy `D:\Knowstead\.env.example` to `D:\Knowstead\.env` and adjust it – for operation behind a reverse
proxy on the same server:

```ini
PORT=3000
HOST=127.0.0.1
BASE_URL=https://knowstead.firma.de
TRUST_PROXY=loopback
COOKIE_SECURE=auto
DATA_DIR=D:\KnowsteadDaten
LOG_LEVEL=info
NODE_ENV=production
# KNOWSTEAD_SECRET=<64 hex characters from section 3>
```

> [!WARNING]
> Write Windows paths in the `.env` **without double quotes** (or with `/`). Inside double quotes `\n` is
> read as a line break – `"D:\KnowsteadDaten\neu"` would become an invalid path.

If the proxy runs on **another** machine, set `HOST=0.0.0.0` and `TRUST_PROXY=<IP of the proxy>` and open
port 3000 in the firewall for that machine only.

### 4.4 Install dependencies, build the interface, trial start

```powershell
cd D:\Knowstead
node scripts\prepare.mjs     # installs the dependencies and builds the user interface (a few minutes)
npm start                    # trial start in the foreground
```

The log shows `Knowstead 2.0.1 läuft auf https://knowstead.firma.de` ("… is running at …") and – as long
as there is no account yet – the **setup code** (*Einrichtungscode*). End the trial start with
`Ctrl`+`C`. The first setup follows after the proxy has been set up
([section 8](#8-first-setup-in-the-browser)).

> [!NOTE]
> Behind a company proxy `npm` needs its address:
> `npm config set proxy http://proxy.firma.de:8080` and `npm config set https-proxy http://proxy.firma.de:8080`.
> If TLS inspection by the proxy breaks the connection: `npm config set cafile C:\Zertifikate\firma-ca.pem`.

### 4.5 Set up as a Windows service (NSSM)

Knowstead runs as a service with the free service wrapper [NSSM](https://nssm.cc/download). Copy
`nssm.exe` (64 bit) to e.g. `C:\Tools\nssm\nssm.exe`, then:

```powershell
$nssm = 'C:\Tools\nssm\nssm.exe'
& $nssm install Knowstead 'C:\Program Files\nodejs\node.exe' '--disable-warning=ExperimentalWarning server\src\index.ts'
& $nssm set Knowstead AppDirectory 'D:\Knowstead'
& $nssm set Knowstead DisplayName 'Knowstead – Dokumentation'
& $nssm set Knowstead Start SERVICE_AUTO_START
# Log to files with rotation (10 MB)
& $nssm set Knowstead AppStdout 'D:\KnowsteadDaten\logs\knowstead.log'
& $nssm set Knowstead AppStderr 'D:\KnowsteadDaten\logs\knowstead.log'
& $nssm set Knowstead AppRotateFiles 1
& $nssm set Knowstead AppRotateOnline 1
& $nssm set Knowstead AppRotateBytes 10485760
# Stop cleanly: send Ctrl+C and wait up to 15 s (open editing states are written)
& $nssm set Knowstead AppStopMethodConsole 15000
# After a failed start wait 5 s before NSSM restarts
& $nssm set Knowstead AppRestartDelay 5000
Start-Service Knowstead
```

Important:

- Start the service **directly with `node`** (as above), not via `npm start` – only then does the stop
  signal reach the server.
- **Service account:** the default is "Local System". It is better to use an account of its own
  (`& $nssm set Knowstead ObjectName '.\knowstead' '<Passwort>'`) and give it modify permission on the
  data directory:

  ```powershell
  icacls D:\KnowsteadDaten /grant 'knowstead:(OI)(CI)M'
  icacls D:\Knowstead /grant 'knowstead:(OI)(CI)RX'
  ```

- **Viewing the log:** `Get-Content D:\KnowsteadDaten\logs\knowstead.log -Tail 50 -Wait`
- **Controlling:** `Start-Service Knowstead`, `Stop-Service Knowstead`, `Restart-Service Knowstead`

> [!NOTE]
> **Without NSSM:** a scheduled task "At system startup" with the program `C:\Program Files\nodejs\node.exe`,
> the arguments `--disable-warning=ExperimentalWarning server\src\index.ts` and the start directory
> `D:\Knowstead` works as well. When the task is ended, however, the process is killed; NSSM is therefore
> preferable.

### 4.6 Antivirus and firewall

```powershell
# Exclude the database files from real-time scanning (attachments under uploads\ may be scanned)
Add-MpPreference -ExclusionPath 'D:\KnowsteadDaten\knowstead.db','D:\KnowsteadDaten\knowstead.db-wal','D:\KnowsteadDaten\knowstead.db-shm'

# Only needed if the proxy runs on another machine:
New-NetFirewallRule -DisplayName 'Knowstead (nur Proxy)' -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 10.0.0.5 -Action Allow
```

Set the same exclusions for other antivirus products. Continue with
[section 7 (HTTPS)](#7-https-and-reverse-proxy) – on Windows, [Caddy](#71-caddy--the-simplest-option) or
[IIS](#73-iis-windows-server) are a good fit.

---

## 5. Installation on Linux

> [!TIP]
> After section 5.1, [`install.sh`](#linux) does steps 5.2 to 5.6 automatically.

Example for Debian/Ubuntu; program in `/opt/knowstead`, data in `/var/lib/knowstead`.

### 5.1 Install Node.js

From the NodeSource package archive (alternatives: the package source of the distribution, provided it
ships Node 24, or the official binary packages from nodejs.org):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install -y nodejs
node --version    # v24.x or newer
```

### 5.2 Account and directories

```bash
sudo useradd --system --home-dir /opt/knowstead --shell /usr/sbin/nologin knowstead
sudo mkdir -p /opt/knowstead /var/lib/knowstead
# Copy or extract the program files to /opt/knowstead, then:
sudo chown -R knowstead:knowstead /opt/knowstead /var/lib/knowstead
sudo chmod 750 /var/lib/knowstead
```

### 5.3 Configuration

```bash
sudo -u knowstead cp /opt/knowstead/.env.example /opt/knowstead/.env
sudo -u knowstead nano /opt/knowstead/.env
sudo chmod 600 /opt/knowstead/.env
```

```ini
PORT=3000
HOST=127.0.0.1
BASE_URL=https://knowstead.firma.de
TRUST_PROXY=loopback
COOKIE_SECURE=auto
DATA_DIR=/var/lib/knowstead
LOG_LEVEL=info
NODE_ENV=production
# KNOWSTEAD_SECRET=<64 hex characters from section 3>
# TZ=Europe/Berlin       # if the server runs in UTC (time of the backup and the daily digest)
```

### 5.4 Install dependencies, build the interface, trial start

```bash
cd /opt/knowstead
sudo -u knowstead node scripts/prepare.mjs
sudo -u knowstead npm start          # trial start, end with Ctrl+C
```

### 5.5 systemd service

`/etc/systemd/system/knowstead.service`:

```ini
[Unit]
Description=Knowstead – Dokumentation und Wissen
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=knowstead
Group=knowstead
WorkingDirectory=/opt/knowstead
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.ts
Environment=NODE_ENV=production
# Internal certification authority for LDAPS/SMTP (see section 9):
# Environment=NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/firma-ca.crt
Restart=always
RestartSec=5
# Enough file descriptors for many live connections
LimitNOFILE=65536
# Let open editing states be written before stopping
TimeoutStopSec=20
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

In an LXC container without *nesting* the service does not start with
`PrivateTmp`/`ProtectSystem`/`ProtectHome` (`status=226/NAMESPACE`) – switch on nesting or leave out these
three lines.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now knowstead
sudo systemctl status knowstead
journalctl -u knowstead -f            # follow the log
```

Knowstead reads the `.env` in the program folder itself; values from the service environment
(`Environment=`) take precedence.

### 5.6 Firewall

```bash
sudo ufw allow 80,443/tcp        # port 3000 stays closed, the proxy connects locally
```

Continue with [section 7 (HTTPS)](#7-https-and-reverse-proxy).

---

## 6. Installation with Docker

Requirement: Docker Engine with the Compose plugin (`docker compose version`).

```bash
cd /opt/knowstead                   # program folder with Dockerfile and docker-compose.yml
cp .env.example .env
nano .env
```

In the `.env` for Docker at least:

```ini
BASE_URL=https://knowstead.firma.de
KNOWSTEAD_SECRET=<64 hex characters from section 3>
# TZ=Europe/Berlin            # default in the container; set only for other time zones
```

Do not change `DATA_DIR`, `HOST` and `PORT` in the container – the data directory is the volume
`knowstead-data` (`/app/data`), `TRUST_PROXY` is set to `uniquelocal,loopback` (proxy on the host or in a
container).

If the reverse proxy runs on the Docker host, publish the port locally only – in `docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

Start and show the setup code (*Einrichtungscode*):

```bash
docker compose up -d --build
docker compose ps                                  # wait for the status "healthy"
docker compose logs knowstead | grep Einrichtungscode
```

| Task | Command |
| --- | --- |
| Log | `docker compose logs -f knowstead` |
| Administration tool | `docker compose exec knowstead node --disable-warning=ExperimentalWarning server/src/cli.ts status` |
| Update | `docker compose build --pull && docker compose up -d` |
| Copy a backup to the outside | `docker compose cp knowstead:/app/data/backups ./knowstead-sicherungen` |

> [!NOTE]
> The container image contains **no LibreOffice** – the Office preview (Word, Excel, PowerPoint, Visio) is
> not available in the container. If you need it, install Knowstead directly on the server or extend the
> image with LibreOffice.

---

## 7. HTTPS and reverse proxy

Knowstead itself speaks HTTP only. HTTPS is provided by a reverse proxy in front of it. Every proxy
configuration must:

1. offer **HTTPS** with a valid certificate and redirect HTTP to HTTPS,
2. pass the **Host** header on unchanged and set `X-Forwarded-For` and `X-Forwarded-Proto`,
3. pass **WebSocket upgrades** for `/api/v1/collab/…` through (editing together),
4. keep **Server-Sent Events** (`/api/v1/stream`) **unbuffered** and open for a long time (live updates),
5. allow **uploads** up to the configured limit (default 50 MB per attachment; wiki imports up to 2 GB).

To match, in the `.env`: `BASE_URL=https://…`, `TRUST_PROXY` set to the address of the proxy (`loopback`
for the same machine), `HOST=127.0.0.1` if the proxy runs locally.

### 7.1 Caddy – the simplest option

[Caddy](https://caddyserver.com/) (Windows and Linux) obtains public certificates by itself, redirects
HTTP to HTTPS and passes WebSockets and Server-Sent Events through without further settings.
`Caddyfile`:

```caddyfile
knowstead.firma.de {
    reverse_proxy 127.0.0.1:3000

    # Internal certificates instead of Let's Encrypt:
    # tls C:/Zertifikate/knowstead.pem C:/Zertifikate/knowstead-key.pem

    header Strict-Transport-Security "max-age=31536000"
    request_body {
        max_size 2GB
    }
}
```

For automatic certificates `knowstead.firma.de` must be publicly resolvable and ports 80/443 reachable
from the internet; in an internal network specify a certificate from your own certification authority
with `tls`.

### 7.2 nginx

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name knowstead.firma.de;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name knowstead.firma.de;

  ssl_certificate     /etc/ssl/certs/knowstead.firma.de.pem;
  ssl_certificate_key /etc/ssl/private/knowstead.firma.de.key;
  add_header Strict-Transport-Security "max-age=31536000" always;

  client_max_body_size 2g;                         # uploads and wiki imports

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;          # WebSocket (editing together)
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;                             # deliver Server-Sent Events immediately
    proxy_read_timeout 1h;                           # do not cut long-lived connections
  }
}
```

The directive `http2 on;` exists from nginx 1.25.1; older versions write `listen 443 ssl http2;`.
Check and reload: `sudo nginx -t && sudo systemctl reload nginx`.

### 7.3 IIS (Windows Server)

**Prepare once:**

1. Install the role and WebSocket support:

   ```powershell
   Install-WindowsFeature Web-Server, Web-WebSockets -IncludeManagementTools
   ```

2. Install **URL Rewrite 2.1** and **Application Request Routing (ARR) 3.0** from the Microsoft website.
3. Switch on the proxy, preserve the Host header, switch off the response buffer (otherwise live events
   arrive late) and allow long connections:

   ```powershell
   $appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
   & $appcmd set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /responseBufferLimit:"0" /timeout:"01:00:00" /commit:apphost
   # Allow the server variable for X-Forwarded-Proto
   & $appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost
   ```

4. Create a website `knowstead.firma.de` (an empty folder, e.g. `C:\inetpub\knowstead`) with an **HTTPS
   binding** and certificate.

**`web.config`** in the folder of the website:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="HTTP auf HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="Knowstead" stopProcessing="true">
          <match url=".*" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
          <!-- UNENCODED_URL keeps special characters and the query string unchanged -->
          <action type="Rewrite" url="http://127.0.0.1:3000{UNENCODED_URL}" appendQueryString="false" />
        </rule>
      </rules>
    </rewrite>
    <!-- IIS must not compress again: Knowstead delivers pre-compressed content, live events must not be buffered -->
    <urlCompression doStaticCompression="false" doDynamicCompression="false" />
    <security>
      <requestFiltering allowDoubleEscaping="true">
        <requestLimits maxAllowedContentLength="2147483648" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

For the redirect from HTTP to HTTPS the website additionally needs an HTTP binding (port 80). Switch on
**HSTS** from Windows Server 2019 in IIS Manager under *Website → HSTS* (`max-age` 31536000). ARR adds
`X-Forwarded-For` by itself. In the `.env`, `TRUST_PROXY=loopback` fits.

> [!IMPORTANT]
> If the feature **WebSocket Protocol** is missing, Knowstead still works – after a few seconds the editor
> then works without shared editing, with personal drafts. **"Live"** in the editor shows that WebSockets
> arrive.

### 7.4 Apache (2.4.47 or newer)

```apache
# a2enmod ssl proxy proxy_http headers
<VirtualHost *:80>
  ServerName knowstead.firma.de
  Redirect permanent / https://knowstead.firma.de/
</VirtualHost>

<VirtualHost *:443>
  ServerName knowstead.firma.de
  SSLEngine on
  SSLCertificateFile    /etc/ssl/certs/knowstead.firma.de.pem
  SSLCertificateKeyFile /etc/ssl/private/knowstead.firma.de.key
  Header always set Strict-Transport-Security "max-age=31536000"

  ProxyPreserveHost On
  RequestHeader set X-Forwarded-Proto "https"
  LimitRequestBody 0
  # upgrade=websocket: editing together · flushpackets=on: live events immediately
  ProxyPass        / http://127.0.0.1:3000/ upgrade=websocket flushpackets=on timeout=3600
  ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

### 7.5 Checking the proxy

```bash
curl https://knowstead.firma.de/api/v1/health                   # {"status":"ok","version":"2.0.1",…}
curl -s -o /dev/null -D - https://knowstead.firma.de/login      # 200, among others content-security-policy, strict-transport-security
```

On Windows: `Invoke-RestMethod https://knowstead.firma.de/api/v1/health` and
`(Invoke-WebRequest https://knowstead.firma.de/login).Headers`.

In the browser after the setup: edit a page → **"Live"** appears at the top (WebSocket works); a change
made in a second window appears without reloading (Server-Sent Events work).

---

## 8. First setup in the browser

1. Open `https://knowstead.firma.de` – without accounts Knowstead redirects to the setup wizard `/setup`.
2. Enter the **setup code**. It protects a freshly started server from being set up by someone else
   first, and it is in the log (the log is German – look for *Einrichtungscode*):

   | Installation | Finding the code |
   | --- | --- |
   | Windows service (NSSM) | `Select-String -Path D:\KnowsteadDaten\logs\knowstead.log -Pattern Einrichtungscode` |
   | Linux (systemd) | `journalctl -u knowstead \| grep Einrichtungscode` |
   | Docker | `docker compose logs knowstead \| grep Einrichtungscode` |
   | Trial start in a window | it is directly in the output |

   Opened directly on the server at `http://localhost:3000/setup`, no code is needed.
3. **Basic data:** name of the installation, language, accent colour, optionally sample content.
4. **Administrator account:** display name, username, e-mail address, a strong password.
5. **Done:** Knowstead creates the groups *Administrators* and *Users*, the space **Handbook** and
   13 templates.

**After that, in this order:**

1. **Administration → Settings:** self-registration (default: off), password rules, upload limit,
   retention periods, anonymous read access (default: off).
2. **Administration → Settings → Backups:** time, number, include attachments
   ([section 10](#10-setting-up-and-testing-backups)).
3. **Administration → Email** ([section 9.1](#91-email-smtp)).
4. **Administration → Directory (AD/LDAP)** for Active Directory ([section 9.2](#92-active-directory--ldap)).
5. Create **groups and spaces**, assign space roles, invite people.

---

## 9. Optional integrations

### 9.1 Email (SMTP)

**Administration → Email:** choose a preset (Microsoft 365, Exchange, Google Workspace, IONOS, STRATO),
enter sender and credentials, use **Check connection** and **Send test email**, then switch on
**Send notifications by email**. The password is stored encrypted.

- **Microsoft 365** often no longer allows sign-in with username and password – then use the preset for
  a relay via connector (a connector in the Exchange admin center for the fixed public IP of the server).
- In detail: [administration guide → E-Mail](ADMINISTRATION.md#e-mail) (German).

### 9.2 Active Directory / LDAP

**Administration → Directory (AD/LDAP):**

1. Server `ldaps://dc01.firma.local:636`, base DN `DC=firma,DC=local`, a service account with read
   permission.
2. **Check connection** – optionally with a test account.
3. Map AD security groups to the Knowstead groups (Administration → Groups).
4. **Leave "Also allow local sign-in" switched on** – otherwise a problem in the directory locks
   everybody out.

> [!IMPORTANT]
> **Certificate of the internal certification authority:** by default Node.js trusts public
> certification authorities only. If the check reports `unable to verify the first certificate` or
> `self-signed certificate in certificate chain`, make the CA certificate known – do **not** switch off
> certificate verification:
>
> - **Linux:** `Environment=NODE_EXTRA_CA_CERTS=/pfad/firma-ca.pem` in the systemd service.
> - **Windows:** in the NSSM service put `--use-system-ca` before the other arguments – then the Windows
>   certificate store applies (root certificates distributed by group policy):
>   `& $nssm set Knowstead AppParameters '--use-system-ca --disable-warning=ExperimentalWarning server\src\index.ts'`.
>   Alternatively `& $nssm set Knowstead AppEnvironmentExtra 'NODE_EXTRA_CA_CERTS=C:\Zertifikate\firma-ca.pem'`.
> - **Docker:** mount the CA file and set `NODE_EXTRA_CA_CERTS` in the `environment` section.
>
> These variables only take effect at process start and therefore belong in the service environment, not
> in the `.env`. The same applies to SMTP servers with an internal certificate.

In detail: [administration guide → Active Directory](ADMINISTRATION.md#active-directory--ldap) (German).

### 9.3 Office and Visio preview (LibreOffice)

The easiest way is the installation assistant – it installs LibreOffice and switches the preview on:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-office      # Linux
```

```powershell
.\Knowstead-Installation.cmd -Unattended -InstallLibreOffice                 # Windows (winget)
```

By hand on Debian and Ubuntu – without a graphical interface, with fonts for consistent line breaks:

```bash
sudo apt install --no-install-recommends libreoffice-core-nogui libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea
```

On Windows use the LibreOffice installer (`C:\Program Files\LibreOffice\program\soffice.exe` is found
automatically). Then activate **Administration → AI & files → Office preview**; the status display
reports whether LibreOffice was found.

### 9.4 Single sign-on (Microsoft Entra ID, SAML, Windows sign-in)

**Administration → Single sign-on** – the HTTPS address in `BASE_URL` is a prerequisite.

- **Entra ID**: an app registration (platform *Web*) with the redirect URI
  `https://knowstead.firma.de/api/v1/auth/oidc/callback`, a client secret, a groups claim (group IDs). In
  Knowstead enter tenant ID, client ID and secret, check, activate; enter the object IDs of the Entra
  groups at the Knowstead groups.
- **SAML**: import the metadata `https://knowstead.firma.de/api/v1/auth/saml/metadata` at the provider;
  enter the provider's sign-in URL, entity ID and signing certificate in Knowstead.
- **Windows sign-in**: the reverse proxy (Apache with `mod_auth_gssapi` or IIS with Windows
  authentication) protects only `/api/v1/auth/kerberos` and passes the account on in `X-Remote-User`; in
  Knowstead enter the address of the proxy and a shared secret.

In detail, with example configurations:
[administration guide → Single Sign-on](ADMINISTRATION.md#single-sign-on-entra-id-saml-und-windows-anmeldung)
(German).

### 9.5 Text recognition for scans (Tesseract)

The easiest way is the installation assistant – it installs Tesseract with the language data, checks
which languages are really present and switches text recognition on:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-ocr                              # Linux
cd /opt/knowstead && sudo bash install.sh --unattended --install-ocr --ocr-languages deu+eng+fra  # with French
```

```powershell
.\Knowstead-Installation.cmd -Unattended -InstallTesseract                    # Windows (winget)
```

> [!NOTE]
> Tesseract aborts completely if a single language is missing. The assistant therefore only enters
> languages whose data is present and reports the others. On Windows the Tesseract installer brings only
> English unless you select more – the assistant downloads the missing language data from the Tesseract
> project (`github.com/tesseract-ocr/tessdata_fast`).

By hand:

```bash
# Debian/Ubuntu
sudo apt install tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng
```

On Windows use the Tesseract installer (UB Mannheim) and select the language data you need (e.g.
"German"). Then activate **Administration → AI & files → Text recognition (OCR) for scans and images**;
existing scans are recognised in the background afterwards. In the Docker image Tesseract can be
included with the build argument `WITH_OCR=true`.

### 9.6 More

- **draw.io** runs in the browser from `embed.diagrams.net` by default; for networks without internet
  access run it yourself ([administration guide → draw.io](ADMINISTRATION.md#drawio), German).
- **AI assistant** (Claude, OpenAI, Azure OpenAI, Ollama): switch it on only after coordination with your
  data protection officer ([administration guide → KI-Anbindung](ADMINISTRATION.md#ki-anbindung), German).
- **Alerts and monitoring**: Knowstead sends the administrators an e-mail when the backup fails to
  appear, disk space runs low or the restart is missing after an update, and provides the same state for
  monitoring systems at `/api/v1/monitoring`
  ([administration guide → Warnungen und Überwachung](ADMINISTRATION.md#warnungen-und-überwachung), German).

---

## 10. Setting up and testing backups

By default Knowstead makes a backup **every night at 3 a.m.** (server time) and keeps seven of them; in
addition it backs up automatically before every update that changes the database and before a space is
deleted. The backups are in the data directory under `backups/`.

1. **Administration → Settings → Backups:** set the time, the number and "Include attachments in
   backups". Then use **Back up now** once under **Administration → Backups**.
2. **External copy:** transfer the folder `backups/` to another system regularly (backup software,
   Robocopy, rsync). Copy the database itself only while the service is **stopped**.
3. **Keep the server key separately:** `secret.key` from the data directory, or `KNOWSTEAD_SECRET`, goes
   into the password vault. Backups deliberately do not contain it – without it, stored credentials (SMTP,
   AD service account, connectors) can no longer be read.
4. **Rehearse a restore once** – preferably on a test machine:

   ```bash
   npm run cli -- backup:list
   npm run cli -- restore backup-JJJJMMTT-HHMMSS-auto --with-uploads   # only while the service is stopped
   ```

   (`JJJJMMTT-HHMMSS` stands for the date and time in the name of the backup, as `backup:list` shows it.)

In detail: [administration guide → Sicherungen](ADMINISTRATION.md#sicherungen) (German).

---

## 11. Updates and moving

### Update

Updates never lose data: before database changes Knowstead makes a backup itself, all migrations run in
one transaction, and an older version never starts on a newer database.

**With one command (Linux, from 1.8.0):** every installation package brings `update.sh`. Copy the
package and its `.sha256` file to the server, then:

```bash
sudo bash /opt/knowstead/update.sh /tmp/knowstead-2.0.1-linux-x64.tar.gz
```

| Step | What happens |
| --- | --- |
| Verify | checksum against the `.sha256` file next to the package (or `--sha256 <value>`), architecture and Node.js version. If something is wrong, nothing is touched. |
| Prepare | the new program is placed next to the old one – Knowstead keeps running meanwhile. The `.env` (with owner and permissions) and your own plugins are taken over. |
| Swap | stop the service, move the previous folder to `/opt/knowstead.vor-<version>`, put the new one in its place, start the service. A data directory inside the program folder moves along. |
| Check | the server must run, answer on its port and work with the new version (`doctor`, up to 120 seconds – `--wait`). |
| Otherwise back | if the new version does not answer, the previous folder comes back and starts. If the new version had already converted the database, the script restores the backup `backup-…-update` of this update. The failed version stays in `/opt/knowstead.fehlgeschlagen-<time>` for troubleshooting. |
| Clean up | update the handbook, remove earlier program folders except the last two (`--keep`). |

The script prints its steps in German: `Paket prüfen` (verify package), `Paket auspacken` (unpack),
`Neues Programm bereitlegen` (prepare the new program), `Dienst anhalten` (stop service),
`Programmordner tauschen` (swap program folders), `Dienst starten` (start service), `Prüfen, ob der neue
Stand läuft` (check that the new version runs) and finally `Fertig` (done).

- **First update with the script** – installations before 1.8.0 do not have `update.sh` yet: extract the
  package and start the script from it. It finds the installation through the service entry (otherwise
  `--target /opt/knowstead`):

  ```bash
  cd /tmp && tar -xzf knowstead-2.0.1-linux-x64.tar.gz
  sudo bash /tmp/knowstead-2.0.1-linux-x64/update.sh
  ```

- **Installation from the time when Knowstead was still called "Doku" (up to 1.9):** service, account,
  folder and database keep their names – only the program is swapped. The installed script accepts the
  new package and finds the service `doku` by itself:

  ```bash
  sudo bash /opt/doku/update.sh /tmp/knowstead-2.0.1-linux-x64.tar.gz
  ```

  Wherever this guide mentions `/opt/knowstead`, `/var/lib/knowstead` or the service `knowstead`, such an
  installation still uses `/opt/doku`, `/var/lib/doku` and `doku` (`systemctl status doku`,
  `journalctl -u doku`). Entries with `DOKU_` in the `.env`, existing sign-ins, API tokens with `doku_`
  and the headers `X-Doku-…` remain valid; what changes for your own scripts is described in the
  [release notes for 2.0.0](../CHANGELOG.md) (German).
- **Dry run:** `bash update.sh <package> --dry-run` shows the steps without changing anything.
- **Back to the previous version:** `sudo bash /opt/knowstead/update.sh --rollback` brings back the most
  recently kept program folder. If the update converted the database, the script says so **before** it
  asks for confirmation: the earlier version then needs the database from before the update – it is
  restored from `backup-…-update`, and whatever was entered since then exists only in the backup
  `backup-…-restore` that is created in the process. If the backup from the update is missing, the script
  refuses before it touches anything.
- **Without confirmation** (script, Ansible): `--yes`. `bash update.sh --help` shows all options
  (`--target`, `--sha256`, `--keep`, `--wait`, `--no-handbook`, `--force`).
- Files of your own in the program folder that the package does not know are not carried along silently:
  the script names them at the end; they are in the folder that was kept.
- Knowstead's command line runs under the **service account** (which owns the data directory), not as
  root – so backups and a restored database belong to the service.
- If the SSH connection drops, the update runs to the end. `Ctrl`+`C` aborts; if the folder had already
  been swapped, the previous version comes back.
- In containers without `sudo` (Proxmox) call it as root without `sudo`.

Without a systemd service (start via `start.sh`) the script only swaps the folders and asks you to start
Knowstead yourself. On **Windows** and for installations from the source code, use the way with the
assistant or by hand.

**With the assistant:**

1. Read the release notes (`CHANGELOG.md`, section „Update-Hinweise“ – "update notes").
2. Stop Knowstead: `Knowstead-Dienst.cmd stop` or `sudo systemctl stop knowstead`.
3. Extract the new installation package over the program folder – `.env` and the data directory stay
   untouched.
4. `Knowstead-Installation.cmd -Unattended` or `sudo bash install.sh --unattended` – takes over all
   previous values, checks, starts Knowstead and verifies that it can be reached.
5. **Administration → Maintenance → Update handbook.**

**Has the update arrived?** The version number alone does not tell if two packages carry the same
version. Reliable are:

```bash
npm run cli -- status
```

The first line states the version and the **build time of the package** – it must match the package you
installed. If the server still runs with the old version because the service was not restarted after
installing, an **ACHTUNG** ("attention") with the command for the restart is shown below it; in that case
*Administration → Overview* shows **Restart required**.
The same information is in **Administration → Overview** under *Package built* and in
`npm run cli -- doctor`. Before extracting, it is worth comparing the checksum (`sha256sum` or
`Get-FileHash`) with the `.sha256` file of the package – this rules out installing an older archive of
the same name by mistake.

**By hand:**

1. Read the release notes (`CHANGELOG.md`, section „Update-Hinweise“).
2. `npm run cli -- status` – version, database state, last backup.
3. Stop the service (`npm run cli -- stop`, `Stop-Service Knowstead` or `sudo systemctl stop knowstead`).
4. Copy the new program files over the program folder – the `.env` is kept.
5. `node scripts/prepare.mjs` (on Linux as `sudo -u knowstead …`) – installs changed dependencies and
   rebuilds the user interface.
6. Start the service (if it was still running: **re**start it – `sudo systemctl restart knowstead`), then
   check `npm run cli -- doctor` and the log. Delete an old program folder that you set aside only after
   that.
7. **Administration → Maintenance → Update handbook.**

Docker: `docker compose build --pull && docker compose up -d`. Returning to the previous version and
details: [administration guide → Aktualisierung](ADMINISTRATION.md#aktualisierung) (German).

### Moving to a new server

1. Install Knowstead on the new server as described above, but do **not** set it up.
2. Stop the old service.
3. Copy the complete **data directory** (including `secret.key`) or use the same `KNOWSTEAD_SECRET`; take
   over the `.env` and adjust the paths.
4. Start the new service – if the new program version is newer, the start migrates the database
   automatically (with a backup beforehand).
5. Switch DNS or the proxy to the new server.

### Servers without internet access

The easiest way is the **installation package** for the server's operating system: it contains the user
interface and the dependencies, and the assistant needs no internet access (Node.js must be installed).

The package can be built on any machine with internet access – also for another operating system, e.g.
on Windows for Linux: `npm run build` and `node scripts/package.mjs --target linux-x64`.

Without a package: prepare the program folder on a machine **with the same operating system** and
internet access (`node scripts/prepare.mjs`), then copy the whole folder including `node_modules` and
`web/dist` to the target server. There `prepare.mjs` recognises that nothing is left to do.

---

## 12. Checklist after the installation

- [ ] `https://knowstead.firma.de` loads with a valid certificate, `http://` redirects to `https://`
- [ ] `BASE_URL` matches the address in the browser; links in e-mails lead there
- [ ] Port 3000 is **not** reachable from outside (`HOST=127.0.0.1` or firewall)
- [ ] `TRUST_PROXY` contains only the address of the proxy (not `true` if the port can be reached in another way)
- [ ] Signing in, signing out and signing in again work (session cookie with `Secure`)
- [ ] **"Live"** appears while editing; changes appear in a second window without reloading
- [ ] The service starts by itself after the server is restarted
- [ ] Data directory on a local SSD, outside the program folder, antivirus exclusions set
- [ ] `secret.key` or `KNOWSTEAD_SECRET` kept separately in the password vault
- [ ] Nightly backup active, external copy set up, restore rehearsed once
- [ ] Test e-mail arrived; "Forgot password?" works
- [ ] Test alert arrived (Administration → Settings → Alerts for administrators)
- [ ] AD sign-in successful with a test account, a local emergency administrator account exists
- [ ] Self-registration and anonymous read access deliberately switched on or off
- [ ] The permission `admin` for a few people only
- [ ] The server's time zone is correct (time of the backup, dates in exports)

The detailed list for continuous operation is in the
[administration guide](ADMINISTRATION.md#checkliste-für-den-produktivbetrieb) (German).

---

## 13. Troubleshooting the installation

The first step for every problem: `npm run cli -- doctor` in the program folder – the check names cause
and remedy for the most common cases. Messages are quoted in German, as the program prints them, with
their meaning.

| Symptom | Cause and solution |
| --- | --- |
| On double-click Windows warns that the publisher could not be verified, or SmartScreen appears | the package is not signed and comes from the internet – compare the checksum first, then choose *Run* or *More info → Run anyway*; alternatively tick *Unblock* in the properties of the ZIP file before extracting |
| Assistant: „Administratorrechte wurden nicht erteilt“ (administrator rights were not granted) | confirm the User Account Control prompt or right-click `Knowstead-Installation.cmd` and choose "Run as administrator" |
| Assistant: „Der Probestart ist fehlgeschlagen“ (the trial start failed) | the last log lines are shown in the window; often the port is in use or permissions on the data directory are missing |
| The scheduled task runs, Knowstead does not answer | `Knowstead-Dienst.cmd status` and `Knowstead-Dienst.cmd log`; the log states the reason (e.g. database from a newer version) |
| `systemctl stop knowstead` takes 20 seconds, `journalctl -u knowstead` shows `State 'stop-sigterm' timed out. Killing` | an early program version (packages of 1.6.0 from the first days): on stopping, the server waited for open live connections of the browsers. Install the current package – since 1.7.0 Knowstead disconnects them itself and exits after 8 seconds at the latest. The database is not harmed by the hard stop |
| An export reports `Export-Worker: ENOENT: process.cwd failed … uv_cwd`; backups or text search in attachments stop working | the program folder was replaced during an update and the old one deleted **without restarting the service** – the server is still running the old version from memory. Restart the service (`sudo systemctl restart knowstead` or `Knowstead-Dienst.cmd restart`). From 1.7.0 the server keeps working in this case and reports **Restart required** in *Administration → Overview* and in `npm run cli -- status` |
| *Administration → Overview* shows **Restart required**, `npm run cli -- status` reports „Der laufende Server arbeitet noch mit …“ (the running server is still working with …) | an update was installed but the service was not restarted (`systemctl start` has no effect on a running service) – `sudo systemctl restart knowstead` or `Knowstead-Dienst.cmd restart` |
| `update.sh`: „Der neue Stand läuft nicht – der bisherige kommt zurück“ (the new version does not run – the previous one comes back) | the new server did not start or does not answer. The check (`doctor`) of the new version is directly above it in the output, the reason in the log (`journalctl -u knowstead -n 80`). The failed version is in `/opt/knowstead.fehlgeschlagen-<time>`; the next successful update removes it. If the start just takes longer (very large database), repeat with `--wait 600` |
| `update.sh`: „Die Prüfsumme stimmt nicht“ (the checksum does not match) | the package was transferred incompletely, or the `.sha256` file of another package is next to it – copy both again |
| `update.sh`: „… ist keine Knowstead-Installation“ (… is not a Knowstead installation) | the script did not find the program folder (no service entry `knowstead.service`, another location) – specify it with `--target <folder>` |
| `journalctl -u knowstead` shows `status=226/NAMESPACE` | LXC container without *nesting*: switch it on in Proxmox (*Options → Features*), restart the container; `install.sh` detects this and otherwise sets up the service without these protection options |
| `bash: $'\r': command not found` when starting `install.sh` | the file has Windows line endings, e.g. after copying individual files with a Windows program – use the installation package or `sed -i 's/\r$//' install.sh` |
| `install.sh`: „Das Konto knowstead kann den Programmordner nicht lesen“ (the account knowstead cannot read the program folder) | the program is e.g. in a home directory – move it to `/opt/knowstead` and run it again there |
| „Node.js … ist zu alt – benötigt wird Version 24“ (Node.js … is too old – version 24 is required) | install Node.js 24 or newer, open a new console, check `node --version` |
| `npm ci` aborts with a network or certificate error | company proxy: `npm config set proxy …` / `https-proxy …`; TLS inspection by the proxy: `npm config set cafile <CA file>` |
| „Die Weboberfläche wurde noch nicht gebaut“ (the web interface has not been built yet) | run `node scripts/prepare.mjs` or `npm run build` in the program folder |
| `EADDRINUSE` – port in use | another service on port 3000: change `PORT` in the `.env` and adjust the proxy |
| `EACCES`/"access denied" on the data directory | the service account needs write permission (`icacls` or `chown knowstead:knowstead`) |
| „Datenbank wird bereits von einem laufenden Knowstead-Server verwendet“ (the database is already in use by a running Knowstead server) | a second process is running (trial start still open, old service) – stop it |
| „Serverschlüssel passt nicht“ (the server key does not match) | `KNOWSTEAD_SECRET` was set or changed after the first start – use the original key again |
| 502 Bad Gateway from the proxy | Knowstead is not running or listens on another address: check the service status, `HOST`/`PORT` and the log |
| The page stays white or shows "Loading takes unusually long" | program files under `/assets/` are blocked (proxy, web filter) or the browser is outdated – F12 → Network |
| Sign-in seems to work, but you are signed out immediately | `COOKIE_SECURE=true` when opened via `http://` – use HTTPS or `COOKIE_SECURE=auto` |
| Links in e-mails point to `localhost` | set `BASE_URL` in the `.env`, restart the service |
| The setup asks for the code, the log shows none | an account already exists (the code is only shown without accounts); otherwise check `LOG_LEVEL=info` |
| Through the proxy the setup does **not** ask for the code | a proxy on the same machine does not send `X-Forwarded-For` – use the configuration from section 7 |
| No "Live" in the editor | the WebSocket upgrade is missing: nginx `Upgrade`/`Connection` headers, the IIS feature "WebSocket Protocol", Apache `upgrade=websocket` |
| Notifications appear only after reloading | the proxy buffers Server-Sent Events: nginx `proxy_buffering off`, IIS `responseBufferLimit=0`, Apache `flushpackets=on` |
| Uploads of large files abort (413) | raise the proxy's upload limit (`client_max_body_size`, `maxAllowedContentLength`, `request_body max_size`) |
| AD/SMTP: "unable to verify the first certificate" | make the internal certification authority known (`NODE_EXTRA_CA_CERTS` or `--use-system-ca`, section 9.2) |
| The backup runs at the wrong time | check the server's time zone; `TZ=Europe/Berlin` in the `.env` or in the container |

More cases: [administration guide → Fehlersuche](ADMINISTRATION.md#fehlersuche) (German).

---

## 14. Reference: settings in the `.env`

The `.env` is in the program folder; values from the environment of the service take precedence.
Content-related settings (name, registration, SMTP, backups …) are not here but in the web interface
under **Administration**.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | port of the server |
| `HOST` | `0.0.0.0` | network interface; `127.0.0.1` if only a local proxy connects |
| `BASE_URL` | `http://localhost:3000` | public address for links in e-mails, webhooks, calendar subscriptions and the API reference |
| `TRUST_PROXY` | `false` | evaluate proxy headers: addresses/networks of the proxy (`loopback`, `127.0.0.1`, `10.0.0.5`, `10.0.0.0/8`, `uniquelocal`) or `true` for every sender |
| `COOKIE_SECURE` | `auto` | session cookie over HTTPS only: `auto` (as soon as the request arrives via HTTPS or with `X-Forwarded-Proto: https`), `true`, `false` |
| `DATA_DIR` | `data` | database, attachments, backups, previews, server key |
| `DB_FILE` | `DATA_DIR/knowstead.db` | a different path for the database file |
| `PLUGINS_DIR` | `plugins` | plugin directory |
| `WEB_DIST_DIR` | `web/dist` | the built user interface |
| `KNOWSTEAD_SECRET` | – (then `secret.key`) | server key, at least 32 characters; do not change it after the first start |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `LOG_FILE` | – (console only) | log file with rotation (10 MB, five older files), relative to the data directory, e.g. `logs/knowstead.log` – the assistant sets it for the scheduled task |
| `KNOWSTEAD_SERVICE` | – | mode of operation according to the assistant (`task`, `nssm`, `systemd`, `docker`) – only displayed under *Next steps* |
| `NODE_ENV` | – | `production` for operation |
| `TZ` | time zone of the server (Docker: `Europe/Berlin`) | time of the backup, the daily digest and dates in exports |

Effective only in the **service environment** (not in the `.env`): `NODE_EXTRA_CA_CERTS` (additional
certification authorities) and `NODE_OPTIONS`.

Emergency switches, only deliberately and temporarily: `KNOWSTEAD_ALLOW_DOWNGRADE=1`,
`KNOWSTEAD_ALLOW_KEY_CHANGE=1`, `KNOWSTEAD_SKIP_UPDATE_BACKUP=1` – see
[administration guide → Aktualisierung](ADMINISTRATION.md#aktualisierung) (German).
