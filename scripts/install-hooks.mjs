#!/usr/bin/env node

import { spawnSync } from "node:child_process";

if (process.env.CI) {
  process.exit(0);
}

const command = process.platform === "win32" ? "lefthook.cmd" : "lefthook";
spawnSync(command, ["install"], { shell: false, stdio: "ignore" });
