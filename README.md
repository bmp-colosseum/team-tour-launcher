# Team Tour Launcher

A small per-OS app that points Balatro Multiplayer at the Team Tour server, or back at the public
one, with one click.

## What it does

Multiplayer reads a small `.env` file from its own folder at launch. The launcher writes and removes
that file for you. When you open it, it shows which server you are on:

- A **red** mark means the public server (`balatro.virtualized.dev`).
- A **green** mark means the Team Tour server (`server_url=mp.balatroleague.com`, `server_port=8788`).

Then pick one:

- **Switch to the other server** changes it and shows the new mark. Use it just to switch, then start
  Balatro however you normally do.
- **Play Balatro** starts the game from the launcher.
- **Quit** closes it without changing anything.

Switching to the public server also repairs Multiplayer's settings if the old Team Tour mod left our
address in them. Your username, stats and match history are not touched either way.

You need Steamodded and a current version of the Multiplayer mod already working.

## Install

Download the zip for your system from the latest release and unzip it:

- https://github.com/bmp-colosseum/team-tour-launcher/releases/latest/download/Team-Tour-Launcher-Mac.zip
- https://github.com/bmp-colosseum/team-tour-launcher/releases/latest/download/Team-Tour-Launcher-Windows.zip
- https://github.com/bmp-colosseum/team-tour-launcher/releases/latest/download/Team-Tour-Launcher-Linux.zip

The launcher is not signed, so your system warns you the first time. That is expected:

- **Mac:** unzip, then double-click Team Tour Launcher. The first time, macOS blocks it. Go to System
  Settings > Privacy & Security, scroll down, and click Open Anyway next to the app. On macOS 14 and
  older, right-click the app and choose Open instead. It shows a small dialog; there is no Terminal
  window. If it cannot find your Balatro install, Play Balatro tells you to start the game yourself.
- **Windows:** unzip, then double-click Team Tour Launcher. If a blue SmartScreen window appears, click
  More info, then Run anyway. It opens a small window with the same three buttons.
- **Linux:** run it once with `bash team-tour-launcher.sh` (or `chmod +x` it first). After that, Team
  Tour Launcher is in your app menu with its icon. It uses the Proton folder the Multiplayer launcher
  uses; set `BALATRO_DIR` if your Balatro folder is elsewhere.

Switching Multiplayer versions in the Multiplayer launcher drops the setting, and the mark turns red.
Open Team Tour Launcher again and switch to the Team Tour server: that rewrites the file, so it is
fixed from then on.

Unsigned binaries for now; code signing and notarization are planned. Each release also has a
`SHA256SUMS` file if you want to check a download: `sha256sum -c SHA256SUMS` in the folder you saved
the zip to.

## Layout

| Path | What |
| --- | --- |
| `windows/` | C# WinForms app (.NET Framework 4.8), its build recipe, and the committed exe in `windows/dist/` |
| `mac/` | the `.app` bundle (a shell script) and the icon art |
| `linux/` | `team-tour-launcher.sh` |
| `test/` | black-box harness that runs each launcher against a fake Balatro folder |
| `scripts/build-zips.mjs` | dependency-free, byte-deterministic zipper that writes `dist-zips/` |

## Build

The Windows exe is built on Linux (or anywhere with Docker) from pinned base images, committed, and
checked byte for byte by CI. From the repo root, after changing anything in `windows/` or the icon art:

```
docker build -f windows/Dockerfile.build --output type=local,dest=windows/out . && cp "windows/out/Team Tour Launcher.exe" "windows/dist/Team Tour Launcher.exe"
```

Build the three zips (needs only Node 22 or newer):

```
node scripts/build-zips.mjs
```

Run the tests for one OS (`mac`, `windows` or `linux`):

```
node test/harness.mjs windows
```

## Cut a release

```
git tag vX.Y.Z && git push --tags
```

The `release` workflow rebuilds the exe, fails if the committed one is stale, builds the zips and
`SHA256SUMS`, and publishes a GitHub Release with all four files attached.
