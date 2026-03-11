---
name: analyzing-ai-usage
description: GitHubからPRデータを取得してCSVを生成し、AI使用率分析レポートを出力するフルワークフロースキル。「AI使用率を分析して」「今週のAI利用率を見たい」「PR取得からCSV分析まで実行して」「AI利用率のレポートを出して」「GitHubのPRデータを取得して分析して」などのリクエストで必ず起動すること。既存CSVの分析だけでなく、PRデータの取得から始める場合に使用する。
allowed-tools: Bash, Read, Glob
---

# AI使用率分析フルワークフロー

GitHubのPRデータ取得からCSV生成、AI使用率分析、サマリー表示まで一連のワークフローを実行します。

## ワークフロー概要

1. 環境変数の確認
2. PRデータ取得・CSV生成（`get-github-pull-requests.ts`）
3. CSV分析実行（`csv-analyzer.ts`）
4. 分析結果のサマリー表示

## ステップ1: 環境変数の確認

以下の環境変数が設定されているか確認する。未設定の場合はユーザーに確認を求める。

**必須:**
- `GITHUB_TOKEN` - GitHubの Access Token
- `GITHUB_REPOSITORIES` - 対象リポジトリ（例: `"owner1/repo1,owner2/repo2"`）

**オプション:**
- `START_DATE` - 開始日（例: `"2026-02-11"`）
- `END_DATE` - 終了日（例: `"2026-02-17"`）
- `OUTPUT_PATH` - 出力パス（未設定時は日付から自動生成）

```bash
# 環境変数の確認（GITHUB_TOKENの値は表示しない）
echo "GITHUB_TOKEN: ${GITHUB_TOKEN:+設定済み（値は非表示）}"
echo "GITHUB_REPOSITORIES: ${GITHUB_REPOSITORIES:-未設定}"
echo "START_DATE: ${START_DATE:-未設定（相対日付モード）}"
echo "END_DATE: ${END_DATE:-未設定（相対日付モード）}"
```

環境変数は `.env` ファイルからも読み込まれる。未設定の場合はプロジェクトルートに `.env` ファイルがあるか確認し、なければ以下の設定方法を案内して処理を停止する：

```bash
# .envファイルに記載するか、シェル環境変数として設定する
GITHUB_TOKEN=ghp_xxxx
GITHUB_REPOSITORIES=owner1/repo1,owner2/repo2
```

## ステップ2: PRデータ取得・CSV生成

初回実行の場合は依存関係のインストールが必要：

```bash
pnpm install
pnpm approve-builds  # duckdb/esbuildのビルド承認（初回のみ）
```

PRデータを取得してCSVを生成：

```bash
npx tsx get-github-pull-requests.ts
```

実行中は進捗を表示する。エラーが発生した場合はエラー内容をユーザーに伝え、処理を停止する。

成功したら生成されたCSVファイルのパスを確認する。

## ステップ3: 最新CSVファイルの特定

```bash
# outputディレクトリ内の最新CSVファイルを特定
ls -t output/pull_requests_*.csv 2>/dev/null | head -1
```

CSVファイルが見つからない場合はエラーとしてユーザーに報告する。

## ステップ4: CSV分析実行

```bash
npx tsx csv-analyzer.ts <CSVファイルパス>
```

## ステップ5: 分析結果のサマリー表示

**CRITICAL: 必ず `references/summary-rules.md` に定義された出力テンプレートに厳密に従うこと。**

- テンプレートの構造・見出し・絵文字・フォーマットを一切変えずにそのまま使用する
- PRタイトルの汎用化ルールも同ファイルに定義されているので必ず適用する
- テンプレート以外の独自フォーマット（表形式など）を使用してはならない

## 日付の解釈（12時基準）

このツールは業務要件に合わせ **12時基準** でデータを取得する：

- `START_DATE='2026-02-11'` → 実際の開始は **2026-02-10 12:00:00**（指定日の前日12時）
- `END_DATE='2026-02-17'` → 実際の終了は **2026-02-17 11:59:59**（指定日の11時59分59秒）
- 両方未設定時は実行日の7日前12:00:00から実行日11:59:59まで自動取得

## エラーハンドリング

- 環境変数未設定 → 設定方法を案内して停止
- PRデータ取得失敗 → エラー内容を表示して停止
- CSVファイルが空 → 対象期間にPRが存在しない可能性をユーザーに伝える
- CSV分析失敗 → エラー内容を表示して停止
