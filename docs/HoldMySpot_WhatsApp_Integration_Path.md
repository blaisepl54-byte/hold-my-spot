# Hold My Spot, WhatsApp Integration Path for the Build

Drop this into the build chat alongside the main build handoff. It settles the WhatsApp question so no time is lost on it. Decision is made: use the Twilio WhatsApp sandbox for the buildathon, with a simulated WhatsApp surface as the ready fallback. Do not create a new entity, and do not borrow SoSave's WhatsApp Business Account.

---

## THE DECISION, AND WHY

For the buildathon, a verified WhatsApp Business Account is not needed and should not be pursued. Business verification is slow and would eat days of a three week sprint. Two paths give real or realistic WhatsApp behavior without it:

1. **Twilio WhatsApp Sandbox (primary).** Real WhatsApp messages, sending and receiving, live in minutes, no business verification. Perfect for a single simulated branch on synthetic customers.
2. **Simulated WhatsApp surface (fallback).** A WhatsApp-styled interface driven by the real backend and agents. Demos identically to a judge, zero external dependency. Legitimate for a buildathon as long as it is disclosed honestly.

Do NOT route buildathon traffic through SoSave's WhatsApp Business Account. It entangles two entities that are deliberately kept separate, and any policy flag or rate-limit issue from test traffic would land on the account that must stay clean. SoSave's Stripe, Plaid, and sponsor-bank approvals are financial-rails approvals and are irrelevant to WhatsApp.

Hold My Spot gets its OWN verified WhatsApp Business Account later, at production launch, under its own entity that licenses the Trogon engine. Not during the buildathon.

---

## PRIMARY PATH: TWILIO WHATSAPP SANDBOX

### What it gives you
A shared Twilio sandbox WhatsApp number that can send and receive real WhatsApp messages immediately. Testers opt in by sending a join code to the sandbox number once. After that, the backend can send and receive freely within the sandbox rules. Good enough to demo the full join, position, confirm-to-hold, and "you're next" loop over real WhatsApp.

### Setup steps
1. Create a free Twilio account. Get the Account SID and Auth Token from the console.
2. In the Twilio console, open Messaging, then Try it out, then the WhatsApp sandbox. Note the sandbox number and the join code (a phrase like "join <two-words>").
3. From each test phone that will act as a customer, send that join phrase to the sandbox number on WhatsApp. That phone is now opted in.
4. Set the sandbox "when a message comes in" webhook to the backend endpoint that will receive inbound WhatsApp messages (see webhook shape below). Use a tunneling tool (a public URL forwarder) during local dev so Twilio can reach the local server.
5. Send a test message from the backend to a joined number to confirm the round trip works before wiring any agent logic.

### Sending a message from the backend (shape, not final code)
- Use the Twilio REST API messages endpoint.
- `from` is `whatsapp:<sandbox number>`, `to` is `whatsapp:<tester number in E.164>`, plus the body text.
- Authenticate with the Account SID and Auth Token.
- The Twilio Node helper library or a plain POST both work.

### Receiving a message (inbound webhook)
- Twilio POSTs inbound messages to the configured webhook as form-encoded fields.
- Key fields: the sender number, the message body, and message metadata.
- The endpoint should parse the sender and body, hand the text to the Conversation Agent, and return a response (either inline in the webhook reply or via a follow-up send).

### Map the queue actions to WhatsApp
- **Join:** inbound "join" style message (or a QR-poster link that opens a pre-filled message) creates a provisional queue entry.
- **Position / STATUS:** inbound status request returns live position and the Wait Time Agent's ETA.
- **Confirm-to-hold:** when the customer is a few positions out, the backend sends the reconfirm prompt; the customer's one-tap reply flips the entry from provisional to confirmed and callable.
- **You're next:** backend send when the customer reaches the front, opening the grace window.
- **LEAVE:** inbound leave message removes the entry.

---

## THE RULES TO RESPECT (even in sandbox)

These are real WhatsApp Business Platform constraints. Honor them in the build so the design maps cleanly to production later.

- **Customer initiates.** The business cannot cold-message a customer out of nowhere. The customer opts in first. The QR-poster-opens-a-pre-filled-message pattern is how on-site join respects this.
- **Session window.** After a customer messages in, there is a window during which the business can reply freely with normal messages. Outside that window, business-initiated messages must use pre-approved templates. Design the "still coming?" nudge and the "you're next" alert with this in mind. In sandbox the window behavior is simplified, but build the flow as if the rule applies so nothing has to be re-architected for production.
- **Opt-in and rate limits.** Sandbox requires the explicit join step per tester. Keep the tester list small and known.

Sandbox limitations to expect and design around: only opted-in numbers can be reached, template selection is limited, and the sandbox number is shared and not branded. All fine for a single-branch synthetic demo.

---

## FALLBACK PATH: SIMULATED WHATSAPP SURFACE

Build this if the sandbox opt-in friction gets in the way of a clean demo, or as a safety net so the demo never depends on external connectivity.

- A WhatsApp-styled chat UI (the visual language of a WhatsApp thread) rendered by the app, driven by the SAME backend, agents, and queue state machine as everything else.
- The customer types or taps join, status, confirm, leave, and the real Conversation Agent and orchestrator respond. The only thing simulated is the transport, not the intelligence.
- Demos identically to a judge. Disclose it plainly: the consumer surface simulates WhatsApp, production runs on the WhatsApp Business Platform.
- Bonus: it removes any live-connectivity risk during the recorded demo or a live presentation.

The existing prototype's phone surface is already most of the way to this. Reuse it, point it at the real backend instead of the local state machine, and style it as a WhatsApp thread.

---

## RECOMMENDATION FOR THE BUILD

Start on the Twilio sandbox on day one to prove the real round trip, because a demo with genuine WhatsApp messages is more persuasive than a simulation. Keep the simulated surface built in parallel as the guaranteed-working fallback, since it reuses the prototype phone surface and costs little. Decide which one leads the demo video once both are working, and disclose honestly whichever is used. Either way, respect the initiation and session-window rules in the flow design so the buildathon build is a true preview of production, not a throwaway.
