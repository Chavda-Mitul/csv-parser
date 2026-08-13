import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error("API_KEY environment variable is required");
}

export function apiKeyAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.header("x-api-key") !== apiKey) {
    throw new AppError(401, "Unauthorized");
  }
  next();
}
