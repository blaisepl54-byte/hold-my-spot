# Hold My Spot — Business Plan & Product Handoff

**Status:** Pre-pilot. Concept locked, prototype built, no pilot partner signed.
**Working name:** "Hold My Spot" (placeholder — not trademark-checked)
**Beachhead:** Jamaica
**Date of this handoff:** July 2026

> **For the receiving party:** This supersedes the earlier "Virtual Queue / Hold My Spot — Product Handoff Brief." It carries forward that brief's still-valid analysis, records the decisions locked since, and documents two working HTML artifacts. Where something is an assumption rather than a verified fact, it is labeled. Nothing in Section 3 (market data) has been re-verified since early 2026 — treat those figures as stale until re-checked.

---

## 1. Concept

A virtual queue system that lets people hold their place in line remotely — at banks, government offices, clinics, telecoms, and quick-service restaurants — see their live position, get alerted as their turn approaches, and have their spot held for a short grace window before it releases to the next person.

**The differentiator is the channel, not the queue.** The consumer surface is WhatsApp — no app install, no login. Everything else in the category is table stakes.

---

## 2. Problem

People in Jamaica and across much of the Caribbean routinely lose hours in physical lines at banks and government agencies. Waits are unpredictable, there's no way to reserve a position remotely, and walk-ins are served ad hoc. The cost is lost productivity, frustration, and crowded lobbies.

Global queue-management vendors skew toward North American, European, and Middle-Eastern enterprise deployments. The Caribbean public-sector and retail-banking context is underserved by a purpose-fit, low-capex, mobile-first product priced and supported for that market.

---

## 3. Market & competitive landscape

**⚠️ All figures below are carried forward from early-2026 research and have NOT been re-verified. Re-check before using in any investor or customer-facing material.**

This is an **established B2B category**, not greenfield. Incumbents are evidence the model works and a map of the white space — not a reason to avoid the space.

**Major players:** QLess, Skiplino, Qminder, Qmatic, Waitwhile, WaitWell, NEMO-Q, Wavetec, ScanQueue, Qtrac (Lavi), JRNI.

**Carried-forward data points (unverified):**

| Vendor | Posture | Notes |
|---|---|---|
| QLess | Enterprise, category pioneer | Strong in local government and higher ed; banking-optimized offering; custom pricing; some reported stability/support concerns |
| Skiplino | Mobile-first | Popular in the Middle East; banks, government, telecom, clinics; entry pricing reportedly ~$99/mo |
| Qmatic | Hardware-heavy | Kiosks, ticket printers, signage; enterprise; high setup complexity |
| Waitwhile / Qminder / ScanQueue | Mid-market, software/QR-first | Roughly $50–$500/mo mid-market tiers; some genuinely free tiers |

**All incumbents already handle walk-ins and digital joiners in a single unified system.** Unified queueing is not a differentiator — it is the minimum viable product.

**The actual opening:** incumbents are concentrated in Western and Middle-Eastern markets. The Caribbean queue problem is real, high-volume, and not well served by a localized, low-capex, WhatsApp-native product priced and supported for that market.

**Honest framing of the moat:** geography is a *go-to-market* edge, not a *product* edge. On pure product you would be selling a Jamaican bank roughly what QLess or Skiplino sells. The defensible edges are, in order: channel (WhatsApp-native), price/localization, support proximity, and distribution relationships. Only the first is hard for an incumbent to copy quickly, and even that is a head start rather than a permanent moat.

---

## 4. The architectural truth (read before anything else)

**A virtual queue only works if the physical location runs its floor by it.** There is no consumer-side overlay that can enforce a queue a business does not honor. If a customer is "number 5" in a virtual line but staff serve whoever is physically standing at the counter, the virtual position is fiction.

Two hard consequences shape the entire product:

1. **It is a B2B operational sale first, with a consumer companion second.** The buyer is the branch/agency/operator who adopts it as their official queue-management system. The consumer side is the demand network, but it has no value until locations are live. Plan GTM and economics around the B2B side.

