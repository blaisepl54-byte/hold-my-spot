// Boundary checker tests.
//
// EVERY PROPERTY IS PROVEN CAPABLE OF FAILING. A checker that has only ever
// returned green is indistinguishable from a checker that returns green
// unconditionally, and this repo has already shipped one guarantee that read as
// present and was unreachable. Each test below constructs a graph that MUST
// violate exactly one property, and asserts it is caught.
//
// Synthetic graphs, no filesystem. That is why the core is separated from the
// shell: these failure modes can be exercised without editing real source.

import { test } from "node:test";
import assert from "node:assert/strict";

import { LIMITS, checkBoundaries } from "../scripts/boundary-core.ts";
import type { Edge, ModuleGraph } from "../scripts/boundary-core.ts";

function graph(partial: Partial<ModuleGraph>): ModuleGraph {
  return {
    files: partial.files ?? [],
    edges: partial.edges ?? [],
    entryWriters: partial.entryWriters ?? [],
    applyExports: partial.applyExports ?? [],
    applyReExports: partial.applyReExports ?? [],
  };
}

function edge(from: string, to: string, kind: Edge["kind"], typeOnly = false): Edge {
  return { from, to, kind, typeOnly, dynamic: false };
}

const AGENT = "src/agents/index.ts";
const APPLY = "src/orchestrator/apply/index.ts";
const WRITE = "src/persistence/write/index.ts";
const DOMAIN = "src/domain/index.ts";

function properties(violations: readonly { property: string }[]): string[] {
  return [...new Set(violations.map((v) => v.property))].sort();
}

// --- a clean graph ---------------------------------------------------------

test("a conforming graph produces no violations", () => {
  const result = checkBoundaries(
    graph({
      files: [AGENT, APPLY, WRITE, DOMAIN],
      edges: [edge(APPLY, WRITE, "relative"), edge(APPLY, DOMAIN, "relative")],
      entryWriters: [APPLY],
      applyExports: ["joinQueue", "callNext"],
    }),
  );
  assert.deepEqual(result, []);
});

// --- P1, and the transitive half that review cannot see --------------------

test("P1 catches an agent reaching the write path DIRECTLY", () => {
  const result = checkBoundaries(
    graph({ files: [AGENT], edges: [edge(AGENT, WRITE, "relative")] }),
  );
  // P3 fires too, and correctly: one bad import is both a reachability failure
  // and an ownership failure. Asserting only P1 would have hidden that.
  assert.deepEqual(properties(result), ["P1", "P3"]);
});

test("P1 catches a THREE-HOP path, which is the case review misses", () => {
  const helper = "src/tools/whatsapp/index.ts";
  const mid = "src/tools/whatsapp/simulated.ts";
  const result = checkBoundaries(
    graph({
      files: [AGENT],
      edges: [
        edge(AGENT, helper, "relative"),
        edge(helper, mid, "relative"),
        edge(mid, WRITE, "relative"),
      ],
    }),
  );
  const p1 = result.filter((v) => v.property === "P1");
  assert.equal(p1.length, 1, "the agent is reported once, not once per hop");
  // The full path is reported, not just the endpoints. "agents can reach the
  // write path" is unactionable; naming the three hops is what gets it fixed.
  assert.deepEqual(p1[0]?.path, [AGENT, helper, mid, WRITE]);
});

test("P1 and P3 treat a type-only edge DIFFERENTLY, and that is deliberate", () => {
  // This is why the spec mandates verbatimModuleSyntax (W21): the distinction
  // is syntactically decidable, so the checker can be precise rather than
  // conservative. The two properties then ask different questions:
  //
  //   P1 is REACHABILITY. Can execution get from agents/ to a write path? A
  //      type import is erased, so it carries nothing, and P1 must ignore it or
  //      it would report a runtime danger that cannot occur.
  //   P3 is OWNERSHIP. Who may depend on persistence/write at all? A type-only
  //      import still means agents/ knows the module exists and is coupled to
  //      its shape, so P3 fires.
  //
  // Collapsing them would lose a real distinction in one direction or the
  // other: either false alarms on erased edges, or silent coupling.
  const result = checkBoundaries(
    graph({ files: [AGENT], edges: [edge(AGENT, WRITE, "relative", true)] }),
  );
  assert.deepEqual(properties(result), ["P3"], "P1 silent, P3 fires");
});

// --- P2 --------------------------------------------------------------------

