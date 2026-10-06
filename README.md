**English** · [Deutsch](README.de.md)

# Genstrio

Parametric generators for 3D printing. Enter a few dimensions, watch the model being built in 3D, and download it as **STL**, **3MF** or **STEP**.

Genstrio runs entirely in your browser: the geometry is computed locally by a real CAD kernel (OpenCascade compiled to WebAssembly). No account, no upload, no server-side processing.

## Generators

| Generator | What it makes |
| --- | --- |
| **Electronics enclosure** | Box with lid, PCB standoffs (M2–M4), corner screw posts, a connector cutout (USB-C, Micro-USB or round cable hole) on any side, and vent slots in the lid and/or side walls. The lid is laid out next to the body, ready to print. |
| **Pipe adapter** | Reducer between two pipes or hoses. Each end either plugs into its counterpart or slides over it, with optional hose barbs, a printable transition cone, and an optional elbow of up to 90°. |
| **Drawer organizer** | Splits a drawer into a grid of equal boxes that fill it without gaps and fit your print bed, with optional dividers inside each box. |

More generators are planned, see [Roadmap](#roadmap).

## Quick start

You need [Node.js](https://nodejs.org) 20.19 or newer.

```bash
git clone https://github.com/TechnikWeber/Genstrio.git && cd Genstrio && ./genstrio
```

The first start installs the dependencies and builds the app (about a minute), then opens it in your browser at `http://localhost:4173`. Later starts take a second.

### Install as a desktop app (Linux)

```bash
./genstrio --install
```

This adds **Genstrio** to your application menu and a `genstrio` command to `~/.local/bin`. The menu entry opens Genstrio in its own window if Chromium, Chrome or Brave is installed, otherwise in your default browser. The background server stops by itself shortly after you close the window. Keep the cloned folder where it is; the launcher points to it. `./genstrio --uninstall` removes both again.

### Launcher options

| Command | Effect |
| --- | --- |
| `./genstrio` | Build if needed, start the local server, open the browser |
| `./genstrio --window` | Open in a chromeless app window |
| `./genstrio --no-open` | Start the server only |
| `./genstrio --dev` | Development server with hot reload |
| `./genstrio --rebuild` | Force a fresh build |

Set `GENSTRIO_PORT` to use a port other than 4173.

## Hosting

`npm run build` writes a fully static site to `dist/`. It uses relative paths, so it can be served from any folder of any static host, including GitHub Pages. The CAD kernel is a 23 MB WebAssembly file (about 7 MB compressed) that the browser caches after the first visit.

## Using the exports

- **STL** contains all parts in one mesh, laid out for printing.
- **3MF** contains each part as a separate object.
- **STEP** contains the exact CAD geometry, for further editing in FreeCAD, Fusion and the like.

All files are in millimetres. The drawer organizer exports a single box; the app tells you how many to print.

## Development

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # geometry tests (run the CAD kernel in Node)
npm run typecheck
npm run build
```

How the code is organised:

- `src/generators/meta.ts` declares each generator's parameters. The form is rendered from this.
- `src/generators/build/` holds the geometry, written with [replicad](https://replicad.xyz). Each generator is a JavaScript generator function that yields intermediate stages, which is how the preview shows the model growing step by step.
- `src/engine/worker.ts` runs the CAD kernel in a web worker, so the interface stays responsive.
- `src/viewer.ts` is the three.js preview, `src/i18n.ts` holds the English and German texts.

To add a generator, declare its parameters in `meta.ts`, write a build function, register it in `build/index.ts`, and add its texts to `i18n.ts`.

## Roadmap

- Presets for common boards (Arduino, ESP32, Raspberry Pi) and DIN-rail enclosures
- Several cutouts per enclosure
- Organizer boxes of mixed sizes
- More fittings: flanges, pipe clamps, cable glands
- Further generators: gears, text and QR codes in 3D, logo reliefs, cookie cutters

## License

[AGPL-3.0-or-later](LICENSE). The models you generate are yours, without restriction.

Genstrio builds on [replicad](https://github.com/sgenoud/replicad) (MIT), [OpenCascade](https://dev.opencascade.org) (LGPL-2.1), [three.js](https://threejs.org) (MIT) and [fflate](https://github.com/101arrowz/fflate) (MIT).
