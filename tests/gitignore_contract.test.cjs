const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("gitignore excludes local secrets, runtime state, logs, and build outputs", () => {
  const gitignore = read(".gitignore");
  for (const pattern of [
    ".env",
    ".env.*",
    ".opentoken/",
    "*.log",
    "npm-debug.log*",
    "build/",
    "dist/",
    "*.pkg",
    "src-tauri/target/",
    "src-tauri/gen/schemas/",
    "coverage/",
    ".codebase-memory/",
  ]) {
    assert.match(gitignore, new RegExp(`(^|\\n)${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\n|$)`));
  }
});

test("gitignore keeps environment template files visible", () => {
  const gitignore = read(".gitignore");
  for (const pattern of [
    "!.env.example",
    "!.env.sample",
    "!*.local.example",
  ]) {
    assert.match(gitignore, new RegExp(`(^|\\n)${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\n|$)`));
  }
});