2. **Walk-ins are not "random" — they are enrolled into the same single queue at arrival.** Via kiosk, QR poster, or reception. They land in the *same ordered list* as remote joiners. Staff serve strictly off **one** queue screen. Adherence is an **organizational commitment** the location makes, not a technical trick. The software's job is to make running off the unified queue easier than running off chaos. If a location won't commit, no feature fixes it.

---

## 5. The WhatsApp thesis (locked this session)

The original brief listed WhatsApp as one P0 notification option among SMS and push. **It has been promoted to the entire consumer surface.**

The full consumer experience — join, live position, ETA, "you're next" alert, grace-window check-in, leave — lives inside one WhatsApp thread.

**Why this is the central bet:**

- **It kills the cold-start problem.** A two-sided system where one side requires an app download is brutal to bootstrap. A two-sided system where the consumer side is a phone number is not.
- **Regional fit.** WhatsApp penetration in the Caribbean is high (assumption — worth confirming with a hard source before it goes in a pitch deck). Zero install, zero login, works on low-end phones and patchy data.
- **It doubles as the security layer.** See Section 7.
- **Incumbents lead with SMS and native apps.** This is the wedge they are not currently pressing.

**Constraint to design around (real, not cosmetic):** WhatsApp Business Platform rules require the customer to initiate contact, and constrain business-initiated messaging windows, opt-in, and per-number rate limits. The QR-poster path (scan → opens a pre-filled WhatsApp message) handles initiation. **Pin the current Meta rules before wiring the join and reconfirm flows** — they will shape when and how the "still coming?" nudge and "you're next" alert can legally fire. This is a build-blocking dependency, not a detail.

---

## 6. Product shape

### Two surfaces

