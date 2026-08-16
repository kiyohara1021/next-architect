# 09. ロードマップ

原則: **最初の 5 ルールを非常に高品質に。** 機能を広げる前に、誤検知率で信頼を取る。

---

## v0.1 — Core Engine

| 項目 | 内容 |
| --- | --- |
| CLI | `check` / `explain` |
| Parser | TypeScript Compiler API、tsconfig paths、App Router 走査 |
| Graph | ModuleGraph、ServerClientGraph、**export tracing（barrel 対応）** |
| Rules | ARCH001〜005 |
| Reporter | pretty、json |
| Cache | ファイル単位の増分キャッシュ |

**リリース条件（これを満たすまで出さない）:**

- [10-quality-strategy.md](10-quality-strategy.md) の corpus で **ARCH001 の偽陽性 0 件**
- ARCH003 の偽陽性 0 件
- 1,000 モジュールのプロジェクトで初回 30 秒以内、2 回目 5 秒以内
- `limitations` が必ず出力される

ARCH001 の偽陽性 0 は厳しいが、**キラー機能が誤爆したら終わり**なので譲らない。

---

## v0.2 — Depth

| 項目 | 内容 |
| --- | --- |
| Graph | RouteGraph、DataFlowGraph の本格化 |
| Rules | ARCH006〜015（**ARCH009 Env Var Leakage を目玉に**） |
| Reporter | HTML レポート、SARIF |
| CI | GitHub Actions + Code Scanning 連携 |
| Config | `next-architect.config.ts`、抑制構文 |
| ARCH004 | パッケージの export 総数の解決（`Used exports: n of m` の分母）。型解決とセット |

HTML レポートはこの段階で入れる。**ARCH002 の到達経路は図で見せると圧倒的に伝わる**ため、
スクリーンショットが README の説得力になる（＝ Star に効く）。

---

## v0.3 — Fix & Visibility

| 項目 | 内容 |
| --- | --- |
| `fix` | ARCH001 のみ。git クリーン要求 + 再解析検証 + ロールバック |
| PR | PR アノテーション（SARIF で足りなければ自前） |
| Graph | アーキテクチャ可視化（ルート単位の client closure 図） |

`fix` は ARCH001 **1 つだけ**で出す。「安全な修正しかしない」という評判を先に作る。

---

## v0.4 — MCP

| 項目 | 内容 |
| --- | --- |
| MCP | [08-mcp.md](08-mcp.md) の 8 ツール |
| Watch | ファイル監視による増分グラフ更新 |
| 対応 | Claude Code / Codex / Cursor での動作確認 |

ここが本命。**v0.1〜v0.3 は MCP のための基盤**という見方もできる。
ただし MCP を先に出すと「AI 用の何か」に見えて、CLI として評価されなくなる。順序は守る。

---

## v1.0 — Platform

| 項目 | 内容 |
| --- | --- |
| VS Code 拡張 | インライン診断、境界の可視化 |
| Dashboard | スコア推移、リポジトリ横断 |
| Plugin API | 外部ルールの登録（`core` の一方向依存が効く） |
| Pages Router | 限定的な対応（需要があれば） |

VS Code 拡張は**後回しで正しい**。CLI で価値が証明される前に IDE 統合を作ると、
実装コストの割に使われない。

---

## 各段階の「成功の定義」

| Version | 成功の定義 |
| --- | --- |
| v0.1 | 実プロジェクトに入れて、**1 件でも意味のある ARCH001 が出る**。ノイズが出ない |
| v0.2 | CI に入れてもらえる |
| v0.3 | `fix` が信用される（ロールバックが働いた報告が出ても評価が落ちない） |
| v0.4 | AI が自発的に `verify` を呼ぶ |
| v1.0 | 外部ルールが書かれる |

## やらないと決めたこと（再掲）

- 一般的なコード品質ルール
- バンドルサイズの正確な計測
- LLM によるコード解釈
- スコアによる CI ゲート
- ARCH005 の `warning` 昇格・自動修正
