#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootHost } from "./boot-host.js";

const cache = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.exitCode = await bootHost(cache, process.argv.slice(2), (text) => process.stderr.write(text));
