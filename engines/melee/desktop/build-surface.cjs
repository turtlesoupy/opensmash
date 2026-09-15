const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (process.platform === "darwin") {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("node-gyp/bin/node-gyp.js"),
      "rebuild",
      "--directory",
      path.join(__dirname, "native"),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
