# 11. 未決事項

実装に入る前に決着させるもの。

---

## 11.1 名前の可用性 ⚠️ 最優先

**この設計時点では確認できていない**（作業環境にネットワークアクセスがなかった）。
実装着手前に必ず確認すること。

### 確認先

| 対象 | 確認方法 |
| --- | --- |
| npm | `npm view next-architect` / https://www.npmjs.com/package/next-architect |
| GitHub | リポジトリ名・Organization 名の衝突 |
| PyPI / crates.io | 同名ツールの有無（直接の競合ではないが混乱の元） |
| 商標 | 特に "Next" を冠する点。**Vercel の商標ポリシーを確認**（→ 11.2） |

### 候補（優先順）

1. `next-architect` — 意味が最も明確
2. `next-arch` — 短い。CLI として打ちやすい
3. `next-archlint` — "lint" が入ると ESLint と混同されるので**避けたい**
4. `next-structure`
5. `archnext` / `nextarch` — "next-" を外す案（→ 11.2 の回避策にもなる）

### 判断基準

CLI 名（`npx next-architect`）と npm パッケージ名は一致させる。
スコープ付き（`@yourorg/next-architect`）は `npx` の体験が落ちるため最後の手段。

---

## 11.2 "next-" プレフィックスと商標

`next-` で始まるサードパーティパッケージは多数存在するが、
**Vercel の商標ガイドラインを確認し、必要なら README に非公式であることを明記する。**

```
next-architect is an independent open-source project and is not
affiliated with, endorsed by, or sponsored by Vercel.
```

この一文は、名前を変えない場合は**必須**と考えてよい。

---

## 11.3 Turbopack / next.config の解釈

`next.config.js` の alias 設定は関数形式・条件分岐を含むことがあり、静的に評価できない。

- **案 A**: 静的に読める形（オブジェクトリテラル）のみ解釈し、それ以外は `limitations` に記録
- **案 B**: `next.config` を実際に import して評価する（副作用のリスクあり）

**推奨は案 A。** ユーザーのコードを実行するツールにはしない。
不足する場合は設定ファイルの `resolve.alias` で手動補完してもらう。

---

## 11.4 monorepo 対応の範囲

Next.js アプリが monorepo の 1 パッケージであるケースは多い。

- `apps/web` を root として解析しつつ、`packages/ui` の `"use client"` も追跡する必要がある
- `transpilePackages` の扱い

**v0.1 では「workspace 内の TypeScript ソースは追跡、それ以外の node_modules は 1 段」**とし、
完全な monorepo 対応は v0.2 に送る。ただし**設計段階で `isExternal` の判定を
「node_modules 配下か」ではなく「解析対象ソースに含まれるか」にしておく**こと。
ここを間違えると後から直せない。

---

## 11.5 Next.js のバージョン差分

`"use client"` のセマンティクスは安定しているが、周辺は動く。

- Server Actions（`"use server"`）の仕様
- `unstable_cache` / `use cache` などキャッシュ API
- PPR（Partial Prerendering）

**対応方針**: `package.json` の `next` バージョンを読み、
**サポート範囲外なら警告を出して、バージョン依存ルールをスキップする。**
黙って誤った前提で解析しない。サポート範囲は README に明記する（例: Next.js 14〜15）。

---

## 11.6 ライセンス

MIT を想定。corpus テスト（[10-quality-strategy.md](10-quality-strategy.md)）で
他プロジェクトのコードを取り込む場合は、**リポジトリに含めず取得スクリプトにする**こと。

---

## 11.7 未決の設計判断

| 論点 | 選択肢 | 現時点の傾き |
| --- | --- | --- |
| ARCH005 を v0.1 に含めるか | 含める / v0.2 に送る | **含める。** ただし info 固定で「面白さ」の担当。ただし品質ゲート未達なら躊躇なく落とす |
| Route Graph を v0.1 で作るか | 作る / v0.2 | **構築のみ v0.1、ルールは v0.2。** `clientClosure` は ARCH004 の表示に使う |
| `--fast` モードを v0.1 に入れるか | 入れる / 後回し | **後回し。** ただし `Rule.requiresTypeInfo` は最初から持たせる |
| デフォルトで `shakeable` 経路を報告するか | する / しない | **しない。** 偽陽性の最大要因 |
| Pages Router | 検出のみ / 部分対応 | **検出のみ。** 明示的に非対応と告げる |
