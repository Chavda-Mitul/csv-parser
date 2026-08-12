import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";

const headersSchema = z.object({
  "content-type": z.string().startsWith("multipart/form-data", {
    message: "Expected multipart/form-data request",
  }),
});

export function validateUpload(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const result = headersSchema.safeParse(req.headers);
  if (!result.success) {
    throw new AppError(
      400,
      result.error.issues[0]?.message ?? "Invalid request",
    );
  }
  next();
}
