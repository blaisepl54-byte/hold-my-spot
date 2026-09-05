// The queue state machine. PURE. Phase 2, B3.
//
// P2 and the standing carry-forward rule: this directory imports nothing from
// src/, no external package, and no node builtin. It decides; it never writes.
// Everything here is a function of its arguments, so it is testable without a
// database and cannot reach one.
//
// Statuses are v2 line 278, corroborated at v4 line 199. SEVEN, and the set is
// closed. `undeliverable` is NOT among them: ruled 2026-08-15, it describes the
// notification rather than the place in line, so it lives as the column
// `undeliverable_at`. An unreached entry still holds its position, is still
// unconfirmed, and is still on the same clock.

export type Status =
  | "provisional"
  | "waiting"
  | "called"
  | "serving"
  | "served"
  | "noshow"
  | "left";

export type Channel = "whatsapp" | "qr" | "reception";

export type Trigger =
  | "remote_join"
  | "onsite_join"
  | "customer_confirms"
  | "customer_leaves"
  | "provisional_expiry"
  | "operator_removal"
  | "call_next"
  | "out_of_order_call"
  | "check_in"
  | "undo_call"
  | "undo_check_in"
  | "customer_not_ready"
  | "call_expiry"
  | "grace_expiry"
  | "staff_marks_noshow"
  | "complete"
  | "walk_out"
  | "reinstate_position"
  | "reinstate_after_expiry"
  | "close_of_day";

export type Transition = {
  readonly from: Status | null;
  readonly to: Status;
  readonly trigger: Trigger;
  // Gating principle, v4 3.5: automatic application of a published rule fires
  // ungated; HUMAN REVERSAL of it is gated. An approver is a name, not an
  // authentication (R13).
  readonly requiresApprover: boolean;
};

// v4 lines 204 to 223, read from the primary. Order preserved.
export const TRANSITIONS: readonly Transition[] = [
  { from: null, to: "provisional", trigger: "remote_join", requiresApprover: false },
  { from: null, to: "waiting", trigger: "onsite_join", requiresApprover: false },
  { from: "provisional", to: "waiting", trigger: "customer_confirms", requiresApprover: false },
  { from: "provisional", to: "left", trigger: "customer_leaves", requiresApprover: false },
  { from: "provisional", to: "left", trigger: "provisional_expiry", requiresApprover: false },
  // X8 third exit, R-A: ungated and unconditional, and permitted ONLY from
  // provisional. Removing a ghost moves nobody forward out of turn.
  { from: "provisional", to: "left", trigger: "operator_removal", requiresApprover: false },
  { from: "waiting", to: "called", trigger: "call_next", requiresApprover: false },
  { from: "waiting", to: "called", trigger: "out_of_order_call", requiresApprover: true },
  { from: "waiting", to: "left", trigger: "customer_leaves", requiresApprover: false },
  { from: "called", to: "serving", trigger: "check_in", requiresApprover: false },
  { from: "called", to: "waiting", trigger: "undo_call", requiresApprover: false },
  // The call response window. Both are called -> waiting, both RETAIN joined_at,
  // and both are UNGATED: this is the automatic application of a rule the
  // customer was told in writing, not a human REVERSAL of one, which is the
  // distinction v4 3.5 draws. They are kept separate from undo_call, and from
  // each other, so the fairness log records whether the customer declined or
  // simply never answered. Those are different facts about a person and
  // collapsing them would lose the only evidence of which happened.
  { from: "called", to: "waiting", trigger: "customer_not_ready", requiresApprover: false },
  { from: "called", to: "waiting", trigger: "call_expiry", requiresApprover: false },
  { from: "called", to: "noshow", trigger: "grace_expiry", requiresApprover: false },
  { from: "called", to: "noshow", trigger: "staff_marks_noshow", requiresApprover: false },
  { from: "serving", to: "served", trigger: "complete", requiresApprover: false },
  { from: "serving", to: "called", trigger: "undo_check_in", requiresApprover: false },
  { from: "serving", to: "left", trigger: "walk_out", requiresApprover: false },
  { from: "serving", to: "noshow", trigger: "staff_marks_noshow", requiresApprover: false },
  { from: "noshow", to: "waiting", trigger: "reinstate_position", requiresApprover: true },
  // X9a bounded reversal. Ungated, but bounded: only an entry whose left_reason
  // is provisional_expiry may take it, and joined_at is retained. The caller
  // enforces the left_reason bound; this table carries the gate.
  { from: "left", to: "waiting", trigger: "reinstate_after_expiry", requiresApprover: false },
  // B4, close of day. Ungated: it is the automatic application of a published
  // branch policy, and the gating principle gates human REVERSAL, not
  // application. `called -> left` exists only here. A customer who was called
  // when the branch closed did not no-show; the branch ran out of day.
  { from: "waiting", to: "left", trigger: "close_of_day", requiresApprover: false },
  { from: "provisional", to: "left", trigger: "close_of_day", requiresApprover: false },
  { from: "called", to: "left", trigger: "close_of_day", requiresApprover: false },
];

