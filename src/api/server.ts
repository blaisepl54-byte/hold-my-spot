// Server entry point. B6.
//
// Started explicitly, never on import: importing the app must not open a socket,
// for the same reason the pools are lazy. `npm run console` is the only thing
// that listens.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import express from "express";

import { createApp } from "./index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "..", "public");

// C6, Build Order 3. The bind address is DEFAULT SAFE and exposure is opted
// into, not opted out of.
//
// Before this, the console bound to 0.0.0.0 with no authentication on any
// route, so anyone on the same wifi could close the queue, remove entries, and
// call customers. On a laptop that is a real exposure; the default now removes
// it without removing the two-sided demo.
//
// NO SHARED-SECRET TOKEN IS BUILT HERE, and that is the order's decision rather
// than an omission: Clerk supersedes it in Phase 5, and building an auth
// mechanism twice is throwaway work. Until then the exposure is bounded by this
// default and by nothing being deployed.
export const DEFAULT_HOST = "127.0.0.1";

export function startServer(
  port: number,
  host: string = DEFAULT_HOST,
): ReturnType<express.Express["listen"]> {
  const app = createApp();
  app.use(express.static(PUBLIC_DIR));
  app.get("/", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "console.html"));
  });
  return app.listen(port, host, () => {
    console.log(`Hold My Spot console: http://localhost:${String(port)}`);
    console.log(`health:                http://localhost:${String(port)}/health`);
    console.log(`bound to:              ${host}`);
    if (host === DEFAULT_HOST) {
      console.log("                       loopback only. Set HOST=0.0.0.0 to reach it over wifi.");
    } else {
      console.log("                       REACHABLE FROM THE NETWORK. No authentication exists yet.");
    }
  });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env["PORT"] ?? "3000");
  // Anything other than an explicit override lands on loopback, including a
  // typo. A misspelled value must not silently expose the console.
  startServer(port, process.env["HOST"] ?? DEFAULT_HOST);
}
