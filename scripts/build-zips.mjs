// Zips the per-OS Team Tour Launcher files (<os>/ at the repo root) into
// dist-zips/Team-Tour-Launcher-<Os>.zip. Run by the release workflow (and by hand), so a
// tagged release carries the zips. Dependency-free (node:zlib only) and deterministic: fixed DOS
// timestamp, sorted entries, so rebuilding unchanged sources gives byte-identical zips.
import { deflateRawSync, deflateSync, inflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = [
  { dir: "mac", zip: "Team-Tour-Launcher-Mac.zip" },
  { dir: "windows", zip: "Team-Tour-Launcher-Windows.zip" },
  { dir: "linux", zip: "Team-Tour-Launcher-Linux.zip" },
];

const EXECUTABLE = /(\.(command|sh)$|\.app\/Contents\/MacOS\/[^/]+$)/;
const BAT = /\.bat$/;
const BINARY = /\.(icns|png|ico|exe)$/;
// 1980-01-01 00:00:00 in MS-DOS date/time, the zip epoch.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** .bat gets CRLF, everything else LF, whatever the checkout's autocrlf did. */
export function normalizeEol(name, data) {
  if (BINARY.test(name)) return data;
  const text = data.toString("latin1").replace(/\r\n/g, "\n");
  return Buffer.from(BAT.test(name) ? text.replace(/\n/g, "\r\n") : text, "latin1");
}

export function modeFor(name) {
  return EXECUTABLE.test(name) ? 0o755 : 0o644;
}

/** Every ancestor directory of the given file names, as "a/", "a/b/" (a .app is a directory). */
export function dirNames(names) {
  const dirs = new Set();
  for (const n of names) {
    const parts = n.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/");
  }
  return [...dirs];
}

/** entries: { name: string (ASCII, "/" separated), data: Buffer }[] -> zip Buffer. Directory entries are synthesized (mode 040755). */
export function buildZip(files) {
  const entries = [
    ...files,
    ...dirNames(files.map((f) => f.name)).map((name) => ({ name, data: Buffer.alloc(0), dir: true })),
  ];
  const sorted = entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data: raw, dir } of sorted) {
    const data = dir ? raw : normalizeEol(name, raw);
    const nameBuf = Buffer.from(name, "ascii");
    const method = dir ? 0 : 8;
    const packed = dir ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, v2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // external attrs: unix mode in the high 16 bits, MS-DOS directory flag in the low byte
    central.writeUInt32LE((((dir ? 0o040755 : 0o100000 | modeFor(name)) << 16) | (dir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Relative "/"-separated paths of every file under dir. */
function listFiles(dir, prefix) {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(dir, prefix + e.name + "/") : [prefix + e.name],
  );
}

// ---- App icon: icns with PNG entries, built from mac/icon-source.png (no dependencies). ----
export const ICON_SOURCE = "icon-source.png";
const GRAD_TOP = [0xf6, 0xd3, 0x65];
const GRAD_BOTTOM = [0xfd, 0xa0, 0x85];
const ICON_SIZES = [
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
];

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG from already-filtered scanlines (each row: filter byte + width*4 RGBA bytes). */
export function pngFromRaw(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** RGBA bytes (width*height*4) -> PNG using filter 0. */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return pngFromRaw(width, height, raw);
}

/** Decodes an 8-bit RGBA, non-interlaced PNG (all five scanline filters) -> { width, height, data }. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  const idat = [];
  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error("icon source must be 8-bit RGBA, not interlaced");
      }
    } else if (type === "IDAT") idat.push(body);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      let add;
      if (filter === 0) add = 0;
      else if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`bad PNG filter ${filter}`);
      out[y * stride + i] = (raw[src + i] + add) & 0xff;
    }
  }
  return { width, height, data: out };
}

/** Area (box) downsample of straight-alpha RGBA to dw x dh, averaged in premultiplied space. Returns premultiplied Float64 [r,g,b,a], each 0..255. */
export function resampleArea({ width: sw, height: sh, data }, dw, dh) {
  const out = new Float64Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let sy = Math.floor(y * fy); sy < Math.ceil((y + 1) * fy); sy++) {
        const wy = Math.min(sy + 1, (y + 1) * fy) - Math.max(sy, y * fy);
        for (let sx = Math.floor(x * fx); sx < Math.ceil((x + 1) * fx); sx++) {
          const w = wy * (Math.min(sx + 1, (x + 1) * fx) - Math.max(sx, x * fx));
          const i = (sy * sw + sx) * 4;
          const al = data[i + 3] / 255;
          r += data[i] * al * w;
          g += data[i + 1] * al * w;
          b += data[i + 2] * al * w;
          a += data[i + 3] * w;
          wsum += w;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / wsum;
      out[o + 1] = g / wsum;
      out[o + 2] = b / wsum;
      out[o + 3] = a / wsum;
    }
  }
  return out;
}

/** 1 inside the rounded square, else 0, at (x, y) in a unit canvas. */
function squareCoverage(x, y, margin, radius) {
  const lo = margin + radius;
  const hi = 1 - margin - radius;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = Math.min(Math.max(y, lo), hi);
  const inside = x >= margin && x <= 1 - margin && y >= margin && y <= 1 - margin;
  return inside && Math.hypot(x - cx, y - cy) <= radius ? 1 : 0;
}

/** The icon at size x size: the source art centred at 80% of a warm gradient rounded square (radius 22%). */
export function renderIconRgba(size, source) {
  const margin = 0.06;
  const side = 1 - 2 * margin;
  const radius = 0.22 * side;
  const ss = 3;
  const artSize = Math.round(side * 0.8 * size);
  const art = resampleArea(source, artSize, artSize);
  const off = Math.floor((size - artSize) / 2);
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cov = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          cov += squareCoverage((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, margin, radius);
        }
      }
      cov /= ss * ss;
      const t = Math.min(Math.max((py / size - margin) / side, 0), 1);
      const bg = GRAD_TOP.map((c, k) => c + (GRAD_BOTTOM[k] - c) * t);
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      const ax = px - off;
      const ay = py - off;
      if (ax >= 0 && ay >= 0 && ax < artSize && ay < artSize) {
        const i = (ay * artSize + ax) * 4;
        ar = art[i];
        ag = art[i + 1];
        ab = art[i + 2];
        aa = art[i + 3] / 255;
      }
      const outA = aa + cov * (1 - aa);
      const o = (py * size + px) * 4;
      if (outA > 0) {
        rgba[o] = Math.round((ar + bg[0] * cov * (1 - aa)) / outA);
        rgba[o + 1] = Math.round((ag + bg[1] * cov * (1 - aa)) / outA);
        rgba[o + 2] = Math.round((ab + bg[2] * cov * (1 - aa)) / outA);
      }
      rgba[o + 3] = Math.round(outA * 255);
    }
  }
  return rgba;
}