export type TransitionCheck =
  | { readonly ok: true; readonly transition: Transition }
  | { readonly ok: false; readonly reason: string };

export function checkTransition(
  from: Status | null,
  to: Status,
  trigger: Trigger,
  approver: string | null,
): TransitionCheck {
  const match = TRANSITIONS.find(
    (t) => t.from === from && t.to === to && t.trigger === trigger,
  );

  if (match === undefined) {
    return {
      ok: false,
      reason: `no transition ${String(from)} -> ${to} on ${trigger}`,
    };
  }

  // A gate that is declared but unchecked is the failure this project keeps
  // finding, so the check is here and not left to the caller's good manners.
  if (match.requiresApprover && (approver === null || approver.trim() === "")) {
    return {
      ok: false,
      reason: `${trigger} requires a named approver (R13: recorded, not authenticated)`,
    };
  }

  return { ok: true, transition: match };
}

// X8 channels. qr and reception are on-site and presence is proof, so they
// enter at waiting, auto-confirmed. whatsapp is the ONLY remote channel and the
// only one producing a provisional entry.
export function initialStatusFor(channel: Channel): Status {
  return channel === "whatsapp" ? "provisional" : "waiting";
}

export function triggerForJoin(channel: Channel): Trigger {
  return channel === "whatsapp" ? "remote_join" : "onsite_join";
}

// ---------------------------------------------------------------------------
// Call Next. I3 and D1, the demo moment.
// ---------------------------------------------------------------------------

export type QueueEntry = {
  readonly id: string;
  readonly status: Status;
  readonly joinedAt: Date;
  // DERIVED BY THE CALLER from the fairness log and passed in, so this module
  // stays pure and no deferral state is ever stored on the entry. Absent means
  // not deferred. It changes exactly one thing: whether this entry is callable
  // right now. It does not change its position, because position is joinedAt
  // and joinedAt is not writable by anything (I1).
  readonly deferred?: boolean;
};

// steppedOver is a FIRST-CLASS RESULT, not a side note (v4 line 145). The
// unconfirmed entries that were passed are returned so the console can show
// them, which is what makes "they held their place" visible rather than
// asserted.
export type CallNextSelection =
  | {
      readonly ok: true;
      readonly next: QueueEntry;
      readonly steppedOver: readonly QueueEntry[];
    }
  | { readonly ok: false; readonly reason: "empty_queue"; readonly steppedOver: readonly QueueEntry[] };

