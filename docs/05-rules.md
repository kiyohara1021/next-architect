# 05. ルール仕様

v0.1 は **5 ルールを非常に高い品質で**出す。数で勝負しない。

| ID | 名前 | Category | 既定 severity | base confidence | fix |
| --- | --- | --- | --- | --- | --- |
| ARCH001 | Unnecessary Client Component | boundary | warning | 0.95 | ✅ |
| ARCH002 | Client Boundary Pollution | dependency | warning | 0.85 | ❌ |
| ARCH003 | Server Module in Client Graph | boundary | **error** | 0.98 | ❌ |
| ARCH004 | Large Dependency in Client Bundle | bundle | info | 0.80 | ❌ |
| ARCH005 | Potential Request Waterfall | data | info | 0.70（上限 0.8） | ❌ |

---

## ARCH001 — Unnecessary Client Component

**キラー機能。** LLM が生成した Next.js コードで最も頻出する構造的ミス。

### 検出条件

[03-graph-semantics.md §3.4](03-graph-semantics.md) の判定木。
`"use client"` があり、直接シグナル・推移シグナル・弱シグナルのいずれも無く、経路に未解決 import が無い。

### 出力

```
WARNING  ARCH001
Potential unnecessary Client Component
components/UserName.tsx:1

  "use client" is present, but no client-only features were detected.

  Checked:
    ✗ hooks (useState, useEffect, ...)
    ✗ event handlers
    ✗ browser APIs
    ✗ client-only imports
    ✗ transitively client-only custom hooks

  Confidence: 96%
  → Remove "use client"
```

### 偽陽性を避けるための除外条件（重要）

以下は**報告しない**。実装時にこのリストをテストケースに落とす。

1. import 解決に失敗したモジュールが依存経路にある
2. `export default` されたコンポーネントが `next/dynamic` の `{ ssr: false }` で読まれている
3. ファイルが `error.tsx` / `global-error.tsx`（仕様上 client 必須）
4. `createContext` を含む（Provider は client 必須）
5. サードパーティの client-only パッケージを import している（規則 C3）
6. `"use client"` の直後にコメントで `next-architect-disable` がある
7. ファイルが `node_modules` 由来

### なぜ「単に `"use client"` があったら警告」ではダメか

Client Component が Server Component の子として使われること自体は完全に正当。
`"use client"` には state・イベント・browser API という明確な用途がある。
このルールは「Client Component を減らせ」ではなく、**「効果のない境界宣言を消せ」**である。
メッセージ文言もその立場を守る（"unnecessary" であって "bad" ではない）。

### fix

`"use client"` 行の削除のみ。confidence ≥ 0.95 かつ以下すべてを満たす場合に限る。

- 同一ファイルに他のディレクティブがない
- そのファイルを import しているモジュールがすべて解決済み
- 削除後に再解析して新たな ARCH003 が発生しない（**fix は必ず再解析で検証する**）

---

## ARCH002 — Client Boundary Pollution

Client Component から、サーバ指向の依存が到達可能になっている。

### 検出条件

```
BoundaryEdge から到達可能なモジュール M について、
M が「サーバ指向」と判定され、かつ経路が direct であるとき報告。
```

### 「サーバ指向」の判定（ヒューリスティクスであることを明示する）

| シグナル | 重み |
| --- | --- |
| `server-only` を import している | 確定（→ ARCH003 に昇格） |
| DB クライアントを import（`pg`, `mysql2`, `prisma`, `drizzle-orm`, `mongoose`, `@supabase/supabase-js` の server 用エントリ 等） | 強 |
| `fs` / `path` / `crypto` / `child_process` など Node 組み込み | 強 |
| `process.env` の非 `NEXT_PUBLIC_` 変数を参照 | 強 |
| ファイル名 / ディレクトリが `db`, `server`, `repository`, `dal`, `queries` | 弱（単独では報告しない） |

**弱シグナル単独では報告しない。** 命名規約だけで警告するとチームごとに大量の誤検知になる。

### 出力

```
WARNING  ARCH002
Client Boundary Pollution
components/ProductList.tsx

  components/ProductList.tsx   [client]  ← "use client"
        ↓ import { getProduct }
  lib/product.ts               [client]  ← pulled in
        ↓ import { db }
  lib/database.ts              [client]  ← imports "pg"

  A server-oriented dependency is reachable from a Client Component.

  Potential impact:
    - unnecessary client bundle
    - environment poisoning
    - server-only code exposure

  Confidence: 91%
  → Move data access behind a Server Component boundary,
    or add `import "server-only"` to lib/database.ts to make this an error.
```

最後の一文が地味に効く。**ツールが「次に取るべき防御策」を教える**形にする。

### fix

なし。修正はアーキテクチャ変更であり、自動化してはいけない。

---

## ARCH003 — Server Module in Client Graph

ARCH002 の**確定版**。`server-only` を import しているモジュールが client graph に入った。
これは Next.js のビルドでも失敗する（＝偽陽性がほぼありえない）ため **error**。

