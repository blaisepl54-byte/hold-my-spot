# HMS BUILD ORDER 4, PHASE 5

**Realm:** holdmyspot
**From:** Claude, architect-coordinator
**Sealed by:** King B, pending
**Authored:** 2026-08-17
**Intended path:** `docs/governance/BUILD_ORDER_4.md`
**Predecessor:** `BUILD_ORDER_3.md`, `sha256:03a1fc2f88687386b6c0b41118349a29eaf4818deb8bf4e0c410bf4a0f96e23b`

Build Order 3 is COMPLETE. Phase 5 begins. R9 is satisfied by King B's ruling of 2026-08-17 that
deployment is Phase 5, so nothing here is an exception to it.

---

## 0. Standing position

**Additive, as before.** B0 through B6 and C0 through C6 must pass unmodified at every stage. If a
step requires weakening an existing guarantee, stop and report rather than weakening it.

**The fairness guarantee is the product and it must be re-proven remotely.** Proven on a laptop is
not proven in production. B1 and B2 are re-run against Railway and must reject exactly as they
reject locally. **If any rejection does not reproduce, stop.** A deployment that silently loses the
grant model is worse than no deployment.

**Superuser rule, amended by King B 2026-08-17, with a compensating control.** The standing rule was
that Claude Code never holds a superuser credential. Railway CLI access cannot coexist with it:
`railway connect` opens a superuser session and `railway variables` prints the URL. The rule is
therefore replaced rather than pretended.

**What replaces it, and it is stronger.** The old rule protected proof integrity by absence, which
is tier V: it held because nothing enforced it. **Every remote proof now asserts `current_user`
before it asserts anything else.** A proof accidentally connected as superuser fails loudly rather
than passing silently. That is a mechanism that rejects, which is tier C. Absence of a credential is
replaced by an assertion that fails.

The superuser URL is used for exactly two things: creating the three roles, and applying migration
DDL. Every other operation, and every proof without exception, connects as a named limited role.

**The simulated transport surface stays first class** and must remain capable of carrying the entire
demo alone. Twilio does not become the only path.

**Write discipline unchanged.** Create, modify and stage freely. Do not commit, do not push, do not
deploy.

**MODEL A IS THE ONLY SANCTIONED DEPLOY PATH.** Two models exist and they are not interchangeable.

- **Model A, git driven.** GitHub is the trigger. Railway and Netlify each watch `main` and deploy
  on push. The deploy is a CONSEQUENCE of a push King B already authorized.
- **Model B, CLI driven.** `railway up` uploads the working directory. `netlify deploy --prod`
  publishes local files. **Neither consults git.** Both will ship uncommitted, unreviewed, unsealed
  code with no commit-shaped audit trail.

Model B is permitted for read-only inspection, for provisioning, and for pre-traffic smoke work
only. **No Model B command publishes anything that serves a user.**

**Architect defect, recorded, caught before execution.** The prior revision of this order authorized
Claude Code to deploy by CLI while also instructing it not to commit. Those two instructions
together authorize shipping code that was never committed, in a realm whose governance rests
entirely on forward-only linear history. Fifth instance of the architect pattern in this realm, and
the first caught before it reached execution rather than during it.

**Architect defect, recorded.** Build Order 3's C5 stated the Adherence Agent already existed and
described an extension. It did not exist. This is the fourth instance in this realm of the same
architect pattern: naming a source without verifying it contains the fact. It was built rather than
blocked, correctly, and named built rather than extended.

---

## 1. Ordering, and why

Twilio inbound webhooks require a publicly reachable URL. That single fact sets the sequence:
Railway precedes Twilio, or a tunnel becomes a moving part inside a live demo.

```
PD  Discovery        read only, ground truth, branch protection audit
P0  Railway          database and API deployed via CD, public URL exists
P1  Twilio           real WhatsApp against that URL, highest uncertainty, proven early
P2  Clerk and roles  authentication and the three surfaces
P3  Netlify          console as a static client
```

