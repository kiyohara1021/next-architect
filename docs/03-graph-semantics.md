# 03. グラフのセマンティクス

**このドキュメントが next-architect の心臓部。** ここの精度がそのまま製品の価値になる。
ルールは薄い。難しいのは全部ここにある。

---

## 3.1 5 つのグラフ

| Graph | ノード | エッジ | 用途 |
| --- | --- | --- | --- |
| ModuleGraph | ファイル | import | すべての土台 |
| RouteGraph | ルートセグメント | 親子 | App Router 構造 |
| ServerClientGraph | ModuleGraph の彩色結果 | 境界エッジ | ARCH001〜004 |
| DependencyGraph | ModuleGraph + node_modules | import | ARCH004 |
| DataFlowGraph | await 式 / 関数呼び出し | データ依存 | ARCH005 |

実体は 1 つの `ModuleGraph` で、他は**そのビュー**として持つ。別々に構築しない。

---

## 3.2 環境ラベルの伝播規則

各モジュールは `server` / `client` / `shared` / `edge` / `unknown` のいずれかを持つ。
これを**不動点計算**で決める。以下が全規則。

### 起点（seed）

```
"use client" を先頭に持つ                          → client（境界の起点）
"server-only" を import している                   → server（強制）
"client-only" を import している                   → client（強制）
app/**/route.ts                                    → server
app/**/error.tsx, global-error.tsx                 → client（暗黙）
middleware.ts                                      → edge
app/**/page.tsx, layout.tsx（"use client" なし）   → server
それ以外                                            → shared（未確定）
```

### 伝播（fixed point）

```
規則 P1: client なモジュールが import するモジュールは client になる
規則 P2: client の伝播は "use server" ファイルで止まる（Server Action 境界）
規則 P3: import type / type-only import は伝播しない（消去される）
規則 P4: dynamic import は伝播する（別チャンクになるだけで client graph には入る）
規則 P5: server 強制モジュールが client に彩色されたら → ARCH003（矛盾）
規則 P6: shared のまま残ったモジュールは、server からのみ到達可能なら server 相当
```

### 「境界」の定義

```
BoundaryEdge = server なモジュール → client なモジュール への import エッジ
```

ここが `"use client"` が実際に効いている点。ARCH001 は「この境界は必要か」を問い、
ARCH002 は「この境界の**先**に何が入ったか」を問う。

### よくある誤解の明示

- `"use client"` は「これは Client Component です」という宣言ではなく、**「ここから先が Client module graph」という境界宣言**。だから*子孫全部*に効く。
- Client Component が Server Component を `children` として受け取るのは合法。**props 経由の受け渡しは import ではない**ので、グラフ上のエッジにならない。これを import と混同すると大量の偽陽性が出る。
- 逆に「Client Component は Server Component を import できない」のではなく、**import した時点でそれは Client Component になる**。エラーではなく彩色である。

---

## 3.3 Barrel file 問題（最重要）

ARCH002 の例そのものが barrel file を経由している。

```
ClientComponent.tsx
  ↓ import { formatDate } from "@/lib/utils"
lib/utils/index.ts        ← barrel: 30 個を re-export
  ↓
lib/date.ts   lib/database.ts   lib/mailer.ts   ...
```

**素朴にファイル単位でエッジを張ると、`formatDate` しか使っていないのに `database.ts` が client graph に入ったことになり、ARCH002 が誤発火する。**
実プロジェクトの barrel 率を考えると、これを解かないツールは初回実行でノイズの山を吐いて捨てられる。

### 解決: 名前付きエクスポートの追跡（export tracing）

エッジをファイル単位ではなく **`(from, to, importedNames)`** で持つ。

```
規則 B1: 名前付き import は、その名前を提供する re-export 元にだけエッジを張る
         export { formatDate } from "./date"      → date.ts にのみ張る
規則 B2: export * from "./x" は、x の全エクスポート名を解決してから B1 を適用
規則 B3: 名前が解決できない場合（動的、型のみ、循環）は
         保守的に全体へ張り、その経路の confidence に減衰を掛ける
規則 B4: default import / namespace import（import * as）は全体へ張る
規則 B5: side-effect import（import "./x"）は全体へ張る
```

### バンドラの実挙動との差分（正直に書く）

実際のバンドラは tree-shaking の可否を `sideEffects` フラグと副作用解析で決めるため、
**B1 が示す「入らない」は理想であって保証ではない**。

そこで next-architect は 2 つの経路種別を区別する:

| 種別 | 意味 | 既定の扱い |
| --- | --- | --- |
| `direct` | tree-shaking 後も確実に残る経路 | ARCH002 を報告 |
| `shakeable` | barrel 経由で、理想的には除去される経路 | 既定では**報告しない**。`--include-shakeable` で表示 |

