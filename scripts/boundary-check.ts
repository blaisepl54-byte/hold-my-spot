// The boundary checker's I/O shell. Builds a module graph from src/ and hands
// it to the pure core.
//
// SCOPE. It binds src/, scripts/, tests/ and db/ -- the WHOLE project.
//
// The first version walked `src/` only. That was X2's third exit, "carve a
// silent exception into the checker being written in the same phase", and it
// hid seven proof scripts that import the write pool. A checker that cannot see
// a directory cannot be audited over it, and the fix is a permitted-importer
// ALLOWLIST in the core, not a smaller walk.
//
// Exit code is 1 on any violation, so this is CI-able as it stands.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";

import {
  ENTRY_WRITERS_PERMITTED,
  LIMITS,
  WRITE_POOL_IMPORTERS,
  checkBoundaries,
} from "./boundary-core.ts";
import type { Edge, ModuleGraph } from "./boundary-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
// Every directory carrying project code. node_modules and .git are not walked.
const SCANNED = ["src", "scripts", "tests", "db"];

const NODE_BUILTIN = /^node:/;

async function listTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...(await listTs(full)));
    else if (item.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const posix = (p: string): string => p.split("\\").join("/");

// Matches static imports, re-exports, and dynamic import(). Deliberately
// regex-based rather than a full parser: the repo sets erasableSyntaxOnly and
// verbatimModuleSyntax, so import forms here are a small, syntactically
// decidable set. A parser would be the right call the moment that stops being
// true, and this comment is the marker for when it does.
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function classify(spec: string): Edge["kind"] {
  if (spec.startsWith(".") || spec.startsWith("/")) return "relative";
  if (NODE_BUILTIN.test(spec)) return "builtin";
  return "package";
}

async function buildGraph(): Promise<ModuleGraph> {
  const absolute: string[] = [];
  for (const dir of SCANNED) absolute.push(...(await listTs(join(ROOT, dir))));
  const files = absolute.map((f) => posix(relative(ROOT, f)));
  const edges: Edge[] = [];
  const entryWriters: string[] = [];
  let applyExports: string[] = [];
  let applyReExports: string[] = [];

  for (const abs of absolute) {
    const rel = posix(relative(ROOT, abs));
    const source = await readFile(abs, "utf8");

    // Strip block and line comments so a specifier mentioned in prose is not
    // read as an edge. This file's own header would otherwise flag itself.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(code)) !== null) {
      const spec = match[2] ?? match[3] ?? match[4];
      if (spec === undefined) continue;
      const kind = classify(spec);
      const to =
        kind === "relative" ? posix(relative(ROOT, resolve(dirname(abs), spec))) : spec;
      edges.push({
        from: rel,
        to,
        kind,
        typeOnly: match[1] !== undefined,
        // Group 4 is the dynamic import() form. Caught only when the specifier
        // is a literal; see LIMITS.
        dynamic: match[4] !== undefined,
      });
    }

    // A write to entries, in any of the three forms that move a place in line.
    if (/\b(INSERT\s+INTO\s+entries|UPDATE\s+entries|DELETE\s+FROM\s+entries)\b/i.test(code)) {
      entryWriters.push(rel);
    }

    if (rel === "src/orchestrator/apply/index.ts") {
      applyReExports = [...code.matchAll(/export\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g)]
        .map((m) => posix(relative(ROOT, resolve(dirname(abs), m[1] ?? ""))));
      applyExports = [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|type)\s+(\w+)/g)]
        .map((m) => m[1] ?? "")
        .filter((n) => n !== "");
    }
  }

  return { files, edges, entryWriters, applyExports, applyReExports };
}

async function main(): Promise<void> {
  const graph = await buildGraph();
  const violations = checkBoundaries(graph);

  console.log(`boundary check over ${String(graph.files.length)} files, ${String(graph.edges.length)} edges\n`);

  const properties = [
    ["P1", "agents/ cannot reach a write path, transitively"],
    ["P2", "domain/ imports nothing from src/"],
    ["P3", "persistence/write/ is imported only by permitted importers"],
    ["X1", "agents/, domain/, governance/, synthetic/ import no package and no node builtin"],
    ["X12", "governance/ reaches only domain/ and its own siblings"],
    ["R1", "orchestrator/apply/ hands no pool or client onward"],
    ["CO-2", "only orchestrator/apply/ writes to entries, and the governed write stays unexported"],
  ];

  for (const [key, description] of properties) {
    const hits = violations.filter((v) => v.property === key);
    console.log(`[${hits.length === 0 ? "PASS" : "FAIL"}] ${String(key).padEnd(5)} ${String(description)}`);
    for (const hit of hits) {
      console.log(`         ${hit.detail}`);
      if (hit.path !== undefined) console.log(`         path: ${hit.path.join(" -> ")}`);
    }
  }

  // X2's allowlist is printed in full. A permitted importer that nobody can see
  // is the same hole as a directory nobody walks.
  console.log(`\npermitted importers of the write pool, ${String(WRITE_POOL_IMPORTERS.length)} entries:`);
  for (const p of WRITE_POOL_IMPORTERS) {
    console.log(`  ${p.path.padEnd(32)} ${p.why}`);
  }

  // X14's fix: the limits are stated WHERE THE CLAIM IS MADE, not only in
  // AMENDMENTS. A reader of this output should not have to go looking for what
  // it cannot see.
  console.log("\nwhat this check CANNOT see:");
  for (const limit of LIMITS) {
    console.log(`  - ${limit}`);
  }

  console.log(
    violations.length === 0
      ? "\nAll boundary properties hold."
      : `\n${String(violations.length)} VIOLATION(S).`,
  );
  if (violations.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
