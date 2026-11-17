# Contributing to next-architect

[English](#english) | [日本語](#日本語)

## English

Bug reports, false-positive reports, new rules, and documentation fixes are welcome.

- Search existing issues first. For a new rule or a behavior change, open an issue before implementing it.
- Specs in [`docs/`](docs/) are the source of truth. Update the spec in the same PR as the implementation.
- Never paste private source code. Reduce a false positive to a minimal fixture.

### Development

Requires Node.js 22+ and pnpm 9.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm corpus:all   # false-positive / smoke / perf gates
```

All of the above run in CI and must pass before merge.

## 日本語

不具合・誤検知の報告、新しいルール、文書の修正を歓迎します。

- まず既存 Issue を検索してください。新しいルールや挙動の変更は、実装前に Issue で相談してください。
- 仕様は [`docs/`](docs/) が正です。実装と同じ PR で仕様も更新してください。
- 非公開のソースコードは貼らず、誤検知は最小のフィクスチャにして報告してください。

### 開発

Node.js 22 以上と pnpm 9 が必要です。上の英語セクションのコマンドで、ビルド・型チェック・テスト・コーパスゲートを実行できます。CI でも同じ検査を行い、すべて成功してからマージします。
