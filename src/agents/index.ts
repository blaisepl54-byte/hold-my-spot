// BOUNDARY MARKER. Filled in Phase 3, the Wait Time Agent, and Phase 7.
// Exports a throwing function rather than throwing at module top level.
//
// P1: no path from here to src/persistence/write/ or src/orchestrator/apply/.
// I6 tier V: agents are pure by contract, lint-assisted, defeatable.

export function notImplemented(): never {
  throw new Error("src/agents: not implemented until Phase 3");
}
