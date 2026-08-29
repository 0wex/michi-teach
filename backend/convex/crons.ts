/**
 * Crons nativos de Convex.
 *
 * `rag-ingest-all-apps`: cada 14 días refresca la ingesta de todas las apps
 * del catálogo (via `internal.rag.ingestAllApps`). El día/hora está fijado a
 * lunes 04:00 UTC para caer fuera de horas pico.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "rag-ingest-all-apps-biweekly",
  { hours: 24 * 14 },
  internal.rag.ingestAllApps,
  {}
);

export default crons;
