// The boundary checker's PURE CORE. No filesystem, no imports beyond types.
//
// Deferred by Build Order 2 section 4 because it "protect[s] properties of
// product code that did not exist when they were written". That code now
// exists, so the deferral lapsed and King B ruled this the arc on 2026-08-16.
//
// Separated from the I/O shell deliberately. A checker testable only by editing
// real source is one whose failure modes nobody exercises, so the analysis is a
// pure function of a graph and the graph is built elsewhere.
//
// ===========================================================================
// FINDINGS CLOSED HERE, and one of them was live in this checker's own first
// version. Recorded rather than quietly fixed.
// ===========================================================================
//
// X1, CRITICAL. v4's properties bound only edges TARGETING `src/`, so
//     `import pg from "pg"` inside `agents/` was invisible and I5 read as
//     enforced with a driver one import away. Every edge is classified now,
//     including those leaving the project.
//
// X2, CRITICAL, AND THE FIRST VERSION OF THIS FILE COMMITTED IT. Criterion 2
//     requires each pool to assert `current_user` at runtime; T1.5 puts that
//     proof in `scripts/`; P3 named `orchestrator/apply/` as the only permitted
//     importer of the write pool. The gate lists three exits and says all three
//     fail: drop the assertion, add the import, or "carve a silent exception
//     into the checker being written in the same phase."
//     **The first version walked `src/` only, which IS that third exit.** Seven
//     proof scripts import the write pool and not one was visible to it.
//     Fixed as the gate prescribes: P3 is now a PERMITTED-IMPORTER LIST, and
//     the shell walks the whole project so the list is load-bearing rather than
//     decorative.
//
// X6, HIGH. Read literally, P2 forbade `domain/` from importing itself and P3
//     forbade `persistence/write/` from importing itself. Phase 2's state
//     machine will not be one file. Intra-directory edges are carved out below,
//     restoring the carve-out v3 carried and v4's rewrite dropped.
//
// X12, MEDIUM. No invariant asserted governance purity; it lived in a comment
//     in `src/governance/index.ts`, a guarantee existing only in prose.
//     It is a named property here.
//
// X13, MEDIUM. P3 is direct-import only while P1 is transitive, so `apply/`
//     could lawfully re-export `writePool` and hand `api/` the raw pool with
//     every property green. P3 is a path guarantee; the single-write-path claim
//     needs an AUTHORITY guarantee, which is R1 below.
//
// X14, MEDIUM. The recorded-behavior list omitted the four cases that decide
//     whether P1-P3 hold: package/builtin imports, files outside `src/`,
//     intra-directory imports, and dynamic `import()`. All four are covered,
//     and `LIMITS` at the foot of this file states what remains invisible,
//     stated WHERE THE CLAIM IS MADE rather than only in AMENDMENTS.

export type EdgeKind = "relative" | "package" | "builtin";

export type Edge = {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  // verbatimModuleSyntax is set precisely so this is syntactically decidable
  // (v4 W21). A type-only edge is ERASED at runtime and cannot carry execution,
  // so P1 must ignore it. P3 still counts it, because coupling is not reach.
  readonly typeOnly: boolean;
  readonly dynamic: boolean;
};

export type ModuleGraph = {
  readonly files: readonly string[];
  readonly edges: readonly Edge[];
  readonly entryWriters: readonly string[];
  readonly applyExports: readonly string[];
  // Re-export statements in orchestrator/apply, for X13's authority guarantee.
  readonly applyReExports: readonly string[];
};

export type Violation = {
  readonly property: string;
  readonly detail: string;
  readonly path?: readonly string[];
};

const under = (file: string, dir: string): boolean => file.startsWith(dir);

const AGENTS = "src/agents/";
const DOMAIN = "src/domain/";
const GOVERNANCE = "src/governance/";
const WRITE = "src/persistence/write/";
const APPLY = "src/orchestrator/apply/";

