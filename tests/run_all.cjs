const { spawnSync } = require("child_process");
const path = require("path");

const tests = [
  "windows_support_contract.test.cjs",
  "share_poster_contract.test.cjs",
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
