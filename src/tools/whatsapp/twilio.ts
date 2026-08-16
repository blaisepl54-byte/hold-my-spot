// The Twilio WhatsApp adapter. B5, built BEHIND the simulated surface.
//
// It satisfies the same I11 contract, so swapping it in changes no caller. It
// is NOT wired to a live account and MUST NOT BE without an explicit
// authorization: sending a WhatsApp message is an outward-facing act that
// reaches a real person's phone and cannot be undone.
//
// UNCONFIGURED IS A REASON, NOT A CRASH. With no credentials it returns
// {ok:false, reason:"twilio_not_configured"}. That keeps the "neither transport
// is the only path" property true in both directions: selecting twilio on a
// machine with no account degrades to a clean refusal instead of an exception
// that unwinds an orchestrator transaction.
//
// CREDENTIAL DISCIPLINE. The auth token is read, used to build one header, and
// never logged, never echoed, never placed in a reason string, and never
// interpolated into a URL. The failure paths below deliberately report status
// codes and Twilio's own message, never the request that produced them.
//
// No new dependency: Node 24 has global fetch, so this adds nothing to
// package.json and nothing to the supply chain.

import { neverThrows } from "./index.ts";
import type { SendRequest, SendResult, Transport } from "./index.ts";

export type TwilioConfig = {
  readonly accountSid: string;
  readonly authToken: string;
  readonly from: string;
};

// Reads config without ever asserting a value. Presence is a boolean here; the
// values go straight into the request and nowhere else.
export function twilioConfigFromEnv(env: NodeJS.ProcessEnv): TwilioConfig | undefined {
  const accountSid = env["TWILIO_ACCOUNT_SID"];
  const authToken = env["TWILIO_AUTH_TOKEN"];
  const from = env["TWILIO_WHATSAPP_FROM"];
  if (
    accountSid === undefined ||
    authToken === undefined ||
    from === undefined ||
    accountSid === "" ||
    authToken === "" ||
    from === ""
  ) {
    return undefined;
  }
  return { accountSid, authToken, from };
}

export class TwilioTransport implements Transport {
  readonly name = "twilio";

  private readonly config: TwilioConfig | undefined;
  private readonly fetchImpl: typeof fetch;

  // fetch is INJECTED rather than reached for statically. An adapter whose
  // network call cannot be substituted is unobservable, and an unobservable
  // branch cannot be claimed to work. This is the seam that lets a test drive
  // the success and failure paths without an account.
  constructor(config?: TwilioConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async send(request: SendRequest): Promise<SendResult> {
    return neverThrows(this.name, async () => {
      if (this.config === undefined) {
        return {
          ok: false,
          reason:
            "twilio_not_configured: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and " +
            "TWILIO_WHATSAPP_FROM are required. Use the simulated transport instead.",
        };
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
      const body = new URLSearchParams({
        To: `whatsapp:${request.to}`,
        From: `whatsapp:${this.config.from}`,
        Body: request.body,
      });

      const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString(
        "base64",
      );

      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          // The only place the token appears. Not logged, not returned.
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        // Status and Twilio's message only. The request, and therefore the
        // credential, is never included.
        const detail = await response.text().catch(() => "");
        return {
          ok: false,
          reason: `twilio_http_${String(response.status)}: ${detail.slice(0, 300)}`,
        };
      }

      const payload = (await response.json()) as { sid?: unknown; status?: unknown };
      const sid = typeof payload.sid === "string" ? payload.sid : undefined;
      if (sid === undefined) {
        return { ok: false, reason: "twilio returned no message sid" };
      }

      // Twilio's immediate response reports QUEUED or SENT, not delivered.
      // Delivery arrives later on a status webhook. Reporting delivered:false
      // here is the honest answer, and section 3.6's clock must not start on it.
      // Claiming delivery from an acknowledgement is exactly the false
      // guarantee that would void the expiry rule for every remote entry.
      const status = typeof payload.status === "string" ? payload.status : "unknown";
      return {
        ok: true,
        value: {
          providerId: sid,
          delivered: status === "delivered",
          transport: this.name,
        },
      };
    });
  }
}