// Order is join time (I1). Position is DERIVED here, never stored, so there is
// no priority field to corrupt and no reordering API to misuse.
export function selectNextToCall(entries: readonly QueueEntry[]): CallNextSelection {
  const inLine = [...entries]
    .filter((e) => e.status === "provisional" || e.status === "waiting")
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

  const steppedOver: QueueEntry[] = [];

  for (const entry of inLine) {
    if (entry.status === "waiting" && entry.deferred !== true) {
      return { ok: true, next: entry, steppedOver };
    }
    // provisional holds its place, is skipped, and is REPORTED. A deferred
    // entry does exactly the same thing for exactly the same reason: it keeps
    // joinedAt and is simply not callable yet. One mechanism, two causes.
    steppedOver.push(entry);
  }

  // EXHAUSTION. If deferral is the ONLY thing standing between the counter and
  // the queue, the earliest deferred entry becomes callable again.
  //
  // A deferral costs its holder exactly one place, and it can only cost that
  // place to somebody. With nobody else to yield to there is no place to lose,
  // so holding the line closed would punish a customer for a slot that does not
  // exist, and would let a branch deadlock its own queue into uncallable.
  const firstDeferred = inLine.find((e) => e.status === "waiting" && e.deferred === true);
  if (firstDeferred !== undefined) {
    return {
      ok: true,
      next: firstDeferred,
      steppedOver: steppedOver.filter((e) => e.id !== firstDeferred.id),
    };
  }

  return { ok: false, reason: "empty_queue", steppedOver };
}

// ---------------------------------------------------------------------------
// The call response window.
// ---------------------------------------------------------------------------

// DELIBERATELY NOT location.grace_seconds (300). Grace is how long a counter
// waits for a body to arrive; this is how long we wait for a reply to a
// message. Two different questions, and a single number pressed into both jobs
// would be wrong for at least one of them.
export const CALL_RESPONSE_SECONDS = 120;

// `calledAt` is DERIVED from the fairness log by the caller (the occurred_at of
// the entry's most recent call event), not read from a column. Nothing stores
// it, so nothing can disagree with the log about when the call happened.
export function callDeadlinePassed(
  calledAt: Date,
  now: Date,
  windowSeconds: number = CALL_RESPONSE_SECONDS,
): boolean {
  return now.getTime() - calledAt.getTime() > windowSeconds * 1000;
}

// I3: unconfirmed entries are excluded from wait math. Stated as a function so
// the exclusion is one definition rather than a rule each caller remembers.
export function countedForWaitMath(entries: readonly QueueEntry[]): readonly QueueEntry[] {
  return entries.filter((e) => e.status === "waiting");
}

// X8 transport. Bounded send attempts, default 3. When they are exhausted the
// entry is marked undeliverable_at and the expiry window runs from the LAST
// ATTEMPT, so every provisional entry has a clock rather than sitting forever.
export const DEFAULT_MAX_SEND_ATTEMPTS = 3;

export function sendAttemptsExhausted(
  attempts: number,
  max: number = DEFAULT_MAX_SEND_ATTEMPTS,
): boolean {
  return attempts >= max;
}

// ---------------------------------------------------------------------------
// B4, close of day. R-B: branch policy, not a global rule, and set at
// configuration rather than as a console button so a mid-operation flip cannot
// happen and no permissions model is needed to decide who may press it.
// ---------------------------------------------------------------------------

export type CloseOfDayPolicy = "reset" | "roll_forward";

// AMENDED BY KING B, 2026-08-15. The order originally released four statuses
// under reset, naming `undeliverable` as the fourth. `undeliverable` is a
// COLUMN, not a status, so an unreached entry IS provisional and is already
// covered by the provisional case. Three statuses, not four.
//
// Under BOTH policies, provisional and called are released. An unconfirmed
// entry carried overnight would take the front of the next day's line, which is
// exactly the harm X8 exists to prevent, so roll_forward does not protect it.
//
// Under BOTH policies, `serving` is untouched. The operator completes them; the
// branch does not evict someone mid-service because a clock struck.
export function releasedByCloseOfDay(
  entries: readonly QueueEntry[],
  policy: CloseOfDayPolicy,
): readonly QueueEntry[] {
  const released: Status[] =
    policy === "reset"
      ? ["waiting", "provisional", "called"]
      : ["provisional", "called"];

  return entries.filter((e) => released.includes(e.status));
}

// The complement, stated explicitly rather than left as "whatever is not
// released". Under roll_forward a waiting entry keeps its status AND its
// original joined_at, so it carries to the next day in the same position.
export function carriedByCloseOfDay(
  entries: readonly QueueEntry[],
  policy: CloseOfDayPolicy,
): readonly QueueEntry[] {
  if (policy === "reset") return [];
  return entries.filter((e) => e.status === "waiting");
}
