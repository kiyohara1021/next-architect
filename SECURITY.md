# Security Policy

[English](#english) | [日本語](#日本語)

## English

### Supported versions

next-architect is pre-1.0. Only the latest commit on `main` receives security fixes.

### Reporting a vulnerability

Do not open a public issue. Report privately via
[GitHub Security Advisories](https://github.com/kiyohara1021/next-architect/security/advisories/new)
with the affected version, impact, and a minimal reproduction (ideally a small Next.js fixture).

Response times are best effort. Please allow time for a fix before public disclosure.

### Threat model

next-architect statically analyzes a local Next.js project. It is not expected to execute code
from the analyzed project, write into it, or send its contents over the network. Reports of a
crafted project that breaks these expectations (code execution, path traversal, symlink escape,
hangs, or memory exhaustion) are especially welcome.

## 日本語

### サポート対象

1.0 未満のため、`main` の最新コミットだけをセキュリティ修正の対象とします。

### 脆弱性の報告

公開 Issue は作らず、[GitHub Security Advisories](https://github.com/kiyohara1021/next-architect/security/advisories/new)
から非公開で報告してください。対象バージョン、影響、最小の再現（小さな Next.js フィクスチャが理想）を記載してください。

返信は可能な範囲で行います。修正の公開まで情報公開をお待ちください。

### 想定する脅威

next-architect はローカルの Next.js プロジェクトを静的に解析します。解析対象のコードを実行したり、
解析対象へ書き込んだり、内容をネットワークへ送信したりしない想定です。細工したプロジェクトでこの前提を破れる問題
（コード実行、パストラバーサル、シンボリックリンク経由の脱出、ハングやメモリ枯渇）の報告を特に歓迎します。
