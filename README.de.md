# DriveNX

DriveNX ist eine quelloffene Desktop-Anwendung für die **Diagnose von HDDs, SSDs und NVMe-Laufwerken** unter Windows, macOS und Linux. Die Anwendung verwendet [smartmontools](https://www.smartmontools.org/), erklärt SMART-Befunde und Datenabdeckung, unterstützt geeignete Selbsttests und kann lokale Messverläufe sowie Diagnoseberichte erstellen.

Der eigene Anwendungscode steht unter der [MIT-Lizenz](LICENSE.md); für mitgelieferte Komponenten gelten [eigene Drittanbieter-Lizenzen](LICENSE-THIRD-PARTY.md).

[English](README.md) · [Mitwirken](CONTRIBUTING.md) · [Architektur](docs/ARCHITECTURE.md) · [Diagnosehinweise](DISCLAIMER.md)

> Ein unauffälliges SMART-Ergebnis schließt einen Laufwerksausfall nicht aus. Vor riskanten Untersuchungen und Reparaturversuchen wichtige Daten sichern.

## Funktionen

- HDDs, SATA-SSDs, NVMe-Laufwerke und geeignete USB-Adapter erkennen und auslesen.
- Gesundheitsbefunde und deren Aussagegrenzen nachvollziehbar darstellen; fehlende Messwerte nicht als null oder gesund bewerten.
- SMART-Selbsttests ausführen, Fehlerprotokolle auswerten und optional eine lokale Messhistorie führen.
- PDF-, HTML- und JSON-Berichte erstellen; deutsch- und englischsprachige Oberfläche.

## Entwicklung

Empfohlen werden **Node.js 24 und npm** (wie in der CI).

```sh
npm ci
npm run dev
```

Vor einem Pull Request:

```sh
npm run release:check
```

Weitere Informationen stehen in der [Beitragsanleitung](CONTRIBUTING.md), der [Architektur](docs/ARCHITECTURE.md), der [Geräteerkennung](docs/DEVICE-DETECTION.md), der [Diagnoselogik](docs/DIAGNOSTICS.md) und in den [Tests](docs/TESTING.md).

## Projektaufbau

- `electron/main.js` / `electron/preload.js`: Electron-Einstieg und beschränkte IPC-Bridge.
- `electron/devices/`, `electron/diagnostics/`, `electron/platform/`: Gerätezugriff, Bewertung und Betriebssystemanbindung.
- `electron/ipc/`, `electron/security/`: Validierung, Autorisierung und Prozesssicherheit.
- `electron/data/`, `electron/reports/`, `electron/ui/`: Speicherung, Exporte und Fenster.
- `src/`: React-Oberfläche; `shared/`: gemeinsam verwendete Logik.
- `tests/electron/`, `fixtures/`: Regressionstests und bereinigte Beispieldaten.
- `locales/`: Sprachkataloge; `linux/privileged/`: eingeschränkter Linux-Hilfsprozess.

## Builds

| Ziel        | Befehl                |
| ----------- | --------------------- |
| Windows x64 | `npm run release:win` |
| macOS ARM64 | `npm run dist:mac`    |
| Linux x64   | `npm run dist:linux`  |

Build-Voraussetzungen und Linux-Berechtigungen stehen in [BUILDING.md](docs/BUILDING.md). Das mitgelieferte ARM64-`smartctl` wurde für macOS 15 oder neuer kompiliert (`minos 15.0`). Die tatsächliche Kompatibilität muss noch auf macOS 15 geprüft werden; ein erfolgreicher Build ersetzt keinen Gerätetest.

## Übersetzungen und Datenschutz

Die englische Referenz liegt unter `locales/en-US.json`, die deutsche Übersetzung unter `locales/de-DE.json`. Beiträge sind in [TRANSLATORS.md](docs/TRANSLATORS.md) erklärt. Die internen Sprachkennungen heißen `en-US` und `de-DE`.

DriveNX verarbeitet Diagnosedaten lokal. Exporte und Verlauf können Seriennummern enthalten und sollten vor der Weitergabe kontrolliert werden. Sicherheitslücken nach Möglichkeit über GitHubs private Schwachstellenmeldungen mitteilen.
