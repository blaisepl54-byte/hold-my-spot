// tools/whatsapp. External capability, reached by the orchestrator per v4 line
// 106. Agents never reach tools.
//
// I11 IS THE CONTRACT AND IT IS TIER C, meaning a test fails if it is violated:
//   async, plain request in, {ok:true,value} or {ok:false,reason} out,
//   NEVER THROWS ACROSS THE BOUNDARY.
//
// "Never throws" is the load-bearing half. A transport talks to a network, and
// a network fails in ways nobody enumerated. If those escape as exceptions the
// orchestrator's transaction unwinds on a delivery problem, which would let a
// failed SMS roll back a place in line. Every implementation therefore catches
// everything and converts it to a reason.
//
// NEITHER TRANSPORT IS THE ONLY PATH, per B5. The simulated surface can carry
// the demo alone; the Twilio adapter can replace it without any caller
// changing. Selection is explicit and lives in one function at the bottom.

export type SendRequest = {
  // Synthetic destination. R11: synthetic data only, so this is a test number
  // in every environment that exists today.
  readonly to: string;
  readonly body: string;
  readonly entryId: string;
};

export type SendOutcome = {
  readonly providerId: string;
  // section 3.6 is DELIVERY-ANCHORED: the expiry window runs from delivery, not from
  // sending. A transport that cannot report delivery must say so rather than
  // guess, because a false "delivered" starts a clock that should not run.
  readonly delivered: boolean;
  readonly transport: string;
};

export type SendResult =
  | { readonly ok: true; readonly value: SendOutcome }
  | { readonly ok: false; readonly reason: string };

export type Transport = {
  readonly name: string;
  send(request: SendRequest): Promise<SendResult>;
};

// Guard used by both implementations so the "never throws" property has ONE
// definition rather than being re-implemented per adapter and drifting.
export async function neverThrows(
  name: string,
  work: () => Promise<SendResult>,
): Promise<SendResult> {
  try {
    return await work();
  } catch (error) {
    return {
      ok: false,
      reason: `${name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type TransportChoice = "simulated" | "twilio";

export function chooseTransport(raw: string | undefined): TransportChoice {
  // Defaults to simulated. A missing or misspelled value must NOT silently
  // select a network transport that could message a real person; the safe
  // direction is the one that cannot leave the machine.
  return raw === "twilio" ? "twilio" : "simulated";
}
