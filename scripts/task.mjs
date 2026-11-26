// Package-manager-independent tasks. Production CLI deliberately uses Node, including bun installs.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const [task, ...input] = process.argv.slice(2);
const args = input[0] === "--" ? input.slice(1) : input;
function run(argv) {
  const result = spawnSync(process.execPath, argv, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const tsc = fileURLToPath(
  new URL("bin/tsc", import.meta.resolve("typescript/package.json")),
);
// TypeScript leaves deleted modules in the output. A package build must start with a fresh dist.
if (task === "build") rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
run([tsc, "-p", "tsconfig.json", ...(task === "check" ? ["--noEmit"] : [])]);
if (task === "test") {
  // This file starts and restarts several real child processes.
  const collaborationPolicy = "collaboration-policy-client.test.mjs";
  const tests = readdirSync("test")
    .filter((f) => f.endsWith(".test.mjs") && f !== collaborationPolicy)
    .map((f) => `test/${f}`);
  run(["--test", "--test-timeout=20000", ...tests]);
  run(["--test", "--test-timeout=60000", `test/${collaborationPolicy}`]);
} else if (task === "pida") run(["dist/cli.js", ...args]);
else if (!["build", "check"].includes(task)) throw new Error("Unknown task");
