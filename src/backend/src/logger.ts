import pino from "pino";

const gcpLevelMap: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isProduction
    ? {
        messageKey: "message",
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        formatters: {
          level(label) {
            return { severity: gcpLevelMap[label] ?? "DEFAULT" };
          },
        },
      }
    : { transport: { target: "pino-pretty" } }),
});
