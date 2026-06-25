const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { findOpenTokenBinary, parseJsonFileOrEmpty } = require("../../server.js");

test("returns {} when file is missing (ENOENT)", () => {
  const missing = path.join(os.tmpdir(), "definitely-missing-" + process.pid + ".json");
  assert.deepEqual(parseJsonFileOrEmpty(missing), {});
});

test("throws when file exists but is corrupt JSON", () => {
  const bad = path.join(os.tmpdir(), "corrupt-" + process.pid + ".json");
  fs.writeFileSync(bad, "{not json");
  try {
    assert.throws(() => parseJsonFileOrEmpty(bad), /Failed to parse JSON/);
  } finally {
    fs.unlinkSync(bad);
  }
});

test("parses valid JSON", () => {
  const good = path.join(os.tmpdir(), "good-" + process.pid + ".json");
  fs.writeFileSync(good, '{"webhook_url":"x"}');
  try {
    assert.deepEqual(parseJsonFileOrEmpty(good), { webhook_url: "x" });
  } finally {
    fs.unlinkSync(good);
  }
});

test("treats an empty file as {} (interrupted write), not corruption", () => {
  const empty = path.join(os.tmpdir(), "empty-" + process.pid + ".json");
  fs.writeFileSync(empty, "   \n");
  try {
    assert.deepEqual(parseJsonFileOrEmpty(empty), {});
  } finally {
    fs.unlinkSync(empty);
  }
});

test("tolerateCorruption returns {} instead of throwing on bad JSON", () => {
  const bad = path.join(os.tmpdir(), "tolerate-" + process.pid + ".json");
  const warnings = [];
  fs.writeFileSync(bad, "{not json");
  try {
    assert.deepEqual(parseJsonFileOrEmpty(bad, {
      tolerateCorruption: true,
      warn: (message) => warnings.push(message),
    }), {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ignoring corrupt JSON/);
    assert.match(warnings[0], /tolerate-/);
  } finally {
    fs.unlinkSync(bad);
  }
});

test("findOpenTokenBinary surfaces unexpected filesystem errors", () => {
  const originalAccessSync = fs.accessSync;
  const unexpectedError = Object.assign(new Error("disk read failed"), { code: "EIO" });
  fs.accessSync = () => {
    throw unexpectedError;
  };

  try {
    assert.throws(() => findOpenTokenBinary(), /disk read failed/);
  } finally {
    fs.accessSync = originalAccessSync;
  }
});

test("findOpenTokenBinary skips inaccessible candidate paths", () => {
  const originalAccessSync = fs.accessSync;
  fs.accessSync = () => {
    throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  };

  try {
    assert.equal(findOpenTokenBinary(), "");
  } finally {
    fs.accessSync = originalAccessSync;
  }
});

test("findOpenTokenBinary continues after an expected miss", () => {
  const originalAccessSync = fs.accessSync;
  let attempts = 0;
  fs.accessSync = (candidate) => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    if (!candidate.endsWith("/opt/homebrew/bin/opentoken")) {
      throw Object.assign(new Error("unexpected candidate"), { code: "EIO" });
    }
  };

  try {
    assert.equal(findOpenTokenBinary(), "/opt/homebrew/bin/opentoken");
    assert.equal(attempts, 2);
  } finally {
    fs.accessSync = originalAccessSync;
  }
});
