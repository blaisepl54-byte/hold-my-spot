// BOUNDARY MARKER. Filled in Phase 4, the orchestrator's apply path.
// Exports a throwing function rather than throwing at module top level.
//
// This is the SINGLE WRITE PATH in the system (v4 section 3.3).
// P3: src/persistence/write/ is directly imported only from here.
// It also owns the provisional-expiry sweep (v4 section 3.6), serialized by the
// same per-location advisory lock as I10.

export function notImplemented(): never {
  throw new Error("src/orchestrator/apply: not implemented until Phase 4");
}
