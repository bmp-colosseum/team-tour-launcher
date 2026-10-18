import { fileURLToPath } from "node:url";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TARGETS, build, buildIco, buildIcns, buildZip, collectEntries, crc32, decodePng, encodePng, generatedEntries, pngFromRaw, windowsEntries } from "./build-zips.mjs";

// Minimal reader: walks the central directory.
function readZip(buf) {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const made = buf.readUInt16LE(p + 4);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const attr = buf.readUInt32LE(p + 38);
    const method = buf.readUInt16LE(p + 10);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("ascii", p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lxlen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lxlen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    out.push({ name, system: made >> 8, mode: (attr >>> 16) & 0o177777, crc, data });
    p += 46 + nlen;
  }
  return out;
}

const entries = [
  { name: "Use public server.sh", data: Buffer.from("echo a\r\necho b\n") },
  { name: "Use Team Tour server.command", data: Buffer.from("#!/bin/bash\necho hi\n") },
  { name: "Use Team Tour server.bat", data: Buffer.from("@echo off\necho hi\n") },
  { name: "README.txt", data: Buffer.from("plain\n") },
  { name: "X.app/Contents/Info.plist", data: Buffer.from("<plist/>\r\n") },
  { name: "X.app/Contents/MacOS/x", data: Buffer.from("#!/bin/bash\r\necho x\n") },
];
const DIRS = ["X.app/", "X.app/Contents/", "X.app/Contents/MacOS/"];

