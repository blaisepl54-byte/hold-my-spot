# HANDOFF: Hold My Spot, Future Caribbean Buildathon BUILD

Paste this into the new project chat to start the build with full context. This is a BUILD handoff, not a strategy doc. The strategy is settled; the job now is to ship a working, demonstrable agentic system in the buildathon window. Files in the outputs folder reset between chats, so re-attach the two HTML artifacts and the business plan when iterating.

---

## STATUS
**Hold My Spot has WON entry into the Future Caribbean Buildathon.** This chat is for the build. Three week build phase, solo build, ~20 to 25 hours a week committed. Track 02, Finance, Payments and MSME Capital. Beachhead framing: Jamaica.

## WHO I AM (quick)
Blaise Pierre-Louis. Senior financial services product executive, 16+ years (Morgan Stanley, The Clearing House, Wells Fargo). Built the first centralized open banking API platform in the US. I build hands on with agentic AI. Contact: Blaisepl54@gmail.com | 845-216-5279 | West New York, NJ (Eastern time).

## HARD RULES FOR WORKING WITH ME
- **NO DASHES.** No em-dashes, en-dashes, or double-hyphens as connectors in any deliverable or code comment prose. Open compound hyphens ("cloud native," not "cloud-native"). Keep hyphens only in my name, phone, URLs, and code (CLI flags, kebab-case identifiers). Dash-audit before delivering: `grep -c "—\|–"`.
- Direct and efficient. Short context bursts. Synthesize and produce without long back and forth.
- Prefer working code and real artifacts over plans about code.
- Put finals in /mnt/user-data/outputs/, present with present_files.

---

## WHAT HOLD MY SPOT IS
A virtual queue where the entire consumer experience lives inside one WhatsApp thread. No app, no login. People hold their place in line remotely, see their live position, get alerted as their turn approaches, and have their spot held for a short grace window before it releases to the next person. Two surfaces: an operator console (the B2B product) and a WhatsApp consumer surface (free).

**The differentiator is the channel, not the queue.** Unified queueing (remote joiners plus walk-ins in one list) is table stakes in this category. WhatsApp-native is the wedge.

**The buildathon layer on top is the agentic system.** That is what makes this a buildathon project rather than a queue app.

## THE ARCHITECTURAL TRUTH (never violate in the build)
A virtual queue only works if the location runs its floor by it. Walk-ins and remote joiners land in ONE ordered queue, and staff serve strictly off that one screen. Adherence is an organizational commitment, and in the build it becomes a first-class measured metric. There is no consumer-side overlay that can enforce a queue a business does not honor.

---

## THE AGENTIC LAYER (this is the buildathon deliverable)
Built and submitted in the application. A Queue Intelligence Orchestrator routes every event to specialist agents. The agents PROPOSE and EXPLAIN. No agent ever moves a person's position. A human approves anything that changes a place in line. This fairness constraint is the spine of the design.

**Orchestrator:** holds one ordered queue for remote joiners and walk-ins together, routes events, enforces governance, escalates gated actions to a human.