// ===========================================================================
// X2's FIX. The permitted-importer list for the write pool.
//
// An ALLOWLIST, per the standing rule in AMENDMENTS: "A denylist only blocks
// the edges someone thought to enumerate. Allowlists are complete by
// construction: everything not permitted is forbidden, including the paths
// nobody thought of."
//
// Every entry is justified. A reader can audit this list; nobody can audit a
// directory the checker silently never walked.
// ===========================================================================
export const WRITE_POOL_IMPORTERS: readonly { readonly path: string; readonly why: string }[] = [
  { path: APPLY, why: "the single write path; the whole point of P3" },
  { path: WRITE, why: "intra-directory, X6: a module may import its own siblings" },
  {
    path: "scripts/b1-connection-proof.ts",
    why: "criterion 2 REQUIRES asserting current_user on the write pool, and W15 says proving hms_rw cannot write does not prove the write path IS hms_rw. This is the finding X2 exists for.",
  },
  { path: "scripts/b2-invariant-proof.ts", why: "attempts the five rejections AS hms_rw; a mocked pool would prove nothing about a grant" },
  { path: "scripts/b3-demo-moment.ts", why: "teardown of the pool it drove through orchestrator/apply" },
  { path: "scripts/b3-invariant-proof.ts", why: "teardown" },
  { path: "scripts/b4-close-of-day-proof.ts", why: "teardown" },
  { path: "scripts/b5-transport-proof.ts", why: "teardown" },
  { path: "scripts/b6-console-proof.ts", why: "teardown" },
];

const permittedWriteImporter = (file: string): boolean =>
  WRITE_POOL_IMPORTERS.some((p) => (p.path.endsWith("/") ? under(file, p.path) : file === p.path));

// ===========================================================================
// The same treatment for CO-2, and it was found the same way: widening the
// walk to the whole project immediately surfaced six proof scripts writing to
// `entries` directly. The first version could not see them.
//
// They write as hms_ddl to SEED and TEAR DOWN fixtures. That is legitimate and
// unavoidable: `served` and `noshow` cannot be reached through the state
// machine without a dozen operations that prove nothing about the property
// under test, and teardown needs DELETE, which hms_rw is denied by B2's revoke.
//
// So CO-2's honest claim is narrower than "nothing else writes to entries". It
// is: **no APPLICATION code writes to entries except the governed write, and
// these named fixtures do, as hms_ddl, for setup and teardown only.** An
// allowlist states that; a directory nobody walks only hides it.
// ===========================================================================
export const ENTRY_WRITERS_PERMITTED: readonly { readonly path: string; readonly why: string }[] = [
  { path: APPLY, why: "the governed write; every application write goes here" },
  { path: "scripts/b2-invariant-proof.ts", why: "fixture teardown as hms_ddl; hms_rw cannot DELETE by design" },
  { path: "scripts/b3-demo-moment.ts", why: "fixture teardown as hms_ddl" },
  { path: "scripts/b3-invariant-proof.ts", why: "fixture teardown as hms_ddl" },
  { path: "scripts/b4-close-of-day-proof.ts", why: "seeds all seven statuses directly; reaching served and noshow through the machine would prove nothing about close of day" },
  { path: "scripts/b5-transport-proof.ts", why: "fixture teardown as hms_ddl" },
  { path: "scripts/b6-console-proof.ts", why: "fixture teardown as hms_ddl" },
];

const permittedEntryWriter = (file: string): boolean =>
  ENTRY_WRITERS_PERMITTED.some((p) => (p.path.endsWith("/") ? under(file, p.path) : file === p.path));

// Intra-directory: same immediate directory. X6's carve-out.
function sameDirectory(a: string, b: string): boolean {
  const dir = (p: string): string => p.slice(0, p.lastIndexOf("/") + 1);
  return dir(a) === dir(b);
}

function reachableFrom(graph: ModuleGraph, start: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const queue: { file: string; path: string[] }[] = [{ file: start, path: [start] }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const edge of graph.edges) {
      if (edge.from !== current.file) continue;
      if (edge.typeOnly) continue;
      if (edge.kind !== "relative") continue;
      if (found.has(edge.to)) continue;
      const path = [...current.path, edge.to];
      found.set(edge.to, path);
      queue.push({ file: edge.to, path });
    }
  }
  return found;
}

