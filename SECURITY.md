# Sicherheitsrichtlinie

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils **neueste veröffentlichte Version**. Ältere Versionen –
auch Installationen aus der Zeit, als Knowstead noch „Doku“ hieß (bis 1.9) – lassen sich ohne
Datenverlust aktualisieren: [docs/INSTALLATION.md → Updates und Umzug](docs/INSTALLATION.md#11-updates-und-umzug).

## Sicherheitslücke melden

Bitte **nicht** als öffentliches Issue. Melde sie vertraulich über
**[Security → Report a vulnerability](https://github.com/BStein-coder/Knowstead/security/advisories/new)**
(GitHub Security Advisories) in diesem Repository – oder per E-Mail an <info@steintecdev.com>.

Hilfreich sind:

- betroffene Version und Betriebsart (Windows, Linux, Docker),
- eine Beschreibung mit Schritten zum Nachvollziehen oder einem Proof of Concept,
- die Auswirkung (z. B. Rechteausweitung, Datenabfluss, Kontoübernahme),
- ob die Lücke bereits öffentlich bekannt ist.

Wir bestätigen den Eingang innerhalb von **5 Werktagen**, stimmen den Zeitplan für eine Korrektur mit dir
ab und nennen dich auf Wunsch in den Versionshinweisen.

## Sicherheitsmerkmale im Überblick

- Passwörter mit scrypt, Sitzungs-Cookies `HttpOnly`/`SameSite=Lax`, CSRF-Schutz über eine eigene
  Kopfzeile, Anmeldesperre nach Fehlversuchen, Ratenbegrenzung an Anmelde-, SSO- und KI-Routen
- Single Sign-on: OIDC mit PKCE, `state` und `nonce`; SAML mit signierten Assertions, Prüfung von
  Aussteller, Zielgruppe und `InResponseTo`; alle Anmeldevorgänge an den Browser gebunden; Windows-
  Anmeldung nur über eingetragene Proxy-Adressen und optionales gemeinsames Geheimnis
- Rechteprüfung zentral für Bereiche, Seiten, Anhänge, Suche, Exporte und Live-Verbindungen
- HTML-Bereinigung für alle Inhalte, Content-Security-Policy und weitere Sicherheits-Header
- Zugangsdaten (SMTP, LDAP, KI, SSO, Konnektoren) mit AES-256-GCM verschlüsselt gespeichert
- Uploads mit Größen- und Endungsgrenzen, Schutz vor ZIP-Bomben und Pfadmanipulation beim Import
- API-Tokens mit Umfängen (`read`, `write`, `admin`), signierte Webhooks
- Audit-Log für sicherheitsrelevante Ereignisse

Empfehlungen für den Betrieb stehen in der Checkliste für den Produktivbetrieb
([docs/ADMINISTRATION.md](docs/ADMINISTRATION.md#checkliste-für-den-produktivbetrieb)).

---

## Security policy (English)

Please report vulnerabilities **privately** via
**[Security → Report a vulnerability](https://github.com/BStein-coder/Knowstead/security/advisories/new)** (GitHub
Security Advisories) or by email to <info@steintecdev.com> – not as a public issue. Include the affected version,
steps to reproduce and the impact. We acknowledge reports within 5 business days and fix issues in the
latest published release.
