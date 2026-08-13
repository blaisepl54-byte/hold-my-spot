// BOUNDARY MARKER. Filled in Phase 2, the queue state machine.
// Exports a throwing function rather than throwing at module top level, so the
// boundary-check failure demonstration (T1.9) can import it without crashing the
// checker on load.
//
// P2: this directory imports nothing from src/. Keep it that way.

export function notImplemented(): never {
  throw new Error("src/domain: not implemented until Phase 2");
}
