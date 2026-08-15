// T1.8. Property: Node 24.15.0 executes TypeScript by native type stripping
// across a real cross-file import carrying an explicit .ts specifier, and one
// test asserts a runtime value.
//
// Instrument: node's built-in runner, per v2 R8, zero test dependencies.
//
// Two things are proven here that a self-contained file would not prove:
//   1. the specifier "./helpers/strip-probe.ts" is resolved and executed, so
//      the cross-file half is real. Node strips types but does not rewrite
//      specifiers, which is why the .ts extension is written out.
//   2. `import type` is erased. Under verbatimModuleSyntax a type-only import
//      must be marked, and if it were emitted as a runtime import of a value
//      that does not exist, this file would throw on load.
//
// The assertions compare against a value that must be COMPUTED. addAll over a
// three-element list cannot pass by identity or by returning its input, so a
// stripped-but-broken runtime would fail rather than coincidentally agree.

import { test } from "node:test";
import assert from "node:assert/strict";

import { addAll, describeSample } from "./helpers/strip-probe.ts";
import type { Sample } from "./helpers/strip-probe.ts";

test("type stripping executes a cross-file .ts import and returns a computed runtime value", () => {
  const total = addAll([1, 2, 3]);
  assert.equal(total, 6);

  const sample: Sample<number> = { label: "total", value: total };
  assert.equal(describeSample(sample), "total=6");
});
