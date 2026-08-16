# 10. 品質戦略

「最初の 10 ルールを非常に高品質に作る」を、**測定可能な仕組み**に落とす。
これがないと「高品質に作る」は願望で終わる。

---

## 10.1 このツールが死ぬ唯一のパターン

```
初回実行 → 40 件の警告 → 半分が誤検知 → 「使えない」 → 二度と実行されない
```

静的解析ツールの評価は**初回実行の 10 秒**で決まる。
偽陰性（見逃し）は許される。**偽陽性（誤検知）は許されない。**

したがって全ルールの設計原則は:

> **迷ったら黙る。**

これを実装レベルで担保するのが、[03-graph-semantics.md](03-graph-semantics.md) の
「未解決 import があれば報告しない」と、[04-data-model.md §4.5](04-data-model.md) の confidence 減衰。

---

## 10.2 3 層のテスト

### ① Fixture テスト（ユニット）

ルールごとに、**検出されるべきケース**と**検出されてはいけないケース**を対で持つ。

```
packages/rules/__fixtures__/ARCH001/
├── should-report/
│   ├── plain-presentational.tsx      # 何もない
│   ├── only-forward-ref.tsx          # 弱シグナルのみ
│   └── expected.json
└── should-not-report/
    ├── use-state.tsx
    ├── event-handler.tsx
    ├── transitive-custom-hook/       # 複数ファイル
    ├── third-party-client-pkg.tsx    # framer-motion
    ├── create-context.tsx
    ├── error-boundary/error.tsx
    ├── unresolved-import.tsx
    └── barrel-reexport/              # ★ barrel 経由
```

**`should-not-report` のほうを厚くする。** [05-rules.md](05-rules.md) の除外条件リストは、
そのまま fixture のファイル名になる。

### ② Corpus テスト（結合）— これが要

実在の OSS Next.js アプリを固定バージョンで取得し、**全件に対して実行する。**

| 種別 | 例 |
| --- | --- |
| 公式サンプル | `vercel/next.js` の `examples/` から App Router のもの |
| 実アプリ | OSS の Next.js 製プロダクト（ライセンス確認のうえ） |
| 大規模 | 1,000 モジュール超のもの 1 つ以上（性能計測用） |
| 自前 | 意図的に汚した検証用アプリ（true positive の確認用） |

計測する指標:

```
false positive rate   … 誤検知 / 全報告        ← 最重要
diagnostics per 100 modules                    ← ノイズ量の代理指標
unresolved import rate                         ← 解析カバレッジ
wall time / modules                            ← 性能
```

**判定は人手で行う。** 自動化できない。だから corpus は小さく保ち（5〜10 リポジトリ）、
**リリース前に必ず 1 回全件目視する**運用にする。

### ③ スナップショットテスト

corpus に対する出力を JSON でスナップショット化し、差分をレビュー対象にする。
ルールを触ったときに、**どのプロジェクトで何件増減したか**が PR に出る。

```
$ pnpm corpus:diff

corpus/commerce-app
  ARCH001  3 → 3
  ARCH002  7 → 2   ← -5  (barrel tracing 改善)
corpus/dashboard-app
  ARCH001  0 → 1   ← +1  ⚠ 要確認
```

---

## 10.3 リリースゲート

| 指標 | v0.1 の基準 |
| --- | --- |
| ARCH001 偽陽性 | **0 件** |
| ARCH003 偽陽性 | **0 件** |
| ARCH002 偽陽性率 | ≤ 10% |
| ARCH004 / ARCH005 偽陽性率 | ≤ 25%（severity が info のため許容幅を広く） |
| 全体の報告密度 | ≤ 5 件 / 100 モジュール |
| 未解決 import 率 | ≤ 2% |
| 初回解析（1,000 modules） | ≤ 30 秒 |
| 増分解析 | ≤ 5 秒 |

報告密度の上限を置いているのが重要。**個々が正しくても、量が多ければノイズ**になる。

---

## 10.4 誤検知が報告されたときの運用

Issue テンプレートを用意し、**再現用の最小コードを必ず求める**。
そのコードは**そのまま `should-not-report` fixture になる**。

```
1. Issue（誤検知報告）
2. 最小再現コードを fixture に追加 → テストが落ちる
3. 判定ロジックを修正 → 通る
4. corpus:diff で他プロジェクトへの影響を確認
5. リリース
```

このループが回っていること自体が、ツールの信頼になる。
README に「誤検知は最優先で直します」と明記し、実際にそう運用する。

---

## 10.5 ドキュメントの品質

各ルールに以下を必須にする（`explain` と Web ドキュメントで共用）:

1. **何を検出するか**（1 行）
2. **なぜ問題か**（Next.js の仕組みに基づく説明）
3. **正しくない例 / 正しい例**（コード）
4. **検出されない条件**（除外条件の公開）
5. **誤検知の可能性**（正直に書く）

特に 4 と 5 を公開するツールは少ない。**「このツールは何を見ていないか」を明示する**ことが、
逆説的に信頼を作る。
