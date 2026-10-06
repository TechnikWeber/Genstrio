[English](README.md) · **Deutsch**

# Genstrio

Parametrische Generatoren für den 3D-Druck. Ein paar Maße eingeben, dem Modell beim Entstehen in 3D zusehen und es als **STL**, **3MF** oder **STEP** herunterladen.

Genstrio läuft vollständig im Browser: Die Geometrie berechnet ein echter CAD-Kern (OpenCascade, nach WebAssembly kompiliert) lokal auf deinem Rechner. Kein Konto, kein Upload, keine Verarbeitung auf einem Server.

## Generatoren

| Generator | Was er erzeugt |
| --- | --- |
| **Elektronikgehäuse** | Gehäuse mit Deckel, Platinen-Abstandshaltern (M2–M4), Schraubdomen in den Ecken, einem Anschlussausschnitt (USB-C, Micro-USB oder runde Kabeldurchführung) auf einer beliebigen Seite sowie Lüftungsschlitzen im Deckel und/oder in den Seitenwänden. Der Deckel liegt druckfertig neben dem Unterteil. |
| **Rohradapter** | Reduzierstück zwischen zwei Rohren oder Schläuchen. Jedes Ende steckt entweder im Gegenstück oder sitzt darüber, wahlweise mit Schlauchtülle, mit druckbarem Übergangskonus und optional als Bogen bis 90°. |
| **Schubladen-Organizer** | Teilt eine Schublade in ein Raster gleich großer Boxen auf, die sie lückenlos füllen und auf dein Druckbett passen, wahlweise mit Trennwänden in jeder Box. |

Weitere Generatoren sind geplant, siehe [Roadmap](#roadmap).

## Schnellstart

Du brauchst [Node.js](https://nodejs.org) 20.19 oder neuer.

```bash
git clone https://github.com/TechnikWeber/Genstrio.git && cd Genstrio && ./genstrio
```

Der erste Start installiert die Abhängigkeiten und baut die App (etwa eine Minute), danach öffnet sie sich im Browser unter `http://localhost:4173`. Spätere Starts dauern eine Sekunde.

### Als Desktop-App installieren (Linux)

```bash
./genstrio --install
```

Das legt **Genstrio** im Anwendungsmenü an und einen Befehl `genstrio` in `~/.local/bin`. Der Menüeintrag öffnet Genstrio in einem eigenen Fenster, wenn Chromium, Chrome oder Brave installiert ist, sonst im Standardbrowser. Der Server im Hintergrund beendet sich kurz nach dem Schließen des Fensters von selbst. Lass den geklonten Ordner an seinem Platz; der Starter verweist darauf. `./genstrio --uninstall` entfernt beides wieder.

### Optionen des Starters

| Befehl | Wirkung |
| --- | --- |
| `./genstrio` | Bei Bedarf bauen, lokalen Server starten, Browser öffnen |
| `./genstrio --window` | In einem rahmenlosen App-Fenster öffnen |
| `./genstrio --no-open` | Nur den Server starten |
| `./genstrio --dev` | Entwicklungsserver mit Hot Reload |
| `./genstrio --rebuild` | Neu bauen erzwingen |

Mit `GENSTRIO_PORT` wählst du einen anderen Port als 4173.

## Hosten

`npm run build` schreibt eine rein statische Website nach `dist/`. Sie verwendet relative Pfade und lässt sich deshalb aus jedem Ordner jedes statischen Hosters ausliefern, auch über GitHub Pages. Der CAD-Kern ist eine 23 MB große WebAssembly-Datei (komprimiert etwa 7 MB), die der Browser nach dem ersten Besuch zwischenspeichert.

## Die Exporte verwenden

- **STL** enthält alle Teile in einem Netz, druckfertig angeordnet.
- **3MF** enthält jedes Teil als eigenes Objekt.
- **STEP** enthält die exakte CAD-Geometrie zum Weiterbearbeiten in FreeCAD, Fusion und Ähnlichem.

Alle Dateien sind in Millimetern. Der Schubladen-Organizer exportiert eine einzelne Box; die App nennt dir die Stückzahl.

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver mit Hot Reload
npm test           # Geometrietests (führen den CAD-Kern in Node aus)
npm run typecheck
npm run build
```

So ist der Code aufgebaut:

- `src/generators/meta.ts` deklariert die Parameter jedes Generators. Daraus wird das Formular erzeugt.
- `src/generators/build/` enthält die Geometrie, geschrieben mit [replicad](https://replicad.xyz). Jeder Generator ist eine JavaScript-Generatorfunktion, die Zwischenstände liefert; so zeigt die Vorschau, wie das Modell Schritt für Schritt entsteht.
- `src/engine/worker.ts` führt den CAD-Kern in einem Web Worker aus, damit die Oberfläche flüssig bleibt.
- `src/viewer.ts` ist die three.js-Vorschau, `src/i18n.ts` enthält die deutschen und englischen Texte.

Für einen neuen Generator: Parameter in `meta.ts` deklarieren, eine Build-Funktion schreiben, sie in `build/index.ts` eintragen und die Texte in `i18n.ts` ergänzen.

## Roadmap

- Vorlagen für gängige Boards (Arduino, ESP32, Raspberry Pi) und Hutschienengehäuse
- Mehrere Ausschnitte pro Gehäuse
- Organizer-Boxen in gemischten Größen
- Weitere Fittings: Flansche, Rohrhalter, Kabeldurchführungen
- Weitere Generatoren: Zahnräder, Text und QR-Codes in 3D, Logo-Reliefs, Ausstechformen

## Lizenz

[AGPL-3.0-or-later](LICENSE). Die erzeugten Modelle gehören dir, ohne Einschränkung.

Genstrio baut auf [replicad](https://github.com/sgenoud/replicad) (MIT), [OpenCascade](https://dev.opencascade.org) (LGPL-2.1), [three.js](https://threejs.org) (MIT) und [fflate](https://github.com/101arrowz/fflate) (MIT) auf.
