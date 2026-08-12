import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";
import { AppError } from "../errors/AppError.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isDev = process.env.NODE_ENV !== "production";
  const isOperational = err instanceof AppError;
  const statusCode = isOperational ? err.statusCode : 500;

  logger.error(err, isOperational ? "Operational error" : "Unexpected error");

  if (res.headersSent) return;

  res.status(statusCode).json({
    error: isOperational ? err.message : "Something went wrong",
    ...(isDev && err instanceof Error ? { stack: err.stack } : {}),
  });
}
