// Black-box test of the Team Tour Launcher against a fake Balatro dir.
// Usage: node harness.mjs <mac|windows|linux>
// Run on the matching OS in CI (.github/workflows/ci.yml); also runs on Windows
// with Git Bash for mac/linux. The launcher is pointed at a temp dir through HOME (mac),
// BALATRO_DIR (linux) or APPDATA (windows); SWITCH_CHOICE skips the prompt and NO_LAUNCH makes it
// print the launch command instead of starting the game.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatedEntries } from "../scripts/build-zips.mjs";

const os = process.argv[2];
assert.ok(["mac", "windows", "linux"].includes(os), "usage: harness.mjs <mac|windows|linux>");
const here = dirname(fileURLToPath(import.meta.url));
// mac: the executable inside the .app bundle. MAC_APPS_DIR points at an extracted zip (CI)
// and runs it directly, which also proves the exec bit and shebang; otherwise the source tree
// is used through bash.
const macApps = process.env.MAC_APPS_DIR;
const macDir = macApps ?? join(here, "..", "mac");
const LAUNCHER = {
  mac: join(macDir, "Team Tour Launcher.app", "Contents", "MacOS", "team-tour-launcher"),
  // The committed exe (CI passes the freshly built one through LAUNCHER_EXE).
  windows: process.env.LAUNCHER_EXE || join(here, "..", "windows", "dist", "Team Tour Launcher.exe"),
  linux: join(here, "..", "linux", "team-tour-launcher.sh"),
}[os];

// Extra environment for every run (the Linux no-python3 pass sets NO_PYTHON).
let extraEnv = {};
// Mac only: "real" uses the host osascript, "emulate" a stand-in (non-Mac host), "fallback" a failing one.
let macMode = process.platform === "darwin" ? "real" : "emulate";
const DECOY_ENV = "unrelated=keep-me\n";
const TRAP_ENV = "trap=keep-me-too\n";
const OUR = "mp.balatroleague.com";
const PUB = "balatro.virtualized.dev";
// Non-ASCII username (UTF-8) plus a lone 0xFF byte, which is not valid UTF-8: the repair must
// leave every byte except the host untouched.
const NAME = String.fromCodePoint(0x5a, 0x6f, 0xeb, 0x20, 0x65e5, 0x672c);
const jkr = (host) =>
  Buffer.concat([
    Buffer.from(`return {["username"]="${NAME}",["server"]="${host}",\r\n["again"]="${host}",["bin"]="`, "utf8"),
    Buffer.from([0xff, 0x00, 0x80]),
    Buffer.from(`"}\n`, "utf8"),
  ]);

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "launcher-"));
  const home = join(root, "home");
  const balatro =
    os === "mac"
      ? join(home, "Library", "Application Support", "Balatro")
      : os === "windows"
        ? join(root, "appdata", "Balatro")
        : join(root, "balatro");
  // Linux: a stub xdg-open on PATH so the launch branch is the same on every runner.
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // Mac: how osascript (used to read Multiplayer.json) behaves. "real" is the runner's own, "emulate" a
  // stand-in on a non-Mac host, "fallback" one that fails to run so the grep fallback is exercised.
  if (os === "mac" && macMode === "emulate") {
    writeFileSync(join(bin, "osascript"), `#!/bin/sh\nexec node "${join(here, "osascript-stub.mjs").split("\\").join("/")}" "$@"\n`, { mode: 0o755 });
  }
  if (os === "mac" && macMode === "fallback") writeFileSync(join(bin, "osascript"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  return { root, home, balatro, bin, game: join(root, "game") };
}

function run(choice, fx) {
  const env = { ...process.env, NO_PAUSE: "1", NO_LAUNCH: "1", NO_DIALOG: "1", NO_DESKTOP_INSTALL: "1", SWITCH_CHOICE: choice, ...extraEnv };
  if (os === "mac") {
    env.HOME = fx.home;
    env.BALATRO_GAME_DIR = fx.game;
    env.PATH = `${fx.bin}${delimiter}${process.env.PATH}`;
  }
  if (os === "linux") {
    env.BALATRO_DIR = fx.balatro;
    env.PATH = `${fx.bin}${delimiter}${process.env.PATH}`;
  }
  const script = LAUNCHER;
  const r =
    os === "windows"
      ? spawnSync(script, ["--choice", choice, "--no-launch", "--appdata", join(fx.root, "appdata")], { env, encoding: "utf8" })
      : spawnSync(...(os === "mac" && macApps ? [script, []] : ["bash", [script]]), { env, encoding: "utf8" });
  assert.equal(r.status, 0, `${script} (${choice}) exited ${r.status}: ${r.stderr}`);
  for (const g of fx.guards ?? []) assert.equal(readFileSync(g.path, "utf8"), g.content, `${g.name}'s .env was touched by ${choice}`);
  // eslint-disable-next-line no-control-regex
  return r.stdout.replace(/\u001b\[[0-9;]*m/g, "");
}

function populate(fx, { bom = false } = {}) {
  const mods = join(fx.balatro, "Mods");
  const mod = (name, files) => {
    mkdirSync(join(mods, name), { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(mods, name, file), content);
  };
  // The real mod: Multiplayer.json id "Multiplayer" and a core.lua that reads .env.
  mod("multiplayer-0.5.5", {
    "Multiplayer.json": (bom ? String.fromCharCode(0xfeff) : "") + JSON.stringify({ id: "Multiplayer", name: "Balatro Multiplayer", version: "0.5.5" }, null, 2),
    "core.lua": "MP = {}\nMP.ENV = {}\n",
  });
  // Decoys that must never get or lose a .env, whichever way the server is switched: another mod,
  // and a trap whose core.lua mentions MP.ENV but whose Multiplayer.json id is something else.
  mod("decoy-mod", { "core.lua": "-- not the multiplayer mod\n", "Multiplayer.json": JSON.stringify({ id: "Decoy" }), ".env": DECOY_ENV });
  mod("trap-mod", { "core.lua": "-- mentions MP.ENV but is another mod\n", "Multiplayer.json": JSON.stringify({ id: "SomethingElse" }), ".env": TRAP_ENV });
  fx.guards = [
    { name: "decoy-mod", path: join(mods, "decoy-mod", ".env"), content: DECOY_ENV },
    { name: "trap-mod", path: join(mods, "trap-mod", ".env"), content: TRAP_ENV },
  ];
  mkdirSync(join(fx.balatro, "config"), { recursive: true });
  writeFileSync(join(fx.balatro, "config", "Multiplayer.jkr"), jkr(OUR));
  return mods;
}

// Mods whose .env exists, not counting the decoys (which always keep their own).
const envFiles = (mods) => readdirSync(mods).filter((d) => d !== "decoy-mod" && d !== "trap-mod" && existsSync(join(mods, d, ".env")));

// Every file under the Balatro dir, with content, to prove "no change" means no change.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = readFileSync(p).toString("hex");
    }
  };
  walk(dir);
  return out;
}

