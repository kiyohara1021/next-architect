# 06. CLI 仕様

## 6.1 コマンド

v0.1 で実装するのはこれだけ。増やさない。

```bash
npx next-architect                      # = check
npx next-architect check
npx next-architect check --rule ARCH001
npx next-architect check --format json
npx next-architect check --ci
npx next-architect explain ARCH002      # ルールの解説
npx next-architect explain score        # スコア算出式の表示（07-scoring.md §7.4）
```

v0.2 以降:

```bash
npx next-architect report               # HTML
npx next-architect fix                  # 自動修正（confidence ≥ 0.95 のみ）
npx next-architect graph --route /dashboard   # 特定ルートのグラフ出力
npx next-architect mcp                  # MCP サーバとして起動
```

## 6.2 オプション

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--rule <ID...>` | 全部 | 指定ルールのみ実行 |
| `--format <fmt>` | `pretty` | `pretty` / `json` / `sarif` / `github` |
| `--ci` | false | 色なし、confidence ≥ 0.80 の warning 以上で exit 1 |
| `--min-confidence <n>` | 0.70 | 表示しきい値 |
| `--include-shakeable` | false | tree-shaking で消えうる経路も表示 |
| `--show-suppressed` | false | 抑制された診断も表示 |
| `--fast` | false | 型情報不要ルールのみ（大規模リポジトリ用） |
| `--no-cache` | false | 増分キャッシュを使わない |
| `--root <path>` | 自動検出 | プロジェクトルート |

`--fix` は `fix` サブコマンドとしてのみ提供する。`check --fix` は用意しない
（**チェックのつもりでファイルが書き換わる事故を構造的に防ぐ**）。

## 6.3 終了コード

| コード | 条件 |
| --- | --- |
| 0 | しきい値を超える診断なし |
| 1 | error または（`--ci` 時）confidence ≥ 0.80 の warning が存在 |
| 2 | 解析自体の失敗（Next.js プロジェクトでない、tsconfig 不正 など） |

`info` は終了コードに影響しない。ARCH005 で CI が赤くなってはいけない。

## 6.4 出力（pretty）

```
next-architect v0.1.0

Analyzing Next.js application...
  ✓ Project detected          next@16.x, App Router
  ✓ 183 modules analyzed
  ✓ 42 routes analyzed
  ✓ Server/Client graph built  (31 client, 118 server, 34 shared)
  ✓ Dependency graph built
  ⚠ 3 imports could not be resolved   (see --verbose)

Architecture Score: 81/100

WARNING  ARCH001  Potential unnecessary Client Component
  components/UserName.tsx:1

    "use client" is present, but no client-only features were detected.
    Confidence: 95%
    → Remove "use client"

WARNING  ARCH002  Client Boundary Pollution
  components/ProductList.tsx

    components/ProductList.tsx  [client]
          ↓ getProduct
    lib/product.ts              [client]
          ↓ db
    lib/database.ts             [client]  imports "pg"

    Confidence: 85%
    → Move data access behind a Server Component boundary.

INFO  ARCH005  Potential request waterfall
  app/dashboard/page.tsx:18

    getUser() → getOrders()
    getProducts() appears independent.
    Confidence: 80%

────────────────────────────────────────
2 warnings   1 info   0 errors
3 diagnostics hidden (below confidence threshold) — use --min-confidence 0

Architecture Score: 81/100
  This score represents detected architecture risks, not application quality.

Run `next-architect explain ARCH002` for details.
```

設計上のポイント:

- **未解決 import 3 件を最初のブロックで告げている**（[04-data-model.md §4.6](04-data-model.md) の `limitations`）
- **しきい値で隠した件数を明示している**。黙って減らすと「クリーンだ」と誤読される
- 次のアクション（`explain`）で終わる

## 6.5 設定ファイル

`next-architect.config.ts`（`.js` / `.json` / `package.json#next-architect` も可）。

```ts
import { defineConfig } from "next-architect";

export default defineConfig({
  root: ".",
  include: ["app/**", "components/**", "lib/**"],
  exclude: ["**/*.test.*", "**/*.stories.*"],

  rules: {
    ARCH001: "warn",
    ARCH002: "warn",
    ARCH003: "error",
    ARCH004: ["info", { maxSizeKb: 100, ignore: ["react", "react-dom", "next"] }],
    ARCH005: "info",         // "warn" 以上は無視される（05-rules.md 参照）
  },

  minConfidence: 0.7,

  boundary: {
    /** サーバ指向と見なす追加パッケージ */
    serverPackages: ["@my-org/db"],
    /** client-only と見なす追加パッケージ */
    clientPackages: ["@my-org/ui-motion"],
  },
});
```

**設定で「ルールを消す」より「文脈を教える」ことを優先させる**設計にする。
`serverPackages` / `clientPackages` があると、社内パッケージを使うプロジェクトでの誤検知が激減する。

## 6.6 抑制構文

```ts
// next-architect-disable-next-line ARCH001 -- Provider needs the client boundary
"use client";
```

```ts
/* next-architect-disable ARCH002 */   // ファイル全体
```

- **理由コメント（`-- ...`）を必須にはしないが、`--require-suppression-reason` で強制できる**
- 抑制された診断は `--show-suppressed` で見える
- 使われていない抑制コメントは `ARCH000: Unused suppression` として報告する（腐敗防止）

## 6.7 `fix` の安全設計

```bash
npx next-architect fix                # confidence ≥ 0.95 のみ
npx next-architect fix --dry-run      # diff 表示のみ
```

不変条件:

1. **git の作業ツリーがクリーンでなければ拒否**（`--allow-dirty` で明示的に上書き）
2. 適用後に**必ず再解析**し、新たな error が出たら**全変更をロールバック**
3. `--min-confidence` で 0.95 未満に下げることはできない
4. 適用した修正の一覧を最後に表示する

## 6.8 GitHub Actions

```yaml
- run: npx next-architect check --ci --format sarif > results.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

SARIF を出せると GitHub の Code Scanning に載る。**PR コメント機能を自前で書く前に SARIF を出す。**
既存の仕組みに乗るほうが導入障壁が低い。`--format github` は Actions のアノテーション形式。