test("P2 catches domain importing anything from src/", () => {
  const result = checkBoundaries(
    graph({ files: [DOMAIN], edges: [edge(DOMAIN, "src/governance/index.ts", "relative")] }),
  );
  assert.deepEqual(properties(result), ["P2"]);
});

// --- P3 --------------------------------------------------------------------

test("P3 catches a module other than apply/ importing the write pool", () => {
  const api = "src/api/index.ts";
  const result = checkBoundaries(
    graph({ files: [api, WRITE], edges: [edge(api, WRITE, "relative")] }),
  );
  assert.deepEqual(properties(result), ["P3"]);
});

test("P3 permits orchestrator/apply, which is the one module that may", () => {
  const result = checkBoundaries(
    graph({ files: [APPLY, WRITE], edges: [edge(APPLY, WRITE, "relative")] }),
  );
  assert.deepEqual(result, []);
});

// --- X1, THE CRITICAL THIS CLOSES ------------------------------------------

test("X1 catches `pg` imported from agents/, the exact case the finding names", () => {
  // Under v4's original formulation the three properties bound only edges
  // TARGETING src/, so this edge was invisible and I5 read as enforced while a
  // database driver sat one import away.
  const result = checkBoundaries(
    graph({ files: [AGENT], edges: [edge(AGENT, "pg", "package")] }),
  );
  assert.deepEqual(properties(result), ["X1"]);
  assert.match(String(result[0]?.detail), /pg/);
});

test("X1 catches a node builtin in a pure directory", () => {
  const result = checkBoundaries(
    graph({ files: [DOMAIN], edges: [edge(DOMAIN, "node:crypto", "builtin")] }),
  );
  assert.deepEqual(properties(result), ["X1"]);
});

test("X1 permits a TYPE-ONLY package import, which compiles to nothing", () => {
  const result = checkBoundaries(
    graph({ files: [DOMAIN], edges: [edge(DOMAIN, "pg", "package", true)] }),
  );
  assert.deepEqual(result, [], "an erased import cannot make a pure module impure at runtime");
});

test("X1 does NOT bind directories that are allowed to reach outward", () => {
  const result = checkBoundaries(
    graph({ files: [APPLY], edges: [edge(APPLY, "pg", "package")] }),
  );
  assert.deepEqual(result, [], "apply/ and persistence/ are supposed to touch the driver");
});

// --- R1, the carry-forward rule --------------------------------------------

test("R1 catches apply/ handing a pool onward", () => {
  const result = checkBoundaries(graph({ applyExports: ["joinQueue", "writePool"] }));
  assert.deepEqual(properties(result), ["R1"]);
});

// --- CO-2, the property that raises the tier -------------------------------

test("CO-2 catches a module outside apply/ writing to entries", () => {
  const result = checkBoundaries(graph({ entryWriters: [APPLY, "src/api/index.ts"] }));
  assert.deepEqual(properties(result), ["CO-2"]);
  assert.match(String(result[0]?.detail), /src\/api\/index\.ts/);
});

test("CO-2 catches the governed write being EXPORTED", () => {
  // If applyStatusChange were exported, "every write goes through one function"
  // would still be literally true and would guarantee nothing, because any
  // module could call it directly and skip the named operation entirely.
  const result = checkBoundaries(
    graph({ applyExports: ["joinQueue", "applyStatusChange"] }),
  );
  assert.deepEqual(properties(result), ["CO-2"]);
});

test("several violations are reported together, not one at a time", () => {
  // A checker that stops at the first failure makes fixing a broken boundary an
  // N-round game.
  const result = checkBoundaries(
    graph({
      files: [AGENT, DOMAIN],
      edges: [
        edge(AGENT, WRITE, "relative"),
        edge(AGENT, "pg", "package"),
        edge(DOMAIN, "src/api/index.ts", "relative"),
      ],
      entryWriters: ["src/api/index.ts"],
      applyExports: ["applyStatusChange"],
    }),
  );
  // P3 appears alongside P1 because ONE bad edge violates two properties:
  // agents/ reaching the write path is both "an agent can reach a write path"
  // and "something other than apply/ imported persistence/write". That overlap
  // is correct and worth asserting, since a checker that reported only the
  // first would understate the blast radius of a single import.
  assert.deepEqual(properties(result), ["CO-2", "P1", "P2", "P3", "X1"]);
});

// --- X2. P3 as a permitted-importer ALLOWLIST -------------------------------