const jkrPath = (fx) => join(fx.balatro, "config", "Multiplayer.jkr");
// Status line per state: a mark plus the wording. Linux and the real Windows console use a
// coloured "(*)", the plain-text seam uses [red]/[green].
const STATUS = {
  public: os === "linux" ? /\(\*\) You are on the public server\./ : /\[red\] You are on the public server\./,
  team: os === "linux" ? /\(\*\) You are on the Team Tour server\./ : /\[green\] You are on the Team Tour server\./,
};
const statusLines = (out) => out.split(/\r?\n/).filter((l) => /You are on the/.test(l));

/** The exact launch line each OS must print under NO_LAUNCH, or null when it falls back to a message. */
function expectedLaunch(fx, withDylib) {
  if (os === "windows") return 'LAUNCH: start "" "steam://rungameid/2379780"';
  if (os === "linux") return "LAUNCH: xdg-open steam://rungameid/2379780";
  if (!withDylib) return null;
  const gd = fx.game;
  return `LAUNCH: cd ${gd} && DYLD_INSERT_LIBRARIES=${gd}/liblovely.dylib ${gd}/Balatro.app/Contents/MacOS/love`;
}

const launchOf = (out) => out.split(/\r?\n/).find((l) => l.startsWith("LAUNCH:")) ?? null;

