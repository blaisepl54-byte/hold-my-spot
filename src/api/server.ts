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

export function startServer(port: number): ReturnType<express.Express["listen"]> {
  const app = createApp();
  app.use(express.static(PUBLIC_DIR));
  app.get("/", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "console.html"));
  });
  return app.listen(port, () => {
    console.log(`Hold My Spot console: http://localhost:${String(port)}`);
    console.log("health:                http://localhost:" + String(port) + "/health");
  });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env["PORT"] ?? "3000");
  startServer(port);
}
