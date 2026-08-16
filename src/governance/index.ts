// Governance gates and fairness-event formatting. PURE. Phase 2, B3.
//
// I14: this directory decides whether a gate is satisfied and formats fairness
// events. IT DOES NOT WRITE. orchestrator/apply/ is the single write path.
// Same import rule as domain/: nothing from src/, no external package, no node
// builtin.

import type { Status, Trigger } from "../domain/index.ts";

// A fairness event is the record that a place in line changed, or could have.
// I8 requires EVERY place-in-line change to write one. The emission mechanism
// lives in orchestrator/apply/ (CO-2); this module decides what the row says.
export type FairnessEvent = {
  readonly kind: string;
  readonly fromStatus: Status | null;
  readonly toStatus: Status | null;
  readonly actor: string | null;
  readonly reason: string | null;
  readonly approver: string | null;
};

export function statusChangeEvent(input: {
  readonly from: Status | null;
  readonly to: Status;
  readonly trigger: Trigger;
  readonly actor: string | null;
  readonly reason?: string | null;
  readonly approver?: string | null;
}): FairnessEvent {
  return {
    kind: input.trigger,
    fromStatus: input.from,
    toStatus: input.to,
    actor: input.actor,
    reason: input.reason ?? null,
    approver: input.approver ?? null,
  };
}

// X10: a failed advisory-lock acquisition is an OPERATIONAL event, not a
// fairness event. It is recorded on a counter, never in `events`. Writing it to
// the fairness log would inflate the audit trail with non-events and make the
// real ones harder to find, which defeats the log's purpose.
export type OperationalCounter = {
  lockContention: number;
};

export function newOperationalCounter(): OperationalCounter {
  return { lockContention: 0 };
}

// I7: an out-of-order call carries a named approver. Recorded, unauthenticated
// per R13. This is the formatting half; the gate itself is checked in domain.
export function describeApproval(approver: string | null): string | null {
  if (approver === null || approver.trim() === "") return null;
  return `approved by ${approver.trim()} (unauthenticated, recorded per R13)`;
}