describe("buildZip", () => {
  const zip = buildZip(entries);
  const read = readZip(zip);
  const byName = Object.fromEntries(read.map((e) => [e.name, e]));

  it("contains every file plus its parent directories, sorted by name", () => {
    expect(read.map((e) => e.name)).toEqual([...entries.map((e) => e.name), ...DIRS].sort());
  });

  it.each(DIRS)("%s is a directory entry with mode 040755", (name) => {
    expect(byName[name].mode).toBe(0o040755);
    expect(byName[name].data.length).toBe(0);
  });

  it("makes the app executable 0755 and its plist 0644 with LF endings", () => {
    expect(byName["X.app/Contents/MacOS/x"].mode).toBe(0o100755);
    expect(byName["X.app/Contents/Info.plist"].mode).toBe(0o100644);
    expect(byName["X.app/Contents/Info.plist"].data.toString()).toBe("<plist/>\n");
    expect(byName["X.app/Contents/MacOS/x"].data.toString()).toBe("#!/bin/bash\necho x\n");
  });

  it.each([
    ["Use public server.sh", 0o100755],
    ["Use Team Tour server.command", 0o100755],
    ["Use Team Tour server.bat", 0o100644],
    ["README.txt", 0o100644],
  ])("%s has unix mode %o and create_system 3", (name, mode) => {
    expect(byName[name].mode).toBe(mode);
    expect(byName[name].system).toBe(3);
  });

  it("writes CRLF for .bat and LF for everything else", () => {
    expect(byName["Use Team Tour server.bat"].data.toString()).toBe("@echo off\r\necho hi\r\n");
    expect(byName["Use public server.sh"].data.toString()).toBe("echo a\necho b\n");
    expect(byName["Use Team Tour server.command"].data.toString()).toBe("#!/bin/bash\necho hi\n");
  });

  it("stores a correct CRC of the normalized content", () => {
    for (const e of read.filter((x) => !x.name.endsWith("/"))) expect(e.crc).toBe(crc32(e.data));
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("is deterministic regardless of input order", () => {
    expect(buildZip([...entries].reverse()).equals(zip)).toBe(true);
    expect(buildZip(entries).equals(zip)).toBe(true);
  });
});

describe("build", () => {
  const iconSource = fileURLToPath(new URL("../mac/icon-source.png", import.meta.url));
  function fixture() {
    const app = mkdtempSync(join(tmpdir(), "ss-"));
    for (const dir of ["mac", "linux"]) mkdirSync(join(app, dir), { recursive: true });
    mkdirSync(join(app, "mac", "A.app", "Contents"), { recursive: true });
    writeFileSync(join(app, "mac", "A.app", "Contents", "Info.plist"), "p");
    copyFileSync(iconSource, join(app, "mac", "icon-source.png"));
    writeFileSync(join(app, "linux", "x.sh"), "x\n");
    return app;
  }
  const zipOf = (app, name) => readZip(readFileSync(join(app, "dist-zips", name)));

  it("fails when the committed Windows exe is missing", () => {
    expect(() => build(fixture(), {})).toThrow(/launcher exe is missing/);
  });

  it("zips the committed exe byte-for-byte (no line-ending conversion)", () => {
    const app = fixture();
    mkdirSync(join(app, "windows", "dist"), { recursive: true });
    // Contains CR LF bytes: must not be line-ending converted.
    const bytes = Buffer.from([0x4d, 0x5a, 0x0d, 0x0a, 0x00, 0xff, 0x0d, 0x0a]);
    writeFileSync(join(app, "windows", "dist", "Team Tour Launcher.exe"), bytes);
    expect(build(app, {})).toEqual(TARGETS.map((t) => t.zip));
    const entries = zipOf(app, "Team-Tour-Launcher-Windows.zip");
    expect(entries.map((e) => e.name)).toEqual(["Team Tour Launcher.exe"]);
    expect(entries[0].data.equals(bytes)).toBe(true);
    expect(entries[0].mode).toBe(0o100644);
    expect(zipOf(app, "Team-Tour-Launcher-Mac.zip")).toHaveLength(7);
    // Linux ships the script plus the 256px icon.
    expect(zipOf(app, "Team-Tour-Launcher-Linux.zip").map((e) => e.name).sort()).toEqual(["team-tour-launcher.png", "x.sh"]);
  });

  it("LAUNCHER_EXE overrides the committed path", () => {
    const app = fixture();
    const other = join(app, "other.exe");
    writeFileSync(other, Buffer.from([1, 2, 3]));
    build(app, { LAUNCHER_EXE: other });
    expect(zipOf(app, "Team-Tour-Launcher-Windows.zip")[0].data.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("the real committed exe exists, is a Windows executable and is what gets zipped", () => {
    const real = fileURLToPath(new URL("..", import.meta.url));
    const [entry] = windowsEntries(real, {});
    expect(entry.name).toBe("Team Tour Launcher.exe");
    expect(entry.data.subarray(0, 2).toString("ascii")).toBe("MZ");
    expect(entry.data.length).toBeGreaterThan(10_000);
  });
});

describe("ico", () => {
  const appDir = fileURLToPath(new URL("..", import.meta.url));
  const ico = buildIco(readFileSync(join(appDir, "mac", "icon-source.png")));
  const count = ico.readUInt16LE(4);
  const entries = Array.from({ length: count }, (_, i) => {
    const e = 6 + 16 * i;
    const size = ico.readUInt32LE(e + 8);
    const offset = ico.readUInt32LE(e + 12);
    return { w: ico[e] || 256, h: ico[e + 1] || 256, bits: ico.readUInt16LE(e + 6), data: ico.subarray(offset, offset + size) };
  });

  it("has an ICO header with 16, 32, 48 and 256 px entries", () => {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(entries.map((e) => [e.w, e.h])).toEqual([[16, 16], [32, 32], [48, 48], [256, 256]]);
    expect(entries.every((e) => e.bits === 32)).toBe(true);
  });

  it("entries tile the file with no gaps", () => {
    expect(6 + 16 * count + entries.reduce((n, e) => n + e.data.length, 0)).toBe(ico.length);
  });

  it.each([[0, 16], [1, 32], [2, 48]])("entry %i is a %ipx 32-bit DIB with an AND mask", (i, size) => {
    const d = entries[i].data;
    expect(d.readUInt32LE(0)).toBe(40);
    expect(d.readInt32LE(4)).toBe(size);
    expect(d.readInt32LE(8)).toBe(size * 2);
    expect(d.readUInt16LE(14)).toBe(32);
    expect(d.length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
  });

  it("the 256 px entry is a 256px PNG", () => {
    const png = entries[3].data;
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
  });

  it("DIB rows are bottom-up BGRA: the bottom-left pixel is transparent, the centre is opaque", () => {
    const d = entries[2].data; // 48px
    const px = (x, yFromTop) => d.subarray(40 + ((47 - yFromTop) * 48 + x) * 4, 40 + ((47 - yFromTop) * 48 + x) * 4 + 4);
    expect(px(0, 47)[3]).toBe(0);
    expect(px(24, 8)[3]).toBe(255);
  });

  it("is deterministic", () => {
    expect(buildIco(readFileSync(join(appDir, "mac", "icon-source.png"))).equals(ico)).toBe(true);
  });
});

describe("zip names", () => {
  it("are the Team Tour Launcher names", () => {
    expect(TARGETS.map((t) => t.zip)).toEqual([
      "Team-Tour-Launcher-Mac.zip",
      "Team-Tour-Launcher-Windows.zip",
      "Team-Tour-Launcher-Linux.zip",
    ]);
  });
});

describe("icon", () => {
  const appDir = fileURLToPath(new URL("..", import.meta.url));
  const sourcePng = readFileSync(join(appDir, "mac", "icon-source.png"));
  const icns = buildIcns(sourcePng);
  const entries = [];
  for (let p = 8; p < icns.length; ) {
    const len = icns.readUInt32BE(p + 4);
    entries.push({ type: icns.toString("ascii", p, p + 4), png: icns.subarray(p + 8, p + len) });
    p += len;
  }
  const alphaAt = (png, x, y) => {
    const { width, data } = decodePng(png);
    return data[(y * width + x) * 4 + 3];
  };

  it("is an icns with ic07, ic08 and ic09 PNG entries and a consistent length", () => {
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(entries.map((e) => e.type)).toEqual(["ic07", "ic08", "ic09"]);
  });

  it.each([
    [0, 128],
    [1, 256],
    [2, 512],
  ])("entry %i is a valid %ipx RGBA PNG", (i, size) => {
    const png = entries[i].png;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(png[25]).toBe(6);
    const decoded = decodePng(png);
    expect([decoded.width, decoded.height]).toEqual([size, size]);
  });

  it("has transparent corners, an opaque warm background and dark art in the middle", () => {
    const png = entries[1].png;
    expect(alphaAt(png, 0, 0)).toBe(0);
    expect(alphaAt(png, 128, 40)).toBe(255);
    const { width, data } = decodePng(png);
    const px = (x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];
    const bg = px(128, 24);
    expect(bg[0]).toBeGreaterThan(200); // warm, light
    // Some pixel in the art area is near black (the pizza outline).
    let dark = false;
    for (let y = 40; y < 216 && !dark; y++) for (let x = 40; x < 216; x++) if (px(x, y)[0] < 40) { dark = true; break; }
    expect(dark).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildIcns(sourcePng).equals(icns)).toBe(true);
  });

  it("decodes every PNG scanline filter back to the original pixels", () => {
    const w = 5;
    const h = 5;
    const pixels = Buffer.alloc(w * h * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + 11) & 0xff;
    const stride = w * 4;
    const raw = Buffer.alloc(h * (stride + 1));
    for (let y = 0; y < h; y++) {
      const filter = y % 5;
      raw[y * (stride + 1)] = filter;
      for (let i = 0; i < stride; i++) {
        const cur = pixels[y * stride + i];
        const a = i >= 4 ? pixels[y * stride + i - 4] : 0;
        const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
        const c = i >= 4 && y > 0 ? pixels[(y - 1) * stride + i - 4] : 0;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        const pred = [0, a, b, (a + b) >> 1, paeth][filter];
        raw[y * (stride + 1) + 1 + i] = (cur - pred) & 0xff;
      }
    }
    const decoded = decodePng(pngFromRaw(w, h, raw));
    expect(decoded.data.equals(pixels)).toBe(true);
    expect(decodePng(encodePng(w, h, pixels)).data.equals(pixels)).toBe(true);
  });

  it("rejects a PNG that is not 8-bit RGBA", () => {
    const png = Buffer.from(encodePng(1, 1, Buffer.from([1, 2, 3, 4])));
    png[25] = 2; // colour type RGB
    expect(() => decodePng(png)).toThrow(/RGBA/);
  });

  it("generated entries: icns for Mac, 256px PNG for Linux, none for Windows, and the source art is not shipped", () => {
    expect(generatedEntries(appDir, "mac").map((e) => e.name)).toEqual(["Team Tour Launcher.app/Contents/Resources/AppIcon.icns"]);
    expect(generatedEntries(appDir, "windows")).toEqual([]);
    expect(generatedEntries(appDir, "linux").map((e) => e.name)).toEqual(["team-tour-launcher.png"]);
    expect(collectEntries(appDir, "mac").some((e) => e.name.endsWith("icon-source.png"))).toBe(false);
  });

  it("ships in the built Mac zip untouched (binary, mode 0644) and the plist names it", () => {
    const app = mkdtempSync(join(tmpdir(), "ss-icon-"));
    for (const { dir } of TARGETS) mkdirSync(join(app, dir), { recursive: true });
    writeFileSync(join(app, "mac", "icon-source.png"), sourcePng);
    build(app, { LAUNCHER_EXE: join(appDir, "windows", "dist", "Team Tour Launcher.exe") });
    const read = readZip(readFileSync(join(app, "dist-zips", "Team-Tour-Launcher-Mac.zip")));
    const icon = read.find((e) => e.name.endsWith("AppIcon.icns"));
    expect(icon.mode).toBe(0o100644);
    expect(icon.data.equals(icns)).toBe(true);
    const plist = collectEntries(appDir, "mac").find((e) => e.name.endsWith("Info.plist"));
    expect(plist.data.toString()).toContain("<string>AppIcon</string>");
  });
});

describe("real launcher sources", () => {
  const appDir = fileURLToPath(new URL("..", import.meta.url));
  it.each([
    ["mac", ["Team Tour Launcher.app/Contents/Info.plist", "Team Tour Launcher.app/Contents/MacOS/team-tour-launcher"]],
    ["linux", ["team-tour-launcher.sh"]],
  ])("%s ships exactly one switch", (dir, files) => {
    expect(collectEntries(appDir, dir).map((e) => e.name).sort()).toEqual(files);
  });

  it("Mac bundle: executable 0755, plist 0644, plist names the executable", () => {
    const entries = collectEntries(appDir, "mac");
    const read = readZip(buildZip(entries));
    const byName = Object.fromEntries(read.map((e) => [e.name, e]));
    const base = "Team Tour Launcher.app/Contents/";
    expect(byName[base + "MacOS/team-tour-launcher"].mode).toBe(0o100755);
    expect(byName[base + "Info.plist"].mode).toBe(0o100644);
    expect(byName[base + "Info.plist"].data.toString()).toContain("<string>team-tour-launcher</string>");
    expect(buildZip(entries).equals(buildZip([...entries].reverse()))).toBe(true);
  });
});
