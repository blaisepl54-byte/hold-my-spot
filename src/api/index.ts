// LIVE MODULE, v4 section 1 exception 4. The health route, and nothing else.
// This is the only route Phase 1 creates.
//
// Reaches the database through persistence/read/ rather than opening its own
// pool. Improvising a second pool here is exactly the trap section 1 exists to
// close (W3, and V4 before it).

import express from "express";
import { checkLiveness } from "../persistence/read/index.ts";

export function createApp(): express.Express {
  const app = express();

  // Reports ill health as well as good (v4 criterion 3): a database that is
  // down produces 503 and a differing body, not a hardcoded ok.
  app.get("/health", async (_req, res) => {
    const db = await checkLiveness();
    res.status(db.ok ? 200 : 503).json({
      process: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      database: db.ok ? "ok" : "unreachable",
      role: db.role,
      reason: db.reason,
    });
  });

  return app;
}
