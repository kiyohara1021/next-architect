#!/usr/bin/env node
import { runCli } from "@next-architect/cli";

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
