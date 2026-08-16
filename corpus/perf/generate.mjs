#!/usr/bin/env node
/**
 * Generate a synthetic App Router-ish project with ~N TypeScript modules
 * under corpus/perf/1k-modules/ (gitignored). Used by corpus:perf.
 *
 * Usage: node corpus/perf/generate.mjs [--force] [--count=1000]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "1k-modules");
const META_NAME = ".perf-meta.json";

const args = process.argv.slice(2);
const force = args.includes("--force");
const countArg = args.find((a) => a.startsWith("--count="));
const TARGET = Number(countArg?.slice("--count=".length) ?? process.env.PERF_MODULE_COUNT ?? 1000);

if (!Number.isFinite(TARGET) || TARGET < 10) {
  console.error("Invalid module count; need >= 10");
  process.exit(2);
}

function writeFile(rel, contents) {
  const abs = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function alreadyGenerated() {
  const metaPath = path.join(OUT_DIR, META_NAME);
  if (!fs.existsSync(metaPath)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return meta.target === TARGET && Number(meta.moduleFiles) >= TARGET;
  } catch {
    return false;
  }
}

/**
 * Count .ts/.tsx modules (exclude .d.ts).
 */
function countModules(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next-architect") continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) n += 1;
    }
  }
  return n;
}

export function generatePerfCorpus({ force: doForce = false, target = TARGET } = {}) {
  if (!doForce && alreadyGenerated()) {
    return { outDir: OUT_DIR, skipped: true, moduleFiles: countModules(OUT_DIR), target };
  }

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  writeFile(
    "package.json",
    JSON.stringify(
      {
        name: "corpus-perf-1k-modules",
        private: true,
        dependencies: {
          next: "15.0.0",
          react: "19.0.0",
          "react-dom": "19.0.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  writeFile(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          strict: true,
          noEmit: true,
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
          allowJs: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ["**/*.ts", "**/*.tsx"],
      },
      null,
      2,
    ) + "\n",
  );

  writeFile(
    "next-env.d.ts",
    `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`,
  );

  // Budget: layout + root page + N routes + libs + components ≈ target
  const routeCount = Math.max(20, Math.floor(target * 0.05));
  const libCount = Math.floor(target * 0.45);
  const componentCount = Math.floor(target * 0.45);
  // Remainder filled with extra libs if needed after writing core files

  writeFile(
    "app/layout.tsx",
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  );

  writeFile(
    "app/page.tsx",
    `import { Lib0 } from "@/lib/lib-0";

export default function HomePage() {
  return (
    <main>
      <h1>perf corpus</h1>
      <Lib0 />
    </main>
  );
}
`,
  );

  for (let i = 0; i < libCount; i++) {
    const next = i + 1 < libCount ? i + 1 : 0;
    const usesClientComp = i % 7 === 0;
    const compIdx = i % Math.max(componentCount, 1);
    if (usesClientComp && componentCount > 0) {
      writeFile(
        `lib/lib-${i}.tsx`,
        `import { Comp${compIdx} } from "@/components/comp-${compIdx}";
import { lib${next}Value } from "./lib-${next}";

export function Lib${i}() {
  return <Comp${compIdx} label="lib-${i}" />;
}

export function formatLib${i}(n: number): string {
  return \`lib-${i}:\${n + lib${next}Value}\`;
}

export const lib${i}Value = ${i};
`,
      );
    } else {
      writeFile(
        `lib/lib-${i}.ts`,
        `import { lib${next}Value } from "./lib-${next}";

export function formatLib${i}(n: number): string {
  return \`lib-${i}:\${n + lib${next}Value}\`;
}

export const lib${i}Value = ${i};
`,
      );
    }
  }

  for (let i = 0; i < componentCount; i++) {
    const peer = (i + 1) % componentCount;
    writeFile(
      `components/comp-${i}.tsx`,
      `"use client";

${i % 3 === 0 ? `import { useState } from "react";\n` : ""}
export function Comp${i}({ label }: { label: string }) {
${i % 3 === 0 ? `  const [n, setN] = useState(${i});\n` : `  const n = ${i};\n`}
  return (
    <button type="button" onClick={() => ${i % 3 === 0 ? "setN((x) => x + 1)" : "void 0"}}>
      {label}-{n}-peer{${peer}}
    </button>
  );
}
`,
    );
  }

  for (let i = 0; i < routeCount; i++) {
    const libIdx = i % Math.max(libCount, 1);
    const compIdx = i % Math.max(componentCount, 1);
    writeFile(
      `app/r${i}/page.tsx`,
      `import { formatLib${libIdx} } from "@/lib/lib-${libIdx}";
import { Comp${compIdx} } from "@/components/comp-${compIdx}";

export default function Route${i}Page() {
  return (
    <section>
      <p>{formatLib${libIdx}(${i})}</p>
      <Comp${compIdx} label="route-${i}" />
    </section>
  );
}
`,
    );
  }

  // Pad to target with small util modules if short
  let moduleFiles = countModules(OUT_DIR);
  let pad = 0;
  while (moduleFiles < target) {
    writeFile(
      `lib/pad/pad-${pad}.ts`,
      `export const pad${pad} = ${pad};
export function usePad${pad}(x: number): number {
  return x + ${pad};
}
`,
    );
    pad += 1;
    moduleFiles += 1;
  }

  const meta = {
    target,
    moduleFiles: countModules(OUT_DIR),
    routeCount,
    libCount,
    componentCount,
    generatedAt: new Date().toISOString(),
  };
  writeFile(META_NAME, JSON.stringify(meta, null, 2) + "\n");

  return { outDir: OUT_DIR, skipped: false, ...meta };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = generatePerfCorpus({ force, target: TARGET });
  console.log(
    result.skipped
      ? `perf corpus already present (${result.moduleFiles} modules) at ${result.outDir}`
      : `generated ${result.moduleFiles} modules (target ${result.target}) at ${result.outDir}`,
  );
}
