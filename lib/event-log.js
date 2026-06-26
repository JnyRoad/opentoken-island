const fs = require("fs");
const path = require("path");

const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 4;
const REDACTED = "<redacted>";
const OMITTED = "<omitted>";
const EVENT_LOG_FILE_PREFIX = "island-events";

const SECRET_KEY_PATTERN = /(authorization|cookie|password|secret|token|apiKey|api_token|apikey)/i;
const SECRET_VALUE_PATTERN = /(bearer\s+[a-z0-9._~+/=-]+|authorization(?:\s*[:=]|\s+)|(?:api[_-]?token|auth[_-]?token|token|secret[_-]?token)\s*[:=]|x-opentoken-island-token)/i;
const LARGE_BODY_KEY_PATTERN = /^(body|payload|raw|stdout|stderr)$/i;
const ACCOUNT_PATH_PATTERN = /(\/tokenrank\/api\/subapp\/u\/)[^/?#]+/;
let lastLogFailureWarningAt = 0;

function redactPath(value) {
  return String(value).replace(ACCOUNT_PATH_PATTERN, "$1<account>");
}

function sanitizeString(value) {
  const redacted = redactPath(value);
  if (SECRET_VALUE_PATTERN.test(redacted)) return REDACTED;
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}...<truncated>`;
}

function sanitizeValue(value, key = "", depth = 0) {
  if (SECRET_KEY_PATTERN.test(key)) return REDACTED;
  if (LARGE_BODY_KEY_PATTERN.test(key)) return OMITTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name || "Error"),
      message: sanitizeString(value.message || ""),
    };
  }
  if (depth >= MAX_DEPTH) return "<max-depth>";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, key, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryValue, entryKey, depth + 1),
        ])
    );
  }
  return sanitizeString(String(value));
}

function sanitizeLogDetails(details = {}) {
  return sanitizeValue(details, "details", 0) || {};
}

function logDateSegment(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("event log date must be valid");
  }
  return date.toISOString().slice(0, 10);
}

function resolveDailyEventLogPath(logDirectory, now = new Date()) {
  if (!logDirectory || typeof logDirectory !== "string") {
    throw new TypeError("event log directory must be a string");
  }
  return path.join(logDirectory, `${EVENT_LOG_FILE_PREFIX}-${logDateSegment(now)}.log`);
}

function appendEventLog(logPath, entry, { now = new Date() } = {}) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("event log entry must be an object");
  }
  try {
    const line = JSON.stringify({
      at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
      layer: sanitizeString(entry.layer || "server"),
      event: sanitizeString(entry.event || entry.message || "event"),
      flow: sanitizeString(entry.flow || ""),
      details: sanitizeLogDetails(entry.details || {}),
    });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`);
    return true;
  } catch (error) {
    const now = Date.now();
    if (now - lastLogFailureWarningAt > 60000) {
      lastLogFailureWarningAt = now;
      console.warn(`[event-log] failed to write event log: ${error.message}`);
    }
    return false;
  }
}

function appendDailyEventLog(logDirectory, entry, { now = new Date() } = {}) {
  try {
    return appendEventLog(resolveDailyEventLogPath(logDirectory, now), entry, { now });
  } catch (error) {
    const warningAt = Date.now();
    if (warningAt - lastLogFailureWarningAt > 60000) {
      lastLogFailureWarningAt = warningAt;
      console.warn(`[event-log] failed to write event log: ${error.message}`);
    }
    return false;
  }
}

module.exports = {
  appendEventLog,
  appendDailyEventLog,
  resolveDailyEventLogPath,
  sanitizeLogDetails,
};
