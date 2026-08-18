// P2 secret-split assertion. Build Order 4, section P2. LANDED BEFORE any code
// that could violate it, as the order requires.
//
// "After the console build, grep every built client asset for sk_test_,
// sk_live_, CLERK_SECRET and the literal value of the secret key. Zero hits
// required."
//
// Anything in web/dist is served to every visitor. A secret there is published,
// full stop. This runs after build-console.mjs in the Netlify build command, so
// A LEAK FAILS THE DEPLOY rather than shipping.
//
// Plain JS: runs on Netlify's build image.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "web/dist";
const NEEDLES = ["sk_test_", "sk_live_", "CLERK_SECRET"];
// The literal value, when the environment holds one. On Netlify the secret key
// must NEVER be set at all; checking for it anyway costs nothing and catches
// the day someone sets it there by mistake and a build step interpolates it.
const literal = process.env.CLERK_SECRET_KEY ?? "";
if (literal !== "") NEEDLES.push(literal);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const hits = [];
for (const file of walk(DIST)) {
  files += 1;
  const text = readFileSync(file, "utf8");
  for (const needle of NEEDLES) {
    if (text.includes(needle)) hits.push(`${file}: contains ${needle === literal ? "THE LITERAL SECRET VALUE" : JSON.stringify(needle)}`);
  }
}

if (files === 0) {
  console.error(`secret-split: ${DIST} is empty or missing. Nothing was asserted; refusing to pass vacuously.`);
  process.exit(1);
}
if (hits.length > 0) {
  console.error("secret-split FAILED. A server secret is in the client bundle:");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`secret-split PASS: ${String(files)} built asset(s), zero occurrences of ${String(NEEDLES.length)} needle(s).`);