**Operator console (B2B — the product that's sold)**
- Unified live queue: remote joiners + walk-ins in one ordered list
- "Call Next" / serve-next workflow, one action per counter
- Multi-counter / multi-agent support
- Configurable services and grace windows
- Walk-in enrollment: QR self-check-in and staff/reception entry
- "Now serving" display output (cast to any existing screen)
- Analytics: wait times, no-show rate, throughput, peak times, per-agent
- Multi-branch management (P1)

**Consumer surface (WhatsApp — free)**
- Join remotely or via on-site QR poster
- Live position + estimated wait
- Confirm-to-hold reconfirmation step (see Section 7)
- "Almost your turn" alert
- Tap-to-check-in within grace window
- STATUS / LEAVE commands

### Core loop

```
Join (WhatsApp remote or on-site QR/reception)
  → enters one unified ordered queue
  → live position + ETA
  → [remote joins: confirm-to-hold]
  → "you're next" alert
  → grace window holds slot (configurable, default 5 min)
  → check in → served
  → or timeout → auto-release to next
```

---

## 7. Anti-abuse & verification (locked this session)

Two distinct problems, one mechanic. Do not conflate them:

- **Malicious flooding** — scripted fake joins to deny service or discredit the system. Scary, rare.
- **Honest no-shows** — people who join optimistically and don't come. Unglamorous, and the bigger day-to-day threat to ETA accuracy and capacity.

### The channel is the verification

Joining via WhatsApp requires a real WhatsApp account bound to a SIM-verified number that Meta already vets and polices for automation. You inherit those defenses at zero user friction. From that:

**Rule 1 — one active queue entry per verified number, per location.** This alone defeats naive flooding and multi-slot hoarding. An attacker now needs an army of real, aged, SIM-backed WhatsApp numbers — expensive, slow, and against Meta's terms.

> This is the security dividend of the no-install decision. A web or SMS join path would need CAPTCHA or OTP — i.e. friction. Another reason WhatsApp stays primary.

### Rule 2 — make fake entries non-displacing (the centerpiece)

Don't block bad joins at the door. Let them in and make them worthless.

Every join keeps its timestamp and ordinal place. But a position only becomes a **callable, slot-consuming hold** once confirmed:

| Join type | Confirmation | User friction |
|---|---|---|
| On-site QR (in the lobby) | Auto-confirmed — presence is proof | **None** |
| Reception entry (no phone) | Auto-confirmed by staff | **None** |
| Remote WhatsApp join | One-tap reconfirm a few positions out | **One tap** |

Unconfirmed entries are **skipped** by Call Next and **excluded from ETA math**, so a wall of ghosts distorts nothing.

**Net effect:** to actually deny service, an attacker needs many real numbers *and* must tap-confirm each at the right moment. That is no longer "a script flooding joins" — it is "physically organizing a crowd," which collapses into an ordinary visible-crowd problem staff can see and manage. The attack stops being cheap.

### Organizing principle: adaptive friction

**Tax the anomaly, not the customer.** Zero steps on the trusted path. One tap on the risky path. ~95% of customers feel nothing.

### What to build in v1 — and what NOT to

**Do not build a fraud platform before you have fraud.** At a single-branch pilot the realistic threat is near zero, and a heavy verification stack burns the thing that actually matters: time-to-pilot.

**v1 (four things only):**
1. One active entry per verified number, per location
2. Grace-window auto-release (already core)
3. Confirm-to-hold for remote joins
4. Staff controls: flag / remove / merge, plus an "N unconfirmed entries" console indicator so the operator is never blind

**P1 / P2 — design the data model to accommodate, but ship without:**
- Per-number reputation (silent down-weighting of serial no-shows)
- Join cooldowns and velocity analytics
- Coarse geofence on remote joins

---

## 8. Target users

| Persona | Role | What they need |
|---|---|---|
| **Branch operations manager** | Economic buyer | Shorter waits, less lobby crowding, staff efficiency, reporting to justify spend |
| **Front-line agent** | Daily adopter — **adoption hinges here** | A dead-simple "serve next." If it adds work, it dies. |
| **Receptionist / greeter** | Walk-in enrollment | Add a walk-in in seconds |
| **Consumer** | Network side | Stop standing in line; reliable notifications |

**Critical tension:** the buyer and the adopter are different people with different incentives. See Section 11.

---

## 9. Go-to-market

### Vertical sequencing (candid read)

| Vertical | Verdict | Reasoning |
|---|---|---|
| **Banks** | **Lead with this for the pilot** | Clearest budget, real branch networks, and the *hardest* adherence test — relationship-driven service tempts staff off FIFO. A win here generalizes everywhere. |
| **Government** | **Biggest prize — expansion story, not first signature** | Worst line pain on the island, huge volume. But procurement is slow and political; it will kill a pilot timeline. |
| **QSR / clinics** | **Fastest yes, lowest learning** | Owner-operator decisions, no procurement. But ticket-number adherence is half-solved already, so it teaches less about the hard problem. |

**Operating instruction until a partner is signed:** pitch all three. The beachhead should be chosen by **who you can get to yes**, not by which vertical scores best on a slide. Name the buyer and the vertical falls out. Existing Caribbean relationships are the highest-value asset here — a warm line to a specific operator beats vertical theory.

### Monetization

- **B2B per-location subscription.** Consumer side free, always.
- Global mid-market band is roughly $50–$500/mo (unverified) — **needs localizing to Jamaican price tolerance.**
- **Price point is a blocking decision** because it gates the build decision (Section 10).

### Positioning

Lead every pitch with the architectural truth (Section 4). It is disarming, it is correct, and it pre-qualifies the buyer: an operator who won't commit to serving off one queue is not a customer, and finding that out in the first meeting saves months.

---

## 10. Build vs. white-label (decision framing)

**These are not parallel questions — they are sequential.** The original brief listed price and build-vs-buy as two separate open items. They are not.

Most white-label queue engines are priced for Western enterprise economics. Bolt a localized layer onto one and the underlying cost may break your Jamaican price point before you sell a single seat.

**Correct order:**
1. Determine the price a Jamaican bank branch will actually pay.
2. The build decision then answers itself.

**Candid lean regardless:** white-label or thin-localized-layer to reach a pilot fast. The two assumptions worth validating (staff adherence, and a wait reduction a buyer will pay for) are validated by *running*, not by owning a bespoke engine. Don't sink engineering into a proprietary queue core until both are proven.

**Caveat on that lean:** a white-label engine may not support a WhatsApp-native consumer flow, which is the entire differentiator. Verify that specific capability before committing — if it can't, the calculus shifts toward building the consumer layer yourself over a licensed operator core, or building outright.

---

## 11. The riskiest assumption

**It is human, not technical.**

The earlier brief named staff adherence but treated it as an organizational commitment the buyer simply makes. The harder truth: **the buyer and the adopter are different people with different incentives.** Front-line staff in relationship-heavy service settings — retail banking especially — have active reasons to deviate from strict FIFO: known customers, manager overrides, discretion, "I'll just take this one quick."

This is what kills these deployments everywhere, not just Jamaica.

**Consequences for the pilot:**
- **Adherence is a first-class metric** — measure what share of customers were actually served in queue order, not just wait-time reduction.
- **The buyer must own enforcement as a written precondition of the pilot.** If you can't get that commitment in writing before go-live, you don't have a pilot — you have a software demo.

---

## 12. Pilot design

**Shape:** single branch, one motivated ops manager, fixed window (suggest 60 days).

**Validate exactly two things:**
1. Will front-line staff run off the unified queue *daily*?
2. Does it produce a measurable wait-time reduction the buyer will pay for?

**Preconditions before go-live:**
- Written commitment from branch leadership to serve in unified-queue order
- Baseline measurement period (you cannot prove reduction without a "before")
- Named staff champion on the floor
- Confirmed connectivity posture at the specific site

**Suggested targets (set explicitly with the buyer):**
- ≥40% wait/lobby-time reduction
- ≥80% of served customers flowing through the unified queue
- Adherence: ≥90% served in queue order

### Metrics

**Leading (days–weeks):** location activation; share of served customers through the unified queue; **adherence rate**; daily active front-line staff usage; remote-join rate; no-show rate after grace window; unconfirmed-entry rate.

**Lagging (weeks–months):** measured wait-time reduction; pilot-to-paid conversion; per-location retention; branch expansion; consumer repeat use.

---

## 13. Requirements

### P0 — must have
- Unified queue combining remote joiners and walk-ins in one ordered list
- Walk-in enrollment: QR self-check-in **and** staff/reception entry (the no-phone inclusion path — banks and government *will* ask about the elderly customer without a smartphone; the unified-queue claim has a hole without it)
- "Call Next" workflow + "now serving" display output
- Live position + estimated wait for customers
- Turn-approaching notifications via WhatsApp
- Configurable grace window with auto-release on timeout
- Per-service / per-counter configuration; multi-agent support
- Confirm-to-hold for remote joins (Section 7)
- One active entry per verified number per location
- Basic analytics: wait time, no-show rate, throughput, peak times, **adherence**

### P1 — nice to have
- Multi-branch dashboard
- Post-service feedback capture
- Bi-directional staff ↔ customer messaging
- Multi-language support if needed locally
- **Offline tolerance for intermittent connectivity — may be P0 depending on pilot site reality. Verify on site.**

### P2 — future
- Appointment scheduling that auto-places into the live queue near appointment time
- Cross-location "find the shortest wait near me" discovery (the network-effect feature)
- API integration with core banking / government systems
- Reputation scoring, geofencing, velocity analytics

### Non-goals (v1)
- Not merged with any event/venue-booking product — separate codebase, separate GTM
- Not hardware-heavy — no proprietary kiosks, printers, or signage. BYO tablet + QR + existing screens
- Not a consumer-only crowd-sourced wait estimator — cannot enforce a real queue
- Not appointment scheduling
- Not multi-country at launch

---

## 14. Artifacts delivered

### `hold-my-spot-mockups.html` — static pitch mockups
Self-contained, browser-openable, sendable to a prospect. Vertical-agnostic (branch name, service list, counter names all swap).

Contains: operator console mockup; WhatsApp consumer flow with five-step narrative; core-loop diagram leading with the architectural truth; three-vertical pitch comparison.

**Use:** a prospect leave-behind and the visual anchor for the PRD.

### `hold-my-spot-prototype.html` — clickable two-sided prototype
Both surfaces wired to **one shared live queue** with a working state machine. No dependencies, no backend — open and click.

**Console:** Call Next, Check in, No-show, Complete, Add walk-in; live stats; real grace countdowns that auto-release on timeout.

**Phone:** Join → provisional → confirm-to-hold → called → check in → served, plus leave/rejoin and no-show recovery.

**The key demo moment:** join on the phone, then hit Call Next on the console. The provisional remote join is **visibly skipped** until the customer confirms. That is the Section 7 anti-abuse mechanic made literal, and it is the most persuasive thing in the artifact.

**Auto-serve** runs the line hands-free. **Reset** restores the seed state.

**Known limitations (disclose if asked):**
- ETA is a flat 3 min/person placeholder — see Section 15
- Single branch, single simulated customer
- Service list and branch name are hardcoded; not yet config-driven
- No persistence, no backend, no real WhatsApp integration

---

## 15. Open questions & blocking decisions

| # | Question | Status | Gates |
|---|---|---|---|
| 1 | **Who is the pilot partner?** | **Blocking everything** | Vertical, pricing, PRD specificity |
| 2 | **Price point for the Jamaican market** | **Blocking** | The build-vs-white-label decision |
| 3 | **Build vs. white-label vs. thin layer** | Blocked by #2 | Time-to-pilot, engineering spend |
| 4 | **ETA model** | Open — real modeling problem | Credibility in pitch; a flat per-person average will draw questions. Service-time variance by service type is the substance here. |
| 5 | **WhatsApp Business Platform rules** | Must pin before build | Join flow, reconfirm nudge, alert timing |
| 6 | **Jamaica Data Protection Act obligations** | Must verify before collecting PII | Legal exposure; consent design |
| 7 | **Connectivity at pilot site** | Verify on site | May promote offline support to P0 |
| 8 | Notification cost model per message | Open | Unit economics per location |

---

## 16. Recommended next steps

1. **Work the relationships.** Get a warm introduction to a specific branch ops manager or agency head. Everything downstream is blocked on a named partner. Use the mockups as the leave-behind and the prototype as the live demo.
2. **In parallel, pin the two external dependencies** that don't require a partner: current WhatsApp Business Platform messaging rules, and Jamaica's Data Protection Act obligations.
3. **Establish the price point** through those early conversations — ask directly what a branch spends on operational software today.
4. **Then decide build vs. white-label**, verifying WhatsApp-native support in any candidate engine.
5. **Then write the full PRD** for the named vertical, and design the single-branch pilot around adherence + wait reduction.

**Do not build the production system before step 1.** The prototype is sufficient to sell a pilot.

---

## 17. Sources & verification status

Vendor and category research (QLess, Skiplino, WaitWell, ScanQueue, Quest ME, Verified Market Reports overview of the virtual queuing market) was conducted in **early 2026 and has not been re-verified since.** All market sizes, customer counts, and pricing are approximate. **Re-verify before any investor or customer-facing use.**

Claims marked as assumptions in this document — regional WhatsApp penetration, Jamaican price tolerance, incumbent channel strategy — are reasoned positions, not researched facts. They are load-bearing for the thesis and deserve real evidence before a funding conversation.