export function renderIconPng(size, source) {
  return encodePng(size, size, renderIconRgba(size, source));
}

/** icns: "icns" + total length, then entries of type + length + PNG (ic07 128, ic08 256, ic09 512). */
export function buildIcns(sourcePng) {
  const source = decodePng(sourcePng);
  const entries = ICON_SIZES.map(([type, size]) => {
    const png = renderIconPng(size, source);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

/**
 * ICO with 16/32/48 px BMP (DIB) entries and a 256 px PNG entry, all from the same composited
 * icon. BMP for the small sizes is the most widely compatible form (csc /win32icon, Explorer).
 */
export function buildIco(sourcePng) {
  const source = decodePng(sourcePng);
  const images = [16, 32, 48, 256].map((size) => {
    const rgba = renderIconRgba(size, source);
    if (size === 256) return { size, data: encodePng(size, size, rgba) };
    // DIB: BITMAPINFOHEADER (height doubled for the AND mask), bottom-up BGRA rows, 1bpp AND mask.
    const maskStride = Math.ceil(size / 32) * 4;
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(size * size * 4 + maskStride * size, 20);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = ((size - 1 - y) * size + x) * 4;
        const d = (y * size + x) * 4;
        pixels[d] = rgba[s + 2];
        pixels[d + 1] = rgba[s + 1];
        pixels[d + 2] = rgba[s];
        pixels[d + 3] = rgba[s + 3];
      }
    }
    return { size, data: Buffer.concat([header, pixels, Buffer.alloc(maskStride * size)]) };
  });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    dir[e] = size === 256 ? 0 : size;
    dir[e + 1] = size === 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bit count
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

export const WIN_EXE_NAME = "Team Tour Launcher.exe";
export const LINUX_ICON_NAME = "team-tour-launcher.png";

/** Where the Windows exe is read from: the committed build in windows/dist (LAUNCHER_EXE overrides, for tests). */
export function winExePath(appDir, env = process.env) {
  return env.LAUNCHER_EXE || join(appDir, "windows", "dist", WIN_EXE_NAME);
}

/** Entries generated at build time rather than checked in, per target dir. */
export function generatedEntries(appDir, dir) {
  if (dir === "linux") {
    const source = decodePng(readFileSync(join(appDir, "mac", ICON_SOURCE)));
    return [{ name: LINUX_ICON_NAME, data: renderIconPng(256, source) }];
  }
  if (dir !== "mac") return [];
  const source = readFileSync(join(appDir, "mac", ICON_SOURCE));
  return [{ name: "Team Tour Launcher.app/Contents/Resources/AppIcon.icns", data: buildIcns(source) }];
}

/** The files of one target as zip entries ("/"-separated names relative to <dir>/). Not for windows (a C# project, see windowsEntries). */
export function collectEntries(appDir, dir) {
  const srcDir = join(appDir, dir);
  // icon-source.png is the art composed into the icons, not a shipped file.
  return listFiles(srcDir, "").filter((name) => name !== ICON_SOURCE).map((name) => ({ name, data: readFileSync(join(srcDir, name)) }));
}

/**
 * The Windows zip holds the exe committed at windows/dist, built by
 * windows/Dockerfile.build (see windows/README.md). It is in git, so a missing exe is always an
 * error: silently shipping no Windows download would be worse than failing the build.
 */
export function windowsEntries(appDir, env = process.env) {
  const path = winExePath(appDir, env);
  if (!existsSync(path)) {
    throw new Error(`the Windows launcher exe is missing: ${path} (rebuild it, see windows/README.md)`);
  }
  return [{ name: WIN_EXE_NAME, data: readFileSync(path) }];
}

export function entriesFor(appDir, dir, env = process.env) {
  if (dir === "windows") return windowsEntries(appDir, env);
  return [...collectEntries(appDir, dir), ...generatedEntries(appDir, dir)];
}

export function build(appDir, env = process.env) {
  const out = join(appDir, "dist-zips");
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const { dir, zip } of TARGETS) {
    const entries = entriesFor(appDir, dir, env);
    writeFileSync(join(out, zip), buildZip(entries));
    written.push(zip);
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const icoAt = process.argv.indexOf("--ico");
  if (icoAt !== -1) {
    // Used by windows/Dockerfile.build: the exe's icon must exist before it compiles.
    const target = process.argv[icoAt + 1];
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buildIco(readFileSync(join(appDir, "mac", ICON_SOURCE))));
    console.log(`team-tour-launcher: wrote ${target}`);
  } else {
    console.log(`team-tour-launcher: wrote ${build(appDir).join(", ")}`);
  }
}
