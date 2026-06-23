const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseJsonFileOrEmpty } = require("../../server.js");

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
  fs.writeFileSync(bad, "{not json");
  try {
    assert.deepEqual(parseJsonFileOrEmpty(bad, { tolerateCorruption: true }), {});
  } finally {
    fs.unlinkSync(bad);
  }
});
