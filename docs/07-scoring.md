# 07. Architecture Score

## 7.1 なぜ入れるのか、そして何が危険か

「82点」は導入の動機として強く、共有されやすく、改善の実感を作る。Star を取る UI としても効く。

同時に、**スコアは最も誤用されやすい機能**でもある。

- 「90点だから安全」と読まれる
- CI のゲートにされる（`score >= 85` で落とす）
- ツール側の閾値変更でスコアが動き、開発者の信頼を失う

したがって、**入れる。ただし強い制約を付ける。**

## 7.2 定義

> Architecture Score は「**検出されたアーキテクチャリスクの量**」を 0〜100 に写像したもの。
> **アプリケーションの品質・正しさ・性能を表さない。**

出力時に必ずこの断り書きを併記する。省略可能にしない。

```
Architecture Score
82 / 100

This score represents detected architecture risks,
not application quality.
```

## 7.3 算出

カテゴリごとに減点方式。

```
categoryScore = 100 - min(100, Σ (weight(severity) × confidence × scaleFactor))
```

| severity | weight |
| --- | --- |
| error | 15 |
| warning | 5 |
| info | 1 |

`scaleFactor` はプロジェクト規模による正規化:

```
scaleFactor = clamp(50 / relevantModuleCount, 0.3, 1.0)
```

`relevantModuleCount` は**そのカテゴリが対象とするモジュール数**（boundary なら client モジュール数）。
これを入れないと、大規模プロジェクトほど不当に低くなり、小規模プロジェクトが常に満点になる。

総合スコアはカテゴリの**加重平均**:

| Category | 重み |
| --- | --- |
| Boundary | 30% |
| Dependency | 25% |
| Data Flow | 15% |
| Routes | 15% |
| Security | 15% |

```
Boundary     92
Dependency   76
Data Flow    81
Routes       95
Security     88
─────────────────
Overall      82
```

**分解を必ず出す。** 総合点だけを出すと改善の手がかりにならない。

## 7.4 制約（仕様として固定）

1. **`--ci` の終了コードにスコアを使わない。** 終了コードは診断の severity と confidence のみで決まる。
2. **スコアでの CI ゲートオプションを提供しない**（`--min-score` は作らない）。ユーザーが JSON から自力でやるのは自由だが、ツールとしては勧めない。
3. **スコアの算出式はメジャーバージョンでのみ変更する。** マイナー更新で点数が動くと信頼が消える。
4. 算出式を `next-architect explain score` で常に表示できるようにする（ブラックボックスにしない）。
5. ルールを追加した際、既存プロジェクトのスコアが下がるのは避けられない。**リリースノートに「このバージョンでスコアが平均 -N 点変動します」を必ず書く。**

## 7.5 表示しない場合

以下では総合スコアを出さない（誤解が大きいため）:

- `--rule` で一部ルールのみ実行したとき
- `--fast`（型情報なし）で実行したとき
- `limitations` が多く、解析カバレッジが 90% を下回るとき

代わりに:

```
Architecture Score: not available
  Partial analysis (12 of 183 modules could not be resolved).
  Run with --verbose to see details.
```

**「分からないときは点を出さない」を徹底する。** これが数字への信頼を作る。
