---
title: Administration
icon: 🛠️
---

# Administration

You reach the administration via the user menu. Which sections are visible depends on your global permissions.

<!-- toc -->

## Overview

Key figures on users, spaces, pages, versions and storage, the editing activity of the last 30 days, the most active authors, most-read pages and system information (version, build time of the installed package, uptime, data directory, operating mode and log file).

**Alerts** appear at the very top – with an explanation, what to do and since when they have existed. Knowstead checks every ten minutes:

| Alert | Meaning |
| --- | --- |
| **Restart required** | The program files have been replaced since the server started – typically after an update where the service was not restarted. Knowstead is then still running the old version; the alert shows the command for the restart (e.g. `sudo systemctl restart knowstead`). |
| **Automatic backup failed** | The scheduled backup failed – usually for lack of disk space. Knowstead tries again after an hour. |
| **No recent backup** | The newest backup is older than two days. |
| **Low disk space** | Less than 2 GB are free on the drive holding the data. |

The same alerts go **by email** to all administrator accounts: immediately when they start, once a day as a reminder and finally as the all-clear. Thresholds, additional recipients and a test alert are under **Settings → Alerts for administrators**. A monitoring system reads the state from `/api/v1/monitoring` (administration guide, `docs/ADMINISTRATION.md`).

## Next steps

After the initial setup, **Administration → Next steps** shows what is still missing for production use. Each item links straight to the matching setting and ticks itself off as soon as it is done:

- **Address with HTTPS** – the public address (`BASE_URL`) starts with `https://`.
- **Automatic start** – Knowstead starts with the server (set up by the installation assistant or running in the Docker container).
- **Email delivery** – SMTP server and sender are configured.
- **Backup** – automatic backups are switched on and the latest one is less than two days old. **Back up now** creates one immediately.
- **Invite people** – there are other users besides your account.
- **Create the first space** – there is a space of your own (the handbook and the example space do not count).
- *Optional:* **Sign-in with company accounts** (Active Directory or single sign-on) and **Text recognition and Office preview**.

As long as required items are open, a notice in the **Overview** reminds you. You can hide it there and switch it back on under *Next steps*.

## Users and groups

- **Create users** – with a password or without (then generate a link for setting the password and pass it on).
- **Service accounts** – accounts without sign-in, only for API tokens (integrations, automations).
- **Lock/enable**, set password, lift sign-in lock, view and revoke tokens, view and unlink **linked sign-in accounts** (single sign-on).
- **Groups** with global permissions and members; a group can be the **default group** for new accounts.
- **Permissions** shows a "permission × group" matrix for quick adjustments.

> [!WARNING]
> Knowstead prevents the last active administrator from being locked, deleted or removed from the administrators group.

## Directory (Active Directory / LDAP)

Sign-in with Windows accounts is set up under **Administration → Directory**:

1. **Connection**: server URL (`ldaps://dc01.company.local:636`), base DN, service account and password.
2. Check the **fields** – the defaults fit Active Directory.
3. **Check connection** (ideally with a test account): every step is confirmed individually, including the groups found.
4. **Map groups**: search for security groups and enter the identifier for the matching Knowstead group.

> [!IMPORTANT]
> Keep "Also allow local sign-in" enabled – otherwise a directory outage locks everyone out, administrators too.

## Single sign-on (Entra ID, SAML, Windows sign-in)

Under **Administration → Single sign-on** you set up up to three sign-in methods. The page shows the addresses to be entered at the identity provider (ready to copy).

**Microsoft Entra ID / OpenID Connect**

1. In Entra ID, create an **app registration** (platform *Web*) with the displayed **redirect URI**.
2. Create a **client secret** and add the **groups claim** under *Token configuration* (security groups, ideally "groups assigned to the application").
3. In Knowstead enter the **directory (tenant) ID**, **application (client) ID** and **client secret**, **Save and check settings**, then enable it.
4. Under **Groups** enter the **object IDs** of the Entra groups for the Knowstead groups.

Other providers (Keycloak, ADFS, Okta …) work via "Other OpenID Connect provider" with the issuer URL. Multi-tenant sign-in ("common") is not possible for security reasons.

**SAML 2.0**

Register Knowstead as service provider – the **identifier (entity ID)** and **reply URL** are shown on the page; many providers read everything directly from the **metadata** address. In Knowstead enter the provider's **sign-on URL**, **entity ID** and **signing certificate**. During a certificate rollover paste the old and the new certificate one below the other.

**Windows sign-in (Kerberos)**

An upstream web server (IIS with Windows authentication or Apache/nginx with SPNEGO) verifies the Windows account and passes it on to Knowstead in a header. Only the **protected address** `/api/v1/auth/kerberos` is protected there. In Knowstead you enter the **trusted web servers** (IP addresses) and ideally a **shared secret**. With a directory connection, name and groups come from Active Directory. Example configurations are in the administration guide (`docs/ADMINISTRATION.md`).