PD costs minutes and prevents wiring continuous deployment onto an unprotected branch, which is the
specific way this becomes a retrofit.

P1 sits second deliberately. It is the item most likely to surprise, so it is proven while there is
still time to fall back to the simulated surface.

---

## 2. Vendor surfaces, and what Claude Code may operate

King B has ruled that Claude Code operates the vendor CLIs on his behalf. Deploy remains a distinct
surface from commit and push, and this ruling authorizes it only within Phase 5 scope.

| Vendor | King B supplies | Claude Code may | Claude Code may NOT |
|---|---|---|---|
| Railway | An authenticated CLI session | Run `railway init`, provision Postgres, create roles, set variables, apply migrations, read logs and status, connect the GitHub repo to the service | `railway up` to anything serving a user, delete or destroy any service or project, change billing, add a custom domain, link a public repo |
| Twilio | Account SID and an API key with messaging scope | Configure the sandbox sender, set the inbound webhook, send and receive | Purchase a number, upgrade the account, start a WABA application, message any number not on the approved test list |
| Clerk | A DEVELOPMENT instance and its `pk_test_` and `sk_test_` keys | Configure roles, wire the SDK, set `authorizedParties`, set session settings | **Create a production instance**, create or delete the application, change the plan, invite users, request a custom domain |
| Netlify | An authenticated CLI session | Run `netlify init` to wire CD, configure build settings, set per-context env, run draft deploys | `netlify deploy --prod`, delete the site, change the domain, change billing |

**Standing authorization, bounded.** Provisioning and configuration at all four vendors are
authorized for the duration of Phase 5 without a per-action go, because the system is empty and
mistakes cost a redo. **Publishing is not provisioning.** Deploys reach production only through
Model A, as a consequence of a push King B made. **The first CD deploy at each vendor is reported
before anything else proceeds**, so King B sees what landed. Anything in the may-not column stops
and asks, every time.

**Token custody.** `RAILWAY_TOKEN` and `NETLIFY_AUTH_TOKEN` carry the full permissions of the user
who generated them. They are root credentials. Keep them out of the repo, out of any tracked file,
and out of chat.

**Credential handling, unchanged and absolute.** Never print, echo or interpolate a credential value
into any output, including presence checks. Test presence by exit status. `railway variables` and
its equivalents are read for control flow, never echoed. No vendor credential enters a tracked file;
`.env.example` documents contracts with placeholders only. **This rule caused a real leak in this
realm on 2026-08-13 and it is the rule with the worst track record, so it gets the most care.**

**Cost.** Railway and Clerk bill on usage. If any action would move the project off a free tier or
create a persistent paid resource, report it before acting rather than after.

---

## PD. Discovery and branch protection. READ ONLY.

Nothing is provisioned in this section. Report findings, fix nothing.

**Toolchain.** Report installed or not installed, with version, for `gh`, `railway`, `netlify`.
Do not install anything yet. Note that Railway's one-line installer targets macOS, Linux and WSL;
on a native Windows shell `npm i -g @railway/cli` is the practical route. Confirm which applies
rather than assuming.

**GitHub ground truth.** `gh auth status`, repo visibility, default branch, remote, and whether the
working tree is clean.

**Branch protection audit, the priority item.**

```
gh api repos/blaisepl54-byte/hold-my-spot/branches/main/protection
gh api repos/blaisepl54-byte/hold-my-spot/rulesets
```

**A 404 means NO PROTECTION EXISTS. Report that plainly and prominently.** Do not enable anything.

**Existing vendor state.** King B reports GitHub is already connected to Railway, and that Netlify
and Clerk exist. **Do not assume what that means.** Report what `railway status`, `railway whoami`,
`netlify status` actually return, including "not linked" and "does not exist" as findings. A project
connected at account level is not the same as a service watching a branch.

