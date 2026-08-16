# next-architect

**Architecture intelligence for Next.js applications.**

「このコードは正しいか？」ではなく、**「この Next.js アプリの構造は健全か？」** を診断する CLI。

> next-architect is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Vercel.

---

## Status

**v0.1 Core Engine is implemented.** Specs in [`docs/`](docs/) remain the source of truth.

Gates in CI: ARCH001–005 corpus FP runners, smoke, and a 1k-module perf gate. Not published to npm yet — use from this repo after build.

### What the "0 false positives" claim covers

The per-rule FP gates run against **hand-written synthetic cases in this repo**.
ARCH001 and ARCH003 report zero false positives there, which is a regression
guard — not evidence that the rules are quiet on real code.

The OSS corpus ([`corpus/oss/`](corpus/oss/)) closes part of that gap: six pinned
App Router examples from `vercel/next.js`, analyzed with their real dependencies
installed. It measures **noise** — report density and unresolved-import rate.
Whether each finding is a true or false positive is a human call, recorded in
[`corpus/oss/REVIEW.md`](corpus/oss/REVIEW.md), and **no human-confirmed pass
exists yet**. Until one does, the FP numbers describe our own fixtures only.

The corpus found four defects on its first run — including three ARCH001 false
positives on Next.js's own example code. Those are fixed and guarded by
fixtures. It still fails its own density gate (6.6 findings per 100 modules
against a limit of 5), and the remaining noise is ARCH004's unpacked-size
proxy; see D5 in the review log.

The same applies to `corpus:perf`: 1,000 generated modules with trivial bodies say
little about a real project of that size.

Known gaps vs full v0.1 polish (intentionally deferred):

- ARCH002 does not yet flag non-`NEXT_PUBLIC_` `process.env` as a strong server signal ([docs/05](docs/05-rules.md#arch002--client-boundary-pollution))
- ARCH004 reports the exports the client graph uses, but not the `n of m` ratio in [docs/05](docs/05-rules.md#arch004--large-dependency-in-client-bundle) — the package's own export count needs a type-aware pass
- Parser keeps a Program handle for API compat but does not run a type-aware bind for rules
- The OSS corpus has no completed human review pass ([docs/10](docs/10-quality-strategy.md)) — this blocks the v0.1 tag
- MCP / HTML report / `fix` are later milestones ([docs/09](docs/09-roadmap.md))

## Install / Build / Test

From the repo root (Node ≥ 20, pnpm 9):

```bash
pnpm install
pnpm build
pnpm test
```

## CLI

After `pnpm build`, run against a Next.js App Router project:

```bash
# via workspace script (recommended in-repo)
pnpm next-architect check --root /path/to/next-app
pnpm next-architect check --root /path/to/next-app --format json
pnpm next-architect explain ARCH001
pnpm next-architect explain score

# or the package binary
pnpm --filter next-architect exec next-architect check --root /path/to/next-app
```

Omit `--root` to analyze the current working directory.

## Corpus gates

```bash
pnpm corpus:arch001   # ARCH001 FP gate
pnpm corpus:arch002
pnpm corpus:arch003
pnpm corpus:arch004
pnpm corpus:arch005
pnpm corpus:smoke     # end-to-end smoke fixtures
pnpm corpus:perf      # 1k-module cold/warm timing (generates gitignored tree)
pnpm corpus:all       # all of the above, sequentially
```

The OSS corpus is separate because it clones a third-party repository and
installs its dependencies. It runs nightly rather than per pull request, so an
upstream outage never fails an unrelated PR.

```bash
pnpm corpus:oss:fetch   # sparse checkout of pinned vercel/next.js examples + npm install
pnpm corpus:oss         # report density / unresolved rate (add --update to rewrite the snapshot)
pnpm corpus:diff        # compare against corpus/oss/snapshot.json
```

## Packages

| Package | Name |
| --- | --- |
| `packages/core` | `@next-architect/core` |
| `packages/parser` | `@next-architect/parser` |
| `packages/graph` | `@next-architect/graph` |
| `packages/rules` | `@next-architect/rules` |
| `packages/reporters` | `@next-architect/reporters` |
| `packages/cli` | `@next-architect/cli` |
| `packages/next-architect` | `next-architect`（公開ファサード） |
| `packages/mcp` | `@next-architect/mcp`（v0.4 予定のスタブ） |

## v0.1 Rules

| ID | Name |
| --- | --- |
| ARCH001 | Unnecessary Client Component |
| ARCH002 | Client Boundary Pollution |
| ARCH003 | Server Module in Client Graph |
| ARCH004 | Large Dependency in Client Bundle |
| ARCH005 | Potential Request Waterfall |

## Docs

Design docs under [docs/](docs/) — start with:

- [01-concept.md](docs/01-concept.md)
- [03-graph-semantics.md](docs/03-graph-semantics.md)
- [05-rules.md](docs/05-rules.md)
- [06-cli.md](docs/06-cli.md)
- [09-roadmap.md](docs/09-roadmap.md)
- [10-quality-strategy.md](docs/10-quality-strategy.md)
- [11-open-questions.md](docs/11-open-questions.md)

## License

MIT
