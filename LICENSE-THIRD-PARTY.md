# DriveNX – Drittanbieter-Lizenzhinweise

Der eigenentwickelte Anwendungscode von DriveNX steht unter der **MIT-Lizenz** (`LICENSE.md`, Copyright © 2026 Tobias Degen). Die folgenden Drittanbieterkomponenten behalten unabhängig davon ihre jeweiligen eigenen Lizenzen. Copyright-Hinweise, Original-Lizenztexte und Quellcodepflichten bleiben bestehen.

| Mitgelieferte Komponente         | Im Projekt verwendete Version              | Lizenz                                                  | Originaltext / Ressourcen                                                                              |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Electron (Laufzeit)              | 45.2.1                                     | MIT, zusätzlich Chromium-/Node.js-Drittanbieterhinweise | `licenses/Electron-MIT.txt`; `LICENSES.chromium.html` der Electron-Laufzeit                            |
| React                            | 19.3.1                                     | MIT                                                     | `licenses/React-MIT.txt`                                                                               |
| React DOM                        | 19.3.1                                     | MIT                                                     | `licenses/React-DOM-MIT.txt`                                                                           |
| Scheduler (React DOM Dependency) | 0.28.0                                     | MIT                                                     | `licenses/Scheduler-MIT.txt`                                                                           |
| Lucide React                     | 1.66.0                                     | ISC; Feather-Anteile zusätzlich MIT                     | `licenses/Lucide-ISC-and-Feather-MIT.txt`                                                              |
| smartmontools / smartctl         | 7.5 (Windows/macOS); Systemversion (Linux) | GNU GPL v2 oder später, gemäß Original-Lizenzhinweis    | `smartmontools/COPYING-smartmontools.txt`; Quellarchiv `smartmontools/smartmontools-7.5-source.tar.gz` |
| USB ID Repository (`usb.ids`)    | 2026.06.26                                 | BSD-3-Clause (gewählte alternative Lizenz)              | `usb-ids/LICENSE-BSD-3-Clause.txt`                                                                     |

**Quellen:** https://www.electronjs.org/ · https://react.dev/ · https://lucide.dev/ · https://www.smartmontools.org/ · https://www.linux-usb.org/usb-ids.html

## Electron / Chromium / Node.js

Electron bindet Chromium, Node.js und weitere Komponenten mit eigenständigen Copyright- und Lizenzpflichten ein. Deren vollständige Hinweise stehen in der zum jeweils gebauten Electron-Runtime gehörenden Datei `LICENSES.chromium.html`. Diese Datei darf bei der Paketierung nicht gelöscht werden. Die Originalhinweise sind in der zentralen Ansicht **Hilfe → Rechtliche Hinweise** erreichbar. Die unveränderte Datei bleibt außerdem Bestandteil der ausgelieferten Electron-Runtime.

Für den eigentlichen Electron-Code wird der originale MIT-Lizenztext unverändert beigelegt. Build-Werkzeuge wie Vite und electron-builder gehören normalerweise nicht in den ausführbaren App-Code; ihre Lizenztexte sind nur dann als Laufzeitmitlieferung relevant, wenn sie tatsächlich enthalten sind.

## smartmontools / GPL

Unter Windows und macOS wird `smartctl` als separate, GPL-lizenzierte Binärdatei mitgeliefert. Unter Linux verwendet DriveNX ausschließlich die **systemweit installierte smartmontools-Version**; deren Versionsstand und Lizenzbereitstellung liegen bei der jeweiligen Distribution. DriveNX startet `smartctl` als eigenständigen Prozess. Die **GPL-Rechte der Empfänger** dürfen durch die MIT-Lizenz von DriveNX nicht beschränkt werden. Der GPL-Lizenztext und das smartmontools-7.5-Upstream-Quellarchiv liegen in den gemeinsamen `smartmontools`-Ressourcen. Dieses Quellarchiv ist kein Quellnachweis für die möglicherweise abweichende Linux-Systemversion. Das bereitgestellte Upstream-Archiv entspricht der offiziellen smartmontools-7.5-Quelldatei (SHA-256: `690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e`).

