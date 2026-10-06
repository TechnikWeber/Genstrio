[English](README.md) · **Deutsch**

# Genstrio

**[▶ Genstrio im Browser öffnen](https://technikweber.github.io/Genstrio/)** – ohne Installation.

Parametrische Generatoren für den 3D-Druck. Ein paar Maße eingeben, dem Modell beim Entstehen in 3D zusehen und es als **STL**, **3MF** oder **STEP** herunterladen.

Genstrio läuft vollständig im Browser: Die Geometrie berechnet ein echter CAD-Kern (OpenCascade, nach WebAssembly kompiliert) lokal auf deinem Rechner. Kein Konto, kein Upload, keine Verarbeitung auf einem Server.

Die Oberfläche startet auf Englisch; der Knopf **DE** oben schaltet auf Deutsch um.

## Generatoren

| Generator | Was er erzeugt |
| --- | --- |
| **Elektronikgehäuse** | Rechteckiges, rundes oder vieleckiges (3–12 Ecken) Gehäuse, mit oder ohne Deckel. **Vorlagen** für Raspberry Pi 3/4/5, Zero und Pico, Arduino Uno und Mega, Adafruit Feather, ESP32 DevKit und BeagleBone setzen die Abstandshalter auf das Lochbild des Boards und schneiden die Öffnungen für seine Anschlüsse; jeder Wert bleibt änderbar. Platinen-Abstandshalter und Deckelschrauben sind getrennt einstellbar (M2–M5), als Kernloch für selbstschneidende Schrauben oder als Bohrung für Einpresshülsen; Deckelschrauben wahlweise mit Senkung für Senk- oder Zylinderkopf. Der Deckel kann stattdessen mit Rastnasen einrasten, per Drehverschluss halten (runde Gehäuse) oder nur aufgesteckt werden, und er kann ein Stiftscharnier bekommen. Optional Dichtungsnut, Befestigungslaschen (Seite, Abstand und Versatz einstellbar) und Hutschienen-Clip an jeder Wand oder unter dem Boden. Beliebig viele Öffnungen in Wänden, Deckel oder Boden: Anschlüsse (USB-C, Micro-USB, USB-A einfach und gestapelt, USB-B, HDMI, Mini-/Micro-HDMI, RJ45, DC-Buchse, SD-Schlitz), runde Bohrungen mit Vorgaben für Antennen, LEDs, Schalter und Taster, Kabelverschraubungen (M12–M40, PG7–PG21, auf Wunsch mit gedrucktem Gewinde), Lautsprecher (20–77 mm) und Lüfter (25–120 mm) hinter einem Gitter aus Löchern, Waben, Quadraten, Schlitzen oder Dreiecken oder ganz offen. Die Lüftung wird für Deckel, Wände und Boden getrennt eingestellt. |
| **Rohradapter** | Reduzierstück zwischen zwei Rohren, Schläuchen oder Gewinden. Jedes Ende ist entweder ein freier Durchmesser, der im Gegenstück steckt oder darüber sitzt (der eingegebene Durchmesser bleibt immer die Passfläche, die Wand wächst von ihr weg), oder eine Normgröße: Gartenschläuche 1/2″–1 1/4″, G-Rohrgewinde 1/4″–1″ außen oder innen, HT-Abflussrohr DN 32–110, PVC-Rohr, Staubsauger- und Absauganschlüsse. Vorlagen gibt es für Schlauchverbinder, Hahn- und Gewindeadapter, Staubsaugeradapter, Abflussreduzierungen und Wandflansche. Schlauchtülle mit Anzahl, Höhe und Abstand der Widerhaken je Ende, Einführfasen, druckbarer Übergangskonus, optional als Bogen bis 180° und mit Befestigungsflansch samt Bohrungen. |
| **Schubladen-Organizer** | Teilt eine Schublade in Boxen auf, die sie lückenlos füllen und auf dein Druckbett passen, ausgehend von Vorlagen für typische Küchen-, Schreibtisch-, Werkstatt- und Badschubladen: gleich große Boxen gemischte Größen nach frei eingegebenen Verhältnissen (z. B. `2, 1, 1`) oder eine zufällige Mischung aus kleinen und großen Boxen, die sich neu würfeln lässt, bis sie gefällt. Jede Box kann Trennwände (volle oder reduzierte Höhe), Griffmulden am Rand, Ablauföffnungen im Boden und eine Beschriftungsleiste bekommen. |
| **Gridfinity** | Behälter und Grundplatten im 42-mm-Raster von [Gridfinity](https://gridfinity.xyz). Behälter von 1 × 1 bis 10 × 10 Einheiten mit oder ohne Stapelrand, beliebig viele Fächer, abgesenkte Trennwände, Griffschräge vorne, Beschriftungsleisten (ganze Breite, links, mittig oder rechts), einstellbare Wand- und Bodenstärke sowie Löcher für Magnete und/oder M3-Schrauben in den Ecken oder in jedem Fuß. Statt eines offenen Behälters gibt es auch einen **Halter** mit einem Feld von Aufnahmen – für Sechskant-Bits, AAA-/AA-/18650-Zellen, Stifte oder jedes runde, sechseckige oder quadratische Maß – oder einen massiven Block. Grundplatten als offener Rahmen oder mit Boden, Magnetlöchern und Senklöchern zum Festschrauben. Gibst du das **Innenmaß einer Schublade** ein, füllt die Platte sie vollständig: Das Raster liegt mittig oder an einer Seite, der Rest wird ein massiver Rand, und Platten, die größer sind als dein Druckbett, werden in passende Stücke geteilt. |
| **Haken & Halter** | Wandhaken (Ausladung, Spitze, Steigung und Biegeradius einstellbar), Halter passend zum Durchmesser eines Stiels oder Rohrs, Regalwinkel mit Stützrippe und Löchern für das Brett sowie Leisten mit bis zu zehn Haken. Befestigt mit Schrauben (angesenkt oder nicht), Klebeband, über eine Tür beliebiger Stärke gehängt oder in eine Lochwand eingehängt. Einzelne Haken liegen druckfertig auf der Seite, damit die Schichten entlang des Arms laufen. |
| **Text & Schilder** | Schilder, Etiketten, Schlüsselanhänger, Stempel, Schablonen und freistehende Schriftzüge aus einer oder mehreren Textzeilen, in neun Schriften. Text erhaben auf einer Platte, vertieft, durchbrochen oder als Buchstaben allein mit verbindendem Steg. Rechteckige, pillenförmige oder elliptische Platte mit erhabenem Rahmen, Löchern für Schlüsselring oder Schrauben, gespiegeltem Text für Stempel und dem Text als eigenem Teil für den Druck in einer zweiten Farbe. |

Weitere Generatoren sind geplant, siehe [Roadmap](#roadmap).

## Lokal starten

Die gehostete Version oben reicht völlig. Für den Betrieb auf dem eigenen Rechner:

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

Maße lassen sich in Millimetern, Zentimetern oder Zoll anzeigen und eingeben (Auswahl oben im Panel; Zoll auch als Bruch wie `3 1/2`); exportierte Dateien sind immer in Millimetern. Besteht ein Modell aus mehreren Teilen, lässt sich über die Auswahl unter den Export-Knöpfen auch nur eines herunterladen, etwa nur der Deckel. Der Schubladen-Organizer exportiert jede Boxgröße einmal; die App nennt dir die Stückzahl.

## Arbeit speichern

Deine Werte bleiben im Browser zwischen den Besuchen erhalten. Unter **Projekt und Vorlagen** kannst du die aktuellen Werte außerdem als eigene, benannte Vorlage speichern, als Projektdatei (`.json`) herunterladen, um später oder an einem anderen Rechner weiterzumachen, und eine solche Datei wieder öffnen. **Link kopieren** packt den aktuellen Generator mit allen Werten in einen Link zum Speichern oder Weitergeben. **Zusammengebaut** in der Vorschau zeigt den Deckel auf dem Gehäuse.

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

Lochbilder der Boards stehen in `src/generators/boards.ts`, Vorlagen in `src/generators/templates.ts`.

Für einen neuen Generator: Parameter in `meta.ts` deklarieren, eine Build-Funktion schreiben, sie in `build/index.ts` eintragen und die Texte in `i18n.ts` ergänzen.

## Roadmap

- Weitere Board-Vorlagen, auch mit den Anschlussausschnitten von BeagleBone und anderen Einplatinencomputern
- Scharniere und Verschlüsse, die fertig montiert aus dem Drucker kommen
- Weitere Fittings: Rohrhalter, T-Stücke, Schlauchkupplungen
- Weitere Generatoren: Zahnräder, QR-Codes in 3D, Logo-Reliefs, Ausstechformen

## Lizenz

[AGPL-3.0-or-later](LICENSE). Die erzeugten Modelle gehören dir, ohne Einschränkung.

Genstrio baut auf [replicad](https://github.com/sgenoud/replicad) (MIT), [OpenCascade](https://dev.opencascade.org) (LGPL-2.1), [three.js](https://threejs.org) (MIT) und [fflate](https://github.com/101arrowz/fflate) (MIT) auf.

Die Schriften des Text-Generators – Inter, Fredoka, Oswald, Bebas Neue, Zilla Slab, Playfair Display, JetBrains Mono, Pacifico und Allerta Stencil – stehen unter der [SIL Open Font License 1.1](https://openfontlicense.org), die die freie, auch kommerzielle Nutzung in allem erlaubt, was du damit herstellst. Die Schriftdateien und ihre Lizenztexte liegen in [`src/fonts`](src/fonts).
