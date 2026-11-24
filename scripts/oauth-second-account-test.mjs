#!/usr/bin/env node
/**
 * Safe second-account Manus OAuth test.
 *
 * This script never prints or stores authorization code, state, session token,
 * cookies, email, name, or any other personal data. It records only the
 * correlation-safe OAuth stage, HTTP status, duration, operation and error code.
 *
 * Prerequisites: Android SDK platform-tools and a USB/Wi-Fi connected device.
 * Usage:
 *   node scripts/oauth-second-account-test.mjs --device SERIAL
 *   node scripts/oauth-second-account-test.mjs --diagnostic
 */

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const serialIndex = process.argv.indexOf("--device");
const serial = serialIndex >= 0 ? process.argv[serialIndex + 1] : undefined;
const adbArgs = serial ? ["-s", serial] : [];

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

function safeLine(line) {
  // Keep only pre-approved structured fields; discard arbitrary Logcat text.
  const match = line.match(
    /\[(OAuth|API)\]\s+(mobile_exchange:[a-z_]+|Request failed|Response)\s*(.*)$/,
  );
  if (!match) return null;
  const fields = match[3];
  const allowed = {};
  for (const field of ["status", "code", "operation", "endpoint", "method", "errorType"]) {
    const found = fields.match(new RegExp(`(?:^|[, {])${field}[:=]\\s*[\\"']?([A-Za-z0-9_./-]+)`));
    if (found) allowed[field] = found[1];
  }
  return { source: match[1], event: match[2], ...allowed };
}

if (args.has("--diagnostic")) {
  const base = "https://pump-rca-ntbesymu.manus.space";
  const started = Date.now();
  const response = await fetch(`${base}/api/oauth/mobile?code=diagnostic-invalid&state=diagnostic-state`);
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({
    test: "invalid-code-envelope",
    status: response.status,
    durationMs: Date.now() - started,
    code: typeof body.code === "string" ? body.code : undefined,
    operation: typeof body.operation === "string" ? body.operation : undefined,
  }, null, 2));
  process.exit(response.status === 500 && body.code === "OAUTH_EXCHANGE_FAILED" ? 0 : 1);
}

if (!serial && process.platform !== "win32") {
  // No serial is fine when exactly one device is connected; adb will select it.
  console.log("Starting safe OAuth capture. No code/state/token values will be shown.");
}

run("adb", [...adbArgs, "logcat", "-c"]);
console.log("Logcat cleared. On the device, complete Manus login with the SECOND account.");
console.log("When the app returns to the OAuth error/success screen, press Enter here.");
await new Promise((resolve) => process.stdin.once("data", resolve));

const raw = run("adb", [...adbArgs, "logcat", "-d", "-v", "brief"]);
const events = raw.split(/\r?\n/).map(safeLine).filter(Boolean);
const unique = [];
const seen = new Set();
for (const event of events) {
  const key = JSON.stringify(event);
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(event);
  }
}
console.log(JSON.stringify({
  test: "second-manus-account",
  capturedAt: new Date().toISOString(),
  events: unique,
  note: "Only safe OAuth metadata is included; secrets and personal data were discarded.",
}, null, 2));
