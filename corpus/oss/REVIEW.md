# OSS corpus — review log

[docs/10 §10.2](../../docs/10-quality-strategy.md) requires that corpus findings
be judged **by a human**, and that the judgement be recorded rather than assumed.
This file is that record. It is the only place a false-positive *rate* exists —
`pnpm corpus:oss` measures noise (density, unresolved rate), not correctness.

## How to review

1. `pnpm corpus:oss:fetch` then `pnpm corpus:oss` — every finding is printed with
   file, line, and confidence.
2. Open each finding in `corpus/oss/.cache/next.js/examples/<app>/` and decide:
   **TP** (a real architectural issue in that code), or **FP** (next-architect is
   wrong).
3. Every FP becomes a `should-not-report` fixture before it is fixed
   ([docs/10 §10.4](../../docs/10-quality-strategy.md)).
4. Record the pass below with a date and who did it.

A pass is only complete when every finding has a verdict. "No findings" is a
valid — and expected — outcome for this corpus.

## Release gate

[docs/09](../../docs/09-roadmap.md) does not let v0.1 ship until this file
contains **at least one completed human pass** with ARCH001 and ARCH003 at zero
false positives.

---

## Passes

### 2026-08-16 — first pass (Claude, **pending human confirmation**)

Corpus: `vercel/next.js@dd76599c`, next-architect 0.1.0, all 6 apps with
dependencies installed. 26 findings reviewed.

docs/10 requires a **human** verdict. This pass was produced by an assistant and
does not satisfy the release gate on its own — it is recorded so the next
reviewer starts from a classified list instead of a blank one.

| App | Rule | Location | Verdict | Notes |
| --- | --- | --- | --- | --- |
| with-styled-components | ARCH001 | `lib/client-layout.tsx:1` | **FP** | Imports `ThemeProvider` from `styled-components`, a client-only package. C3 does not recognize it → D1 |
| with-styled-components | ARCH001 | `app/page.tsx:1` | **FP** | Reaches `styled-components` through `app/_components/sharedstyles` → D1 |
| with-styled-components | ARCH001 | `app/about/page.tsx:1` | **FP** | Same as above → D1 |
| prisma-postgres | ARCH001 | `app/Header.tsx:1` | **TP** | `"use client"` with only `next/link` and JSX. Genuinely unnecessary |
| prisma-postgres | ARCH005 | `app/api/posts/route.ts:18` | **TP** | `post.findMany()` and `post.count()` are independent reads; `Promise.all` is safe |
| with-stripe-typescript | ARCH004 ×2 | `app/components/*` (`stripe`) | **FP** | The server SDK is reached through `app/actions/stripe.ts`, a `"use server"` module. Propagation must stop there → D2 |
| with-stripe-typescript | ARCH004 ×4 | `app/components/*` (`@stripe/stripe-js`, `@stripe/react-stripe-js`) | **noise** | Correct that they are in the client bundle, but unavoidable for a Stripe form → D4 |
| with-supabase | ARCH004 ×8 | `components/*` (`tailwind-merge`) | **FP** | ~7KB gzipped. Unpacked size misrepresents it → D4 |
| with-supabase | ARCH004 ×2 | `components/*` (`lucide-react`) | **FP** | Thousands of icon files unpacked; tree-shakes to the icons used → D4 |
| with-supabase | ARCH004 ×5 | `components/*` (`@supabase/ssr`) | **noise** | Real, but reported once per client entry rather than once per package → D4 |
| image-component | — | — | **tooling** | 100% unresolved-import rate: `.css` / `.png` imports are counted as unresolved → D3 |

Result: **ARCH001 FP = 3 → the v0.1 release gate is not met** (docs/09 requires 0).
ARCH003 FP = 0 (no ARCH003 findings). ARCH004 is dominated by size-heuristic
noise. Report density 24.5 / 100 modules against a limit of 5.

Two true positives on Next.js's own example code, which is the docs/09 v0.1
success criterion ("at least one meaningful ARCH001 on a real project").

## Defects found

Each becomes a `should-not-report` fixture before it is fixed (docs/10 §10.4).

- **D1 — ARCH001 misses client-only third-party packages.** `styled-components`
  has no `"use client"` in its entry file, so rule C3 never fires and the
  killer rule reports correct code with 95% confidence. This is the failure mode
  docs/10 §10.1 describes.
- **D2 — Rule traversals ignore P2.** Graph coloring stops at `"use server"`
  modules ([build.ts](../../packages/graph/src/build.ts)), but ARCH004's and
  ARCH002's own BFS walk straight through them. Server Actions that touch a
  database are the most common modern Next.js pattern, so this would misfire
  widely.
- **D3 — Asset imports count as unresolved.** `.css` / `.png` / `.svg` imports
  are recorded as `unresolved-import`. Because ARCH001 stays silent on any path
  containing an unresolved import, importing a stylesheet in `layout.tsx`
  silently disables the rule for everything below it.
- **D4 — ARCH004 measures the wrong thing at the wrong granularity.** Unpacked
  size treats icon and utility packages that tree-shake to nothing as large, and
  the same package is reported once per client entry. Both are the noise that
  docs/01 §1.5 says the rule must avoid.
