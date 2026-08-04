#!/usr/bin/env node
import { runSessionLifecycleEvent } from "../../scripts/agent-hooks/session-lifecycle.mjs";

runSessionLifecycleEvent("SessionEnd");
