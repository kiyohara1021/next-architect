# 01. コンセプト

## 1.1 一行定義

> **next-architect は、Next.js の Server/Client アーキテクチャを理解して、設計上の問題を自動発見する静的解析エンジンである。**

## 1.2 なぜ ESLint ではないのか

Next.js 公式の `eslint-config-next` はすでに Next.js 固有ルールを提供している。ここに正面衝突すると「また Next.js 用の Lint を作りました」で終わる。

決定的な違いは **解析の単位** にある。

```
ESLint          : 1 ファイル（+ 型情報）を見て判断できること
next-architect  : プロジェクト全体のグラフを見ないと判断できないこと
```

`"use client"` の妥当性は、後者にしか存在しない。

- そのファイル単体には `useState` がないが、**import 先**が client-only かもしれない
- そのファイルは正当な Client Component だが、**その先の依存**が DB クライアントに到達しているかもしれない
- その `await` は前の結果に依存していないが、それは **呼び出し先の関数シグネチャ**を辿らないと分からない

ESLint のルール API は「1ファイル1パス」を前提とするため、この領域は構造的に苦手である。ここが next-architect の存在領域になる。

## 1.3 スコープ（v0.1）

| Category | 解析内容 | 主なルール |
| --- | --- | --- |
| 🟢 Boundary | Server / Client 境界 | ARCH001, ARCH003 |
| 🟢 Dependency | import 依存関係 | ARCH002 |
| 🟢 Data | データ取得パターン | ARCH005 |
| 🟢 Route | App Router 構造 | （v0.1 ではグラフ構築のみ、ルールは v0.2） |
| 🟢 Bundle | Client 側へ流入する依存 | ARCH004 |

v0.1 の**キラー機能**は明確に 1 つに絞る:

> **Unnecessary Client Component Detection（ARCH001）**

「入れたら即座に価値が出る」ものが 1 つあれば導入される。残りは信頼を積むための土台。

## 1.4 非目標（やらないこと）

明示的に線を引く。ここが曖昧だと「なんでも解析するツール」になって死ぬ。

| やらない | 理由 |
| --- | --- |
| 一般的なコード品質（命名、複雑度、未使用変数） | ESLint / Biome の領域 |
| 型検査 | TypeScript の領域 |
| 実行時計測 | Lighthouse / Next.js DevTools の領域 |
| **バンドルサイズの正確な計測** | Bundle Analyzer の領域。**「なぜ入ったか」だけを売りにする**（→ 1.5） |
| Pages Router の深い解析 | v0.1 は検出して「非対応」と告げるのみ。App Router に集中 |
| 自動リファクタリング全般 | `--fix` は confidence 極大のもののみ（→ [06-cli.md](06-cli.md)） |
| LLM によるコード解釈 | 決定的でなくなる（→ 1.6） |

## 1.5 ARCH004 の立ち位置（重要）

`@next/bundle-analyzer` はすでにバンドル可視化を提供している。**サイズを測ること自体を売りにしない。**

売りは「**なぜその依存が Client Bundle に入ったのか**」という **到達経路** である。

```
Bundle Analyzer : huge-library が 428KB 入っている    （What）
next-architect  : components/Chart.tsx の "use client" から
                  lib/utils/index.ts 経由で入っている  （Why）
```

Analyzer は結果を見せる。next-architect は原因を見せる。サイズは経路に添える補助情報として、**概算であることを明示して**出す。

## 1.6 AI を最初から入れすぎない

```
AST
 ↓
Dependency Graph
 ↓
Static Analysis
 ↓
Rule Engine
 ↓
Deterministic Result
```

ここまでに LLM は一切登場しない。理由:

- 同じコードには常に同じ結果が出る必要がある（CI で使うため）
- 実行にコストと待ち時間が乗ってはいけない
- 誤検知の原因が追跡可能でなければならない

その上に出力層として AI を載せる。

```
                 ┌─ CLI
                 ├─ JSON
                 ├─ HTML
Static Analysis ─┼─ GitHub PR
                 └─ MCP ─→ AI
```

> **AI が解析する OSS ではなく、AI が利用できる Next.js Architecture Engine。**

この非対称性が、そのまま MCP の設計（→ [08-mcp.md](08-mcp.md)）につながる。

## 1.7 想定ユーザーとユースケース

1. **AI にコードを書かせているチーム** — 生成された Next.js コードの構造を Architecture Guard で検証する。`"use client"` の過剰付与は LLM が最もやりがちなミス。
2. **App Router へ移行中のチーム** — Pages Router 由来の癖（全部 Client）が残っていないか可視化する。
3. **既存アプリのバンドル肥大に悩むチーム** — ARCH002 / ARCH004 の経路表示。

特に 1 は、このツールの一番強いストーリーになる。

```
AI がコードを書く
  ↓
next-architect が構造を検証する
  ↓
AI が直す
  ↓
next-architect が再検証する
```
