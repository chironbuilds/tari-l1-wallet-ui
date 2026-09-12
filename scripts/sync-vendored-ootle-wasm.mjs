// npm's `overrides` doesn't reliably dedupe a `file:` dependency into nested node_modules trees
// (confirmed: `@tari-project/ootle`'s own `@tari-project/ootle-wasm` dependency still nests a
// real-registry copy under node_modules/@tari-project/ootle/node_modules/... even with a matching
// override). Rather than fight npm's resolution algorithm, this runs after every install and
// directly overwrites any nested copy with the vendored one, so the wallet never silently ships two
// different wasm binaries — one carrying the confidential-transfer patch, one not.
import { existsSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(root, "vendor", "ootle-wasm-patched");

function findNestedCopies(dir, depth = 0) {
  if (depth > 6) return [];
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (entry.name === "ootle-wasm" && full !== join(root, "node_modules", "@tari-project", "ootle-wasm")) {
      if (existsSync(join(full, "ootle_wasm_bg.wasm"))) found.push(full);
    }
    if (entry.name === "node_modules" || entry.name.startsWith("@") || entry.name === ".bin") {
      found.push(...findNestedCopies(full, depth + 1));
    }
  }
  return found;
}

const nodeModules = join(root, "node_modules");
if (existsSync(nodeModules) && existsSync(vendorDir)) {
  const nested = findNestedCopies(nodeModules);
  for (const dir of nested) {
    for (const file of ["ootle_wasm.js", "ootle_wasm_bg.js", "ootle_wasm_bg.wasm", "ootle_wasm.d.ts", "ootle_wasm_bg.wasm.d.ts"]) {
      const src = join(vendorDir, file);
      if (existsSync(src)) cpSync(src, join(dir, file));
    }
    console.log(`[sync-vendored-ootle-wasm] synced vendor build into ${dir}`);
  }
}