function scenarios() {
{
  const fx = makeFixture();
  const mods = populate(fx);
  const mp = join(mods, "multiplayer-0.5.5", ".env");

  // quit from the public state: shows red/public, changes nothing, launches nothing, no Done line.
  const before = snapshot(fx.balatro);
  const quitOut = run("quit", fx);
  assert.equal(statusLines(quitOut).length, 1);
  assert.match(quitOut, STATUS.public);
  assert.equal(launchOf(quitOut), null);
  assert.doesNotMatch(quitOut, /Done:/);
  assert.deepEqual(snapshot(fx.balatro), before);

  // An empty script means quit as well.
  assert.deepEqual(statusLines(run("quit,play", fx)).length, 1);
  assert.deepEqual(snapshot(fx.balatro), before);

  // switch,quit from public: .env written (two lines, only in the Multiplayer folder), jkr
  // untouched, status shows public then green, nothing launched.
  const swOut = run("switch,quit", fx);
  const sl = statusLines(swOut);
  assert.equal(sl.length, 2);
  assert.match(sl[0], STATUS.public);
  assert.match(sl[1], STATUS.team);
  assert.equal(launchOf(swOut), null);
  assert.doesNotMatch(swOut, /Done:/);
  assert.deepEqual(envFiles(mods), ["multiplayer-0.5.5"]);
  assert.deepEqual(readFileSync(mp, "utf8").split(/\r?\n/).filter(Boolean), [`server_url=${OUR}`, "server_port=8788"]);
  assert.ok(readFileSync(jkrPath(fx)).equals(jkr(OUR)), "switching to Team Tour must not touch the jkr");

  // quit from the Team Tour state: no change, no launch.
  const afterTeam = snapshot(fx.balatro);
  const teamQuit = run("quit", fx);
  assert.match(teamQuit, STATUS.team);
  assert.equal(launchOf(teamQuit), null);
  assert.deepEqual(snapshot(fx.balatro), afterTeam);

  // switch,quit from Team Tour: back to public with the jkr repaired byte for byte; status team then public.
  const back = run("switch,quit", fx);
  const bl = statusLines(back);
  assert.equal(bl.length, 2);
  assert.match(bl[0], STATUS.team);
  assert.match(bl[1], STATUS.public);
  assert.deepEqual(envFiles(mods), []);
  assert.ok(readFileSync(jkrPath(fx)).equals(jkr(PUB)), "Multiplayer.jkr differs from expected bytes");

  // switch,switch,quit from public: team then public again; same bytes as a single repair.
  const twice = run("switch,switch,quit", fx);
  assert.equal(statusLines(twice).length, 3);
  assert.deepEqual(envFiles(mods), []);
  assert.ok(readFileSync(jkrPath(fx)).equals(jkr(PUB)), "jkr changed across a round trip");
  assert.equal(launchOf(twice), null);

  // play: launch printed per OS, state unchanged. (Mac: first without the game dir -> fallback.)
  const afterPublic = snapshot(fx.balatro);
  if (os === "mac") {
    const out = run("play", fx);
    assert.equal(launchOf(out), null);
    assert.match(out, /Start Balatro the way you usually do\./);
    assert.deepEqual(snapshot(fx.balatro), afterPublic);
    mkdirSync(fx.game, { recursive: true });
    writeFileSync(join(fx.game, "liblovely.dylib"), "");
  }
  const playOut = run("play", fx);
  assert.equal(launchOf(playOut), expectedLaunch(fx, true));
  assert.equal(statusLines(playOut).length, 1);
  assert.deepEqual(snapshot(fx.balatro), afterPublic);

  // switch,play from public: Team Tour first, then the launch, and the state stays Team Tour.
  const swPlay = run("switch,play", fx);
  assert.equal(statusLines(swPlay).length, 2);
  assert.match(statusLines(swPlay)[1], STATUS.team);
  assert.equal(launchOf(swPlay), expectedLaunch(fx, true));
  assert.deepEqual(envFiles(mods), ["multiplayer-0.5.5"]);
  // Restore public for the remaining checks.
  run("switch,quit", fx);
  assert.ok(readFileSync(jkrPath(fx)).equals(jkr(PUB)));

  if (os === "windows") {
    // The window must fit its text at 1x to 2x text size (150% display scaling is simulated with a
    // scaled font, since the display DPI cannot be changed without logging off).
    const r = spawnSync(LAUNCHER, ["--layout-check"], { encoding: "utf8" });
    assert.equal(r.status, 0, `layout check failed: ${r.stdout}${r.stderr}`);
    for (const scale of ["1", "1.25", "1.5", "2"]) assert.match(r.stdout, new RegExp(`layout ok at ${scale}x`));
  }
  rmSync(fx.root, { recursive: true, force: true });
}

// Empty and missing Mods: "not found" message, no prompt, no launch, no crash, nothing created.
for (const makeMods of [true, false]) {
  const fx = makeFixture();
  if (makeMods) mkdirSync(join(fx.balatro, "Mods"), { recursive: true });
  else mkdirSync(fx.balatro, { recursive: true });
  for (const script of ["switch,play", "play", "quit"]) {
    const out = run(script, fx);
    assert.match(out, /Could not find a current Multiplayer mod/);
    assert.doesNotMatch(out, /Done:|You are on the|LAUNCH:/);
  }
  assert.deepEqual(snapshot(fx.balatro), {});
  rmSync(fx.root, { recursive: true, force: true });
}

// A Multiplayer.json that is valid JSON with a UTF-8 byte order mark must still qualify.
{
  const fx = makeFixture();
  populate(fx, { bom: true });
  const out = run("switch,quit", fx);
  const sl = statusLines(out);
  assert.equal(sl.length, 2);
  assert.match(sl[0], STATUS.public);
  assert.match(sl[1], STATUS.team);
  rmSync(fx.root, { recursive: true, force: true });
}

// A malformed Multiplayer.json means "not Multiplayer": the not-found message, no crash, no change.
// (The truncated-but-contains-the-id variant is skipped on the Linux no-python3 fallback, which can
// only grep for the text.)
{
  const variants = [["garbage", "not json at all {{{"]];
  const pythonOk = os !== "linux" || spawnSync("python3", ["-c", "import json"]).status === 0;
  if (!extraEnv.NO_PYTHON && pythonOk && macMode !== "fallback") variants.push(["truncated", '{"id": "Multiplayer", "version": ']);
  for (const [name, json] of variants) {
    const fx = makeFixture();
    const mods = join(fx.balatro, "Mods");
    mkdirSync(join(mods, "multiplayer-broken"), { recursive: true });
    writeFileSync(join(mods, "multiplayer-broken", "Multiplayer.json"), json);
    writeFileSync(join(mods, "multiplayer-broken", "core.lua"), "MP = {}\nMP.ENV = {}\n");
    mkdirSync(join(fx.balatro, "config"), { recursive: true });
    writeFileSync(join(fx.balatro, "config", "Multiplayer.jkr"), jkr(OUR));
    const before = snapshot(fx.balatro);
    for (const script of ["switch,play", "play", "quit"]) {
      const out = run(script, fx);
      assert.match(out, /Could not find a current Multiplayer mod/, `${name} json, ${script}`);
      assert.doesNotMatch(out, /Done:|You are on the|LAUNCH:/);
    }
    assert.deepEqual(snapshot(fx.balatro), before, `${name} json: nothing may change`);
    rmSync(fx.root, { recursive: true, force: true });
  }
}

}