**Quell- und Binärherkunft:**

| Bestandteil                 | Herkunft / Prüfdaten                                                                                                        | SHA-256                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Quellcode smartmontools 7.5 | Offizielles Upstream-Tarball; enthält u. a. `configure`, `Makefile.in`, `INSTALL`, `os_win32.cpp` und `os_darwin.cpp`       | `690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e` |
| Windows x64 `smartctl.exe`  | Im Projekt dokumentiert als Extraktion aus dem offiziellen Windows-Setup 7.5; PE-Zeitstempel 30.04.2025 07:43:44 UTC        | `b5db94e5082c042be44994b7a4fa8f7b5c8e713b2ab1c9a560d8f7a7995ea27d` |
| macOS ARM64 `smartctl`      | Lokal aus offiziellem smartmontools 7.5 gebaut; SVN r5714, ARM64, Deployment-Ziel macOS 15.0 (Build-Host Darwin 27)         | `ba9691d84342c36420fb022141abd3922129ddad4d2e653a93ca3e9ec2f0ddce` |
| `drivedb.h`                 | Im Projekt enthaltene, gegenüber dem 7.5-Tarball aktualisierte GPL-lizenzierte Quelldatei; eigener mitgelieferter Quelltext | `428f9d56357cd35056719e1ef3fe2eff87b5ae7499e7797e0811c38b2dbb7079` |

Die separat ausgelieferten `COPYING-smartmontools.txt`- und `AUTHORS-smartmontools.txt`-Dateien stimmen bytegenau mit den entsprechenden Dateien im offiziellen 7.5-Tarball überein. Der Release-Check prüft den Hash des Quellarchivs automatisch.

**Herkunftsvergleiche abgeschlossen:** Der originale Windows-Installer wurde anhand des von SourceForge veröffentlichten SHA-256-Werts (`896337fcc253220614cf8cdbd5cf2321c5aa326a37a04160a672a281e6104c70`) bestätigt. Seine entpackte x64-`smartctl.exe` ist **bytegenau identisch** mit der Windows-Datei von DriveNX. Die macOS-Datei wurde vom Entwickler aus dem offiziellen smartmontools-7.5-Quellarchiv für ARM64 mit `MACOSX_DEPLOYMENT_TARGET=15.0` kompiliert. Der Build verwendete das macOS-27.2-SDK; `LC_BUILD_VERSION` weist `minos 15.0` aus. Compiler, Konfiguration und Prüfsumme sind in `vendor/smartmontools/darwin/README.txt` dokumentiert. Die neue Datei ist nicht mit dem bisherigen Homebrew-Binary identisch. Buildinformationen sind in `vendor/smartmontools/win32/README.txt`, `vendor/smartmontools/darwin/README.txt` und in den jeweiligen Upstream-Builddateien dokumentiert. Die Herkunftsbestätigung allein ist keine Rechtsbescheinigung über die Vollständigkeit aller korrespondierenden Quellen und Buildbestandteile im Sinne der GPLv2 § 3.

Upstream-Veröffentlichung: https://sourceforge.net/projects/smartmontools/files/smartmontools/7.5/ · Homebrew-Quellrezept: https://github.com/Homebrew/homebrew-core/blob/main/Formula/s/smartmontools.rb · GPLv2: https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html.

## USB-ID-Daten

Der im Release enthaltene `usb-ids/index.json` ist aus der USB-ID-Datenbank `usb.ids` des USB ID Repository abgeleitet (Datenstand 2026.06.26). Die unveränderte Quelldatei `usb.ids` bleibt im Entwicklungsprojekt, wird aber nicht mit der Anwendung ausgeliefert. Die gewählte BSD-3-Clause-Alternative erlaubt die Weitergabe des abgeleiteten Indexes, sofern Copyright-, Lizenz- und Haftungshinweise erhalten bleiben. Der vollständige Lizenztext ist unter `usb-ids/LICENSE-BSD-3-Clause.txt` mitgeliefert.
