const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  appendEventLog,
  sanitizeLogDetails,
} = require("../../lib/event-log");

test("sanitizeLogDetails redacts secrets and large payloads", () => {
  const details = sanitizeLogDetails({
    apiToken: "secret-token",
    authorization: "Bearer secret-token",
    path: "/tokenrank/api/subapp/u/account-1234567890?debug=1",
    payload: { rows: [{ tokens: 10 }] },
    nested: {
      clientSecret: "secret-value",
      safe: "visible",
    },
  });

  assert.equal(details.apiToken, "<redacted>");
  assert.equal(details.authorization, "<redacted>");
  assert.equal(details.path, "/tokenrank/api/subapp/u/<account>?debug=1");
  assert.equal(details.payload, "<omitted>");
  assert.deepEqual(details.nested, {
    clientSecret: "<redacted>",
    safe: "visible",
  });
});

test("appendEventLog writes one structured JSON line with a safe schema", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opentoken-event-log-"));
  const logPath = path.join(directory, "island-events.log");

  appendEventLog(logPath, {
    layer: "test",
    event: "button.click",
    flow: "popover.upload",
    details: {
      token: "secret-token",
      status: 200,
    },
  });

  const [line] = fs.readFileSync(logPath, "utf8").trim().split("\n");
  const entry = JSON.parse(line);

  assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.layer, "test");
  assert.equal(entry.event, "button.click");
  assert.equal(entry.flow, "popover.upload");
  assert.deepEqual(entry.details, {
    token: "<redacted>",
    status: 200,
  });
});

test("appendEventLog never throws when the log target cannot be written", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opentoken-event-log-blocked-"));
  const blockedParent = path.join(directory, "not-a-directory");
  fs.writeFileSync(blockedParent, "blocked");
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    assert.equal(appendEventLog(path.join(blockedParent, "events.log"), {
      layer: "test",
      event: "blocked.write",
    }), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("appendEventLog redacts secret-looking event and flow strings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opentoken-event-log-secret-"));
  const logPath = path.join(directory, "island-events.log");

  assert.equal(appendEventLog(logPath, {
    layer: "test",
    event: "Bearer secret-token",
    flow: "authorization secret-token",
  }), true);

  const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(entry.event, "<redacted>");
  assert.equal(entry.flow, "<redacted>");
});

test("appendEventLog redacts token assignment strings in event and flow", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opentoken-event-log-token-assignment-"));
  const logPath = path.join(directory, "island-events.log");

  assert.equal(appendEventLog(logPath, {
    layer: "test",
    event: "token=abc123",
    flow: "authToken:abc123",
  }), true);

  const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(entry.event, "<redacted>");
  assert.equal(entry.flow, "<redacted>");
});