**Specialist agents:**
1. **Conversation Agent**, join, position, leave in plain language, English and Patois
2. **Wait Time Agent**, learns real service time by type, counter, and hour (replaces the flat per-person average, which is open question #4 and the real modeling substance)
3. **Confirmation and No Show Agent**, asks a remote joiner to confirm at the right moment, keeps unconfirmed entries out of the wait math
4. **Flow Watch Agent**, spots a counter backing up or a wait about to breach target, proposes an action
5. **Adherence Agent**, compares who was served to who was next, reports drift to the manager (reports, never acts)
6. **Demand Shaping Agent**, when the line is long, offers a remote joiner a shorter window later

**Governance layer wraps everything:** no silent reordering (position changes need operator approval), a fairness log (every change recorded with reason and approver), and stated confidence (no agent invents a wait time it cannot compute).

**Human approval gates:** approve a position change, approve a counter change, approve a broadcast, adherence stays a report.

**Data sources / tool layer available to agents:** WhatsApp Business Platform (the consumer surface), Claude API (agent reasoning), PostgreSQL (live queue state and service-time history), operator console (call next, walk-in entry, approvals), QR and kiosk join (auto-confirmed, presence is proof), analytics store.

---

## THE ANTI-ABUSE MECHANIC (the centerpiece, already in the prototype)
Two problems, one mechanic: malicious flooding (rare) and honest no-shows (the real daily threat). Do not build a fraud platform before there is fraud.

**The channel is the verification.** WhatsApp join requires a SIM-verified number Meta already polices.
- **Rule 1:** one active queue entry per verified number, per location.
- **Rule 2 (the centerpiece):** every join keeps its timestamp and place, but a position only becomes a callable, slot-consuming hold once CONFIRMED. On-site QR and reception entries are auto-confirmed (presence is proof). Remote WhatsApp joins need a one-tap reconfirm a few positions out. Unconfirmed entries are SKIPPED by Call Next and EXCLUDED from ETA math.

**Adaptive friction:** tax the anomaly, not the customer. Zero steps on the trusted path, one tap on the risky path, ~95% of customers feel nothing.

**THE KEY DEMO MOMENT (most persuasive thing in the whole project):** join on the phone, hit Call Next on the console, the provisional remote join is visibly SKIPPED until the customer confirms. This is already working in the prototype. It is the thing to preserve and showcase in the build and the demo video.

---

## THE TWO EXISTING ARTIFACTS (re-attach these to the build chat)
1. **`hold-my-spot-prototype.html`**, a working, clickable, two-sided prototype. Console and phone both wired to ONE shared live queue with a real state machine. Console: Call Next, Check in, No-show, Complete, Add walk-in, live stats, real grace countdowns that auto-release on timeout. Phone: Join, provisional, confirm-to-hold, called, check in, served, plus leave/rejoin and no-show recovery. Auto-serve runs it hands-free, Reset restores seed state. Branch is "Kingston Main Branch." Known limits: ETA is a flat 3 min/person placeholder, single simulated customer, hardcoded service list, no persistence, no backend, no real WhatsApp.
2. **`hold-my-spot-mockups.html`**, static pitch mockups, vertical-agnostic, browser-openable.

**These are the foundation. The build extends them, it does not start from scratch.** The queue state machine already works. The three weeks go into the agentic layer and the WhatsApp integration, not into rebuilding the queue.

## BUILDATHON BUILD SCOPE (what "done" looks like in three weeks)
Per the application, the buildathon build runs a SINGLE simulated branch on SYNTHETIC customers, with privacy and consent designed in rather than retrofitted. The deliverable is a working Queue Intelligence system demonstrating: the unified queue, at least a couple of the agents doing real work (Wait Time Agent turning service-time history into a real ETA, and the Confirmation/No Show mechanic), the human approval gates visibly gating a position or counter change, and the adherence metric being measured. The end-to-end story: someone joins on WhatsApp (or a simulated WhatsApp surface), gets a calibrated wait time, gets held, gets served, and the branch can see whether the line was honored.

**Priority order for the build:**
1. Preserve and harden the working queue state machine and the confirm-to-hold skip demo
2. Wait Time Agent: replace the flat 3 min/person placeholder with a model that learns service time by type/counter/hour (this is the real technical substance, open question #4)
3. The orchestrator plus the governance layer and at least one visible human approval gate
4. WhatsApp integration (or a faithful simulated WhatsApp surface if the real Business Platform integration is blocked, see dependencies)
5. Adherence measurement surfaced on the console
6. English and Patois in the Conversation Agent

## TECH STACK (intended)
TypeScript, React, Node and Express, Python where useful, PostgreSQL for queue state and service-time history. Anthropic Claude API for agent reasoning, multi-agent orchestration, Model Context Protocol for tool access. WhatsApp Business Platform for the consumer channel. Railway and Netlify for deployment. Built on a governed agentic system I already run (approval gates, orchestration, output validation available on day one).

## BUILD-BLOCKING DEPENDENCIES (pin these early)
- **WhatsApp Business Platform rules.** Customer must initiate contact; business-initiated messaging windows, opt-in, and per-number rate limits are constrained. The QR-poster path (scan opens a pre-filled WhatsApp message) handles initiation. Pin current Meta rules before wiring the join and reconfirm flows, they shape when the "still coming?" nudge and "you're next" alert can legally fire. If real integration is too heavy for the window, build a faithful simulated WhatsApp surface so the demo still lands, and note it honestly.
- **ETA model (open question #4).** A flat per-person average draws questions. Service-time variance by service type is the substance. This is where the Wait Time Agent earns its place.
- **Synthetic data only for the build.** No real PII. Design consent and privacy in from the first commit (this was stated in the application, question 40).

---

## THE NUMBERS FOR THE PITCH / DEMO (real and current, safe to cite)
- **Guyana, current:** a survey of 2,600+ bank customers found waits up to five hours and an estimated 60M+ productive hours lost per year to bank lines, 8 in 10 of those customers full-time workers. Caribbean neighbor, so it travels.
- **Jamaica tailwind:** a cabinet-level Ministry of Efficiency, Innovation and Digital Transformation exists, led by Minister Audrey Marks, focused on faster, more customer-focused public service.
- **Money behind it:** Jamaica signed a US$70M IDB public sector transformation loan (Feb 2026) plus a J$1.7B EU Digital Jamaica programme.

## COMPETITIVE FRAME (two moats, for demo narrative)
Incumbents: Qmatic, QLess, WaitWell, Waitwhile, Skiplino, Qminder, Qnomy, Nemo-Q. They are scheduling-plus-notification systems with a queue. None have a learning wait-time model, agentic readiness, or adherence as a measured outcome.
- **Moat 1:** architecture that cannot be scalped (a live queue position you must be present to hold, versus a fixed appointment slot that gets hoarded and resold, the Florida DMV lawsuit pattern).
- **Moat 2:** readiness plus the WhatsApp-native channel wedge incumbents lead away from (SMS and apps).

## THE RISKIEST ASSUMPTION (keep honest in the build and demo)
It is human, not technical. A virtual queue only works if front-line staff serve off it, and in relationship-heavy settings they have real reasons to deviate. That is why adherence is a first-class measured metric and why the Adherence Agent reports drift rather than acting on it. Do not paper over this in the demo, name it, then show the measurement answering it.

---

## RELATED ARTIFACTS ALREADY BUILT (in outputs, from the strategy phase)
- `HoldMySpot_Application_Responses.md`, the submitted buildathon answers
- `HoldMySpot_Agentic_Workflow.pdf/.png/.svg`, the agentic workflow diagram (submitted)
- `HoldMySpot_Loom_Script.md`, pitch video script with the govt tailwind and numbers
- `HoldMySpot_Competitive_Onepager.md/.pdf`, competitor analysis, two moats
- `HoldMySpot_DMV_Concept_Brief.md`, US DMV govtech version (separate track, not the buildathon)
- `hold-my-spot-business-plan-handoff.md`, the full business plan (source of truth for product detail; re-attach it)

## ENTITY NOTE
Hold My Spot is treated as its own venture, licensing the core agentic engine from **Trogon United** (my studio and IP holding company, has EIN). The Jamaica (WhatsApp-native) and US (SMS-first DMV govtech) versions are separate businesses sharing a name and the engine. For the buildathon, only the Jamaica version is in scope. Do not expose the other Trogon ventures or SoSave in buildathon materials.

## TECHNICAL NOTES FOR PRODUCING FILES
- Diagrams: hand-authored SVG, convert with cairosvg to PDF/PNG (scale ~1.6).
- Markdown to styled PDF: weasyprint with custom CSS.
- Node `docx` for Word docs, validate with /mnt/skills/public/docx/scripts/office/validate.py.
- Always dash-audit before delivering: `grep -c "—\|–"`.

## IMMEDIATE NEXT STEPS FOR THE BUILD CHAT
1. Re-attach the two HTML artifacts and the business plan
2. Stand up the queue state machine as a real backend (Postgres + Node), carrying over the prototype's logic, preserving the confirm-to-hold skip
3. Build the Wait Time Agent against synthetic service-time history (the real technical centerpiece)
4. Wire the orchestrator, governance layer, and one visible human approval gate
5. Decide WhatsApp real vs. simulated surface based on the Meta-rules check, and build accordingly
6. Surface adherence on the console
7. Keep the demo moment (join, Call Next, skip, confirm, call) intact and central throughout
