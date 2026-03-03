import pino from "pino";
import { config } from "../config/env.ts";

// ---------------------------------------------------------------------------
// Structured logger — pino singleton.
//
// Development  → pino-pretty: human-readable, coloured, single-line output.
// Production   → raw NDJSON to stdout (12-Factor XI; ship to log aggregator).
//
// Child loggers can be created for distinct subsystems:
//   const repoLogger = logger.child({ module: "document.repository" });
// ---------------------------------------------------------------------------

const isDev = config.nodeEnv !== "production";

export const logger = pino(
  {
    level: config.logLevel,
    // Rename pino's default "msg" field to "message" for consistency with the
    // existing inline JSON we were already emitting.
    messageKey: "message",
    // Serialise Error objects in the "err" binding automatically.
    serializers: {
      ...pino.stdSerializers,
    },
    // ISO timestamp in every log line.
    timestamp: pino.stdTimeFunctions.isoTime,
    // Base object appended to every log — service name is useful when logs
    // from multiple services land in the same aggregator.
    base: { service: "document-management" },
  },
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service",
          messageKey: "message",
        },
      })
    : undefined,
);
