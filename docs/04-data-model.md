# 04. データモデル

`@next-architect/core` が公開する型。これが JSON レポータと MCP の出力スキーマも兼ねる。

## 4.1 モジュール

```ts
export type Environment =
  | "server"
  | "client"
  | "shared"
  | "edge"
  | "unknown";

export interface ModuleNode {
  id: string;                    // プロジェクトルート相対の正規化パス
  path: string;                  // 絶対パス
  environment: Environment;
  environmentReason: EnvReason;  // なぜその環境になったか（説明可能性のため必須）
  directives: string[];          // ["use client"] / ["use server"] など
  imports: ImportEdge[];
  exports: ExportInfo[];
  isRoute: boolean;
  routeKind?: "page" | "layout" | "template" | "error" | "loading" | "route" | "default";
  clientSignals: ClientSignal[]; // 3.4 で検出したもの
  isExternal: boolean;           // node_modules 由来
  sizeBytes?: number;            // 外部パッケージのみ、概算
}

export interface EnvReason {
  kind:
    | "directive"        // "use client" を自分で持つ
    | "propagated"       // client から import された
    | "route-convention" // route.ts / error.tsx など規約由来
    | "forced"           // server-only / client-only
    | "reachability"     // server からのみ到達可能
    | "unresolved";
  /** propagated の場合、彩色元からの import 経路 */
  via?: string[];
}
```

`environmentReason` を**必須**にしているのが設計上の要点。
「なぜ client なのか」を答えられないツールは、ARCH002 の経路表示ができない。

## 4.2 エッジ

```ts
export interface ImportEdge {
  from: string;
  to: string;
  type: "static" | "dynamic" | "type" | "side-effect";
  isTypeOnly: boolean;
  /** 名前付き import の対象。default は "default"、namespace は "*" */
  importedNames: string[];
  /** 3.3 の tree-shaking 判定 */
  reachability: "direct" | "shakeable";
  /** re-export を挟んだ場合の中継ファイル列 */
  through: string[];
  loc: SourceLocation;
}
```

## 4.3 ルート

```ts
export interface RouteNode {
  id: string;              // "/dashboard/settings"
  segments: RouteSegment[];
  page?: string;           // ModuleNode.id
  layouts: string[];       // ルートから順に
  handlers?: string;       // route.ts
  children: string[];
  /** このルートのレンダリングに到達しうる全モジュール */
  moduleClosure: string[];
  /** そのうち client graph に入るもの */
  clientClosure: string[];
}

export interface RouteSegment {
  name: string;
  kind: "static" | "dynamic" | "catch-all" | "optional-catch-all" | "group" | "parallel" | "intercepting";
}
```

`moduleClosure` / `clientClosure` を持たせておくと、
「このルートを開いたとき何が client に落ちるか」がルート単位で答えられる。
これは HTML レポートと MCP の両方で効く。

## 4.4 診断

```ts
export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  ruleId: string;                  // "ARCH001"
  severity: Severity;
  file: string;
  line?: number;
  column?: number;
  message: string;                 // 1 行。何が起きているか
  explanation?: string;            // なぜ問題か
  suggestion?: string;             // どうするか
  /** 0..1。→ 4.5 */
  confidence: number;
  /** 境界系ルールで表示する到達経路 */
  path?: DiagnosticPath;
  fix?: Fix;
  /** 抑制された場合の理由（--show-suppressed 用） */
  suppressed?: "config" | "inline" | "below-threshold";
}

export interface DiagnosticPath {
  nodes: Array<{ id: string; environment: Environment; loc?: SourceLocation }>;
  /** shakeable な区間があるか */
  hasShakeableSegment: boolean;
}

export interface Fix {
  /** 適用に必要な最低 confidence を満たすか */
  safe: boolean;
  description: string;
  edits: TextEdit[];
}
```

## 4.5 confidence の定義

**ここを曖昧にすると数字が飾りになる。** 以下を仕様として固定する。

> `confidence` は「**この診断が、開発者にとって実際に対処すべき事象である確率**」の推定値。
> コードの正しさの確率ではなく、**報告としての妥当性**の確率。

### 算出

各ルールが基準値を持ち、グラフ由来の**減衰係数**を掛ける。

```ts
confidence = base × Π(penalties)
```

| 減衰要因 | 係数 |
| --- | --- |
| 経路に未解決 import がある | × 0.5 |
| 経路に `shakeable` 区間がある | × 0.6 |
| 経路に namespace / default import がある | × 0.8 |
| 経路に動的 import がある | × 0.9 |
| 対象ファイルがテスト / stories / mock | × 0.3 |
| 対象が `.d.ts` または生成物 | × 0.1 |
| 型情報なしパス（`--fast`）で得た結果 | × 0.85 |

### しきい値

| 用途 | 既定しきい値 |
| --- | --- |
| CLI 表示 | 0.70 |
| `--ci` で終了コード 1 にする | 0.80 |
| `--fix` を適用する | **0.95** |
| MCP の `suggest_fix` が提案する | 0.85 |

しきい値は設定で変更可能にするが、**`--fix` の 0.95 だけは下限を設けて下げさせない**。
自動修正で壊すツールは一度で信頼を失う。

## 4.6 解析結果全体

```ts
export interface AnalysisResult {
  version: string;
  analyzedAt: string;              // ISO 8601
  project: {
    root: string;
    nextVersion?: string;
    router: "app" | "pages" | "hybrid";
    moduleCount: number;
    routeCount: number;
  };
  diagnostics: Diagnostic[];
  score: ArchitectureScore;        // → 07-scoring.md
  /** 解析できなかったもの。空にせず必ず出す */
  limitations: Limitation[];
}

export interface Limitation {
  kind: "unresolved-import" | "unsupported-router" | "dynamic-config" | "parse-error";
  file?: string;
  detail: string;
}
```

`limitations` を **AnalysisResult の必須フィールド**にしているのが重要。
「183 modules analyzed ✓」だけ出して 12 件解決失敗を黙っているツールは信用できない。
サイレントな取りこぼしを構造的に不可能にする。