**Account rules** (per provider): create accounts on first sign-in, adopt existing accounts with the same name (never administrators), synchronise groups, required group, remove the domain from the username. Under **General** the sign-in form for local accounts can be hidden – it remains reachable via "Sign in with a local account" as emergency access.

> [!IMPORTANT]
> Single sign-on requires Knowstead to be reachable at its **HTTPS address** (`BASE_URL`). Every sign-in, every link and every rejected sign-in is recorded in the audit log.

## Spaces, categories and structure

**Administration → Spaces** lists all spaces with category, page count and status.

**Categories** structure the left navigation and the space directory – such as "Departments", "Projects" or "Archive":

| Task | How |
| --- | --- |
| Add category | enter a name in the **Categories** section and **Add** |
| Rename | click the name – assigned spaces move along |
| Change icon | click the icon |
| Change order | arrows up or down |
| Remove | trash icon – the spaces remain and appear under "Other spaces" |
| Assign a space | choose the category in the space list below (or in the space settings) |

Further settings per space:

- **Changes must be approved** turns on mandatory review – see chapter "Review and approval".
- **Approvals**: multi-stage approval workflow – see chapter "Review and approval".
- **Review schedule**: review interval for all pages and optionally a board for review tasks – see chapter "Review schedule".
- **Archive & delete**: archived spaces are read-only; deleting removes a space permanently.

## Settings

| Section | Content |
| --- | --- |
| General | name, subtitle, **default language** (German or English – applies to new people, emails and exports as long as nobody chooses another language in their profile), accent colour, footer (also shown on the sign-in page), **motion and effects** (default "Full" or "Reduced" for everyone who has not chosen for themselves, and for the sign-in page – "Reduced" is recommended for terminal servers and remote access, where every animation costs bandwidth; it also turns off the blur behind the glass surfaces of navigation, menus and dialogs) |
| Access & security | self-registration (optionally with domain filter – new accounts confirm their email address once email delivery is set up), anonymous read access, personal spaces, **real-time collaborative editing**, password length, session duration, lock after failed attempts |
| Content & files | upload limit, blocked file extensions, allowed embed hosts, trash period, version limit, log retention |
| Backups | daily backup, time, number, include attachments |
| Alerts for administrators | email to all administrator accounts on or off, **additional recipients** (e.g. a distribution list), how little free disk space and what backup age trigger an alert (`0` = never), **Send test alert** |

> [!NOTE]
> For collaborative editing, an upstream web server (reverse proxy) must pass WebSocket connections through. The setup is described in the administration guide (`docs/ADMINISTRATION.md`).

## Email

Email delivery is set up under **Administration → Email**:

1. Choose a **preset** (Microsoft 365 with sign-in or as relay via a connector, Exchange on your own network, Google Workspace, IONOS, STRATO) or enter your own server.
2. Enter the **sender** and, if needed, **user** and **password** – the password is stored encrypted.
3. **Check connection** signs in to the server without sending anything; **Send test email** sends a message immediately. Errors are explained in plain language.
4. Turn on **Send notifications by email** and set the time of the **daily digest**.

The **delivery log** shows all emails of the last 30 days with status. Knowstead retries failed deliveries automatically up to five times; **Resend** sends immediately. New people can be **invited** by email under **Users** – they receive a link to set their password. Emails are sent in each recipient's language.

> [!IMPORTANT]
> Microsoft is gradually disabling sign-in with username and password for SMTP. If sign-in fails with Microsoft 365, use the **relay via connector** preset.

## Export template

Under **Administration → Export template** you define how PDF and Word documents look: **company**, **logo**, **brand colour**, **font** (Word), **classification** (e.g. "Internal"), **paper size**, whether **cover page** and **table of contents** are preselected, and **header and footer** with placeholders:

| Placeholder | Replaced by |
| --- | --- |
| `{company}` | company name |
| `{title}` | document title |
| `{space}` | space name |
| `{date}` | export date |
| `{version}` | page version |
| `{author}` | last edited by |
| `{owner}` | owner (review schedule) |
| `{classification}` | classification |

With **Sample PDF** or **Sample Word** you see the result before saving.

## AI & files

Under **Administration → AI & files** four optional building blocks are set up:

**AI connection**

1. Choose the **provider**: Anthropic (Claude), OpenAI, Azure OpenAI, Ollama (local, without internet) or any OpenAI-compatible interface.
2. Enter the **model** and, if needed, the **base URL** and **API key** (the key is stored encrypted and never displayed again).
3. Set the **daily limit per person**, **maximum response length** and the **enabled features**; optionally an **additional instruction** for tone and terminology.
4. **Test connection**, then **Enable AI features** and save.
5. Under **Groups** grant the permission **Use AI features**. New installations give it to the group "Users"; existing installations need to add it once.

