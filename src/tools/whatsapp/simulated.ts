// The simulated WhatsApp surface. B5: "capable of carrying the demo alone."
//
// In-process, no network, no credentials, no external account. It is a real
// implementation of the contract rather than a stub that returns ok: a message
// is recorded, addressable, and inspectable, so the console can render a
// customer's view of what they received.
//
// DETERMINISTIC BY CONSTRUCTION. There is no randomness anywhere in this file.
// A transport that fails "sometimes" makes every downstream test flaky and
// makes a failure impossible to reproduce, so failure is SCRIPTED instead:
// the caller states exactly which attempts fail. That is what makes the
// undeliverable path in X8 provable rather than waited for.

import { neverThrows } from "./index.ts";
import type { SendRequest, SendResult, Transport } from "./index.ts";

export type SimulatedMessage = {
  readonly to: string;
  readonly body: string;
  readonly entryId: string;
  readonly providerId: string;
  readonly delivered: boolean;
  readonly attempt: number;
};

export type SimulatedOptions = {
  // Attempts that must FAIL, 1-indexed. [1,2] means the first two attempts
  // fail and the third succeeds, which is exactly X8's bounded-retry case.
  readonly failAttempts?: readonly number[];
  // Whether a successful send also reports DELIVERY. A send that succeeds but
  // is never delivered is the case section 3.6 turns on, and it is reachable here.
  readonly deliver?: boolean;
};

export class SimulatedTransport implements Transport {
  readonly name = "simulated";

  private readonly sent: SimulatedMessage[] = [];
  private readonly attemptsByEntry = new Map<string, number>();
  private readonly failAttempts: ReadonlySet<number>;
  private readonly deliver: boolean;
  private counter = 0;

  constructor(options: SimulatedOptions = {}) {
    this.failAttempts = new Set(options.failAttempts ?? []);
    this.deliver = options.deliver ?? true;
  }

  async send(request: SendRequest): Promise<SendResult> {
    return neverThrows(this.name, async () => {
      const attempt = (this.attemptsByEntry.get(request.entryId) ?? 0) + 1;
      this.attemptsByEntry.set(request.entryId, attempt);

      if (this.failAttempts.has(attempt)) {
        return { ok: false, reason: `simulated failure on attempt ${String(attempt)}` };
      }

      this.counter += 1;
      const providerId = `sim-${String(this.counter)}`;
      const message: SimulatedMessage = {
        to: request.to,
        body: request.body,
        entryId: request.entryId,
        providerId,
        delivered: this.deliver,
        attempt,
      };
      this.sent.push(message);

      return {
        ok: true,
        value: { providerId, delivered: this.deliver, transport: this.name },
      };
    });
  }

  // The customer's view. This is what makes the surface a FALLBACK capable of
  // carrying the demo rather than a black hole that swallows messages.
  inbox(entryId?: string): readonly SimulatedMessage[] {
    return entryId === undefined
      ? [...this.sent]
      : this.sent.filter((m) => m.entryId === entryId);
  }

  attemptsFor(entryId: string): number {
    return this.attemptsByEntry.get(entryId) ?? 0;
  }
}
