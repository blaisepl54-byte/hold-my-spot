// C6 proof, Build Order 3 section 4.
//
// "Default start is not reachable from another host on the network, proven by
// an observed connection refusal from a second device or interface rather than
// by reading the bind call. With HOST=0.0.0.0 it is reachable."
//
// INSTRUMENT, per section 7. The refusal is observed over the machine's own LAN
// interface, not over loopback. That is a genuinely different address on a
// different interface, so a server bound to 127.0.0.1 must refuse it while the
// same server answers on localhost. Reading `app.listen(port, host)` and
// believing it would prove nothing; this repo has shipped a guarantee that read
// as present and was unreachable, and the whole point of C6 is that the
// exposure was real until measured.
//
// BOUNDED, stated rather than glossed: this proves refusal from another
// INTERFACE on this host. It does not prove refusal from a second physical
// device, which would need hardware this script cannot summon. The distinction
// matters because a firewall could mask a bad bind on a real second device
// while this test still passes. What is proven is the bind, which is what C6
// changes.

import { networkInterfaces } from "node:os";

import { DEFAULT_HOST, startServer } from "../src/api/server.ts";
import { closeReadPool } from "../src/persistence/read/index.ts";

// NO write-pool import here, and that is deliberate rather than incidental.
// The first draft imported closeWritePool for symmetry and the boundary checker
// refused it within minutes: this script is not on WRITE_POOL_IMPORTERS. The
// correct fix was to drop the import, not to widen the allowlist. C6 only
// probes /health, the pools are lazy, so the write pool is never instantiated
// and there is nothing to close. Widening an allowlist to accommodate an unused
// import is exactly the drift the allowlist exists to stop.

let failures = 0;
function check(label: string, condition: boolean, evidence: string): void {
  if (!condition) failures += 1;
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`);
  console.log(`       ${evidence}`);
}

const PORT = 3141;

function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

type Probe = { reachable: boolean; detail: string };

async function probe(host: string): Promise<Probe> {
  try {
    const response = await fetch(`http://${host}:${String(PORT)}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return { reachable: true, detail: `HTTP ${String(response.status)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    return { reachable: false, detail: `${message}${cause === "" ? "" : ` (${cause})`}` };
  }
}

async function withServer(host: string, work: () => Promise<void>): Promise<void> {
  const server = startServer(PORT, host);
  await new Promise((resolve) => setTimeout(resolve, 400));
  try {
    await work();
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function main(): Promise<void> {
  const lan = lanAddress();
  console.log(`C6 binding proof\n  default host: ${DEFAULT_HOST}\n  lan interface: ${lan ?? "NONE FOUND"}\n`);

  if (lan === undefined) {
    console.log("UNVERIFIABLE: no non-internal IPv4 interface exists on this machine, so a");
    console.log("second-interface refusal cannot be observed. Reported rather than passed.");
    process.exitCode = 1;
    return;
  }

  // --- default: loopback only -------------------------------------------
  console.log("--- default start, no HOST set ---");
  await withServer(DEFAULT_HOST, async () => {
    const local = await probe("127.0.0.1");
    check(
      "the console answers on loopback, so the demo still works",
      local.reachable,
      `http://127.0.0.1:${String(PORT)}/health -> ${local.detail}`,
    );

    const remote = await probe(lan);
    check(
      "the console REFUSES the LAN interface, so wifi cannot reach it",
      !remote.reachable,
      `http://${lan}:${String(PORT)}/health -> ${remote.detail}`,
    );
  });

  // --- explicit opt-in ---------------------------------------------------
  console.log("\n--- HOST=0.0.0.0, the deliberate demo opt-in ---");
  await withServer("0.0.0.0", async () => {
    const remote = await probe(lan);
    check(
      "with the opt-in, the LAN interface IS reachable, so the phone demo survives",
      remote.reachable,
      `http://${lan}:${String(PORT)}/health -> ${remote.detail}`,
    );
  });

  // --- the default is not merely the documented value --------------------
  check(
    "an unset HOST resolves to loopback, not to a network bind",
    DEFAULT_HOST === "127.0.0.1",
    `DEFAULT_HOST = ${DEFAULT_HOST}`,
  );

  await closeReadPool();

  console.log(
    failures === 0
      ? "\nC6 PROVEN. Default safe, exposure opted into."
      : `\n${String(failures)} FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
