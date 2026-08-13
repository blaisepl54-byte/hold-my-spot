// BOUNDARY MARKER. Filled in Phase 4, governance gates and the fairness log.
// Exports a throwing function rather than throwing at module top level.
//
// Pure by design: decides whether a gate is satisfied and formats fairness
// events. It does not write. orchestrator/apply/ is the single write path.

export function notImplemented(): never {
  throw new Error("src/governance: not implemented until Phase 4");
}