Usage (requests, tokens, errors, most active people) is shown on the same page; every request is also recorded in the audit log.

> [!IMPORTANT]
> With cloud providers, selected texts or page contents leave the company. Clarify with data protection and the works council beforehand which content may be transferred – or use a local model via Ollama.

**Office preview**

For previews of PowerPoint, Word, Excel and Visio files the server needs **LibreOffice**. After installation enable the preview; the path to `soffice` is searched automatically or can be entered. The status display reports whether the converter was found. Converted files are cached.

**Text recognition (OCR)**

Scanned PDFs and images contain no searchable text. If **Tesseract** is installed on the server (Windows: *Tesseract-OCR*, Linux: package `tesseract-ocr` with language packs such as `deu` and `eng`), Knowstead recognises the text in the background and adds it to the attachment search. The installer can install Tesseract including language data for you (Linux: `sudo bash install.sh --unattended --install-ocr`, Windows: wizard page *Zusatzfunktionen* or `Knowstead-Installation.cmd -Unattended -InstallTesseract`) and only enters languages whose data is actually present; LibreOffice for the Office preview works the same way (`--install-office` / `-InstallLibreOffice`). After enabling, existing attachments are processed retroactively. Path, **languages** (e.g. `deu+eng`) and the **maximum number of pages per PDF** can be set; the status display reports the version found, installed languages and the number of recognised files.

**draw.io editor**

The default is `https://embed.diagrams.net`. If you run draw.io yourself (e.g. as container `jgraph/drawio`), enter its address here – then diagrams work without internet access.

## Backups and restore

Under **Backups** you create a consistent snapshot of the database at any time (optionally including attachments) and download it as ZIP. Automatic backups run daily at the configured hour; older automatic backups are removed according to the retention.

**Restore:** stop the server and run `npm run cli -- restore <backup name>` (with `--with-uploads` also the attachments). The command checks the backup, saves the current state first and replaces the database safely. Then start the server.

> [!NOTE]
> Backups deliberately do not contain the server key (`secret.key`). Keep it separately – without it, stored credentials (SMTP, directory, AI, single sign-on) must be entered again after a restore on a new server.

## Updates

Updates are safeguarded so that no data is lost:

- Before every change to the database the server automatically creates a backup `backup-…-update`.
- All database changes of an update succeed completely or not at all.
- An older program version does not start on a database already used by a newer one.
- As long as the old service is still running, the new version does not start.
- `start.cmd` or `start.sh` install changed dependencies and rebuild the user interface.

**Linux, with one command:** `sudo bash /opt/knowstead/update.sh <package.tar.gz>` verifies the package (checksum), places the new program next to the old one, stops the service, swaps the folders, starts and checks that Knowstead runs and answers – and updates the handbook. If the new version does not run, the previous one comes back, including the database. The old program folder stays as `/opt/knowstead.vor-<version>`; `sudo bash /opt/knowstead/update.sh --rollback` returns to it, `--dry-run` shows beforehand what would happen. For the first update to 1.8.0 start the `update.sh` from the extracted package.

With the installation assistant: stop Knowstead (Windows `Knowstead-Dienst.cmd stop`, Linux `systemctl stop knowstead`) → extract the new installation package over the program folder → `Knowstead-Installation.cmd -Unattended` or `sudo bash install.sh --unattended` → **Maintenance → Update handbook**. The assistant keeps the existing settings, starts Knowstead again and checks the installation.

Manually: stop the service → copy in the new program files → `start.cmd` or `node scripts/prepare.mjs` → start the service → **Maintenance → Update handbook**. Back to the previous version: copy in the old program files and `npm run cli -- restore backup-…-update`. The detailed instructions are in the administration guide (`docs/ADMINISTRATION.md`).

## Maintenance

Rebuild the search index, **re-index attachments** (re-reads the text of all files for the search), clean up the trash (pages, files **and tasks** after the configured period), remove old logs, clean up sessions, optimise the database and update the handbook after an update. Clean-up and indexing of new files also run automatically.

## Command line

For emergencies and automation there is an administration tool:

```bash
npm run cli -- help
npm run cli -- status
npm run cli -- doctor          # check the installation, machine-readable with --json
npm run cli -- stop            # stop a running server gracefully
npm run cli -- user:create --username anna --name "Anna Admin" --password "…" --admin
npm run cli -- user:password anna
npm run cli -- backup
npm run cli -- backup:list
npm run cli -- restore backup-20260913-030000-auto
npm run cli -- reindex
npm run cli -- handbook:sync
```

`doctor` checks Node.js, user interface, data directory, disk space, address, port, server key, database, backups and log and names the remedy for every problem. On Windows, `Knowstead-Dienst.cmd start|stop|restart|status|log` controls the automatic start set up by the assistant.
