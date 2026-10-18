// Stand-in for the macOS `osascript -l JavaScript -e <script> <file>` call the Mac launcher uses to
// read Multiplayer.json, so the launcher can be tested on a non-Mac host: prints the top-level
// string "id" (or an empty line), exit 0, the way the real script does.
import { readFileSync } from "node:fs";
const file = process.argv[process.argv.length - 1];
let id = "";
try {
  const data = JSON.parse(readFileSync(file, "utf8").replace(String.fromCharCode(0xfeff), ""));
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.id === "string") id = data.id;
} catch {
  // not JSON: empty id
}
console.log(id);
