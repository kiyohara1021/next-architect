import { runCheck, formatExplain, type CheckOptions } from "./check.js";

function printHelp(): void {
  console.log(`next-architect — Architecture intelligence for Next.js

Usage:
  next-architect                         Run check
  next-architect check [options]         Analyze project
  next-architect explain <RULE|score>    Explain a rule or the score formula

Options:
  --rule <ID...>           Run only these rules
  --format <fmt>           pretty | json | sarif | github (default: pretty)
  --ci                     No color; exit 1 on high-confidence warnings
  --min-confidence <n>     Display threshold (default: 0.70)
  --include-shakeable      Show tree-shakeable barrel paths
  --show-suppressed        Include suppressed diagnostics
  --fast                   Skip type-info rules (ARCH005)
  --no-cache               Disable incremental cache
  --root <path>            Project root
  --verbose                Show unresolved imports detail
  -h, --help               Show help
  -v, --version            Show version
`);
}

function parseArgs(argv: string[]): {
  command: string;
  explainTarget?: string;
  options: CheckOptions;
  help: boolean;
  version: boolean;
} {
  const options: CheckOptions = {};
  let command = "check";
  let explainTarget: string | undefined;
  let help = false;
  let version = false;

  const args = [...argv];
  if (args[0] === "check" || args[0] === "explain") {
    command = args.shift()!;
  }

  if (command === "explain") {
    explainTarget = args.shift();
  }

  while (args.length) {
    const a = args.shift()!;
    switch (a) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "-v":
      case "--version":
        version = true;
        break;
      case "--ci":
        options.ci = true;
        break;
      case "--include-shakeable":
        options.includeShakeable = true;
        break;
      case "--show-suppressed":
        options.showSuppressed = true;
        break;
      case "--fast":
        options.fast = true;
        break;
      case "--no-cache":
        options.noCache = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--root":
        options.root = args.shift();
        break;
      case "--min-confidence":
        options.minConfidence = Number(args.shift());
        break;
      case "--format": {
        const fmt = args.shift() as CheckOptions["format"];
        options.format = fmt;
        break;
      }
      case "--rule": {
        options.rules = options.rules ?? [];
        while (args[0] && !args[0].startsWith("-")) {
          options.rules.push(args.shift()!.toUpperCase());
        }
        break;
      }
      default:
        if (a.startsWith("-")) {
          console.error(`Unknown option: ${a}`);
          help = true;
        } else if (!options.root) {
          // Positional project root: `next-architect check ./my-app`
          options.root = a;
        }
        break;
    }
  }

  return { command, explainTarget, options, help, version };
}

export async function runCli(argv: string[]): Promise<number> {
  const { command, explainTarget, options, help, version } = parseArgs(argv);

  if (help) {
    printHelp();
    return 0;
  }
  if (version) {
    const { TOOL_VERSION } = await import("@next-architect/core");
    console.log(TOOL_VERSION);
    return 0;
  }

  if (command === "explain") {
    if (!explainTarget) {
      console.error("Usage: next-architect explain <ARCH001|score>");
      return 2;
    }
    console.log(formatExplain(explainTarget));
    return 0;
  }

  const outcome = await runCheck(options);
  console.log(outcome.output);
  return outcome.exitCode;
}

export { runCheck, formatExplain };
export type { CheckOptions, CheckOutcome } from "./check.js";