**Repo config inventory.** Existence and contents of `railway.toml`, `railway.json`,
`netlify.toml`. Whether any `.env` is tracked, flagged loudly if so. Whether `.gitignore` covers
`.env` and its variants, read from the staged blob rather than the working tree.

**Secret footprint.** Search for `CLERK_SECRET`, `sk_test_`, `sk_live_` across tracked files.
Expected: zero hits. **Print no value at any point, including in error output.** Report counts and
filenames only.

**RULING REQUIRED FROM KING B on the findings, and P0 does not open until it lands.**

If protection is absent, the minimum before CD is wired is **force pushes disabled on `main`**,
which costs nothing and protects the linear history the whole realm rests on. **Require-PR is a
separate question** and it is King B's: on a solo repo with this much window left it may add more
friction than it buys, and admin bypass would make it decorative anyway. Recommendation: disable
force pushes now, defer require-PR, and record the deferral rather than leaving it unstated.

## P0. Railway, database and API

Executed by Claude Code through the Railway CLI, per section 2.

- Provision managed PostgreSQL on the project King B has created.
- **Create the three roles from `db/roles.sql`** using the provisioned superuser connection.
  Generate three distinct passwords locally and never echo them. Set them with `\password` or an
  equivalent that does not write the value to shell or psql history.
- **Store the three limited URLs as Railway variables**, named to match the local `.env` contract.
  **No superuser URL is stored as an application variable.** The application never needs it and a
  variable that exists will eventually be read by something.
- Apply all migrations using the DDL role URL. Observe a second run as a no-op.
- **Wire continuous deployment, not a CLI push.** Connect the GitHub repo to the Railway service,
  watching `main`. Railway is a Model A consumer from its first deploy and there is never a legacy
  CLI path to deprecate. `railway up` is reserved for pre-traffic smoke work only.
- **Environment targeting is checked explicitly.** Railway's `--environment` defaults to whatever is
  linked, and a wrong-environment deploy is reportedly the most common first-day Railway error.
  Report which environment each command targeted rather than assuming the default was right.
- Report the public API URL, which P1 requires.
- **Rehearse rollback while the system is empty.** Redeploy a prior deployment and observe it serve.
  An untested rollback is not a rollback, and rehearsing it now costs nothing because there is
  nothing to lose.
- `HOST` binds as the platform requires. **C6's loopback default remains the local default** and is
  not changed to suit the deployed case.

**Property, and this is the gate on everything after it.**

`npm run b1` and `npm run b2` executed against Railway, connecting only through the limited role
URLs. **Each proof asserts `current_user` matches the expected role before asserting any
rejection**, so a proof connected as superuser fails rather than passes. All five rejections
observed remotely, SQLSTATE 42501, as `hms_rw`. Break-restore on at least one.

**Add the same `current_user` assertion to the local B1 and B2 proofs**, since the control is cheap
and the local proofs currently rest on absence rather than on a check. Report this as a tier change
from V to C rather than as a cosmetic edit.

If the managed instance's default privileges differ from local, the difference is reported and
closed in a migration rather than absorbed.

**Expect this specific failure.** Managed Postgres providers grant broader defaults than a local
install. C0 already found `ALTER DEFAULT PRIVILEGES` silently granting DELETE, where an explicit
grant looked like a constraint being applied while doing nothing. That class will very likely recur
here. **If any rejection does not reproduce on Railway, STOP.** The fairness guarantee is the
product and a deployment that silently loses it is worse than no deployment.

## P1. Twilio, real WhatsApp

**The sandbox is real WhatsApp on a real number reaching real phones.** Its only limitation is that
each recipient sends a join code once. That is acceptable for a demo and for early pilot testing.

- Sandbox sender configured. Inbound webhook pointed at the deployed API from P0.
- Signature validation on the inbound route, so an unsigned request is refused.
- Outbound send through the existing adapter. **No new transport path is created**; the adapter
  built in B5 is wired, not replaced.