`package.json` に `"sideEffects": false` がない barrel を経由する場合は `direct` に格上げする。
（＝ tree-shaking が効かない可能性が高い）

**この 1 点だけで、他の素朴な実装との差が決定的につく。**

---

## 3.4 client-only 機能の検出（ARCH001 の判定核）

`"use client"` が必要かどうかは、以下のいずれかが検出されるかで決まる。

### 直接シグナル（そのファイル内）

```
[hooks]        useState / useReducer / useEffect / useLayoutEffect /
               useRef / useContext / useSyncExternalStore /
               useOptimistic / useFormStatus / useTransition / useDeferredValue
[React API]    createContext / forwardRef(※) / memo(※)
[event]        JSX 属性の on* に関数式・関数参照が渡されている
[browser]      window / document / localStorage / navigator / matchMedia /
               IntersectionObserver / addEventListener
[next client]  next/navigation の useRouter / usePathname / useSearchParams / useParams
               next/link の onClick 系
[class]        React.Component / PureComponent の継承
```

※ `forwardRef` / `memo` は Server Component でも書けてしまうため、**単独では client 根拠にしない**（弱シグナル）。

### 推移シグナル（import 先を辿る）

```
規則 C1: import した custom hook が（推移的に）直接シグナルを含む → client 必要
規則 C2: import したモジュールが "use client" を持つ            → client 必要
規則 C3: import した npm パッケージが client-only               → client 必要
         判定: package.json の exports に "react-server" 条件がない かつ
               パッケージ内に "use client" ディレクティブがある
規則 C4: import "client-only" がある                            → client 必要
```

C3 が効くと、`framer-motion` や `@tanstack/react-query` を使っているファイルを
「client 機能なし」と誤判定しなくなる。

### 判定木

```
"use client" あり
      │
      ├─ 直接シグナルあり            → OK（報告しない）
      ├─ 推移シグナルあり            → OK（報告しない）
      ├─ 弱シグナルのみ              → INFO（confidence 低）
      ├─ 未解決 import が経路にある  → 報告しない（判断保留）
      │
      └─ 何もない                    → ARCH001 WARNING
```

**「未解決 import があれば報告しない」を明示的に入れる。** 分からないときは黙る。

---

## 3.5 DataFlowGraph（ARCH005 の基盤）

async 関数本体の `await` 式を順序付きで列挙し、依存関係を作る。

```
規則 D1: await 式 A の結果に束縛された識別子が、await 式 B の引数に現れる
         → B は A に依存（真の直列）
規則 D2: 依存がない連続した await は「並列化候補」
規則 D3: 以下がある場合は候補から除外する（副作用順序が意味を持つ）
         - try / catch / finally をまたぐ
         - if / for / while の中にある
         - cookies() / headers() / draftMode() など動的 API の呼び出しをまたぐ
         - 呼び出し先が void / 戻り値未使用（副作用目的の可能性）
         - 呼び出し先の名前が create/update/delete/insert/save/send/post で始まる
規則 D4: await 対象が同一モジュール内で解決できない場合は confidence を下げる
```

D3 が ARCH005 の生命線。**「並列化できる」と静的に断定するのは本質的に難しい**ため、
ARCH005 は構造的に:

- severity は `info` 固定（warning に昇格させない）
- confidence の上限を **0.8** に固定する
- **`--fix` の対象外**

とする。この 3 つを仕様として固定しておく（実装者が後から昇格させたくなるのを防ぐ）。

---

## 3.6 グラフ構築の擬似コード

```ts
function buildGraph(files: SourceFile[]): ArchitectureGraph {
  const modules = files.map(extractModuleNode);           // ③ Parse
  const edges = modules.flatMap(m => resolveImports(m));  // ④ Resolve（B1〜B5 適用）
  const graph = new ModuleGraph(modules, edges);

  seedEnvironments(graph);                                // 3.2 seed

  // ⑥ 不動点計算
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (edge.isTypeOnly) continue;                      // P3
      const from = graph.get(edge.from);
      const to = graph.get(edge.to);
      if (from.environment === "client" && to.environment !== "client") {
        if (to.hasServerActionDirective) continue;        // P2
        if (to.forcedServer) {
          graph.recordConflict(edge);                     // P5 → ARCH003
          continue;
        }
        to.environment = "client";                        // P1
        changed = true;
      }
    }
  }

  resolveSharedByReachability(graph);                     // P6
  return graph.withViews({ routes, boundaries, dataFlow });
}
```

循環 import があっても不動点計算なので停止する。ノード数 N・エッジ数 E に対して最悪 O(N·E) だが、
実際は 2〜3 反復で収束する（client 彩色は単調増加のみ）。