export function checkBoundaries(graph: ModuleGraph): readonly Violation[] {
  const violations: Violation[] = [];

  // --- P1. Agents cannot reach a write path, TRANSITIVELY. ----------------
  for (const file of graph.files.filter((f) => under(f, AGENTS))) {
    for (const [target, path] of reachableFrom(graph, file)) {
      if (under(target, WRITE) || under(target, APPLY)) {
        violations.push({
          property: "P1",
          detail: `${file} can reach the write path at ${target}`,
          path,
        });
      }
    }
  }

  // --- P2. domain/ imports nothing from src/, EXCEPT its own siblings. ----
  // X6: the carve-out v3 carried and v4's rewrite dropped. Without it, a
  // multi-file state machine is a violation by construction.
  for (const edge of graph.edges) {
    if (!under(edge.from, DOMAIN)) continue;
    if (edge.kind !== "relative") continue;
    if (sameDirectory(edge.from, edge.to)) continue;
    violations.push({
      property: "P2",
      detail: `${edge.from} imports ${edge.to}; domain may depend on nothing but its own siblings`,
    });
  }

  // --- P3. persistence/write/ is imported only by PERMITTED importers. ----
  for (const edge of graph.edges) {
    if (edge.kind !== "relative") continue;
    if (!under(edge.to, WRITE)) continue;
    if (permittedWriteImporter(edge.from)) continue;
    violations.push({
      property: "P3",
      detail:
        `${edge.from} imports ${edge.to} and is not on the permitted-importer list. ` +
        `Add it to WRITE_POOL_IMPORTERS with a justification, or route through orchestrator/apply.`,
    });
  }

  // --- X1. Edges that do NOT target src/ are bound too. -------------------
  for (const edge of graph.edges) {
    const isPure =
      under(edge.from, AGENTS) || under(edge.from, DOMAIN) || under(edge.from, GOVERNANCE);
    if (!isPure) continue;
    if (edge.kind === "relative") continue;
    if (edge.typeOnly) continue;
    violations.push({
      property: "X1",
      detail:
        `${edge.from} imports the ${edge.kind} "${edge.to}". ` +
        `agents/, domain/ and governance/ must import no external package and no node builtin.`,
    });
  }

  // --- X12. Governance purity, as a PROPERTY rather than a comment. -------
  // The claim previously existed only as "Pure by design" in a header. A
  // guarantee living in prose is a guarantee nobody checks.
  for (const edge of graph.edges) {
    if (!under(edge.from, GOVERNANCE)) continue;
    if (edge.typeOnly) continue;
    if (edge.kind !== "relative") continue;
    if (sameDirectory(edge.from, edge.to)) continue;
    if (under(edge.to, DOMAIN)) continue;
    violations.push({
      property: "X12",
      detail:
        `${edge.from} imports ${edge.to} at runtime. governance/ decides and formats; ` +
        `it does not write, and it may reach only domain/ and its own siblings.`,
    });
  }

  // --- R1 / X13. The AUTHORITY guarantee. --------------------------------
  // P3 is a path guarantee: it says who may import the write pool. It does NOT
  // stop a permitted importer handing the pool onward, which would give any
  // module the raw pool with every path property still green.
  for (const target of graph.applyReExports) {
    if (under(target, WRITE)) {
      violations.push({
        property: "R1",
        detail: `orchestrator/apply re-exports from ${target}, handing the write path onward`,
      });
    }
  }
  for (const name of graph.applyExports) {
    if (/^(writePool|readPool|pool|client|db|connection)$/i.test(name)) {
      violations.push({
        property: "R1",
        detail: `orchestrator/apply exports "${name}", which reads as a pool or client`,
      });
    }
  }

  // --- CO-2. Only orchestrator/apply writes to entries. -------------------
  for (const file of graph.entryWriters) {
    if (permittedEntryWriter(file)) continue;
    violations.push({
      property: "CO-2",
      detail:
        `${file} writes to the entries table and is not a permitted writer. ` +
        `Route it through a named operation in orchestrator/apply, or add it to ` +
        `ENTRY_WRITERS_PERMITTED with a justification.`,
    });
  }

  if (graph.applyExports.includes("applyStatusChange")) {
    violations.push({
      property: "CO-2",
      detail:
        "applyStatusChange is exported. The governed write must stay unexported, " +
        "or every named operation becomes optional.",
    });
  }

  return violations;
}

// ===========================================================================
// X14's FIX. What this checker CANNOT see, stated where the claim is made.
//
// The gate's complaint was that AMENDMENTS concedes the dynamic-import gap in a
// standing rule while section 3.3 claims tier C without restating it. A limit
// recorded somewhere else is a limit the reader of the claim does not have.
// ===========================================================================
export const LIMITS: readonly string[] = [
  "Dynamic import() is caught ONLY when its specifier is a literal string. import(someVariable) " +
    "is invisible, and no static scan can see it.",
  "require() built from a runtime string is invisible for the same reason.",
  "Reflection, eval, and globalThis lookups are invisible.",
  "The checker reads source text, not the emitted graph. A build step that rewrote imports " +
    "would invalidate every result here.",
  "CO-2 detects writes to entries by SQL text match. A write assembled from fragments, or issued " +
    "through a query builder, would not match.",
  "Proportionality, per the standing rule: for a solo build with no adversary inside the repo, " +
    "static coverage is proportionate. This is a real gap, written down rather than implied away.",
];