- **The 24 hour service window is open for the entire core flow**, because the customer initiates by
  messaging to join. Free form messages are permitted inside it and no approved template is required
  for join confirmation, position updates, the call notification, or the survey. **If any message is
  sent outside that window, it needs a template and that is out of scope here.**
- Failure behavior is unchanged: bounded send attempts, then `undeliverable_at` set, with the entry
  remaining provisional and on its clock.

**Property, proven end to end on a real handset, not simulated.** A real phone joins by WhatsApp
message, receives the confirmation prompt, the console shows the entry as provisional, Call Next
skips it visibly, one reply confirms, the next Call Next serves it, and the survey arrives after
service completes. **Then the same sequence is run again on the simulated surface** to prove the
fallback still carries it alone.

**WABA is NOT pursued under this order.** A verified Business Account removes the join code but needs
Meta business verification that can take days to weeks. It is a pilot concern, not a submission
concern, and gating the demo on it would be a bad trade. King B may start an application in
parallel; nothing here depends on it.

## P2. Clerk, roles, and the three surfaces

### Roles

Two roles, no more. `desk` and `manager`. A manager holds everything a desk holds.

**Customers never authenticate.** The confirm and survey routes stay scoped by the entry's own
token. **A person holding a place in line is never asked to create an account**, and any design that
requires it is wrong.

### Development instance only

**Do not create a Clerk production instance under this order.** A production instance requires a
custom domain and DNS records, propagation can take up to 24 hours, and changing the domain later
regenerates the publishable key, which breaks every consumer until each is updated and redeployed.
Development instances carry full functionality for building. Promotion is a Phase 6 concern and is
King B's act.

Three things established now so promotion is later a variable swap rather than a rebuild:

1. **`authorizedParties` is set** on the Clerk middleware. Omitting it exposes the app to CSRF.
   This is a named assertion with a proof, not a nice-to-have.
2. **Every key is read from environment, never hardcoded**, so promotion changes variables only.
3. **The secret split is asserted mechanically**, per below.

### The secret split, adapted to this stack

The Clerk publishable key `pk_test_` is public by design and belongs on the Netlify surface. The
secret key `sk_test_` belongs only on the Railway backend. **This is not a Next.js build, so the
`NEXT_PUBLIC_` convention does not apply. The property does.** Any value baked into the console's
client bundle is readable by anyone who loads the page.

**Property, asserted against built output rather than against intent.** After the console build,
grep every built client asset for `sk_test_`, `sk_live_`, `CLERK_SECRET` and the literal value of
the secret key. Zero hits required. Break-restore: introduce it, observe the assertion fail, remove
it, observe it pass. **Land this assertion before there is any code that could violate it.**

### The three surfaces

**Desk view, role `desk`.** The working surface for a counter.
Sees the branch queue in join order, with each entry's service type, wait, and provisional state.
Acts as its own counter: Call Next, confirm on the customer's behalf where they are physically
present, complete service, remove an unconfirmed provisional entry per R-A, which stays ungated and
unconditional.
**Does not have:** close of day, out of order override, the report surface.

**Manager view, role `manager`.** Everything a desk has, plus branch level acts.
All counters visible at once with what each is serving.
**Out of order override, which is I7's named approver.** Today the approver is a string the console
supplies. Under Clerk it becomes an authenticated identity, which moves I7's attribution from
convention to checked. This is the single largest guarantee improvement in Phase 5 and it must be
stated as such: the record of who authorised serving someone out of turn stops being self declared.
**Close of day.** See the ruling required below.
Counter management: open, close, relabel.

**Report view, role `manager`.** The C4 dashboard, unchanged in substance.
All of R-F holds without exception: keyed on counter, no employee named, nothing ranked, every rate
carries its denominator, sub-10 samples marked provisional, service types footnoted as placeholders
pending rung 2, and no routing decision taken automatically.

### The line that must not be crossed

Clerk introduces user identity. **Authenticated identity in the fairness log is audit attribution
and is legitimate. Joining that identity to any performance figure is scoring and is forbidden under
R-F.** The report surface stays keyed on counter after users exist. No query in this order joins a
user identity to a duration, a solve rate, or an adherence figure.

