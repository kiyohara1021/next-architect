# 08. MCP サーバ設計

## 8.1 なぜ MCP が本命なのか

next-architect の出力は「AI が最も苦手で、最も必要としている情報」そのもの。

LLM は 1 ファイルを見て書く。だから `"use client"` を過剰に付け、barrel 経由で server 依存を
client に引き込む。**これは LLM の構造的な弱点であり、プロンプトでは直らない。**

next-architect はプロジェクト全体のグラフを持っている。これを AI に渡せば、

```
AI がコードを書く
  ↓
next-architect が構造を検証する   ← 決定的、高速、説明可能
  ↓
AI が直す
  ↓
next-architect が再検証する       ← ✓ No architecture violations
```

という **Analyze → Fix → Verify ループ**が閉じる。
CLI は人間向け、MCP は AI 向け。同じエンジンの 2 つの顔。

## 8.2 起動

```bash
npx next-architect mcp
```

```json
{
  "mcpServers": {
    "next-architect": {
      "command": "npx",
      "args": ["-y", "next-architect", "mcp"],
      "cwd": "/path/to/next-app"
    }
  }
}
```

対象クライアント: Claude Code / Codex / Cursor。

## 8.3 ツール一覧

| Tool | 用途 |
| --- | --- |
| `get_architecture` | プロジェクト全体の構造サマリ |
| `get_diagnostics` | 診断の取得（フィルタ可） |
| `explain_rule` | ルールの解説とドキュメント |
| `find_client_boundaries` | `"use client"` 境界の一覧と、その先の closure |
| `find_server_leaks` | server 指向コードが client graph に入っている経路 |
| `explain_module` | 1 モジュールがなぜその環境なのか（経路付き） |
| `suggest_fix` | 診断に対する修正提案（適用はしない） |
| `verify` | 再解析して違反が消えたか確認 |

`explain_module` は当初案になかったが**追加した**。AI は「なぜこのファイルが client なのか」を
最も頻繁に尋ねる。`environmentReason.via` をそのまま返せば答えになる。

## 8.4 シグネチャ

```ts
get_architecture(input: {
  includeRoutes?: boolean;      // default true
  includeModules?: boolean;     // default false（大きいため）
}): {
  project: { root, nextVersion, router, moduleCount, routeCount };
  environments: { server: number; client: number; shared: number; edge: number; unknown: number };
  routes?: Array<{ id, page, layouts, clientModuleCount }>;
  score: ArchitectureScore;
  limitations: Limitation[];
}

get_diagnostics(input: {
  ruleIds?: string[];
  severities?: Severity[];
  minConfidence?: number;       // default 0.7
  path?: string;                // glob
  limit?: number;               // default 50
}): { diagnostics: Diagnostic[]; total: number; truncated: boolean }

find_client_boundaries(input: { route?: string }): Array<{
  module: string;
  reason: EnvReason;
  clientClosure: string[];      // この境界から client に入る全モジュール
  estimatedBytes?: number;
}>

find_server_leaks(input: { minConfidence?: number }): Array<{
  diagnostic: Diagnostic;       // ARCH002 / ARCH003
  path: DiagnosticPath;
}>

explain_module(input: { module: string }): {
  environment: Environment;
  reason: EnvReason;
  /** client なら、彩色元からの最短経路 */
  colorPath?: string[];
  importedBy: string[];
  imports: ImportEdge[];
  clientSignals: ClientSignal[];
}

suggest_fix(input: { ruleId: string; file: string }): {
  applicable: boolean;
  confidence: number;
  description: string;
  edits?: TextEdit[];           // 適用は AI 側（＝ユーザー承認を経る）
  caveats: string[];
}

verify(input: { ruleIds?: string[] }): {
  passed: boolean;
  before?: { errors: number; warnings: number };
  after: { errors: number; warnings: number };
  remaining: Diagnostic[];
}
```

## 8.5 MCP 特有の設計判断

### ① `suggest_fix` はファイルを書かない

編集は必ず AI クライアント側の編集ツールを通す。理由:

- ユーザーの承認フローに乗る（勝手に書き換わらない）
- 差分がクライアントの UI に出る
- MCP サーバが破壊的操作を持たないので、権限設計が単純になる

**MCP サーバは読み取り専用。** これを設計の不変条件にする。

### ② トークン量を制御する

`get_diagnostics` が 300 件返すと AI のコンテキストを潰す。

- 既定 `limit: 50`、`truncated: true` を返す
- `Diagnostic.explanation` は既定で省略し、`explain_rule` に誘導する
- `get_architecture` の `includeModules` は既定 false

**AI 向け API は「全部返す」が正解ではない。**

### ③ キャッシュを共有する

MCP サーバは常駐するので、[02-architecture.md §2.6](02-architecture.md) のキャッシュに加えて
**メモリ上にグラフを保持**し、ファイル変更を watch して増分更新する。
`verify` が数百ミリ秒で返らないとループが成立しない。

### ④ `verify` が返すのは「消えたか」

AI は「直した」と言いがちなので、`before` / `after` を並べて返す。
差分が出ていなければ `passed: false`。**AI の自己申告を検証する側に回る。**

## 8.6 想定される対話

```
User: このページが遅い理由を調べて

AI  → get_diagnostics({ path: "app/dashboard/**" })
    ← ARCH005 Potential request waterfall  (app/dashboard/page.tsx:18)
       ARCH002 Client Boundary Pollution   (components/Chart.tsx)
       ARCH004 Large dependency            (huge-library, ~428KB)

AI  → explain_module({ module: "components/Chart.tsx" })
    ← environment: client
       reason: { kind: "directive" }
       clientSignals: []          ← 実は client 機能がない

AI: 3 つ見つかりました。まず Chart.tsx の "use client" は不要そうです…
    （修正）

AI  → verify()
    ← passed: true
       before: { errors: 0, warnings: 3 }
       after:  { errors: 0, warnings: 0 }
```