```
ERROR  ARCH003
Server module imported by Client Component
components/User.tsx

  components/User.tsx    [client]
        ↓
  lib/user.ts            [client]
        ↓
  lib/db.ts              [server-only]   ← import "server-only"

  Confidence: 98%
  → Move the data access to a Server Component,
    or pass the resolved data down as props.
```

**ARCH002 との関係**: 同一経路で両方成立する場合は ARCH003 のみ出す（重複報告しない）。

Next.js のビルドが同じことを検出するなら価値がないのでは？ という問いへの答え:
ビルドは**そのルートを実際にビルドしたときに**落ちる。next-architect は**全ルートを横断して**、
まだ踏んでいない経路も含めて事前に出す。加えて経路を表示する。

---

## ARCH004 — Large Dependency in Client Bundle

### 立ち位置

[01-concept.md §1.5](01-concept.md) の通り、**サイズ計測を売りにしない**。
売りは「なぜその依存が Client Bundle に入ったのか」。

```
INFO  ARCH004
Large dependency enters client bundle
components/Chart.tsx:3

  components/Chart.tsx   [client]  ← "use client"
        ↓ import { Chart } from "huge-library"
  huge-library

  Estimated unpacked size: ~428 KB   (approximate; see notes)
  Used exports: 1 of 87

  Consider:
    - import the specific submodule directly
    - next/dynamic with { ssr: false }
    - move the processing to a Server Component

  Confidence: 80%
```

### サイズ推定の但し書き（必須）

- `node_modules` の実ファイルサイズであり、**バンドル後・minify 後・gzip 後のサイズではない**
- tree-shaking の結果を反映しない
- 出力に必ず `approximate` と明記し、`--format json` では `sizeBytes` に加えて `sizeSource: "unpacked"` を持たせる

正確なサイズが欲しいユーザーには `@next/bundle-analyzer` を案内する。**競合しに行かない。**

### 閾値

既定 100KB（設定可能）。`react` / `react-dom` / `next` は除外。

---

## ARCH005 — Potential Request Waterfall

### 検出条件

[03-graph-semantics.md §3.5](03-graph-semantics.md) の D1〜D4。

```
INFO  ARCH005
Potential request waterfall
app/dashboard/page.tsx:18

  const user     = await getUser();        line 18
  const orders   = await getOrders(user.id);  line 19  ← depends on user
  const products = await getProducts();    line 20  ← independent

  getProducts() does not appear to depend on previous results.

  Possible optimization:
    const [user, products] = await Promise.all([
      getUser(),
      getProducts(),
    ]);

  Confidence: 74%
```

### 構造的な制約（仕様として固定）

静的解析で「並列化して安全」と断定することは原理的にできない。副作用順序・トランザクション・
動的 API の呼び出し順が絡む。したがって:

- severity は **`info` 固定**。設定でも `warning` 以上に昇格させない
- confidence 上限 **0.8**
- **`--fix` 対象外**
- メッセージは常に "Potential" / "Possible" を使い、断定しない

この 3 行は「後から昇格させたくなる」ことへの予防線として仕様に置く。

---

## v0.2 候補（10〜15 ルール）

実装順は上から。特に **ARCH009 は security 価値が高く、v0.2 の目玉候補**。

| ID | 名前 | Category | 概要 |
| --- | --- | --- | --- |
| ARCH006 | Client Boundary Too High | boundary | `page.tsx` / `layout.tsx` 自体が `"use client"`。境界を葉に押し下げる提案 |
| ARCH007 | Missing Suspense Boundary | route | async Server Component が Suspense で包まれていない |
| ARCH008 | Unvalidated Server Action | security | `"use server"` 関数の引数が検証なしで DB / fetch へ流れている |
| **ARCH009** | **Env Var Leakage** | **security** | 非 `NEXT_PUBLIC_` の `process.env` が client graph 内で参照されている |
| ARCH010 | Duplicate Data Fetch | data | 同一ルートの layout と page で同じ fetch |
| ARCH011 | Barrel Import Widening Client Graph | dependency | barrel 経由で client graph が不必要に広がっている |
| ARCH012 | Undeclared Fetch Caching | data | `fetch` に cache / revalidate の指定がない |
| ARCH013 | Dynamic API in Layout | route | layout での `cookies()` / `headers()` が配下全体を dynamic にしている |
| ARCH014 | Duplicated Provider | boundary | 同じ Context Provider が複数階層に存在 |
| ARCH015 | Route Segment Config Conflict | route | layout と page で `dynamic` / `revalidate` が矛盾 |

## ルール ID の運用

- `ARCHxxx` は**永久欠番制**。削除しても再利用しない
- カテゴリと番号帯を対応させない（後から動かせなくなるため）。カテゴリはメタデータで持つ
- 各ルールに `docs.url` を持たせ、`next-architect explain ARCH002` で参照できるようにする
