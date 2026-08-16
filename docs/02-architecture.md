# 02. 内部アーキテクチャ

## 2.1 パッケージ構成

pnpm workspace + TypeScript のモノレポ。

```
packages/
├── cli/           @next-architect/cli          … 実行エントリ、引数解析、終了コード
├── core/          @next-architect/core         … Project / Context / Rule / Diagnostic
├── parser/        @next-architect/parser       … AST、tsconfig、next.config、Router 走査
├── graph/         @next-architect/graph        … 5 種のグラフ構築
├── rules/         @next-architect/rules        … ARCHxxx 実装
├── reporters/     @next-architect/reporters    … pretty / json / html / sarif
└── mcp/           @next-architect/mcp          … MCP サーバ（GitHub Action は cli の薄いラッパ）
```

公開する npm パッケージは `next-architect`（cli を再エクスポートするファサード）1 つ。
`npx next-architect` で動くことを最優先にする。

### 依存方向

```
cli ──→ core ←── rules
 │       ↑         ↑
 │    graph ──────┘
 │       ↑
 │    parser
 ↓
reporters ──→ core
```

`core` は**誰にも依存しない**（型と抽象のみ）。`rules` は `graph` の読み取り専用 API しか触れない。
この一方向性を守ることで、ルールをプラグインとして外部提供できる（v1.0 の Plugin API）。

## 2.2 解析パイプライン

```
① Discover      プロジェクトルート検出、next.config.*、tsconfig、package.json 読み込み
      ↓
② Enumerate     解析対象ファイルの列挙（tsconfig include / exclude + Router 規約）
      ↓
③ Parse         各ファイルを AST 化、directive / import / export / 使用 API を抽出
      ↓
④ Resolve       import 指定子を実ファイルへ解決（paths エイリアス、拡張子、index）
      ↓
⑤ Build Graph   ModuleGraph → RouteGraph → ServerClientGraph → DataFlowGraph
      ↓
⑥ Propagate     Server/Client 環境ラベルをグラフ上に伝播（→ 03-graph-semantics.md）
      ↓
⑦ Run Rules     各ルールが読み取り専用でグラフを走査、Diagnostic を生成
      ↓
⑧ Report        整形、しきい値フィルタ、終了コード決定
```

③④は並列化する（ファイル単位で独立）。⑥はグラフ全体の不動点計算なので直列。

## 2.3 パーサの選定

| 候補 | 判断 |
| --- | --- |
| **TypeScript Compiler API** | ✅ **採用。** 型情報が要るルール（ARCH005 の依存判定、custom hook の推移解析）が v0.1 時点で存在する。`ts.createProgram` で型チェッカを持てるのが決定打 |
| ts-morph | ラッパとしては便利だがメモリと速度で不利。core は素の Compiler API、テストのみ ts-morph 可 |
| oxc / swc | 高速だが型情報がない。将来 `--fast`（型不要ルールのみ）モードで検討 |

**トレードオフの明示**: Compiler API は数千ファイル規模で遅い。v0.1 では「型情報を要求するルール」と「要求しないルール」を分離し、後者だけを動かす軽量パスを最初から用意しておく（`Rule.requiresTypeInfo: boolean`）。

## 2.4 モジュール解決

自前実装せず、TypeScript の `ts.resolveModuleName` に寄せる。その上で Next.js 固有の補正を入れる。

- `tsconfig.json` の `paths` / `baseUrl`（`@/*` エイリアス）
- `next.config.js` の `webpack` / `turbopack` alias（読めた場合のみ。関数形式は評価しない）
- `.tsx` / `.ts` / `.jsx` / `.js` / `index.*` の解決順
- `next/*`、`react`、`react-dom` は**組み込みノード**として扱い、実体を辿らない
- `node_modules` は既定で **1 段だけ**辿る（`package.json` の `exports`、`sideEffects`、実体サイズを読む）。推移的な深掘りは ARCH004 の `--deep` 時のみ

### 解決失敗の扱い

解決できなかった import は `environment: "unknown"` のノードとして残し、**そこを通る経路の confidence を下げる**。黙って無視すると偽陰性、エラーにすると使い物にならない。「分からないことを分かっている」状態をグラフに持たせる。

## 2.5 Router 走査

`app/` と `pages/` の両方を検出する。

```
app/**/page.{js,jsx,ts,tsx}      → Route
app/**/layout.*                  → Layout（親子で入れ子）
app/**/template.*                → Template
app/**/loading.* / error.*       → 特殊境界（error は暗黙の Client Component）
app/**/route.*                   → Route Handler（常に server）
app/**/default.*                 → Parallel Route
(group) / [param] / [...slug] / @slot  → セグメント種別として解釈
```

`pages/` が存在した場合は検出のみ行い、`v0.1 では Pages Router のルールは実行されません` と告知する（黙って何もしないのが最悪）。

**暗黙の環境ラベル**（見落としやすい）:

- `error.tsx` / `global-error.tsx` は Next.js の仕様上 Client Component。`"use client"` がなくても client として扱う
- `route.ts` は常に server
- `middleware.ts` は client ではないが、通常の Server Component とも実行環境が異なる。
  **runtime を決め打ちしない**: Next.js 15.5 以降は Node.js runtime の middleware も選べるため、
  `export const config = { runtime: ... }` を読んで `edge` / `server` を決める。
  静的に読めない場合は `edge`（制約が厳しい側）を仮定し、`limitations` に記録する

## 2.6 キャッシュと増分解析

実プロジェクトは数千モジュールになる。毎回フル解析すると CI でもローカルでも使われなくなる。

```
.next-architect/cache/
├── meta.json          … ツールバージョン、設定ハッシュ、tsconfig ハッシュ
└── modules/<hash>.json … ファイル内容ハッシュ → 抽出済みメタデータ
```

- キー = ファイル内容の SHA-256 + パーサバージョン
- 無効化 = 設定 / tsconfig / ツールバージョンのいずれかが変われば全破棄
- **グラフ自体はキャッシュしない**（伝播は全体依存のため）。キャッシュするのは③の抽出結果まで

これで実用上、変更ファイルの再パースだけで済む。

## 2.7 ルールの実装形

```ts
export interface Rule {
  id: string;                  // "ARCH001"
  category: RuleCategory;
  defaultSeverity: Severity;
  requiresTypeInfo: boolean;   // 軽量パスで実行可能か
  docs: { summary: string; url: string };
  create(ctx: AnalysisContext): RuleListener;
}

export interface RuleListener {
  onModule?(node: ModuleNode): void;
  onRoute?(node: RouteNode): void;
  onBoundary?(edge: BoundaryEdge): void;  // Server→Client の遷移点
  onFinish?(): void;                      // グラフ全体を見てから出す診断
}
```

`onBoundary` を用意しているのが肝で、境界系ルール（ARCH001〜004）はここを起点に書ける。
ルールは `ctx.report(diagnostic)` 以外の副作用を持たない。