### RULING REQUIRED FROM KING B, and P2 does not guess

**Is close of day manager-only?** Operator removal was ruled ungated and unconditional because
removing a ghost moves nobody forward out of turn. Close of day releases the entire queue, which is
a materially larger act. **Recommendation: manager only.** Ruled either way, recorded either way,
and not assumed.

**Property for P2.** Every route rejects an unauthenticated request, observed as a 401 rather than
read from middleware. Every manager route rejects a `desk` session, observed as a 403. Break-restore
on at least one of each. An out of order override writes the authenticated identity to `events`, and
the adherence agent's unapproved-override finding still fires when the gate is bypassed at fixture
level.

## P3. Netlify, console

- Console served as a static client of the Railway API. C4 already renders client side, so this is a
  deploy rather than a rewrite.
- **`netlify init` to wire CD for the site, not `netlify deploy --prod`.** Model A from the first
  publish. Draft deploys are permitted for inspection.
- **Per-context environment variables.** Netlify supports `production`, `deploy-preview`,
  `branch-deploy` and `dev` contexts, and this is the mechanism that keeps development Clerk keys
  out of a production context. Set it correctly at provisioning; retrofitting context separation
  after keys are spread across contexts is error prone.
- **Deploy previews per pull request** give King B a real visual gate before a merge and cost
  nothing to enable now. Optional, and his call.
- CORS restricted to the Netlify origin. **Not wildcard.**
- API base URL from build time environment.
- Clerk's frontend integrated on the console; the API validates the session server side. **A
  frontend that hides a button is not access control.** The refusal happens on the server.

**Property.** The deployed console drives the full demo moment against the deployed API and a real
handset. `docs/hold-my-spot-prototype.html` remains unmodified and its pin assertion still passes.

---

## 3. What must not regress

At every stage, before reporting:

```
npm run typecheck
npm run test
npm run b1 .. b6
npm run c0 .. c6
```

All pass, unmodified. **The demo moment is the acceptance criterion for this order as a whole.**

---

## 4. If the window closes early

1. The local build, complete and demoable. **Never cut.** It is a submission on its own.
2. PD, discovery. Minutes, and it prevents wiring CD onto an unprotected branch.
3. P0, Railway. Without it nothing else in Phase 5 is reachable.
4. P1, Twilio on a real handset. The claim that this is WhatsApp native rather than a web app.
5. P2, Clerk and the three surfaces.
6. P3, Netlify.

**A working local demo beats a broken deployed one.** If P0 or P1 destabilises the demo, revert to
local and simulated and say so plainly in the Logbook. An honest fallback is a better submission
than a deployment that fails in front of judges.

---

## 5. Reporting

Report at staged, per section, stating the property proven and the instrument chosen. The
implementer selects the instrument; this order states the property. Protected words require
break-restore proof, observed RED before anything is called fixed. Post checks run after authoring,
mechanically.

**Watch for the pattern Build Order 3 named as its dominant risk:** proofs that pass while proving
something other than their label. Five occurred in one order. A remote proof is more susceptible,
not less, because a misconfigured connection can make a rejection look like a pass.

**Failure modes named in advance, because each has a known shape:**

- A secret key reaching the client bundle. Most damaging, most common, assertion-guarded from the
  first commit.
- The first publish happening by CLI because it is faster than wiring CD. **This is the specific way
  the advantage of an empty system is lost**, and it is guarded by name.
- CD wired before branch protection is confirmed, which makes the Model A ruling decoration.
- Development Clerk keys reaching a production context. Per-context variables are the guard.
- Wrong-environment deploys on Railway, reportedly the most common first-day error there.
- Proofs that pass while proving something else. Five occurred in Build Order 3 alone.

**If a constraint in this order forbids its own required outcome, say so and stop.** That has now
happened six times in this realm and five were the architect's.
