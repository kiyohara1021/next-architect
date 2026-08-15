# next-architect

**Architecture intelligence for Next.js applications.**

「このコードは正しいか？」ではなく、**「この Next.js アプリの構造は健全か？」** を診断する CLI。

> ⚠️ このリポジトリは現在 **設計フェーズ**。実装コードはまだ入っていない。
> 仕様は [`docs/`](docs/) 配下にある。

---

## 何をするツールか

Next.js の App Router では `"use client"` が **Server / Client の module graph 境界** を作る。
この境界はファイル単体を見ても正しさが判断できず、**プロジェクト全体の依存グラフ**を構築して初めて評価できる。

next-architect は、

```
Source Code ─┐
Config ──────┼─→ Architecture Graph ─→ Rule Engine ─→ Diagnostics
Package ─────┘
```

という流れで、**境界・依存・データ取得・ルーティング・バンドル流入**を静的に解析する。

## next-architect is not another ESLint plugin.

| Tool                | 主目的                          |
| ------------------- | ------------------------------- |
| ESLint (`eslint-config-next`) | コード品質 / Next.js 固有の既知パターン |
| TypeScript          | 型                              |
| Lighthouse          | 実ブラウザ性能                  |
| Bundle Analyzer     | バンドル可視化                  |
| React DevTools      | React 実行時状態                |
| Next.js DevTools    | Next.js 開発 / 実行時状態       |
| **next-architect**  | **Next.js アーキテクチャ静的解析** |

ESLint は「1ファイルを見て分かること」を得意とする。
next-architect は「**プロジェクト全体を見ないと分からないこと**」だけを扱う。

- `"use client"` は本当に必要か（ARCH001）
- その依存はなぜ Client Bundle に入ったのか（ARCH002 / ARCH004）
- Server 専用コードが Client に到達していないか（ARCH003 / ARCH009）
- その `await` は直列である必要があるか（ARCH005）

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [01-concept.md](docs/01-concept.md) | コンセプト、スコープ、競合ポジショニング、非目標 |
| [02-architecture.md](docs/02-architecture.md) | 内部アーキテクチャ、パッケージ構成、解析パイプライン |
| [03-graph-semantics.md](docs/03-graph-semantics.md) | **Server/Client 伝播規則、barrel file 問題**（本体の心臓部） |
| [04-data-model.md](docs/04-data-model.md) | 型定義、Diagnostic、confidence の定義 |
| [05-rules.md](docs/05-rules.md) | ルール仕様 ARCH001〜005（v0.1）＋ v0.2 候補 |
| [06-cli.md](docs/06-cli.md) | CLI コマンド、出力フォーマット、設定ファイル、抑制構文 |
| [07-scoring.md](docs/07-scoring.md) | Architecture Score の算出と、その扱いの制約 |
| [08-mcp.md](docs/08-mcp.md) | MCP サーバ設計（AI → Analyze → Fix → Verify ループ） |
| [09-roadmap.md](docs/09-roadmap.md) | v0.1 〜 v1.0 のロードマップ |
| [10-quality-strategy.md](docs/10-quality-strategy.md) | 誤検知率をどう測り、どう抑えるか |
| [11-open-questions.md](docs/11-open-questions.md) | 未決事項（名前の可用性確認を含む） |

## 設計上の 3 つの約束

1. **決定的であること。** LLM はコードを読まない。AST → グラフ → ルールエンジン → 決定的な結果。AI はその**利用者**であって、解析器ではない。
2. **誤検知を出さないこと。** 全ルールは `confidence` を持ち、しきい値以下は既定で非表示。`--fix` は confidence が極めて高いものだけ。
3. **スコアを品質保証に見せないこと。** Architecture Score は「検出されたアーキテクチャリスクの量」であって、アプリの品質ではない。
