const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const pkg = readJson("package.json");
assert.equal(pkg.scripts.test, "node tests/windows_support_contract.test.cjs");
assert.equal(pkg.scripts["tauri:dev"], "tauri dev");
assert.equal(pkg.scripts["tauri:build"], "tauri build");
assert.equal(pkg.devDependencies["@tauri-apps/cli"], "^2.11.3");

const config = readJson("src-tauri/tauri.conf.json");
assert.equal(config.identifier, "com.opentoken.island.windows");
assert.equal(config.productName, "OpenToken Island");
assert.equal(config.app.withGlobalTauri, false);
assert.deepEqual(config.bundle.targets, ["nsis"]);
assert.ok(config.bundle.icon.includes("icons/icon.png"));

const cargoToml = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
assert.match(cargoToml, /tauri = \{ version = "2"/);
assert.match(cargoToml, /features = \["tray-icon", "image-png"\]/);

console.log("windows scaffold contract ok");