scenarios();
if (os === "mac") {
  // Again with osascript unable to run, which exercises the grep fallback.
  macMode = "fallback";
  scenarios();
  macMode = process.platform === "darwin" ? "real" : "emulate";
}
if (os === "linux") {
  // Again with the grep fallback used when python3 is missing.
  extraEnv = { NO_PYTHON: "1" };
  scenarios();
  extraEnv = {};
}

// Linux: the first run installs an app-menu entry and icon next to where the script lives (as if
// unzipped), re-running at the same path is silent, and moving the script rewrites the entry.
if (os === "linux") {
  const fx = makeFixture();
  populate(fx);
  const home = join(fx.root, "linuxhome");
  const entry = join(home, ".local", "share", "applications", "team-tour-launcher.desktop");
  const icon = join(home, ".local", "share", "icons", "hicolor", "256x256", "apps", "team-tour-launcher.png");
  const unzipped = (name) => {
    const dir = join(fx.root, name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(LAUNCHER, join(dir, "team-tour-launcher.sh"));
    const png = generatedEntries(join(here, "..", ".."), "linux").find((e) => e.name === "team-tour-launcher.png");
    writeFileSync(join(dir, "team-tour-launcher.png"), png.data);
    // The path the script sees for itself (bash's pwd), which differs from node's only on a Windows host.
    const seen = spawnSync("bash", ["-c", 'cd "$1" && pwd', "x", dir], { encoding: "utf8" }).stdout.trim();
    return { run: join(dir, "team-tour-launcher.sh"), seen: `${seen}/team-tour-launcher.sh` };
  };
  const runInstalled = (script) => {
    script = script.run;
    const env = { ...process.env, HOME: home, BALATRO_DIR: fx.balatro, SWITCH_CHOICE: "quit", NO_LAUNCH: "1" };
    delete env.NO_DESKTOP_INSTALL;
    const r = spawnSync("bash", [script], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };

  const first = unzipped("unzip-a");
  assert.match(runInstalled(first), /Added Team Tour Launcher to your app menu/);
  assert.ok(existsSync(entry) && existsSync(icon), "desktop entry and icon must be installed");
  const text = readFileSync(entry, "utf8");
  assert.ok(text.includes(`Exec=bash "${first.seen}"`));
  for (const line of ["Name=Team Tour Launcher", "Icon=team-tour-launcher", "Terminal=true", "Type=Application", "Categories=Game;"]) {
    assert.ok(text.split("\n").includes(line), `missing ${line}`);
  }
  assert.ok(readFileSync(icon).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "icon is a PNG");
  const validator = spawnSync("desktop-file-validate", [entry], { encoding: "utf8" });
  if (validator.error) assert.notEqual(process.env.REQUIRE_DESKTOP_VALIDATE, "1", "desktop-file-validate is required here");
  else assert.equal(validator.status, 0, `desktop-file-validate: ${validator.stdout}${validator.stderr}`);

  assert.doesNotMatch(runInstalled(first), /Added Team Tour Launcher/);
  const second = unzipped("unzip-b");
  assert.match(runInstalled(second), /Added Team Tour Launcher to your app menu/);
  assert.ok(readFileSync(entry, "utf8").includes(`Exec=bash "${second.seen}"`), "moving the script rewrites the entry");
  rmSync(fx.root, { recursive: true, force: true });
}

console.log(`launcher ${os}: all assertions passed`);
