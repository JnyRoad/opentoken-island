const test = require("node:test");
const assert = require("assert");
const { formatCount, formatPercent, toolLabel, toolIcon } = require("../../lib/format");

test("formatCount uses 亿 above 100M", () => {
  assert.equal(formatCount(250_000_000), "2.50亿");
});
test("formatCount uses 万 above 10k", () => {
  assert.equal(formatCount(15_000), "1.5万");
});
test("formatCount rounds small numbers", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(123.4), "123");
});
test("formatPercent rounds and guards non-finite", () => {
  assert.equal(formatPercent(0.5), "50%");
  assert.equal(formatPercent(NaN), "0%");
  assert.equal(formatPercent(Infinity), "0%");
});
test("toolLabel maps known and humanizes unknown", () => {
  assert.equal(toolLabel("claude-code"), "Claude Code");
  assert.equal(toolLabel("my-tool"), "My Tool");
});
test("toolIcon maps known and falls back to terminal", () => {
  assert.equal(toolIcon("codex"), "zap");
  assert.equal(toolIcon("whatever"), "terminal");
});
