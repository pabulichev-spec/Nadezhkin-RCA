import crypto from "node:crypto";
import type { Request, Response } from "express";
import { ENV } from "./env";
import { getCsrfCookieOptions } from "./cookies";

export const CSRF_COOKIE_NAME = "pumprca_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ENV.allowedOrigins.includes(origin)) return true;
  if (!ENV.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export function applyCors(req: Request, res: Response): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (!isAllowedOrigin(origin)) return false;
  if (origin) res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-CSRF-Token");
  res.header("Access-Control-Allow-Credentials", "true");
  return true;
}

export function ensureCsrfCookie(req: Request, res: Response) {
  const cookieHeader = req.headers.cookie ?? "";
  if (!/(^|;\s*)pumprca_csrf=/.test(cookieHeader)) {
    res.cookie(CSRF_COOKIE_NAME, crypto.randomBytes(32).toString("hex"), {
      ...getCsrfCookieOptions(req),
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
}

export function hasValidCsrf(req: Request): boolean {
  if (req.headers.authorization) return true;
  const cookieHeader = req.headers.cookie ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)pumprca_csrf=([^;]+)/);
  const cookieToken = cookieMatch?.[1];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

export function isStateChanging(req: Request): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
}