test("X2: a PERMITTED script may import the write pool", () => {
  // Criterion 2 requires asserting current_user on the write pool, and T1.5
  // puts that proof in scripts/. Before the allowlist there was no legal way to
  // do it: the gate's three exits all failed.
  const result = checkBoundaries(
    graph({ edges: [edge("scripts/b1-connection-proof.ts", WRITE, "relative")] }),
  );
  assert.deepEqual(result, []);
});

test("X2: an UNLISTED importer of the write pool is refused, and told how to fix it", () => {
  const result = checkBoundaries(
    graph({ edges: [edge("scripts/some-new-script.ts", WRITE, "relative")] }),
  );
  assert.deepEqual(properties(result), ["P3"]);
  assert.match(String(result[0]?.detail), /permitted-importer list/);
});

test("X2: the allowlist is complete by construction, so a NEW directory is refused by default", () => {
  // The point of an allowlist over a denylist: a path nobody thought of is
  // forbidden rather than silently permitted.
  const result = checkBoundaries(
    graph({ edges: [edge("tools/migrate-helper.ts", WRITE, "relative")] }),
  );
  assert.deepEqual(properties(result), ["P3"]);
});

// --- X6. Intra-directory carve-out ------------------------------------------

test("X6: domain/ MAY import its own siblings, or a multi-file state machine is illegal", () => {
  const result = checkBoundaries(
    graph({ edges: [edge("src/domain/index.ts", "src/domain/transitions.ts", "relative")] }),
  );
  assert.deepEqual(result, [], "v3 carried this carve-out and v4's rewrite dropped it");
});

test("X6: domain/ still may not import ACROSS directories", () => {
  const result = checkBoundaries(
    graph({ edges: [edge("src/domain/index.ts", "src/api/index.ts", "relative")] }),
  );
  assert.deepEqual(properties(result), ["P2"]);
});

test("X6: persistence/write MAY import its own siblings", () => {
  const result = checkBoundaries(
    graph({ edges: [edge(WRITE, "src/persistence/write/pool.ts", "relative")] }),
  );
  assert.deepEqual(result, []);
});

// --- X12. Governance purity as a PROPERTY, not a comment --------------------

test("X12: governance/ reaching outward at runtime is caught", () => {
  const result = checkBoundaries(
    graph({ edges: [edge("src/governance/index.ts", "src/api/index.ts", "relative")] }),
  );
  assert.deepEqual(properties(result), ["X12"]);
});

test("X12: governance/ MAY reach domain/, which is what it formats events from", () => {
  const result = checkBoundaries(
    graph({ edges: [edge("src/governance/index.ts", "src/domain/index.ts", "relative")] }),
  );
  assert.deepEqual(result, []);
});

// --- X13. The AUTHORITY guarantee, not just the path guarantee --------------

test("X13: apply/ re-exporting FROM the write module is caught", () => {
  // P3 alone would stay green here: apply/ is a permitted importer, so the path
  // is lawful. What is unlawful is handing the pool onward, and only an
  // authority guarantee catches that.
  const result = checkBoundaries(
    graph({ applyReExports: ["src/persistence/write/index.ts"] }),
  );
  assert.deepEqual(properties(result), ["R1"]);
  assert.match(String(result[0]?.detail), /onward/);
});

// --- CO-2 allowlist ---------------------------------------------------------

test("CO-2: a PERMITTED fixture may write to entries as hms_ddl", () => {
  const result = checkBoundaries(
    graph({ entryWriters: ["scripts/b4-close-of-day-proof.ts"] }),
  );
  assert.deepEqual(result, []);
});

test("CO-2: an UNLISTED writer to entries is refused", () => {
  const result = checkBoundaries(graph({ entryWriters: ["src/api/index.ts"] }));
  assert.deepEqual(properties(result), ["CO-2"]);
});

// --- X14. The limits are published, not implied -----------------------------

test("X14: the checker publishes what it CANNOT see", () => {
  // The gate's complaint was that AMENDMENTS conceded the dynamic-import gap
  // while section 3.3 claimed tier C without restating it. A limit recorded
  // elsewhere is a limit the reader of the claim does not have.
  assert.ok(LIMITS.length > 0);
  assert.ok(
    LIMITS.some((l) => /dynamic import\(\)/i.test(l)),
    "the dynamic-import gap must be stated where the claim is made",
  );
  assert.ok(
    LIMITS.some((l) => /SQL text match/i.test(l)),
    "CO-2's detection method is a limit and must be stated",
  );
});
