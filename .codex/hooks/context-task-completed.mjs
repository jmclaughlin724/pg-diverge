#!/usr/bin/env node
import { runAgentHookEvent } from "../../scripts/agent-hooks/runner.mjs";

runAgentHookEvent("TaskCompleted");
