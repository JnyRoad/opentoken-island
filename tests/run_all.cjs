const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

function findTests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) return findTests(absolutePath);
      if (!entry.name.endsWith(".test.cjs")) return [];
      return [path.relative(root, absolutePath)];
    })
    .sort();
}

run(process.execPath, ["--test", ...findTests(path.join(root, "tests"))]);

const rustTestBin = path.join(
  os.tmpdir(),
  `opentoken-windows-support-tests-${process.pid}${process.platform === "win32" ? ".exe" : ""}`
);
run("rustc", ["--test", path.join("src-tauri", "src", "windows_support.rs"), "-o", rustTestBin]);
run(rustTestBin, []);
