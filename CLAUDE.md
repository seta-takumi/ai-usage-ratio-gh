# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

このリポジトリは「AI使用率分析ツール」です。GitHubのプルリクエストからAI利用率を分析し、CSV形式で出力するツールを提供します。

## 主要ファイル構成

- `get-github-pull-requests.ts` - メインのTypeScriptファイル。GitHub API経由でPRデータを取得し、AI利用率ラベルを解析してCSV出力
- `csv-analyzer.ts` - CSV分析ツール。出力されたCSVファイルからAI使用率統計、リードタイム分析、相関分析を実行
- `create_ai_labels.sh` - GitHub リポジトリにAI利用率ラベル（AI0%〜AI100%、5%刻み）を作成するBashスクリプト
- `package.json` - Node.js プロジェクトの設定ファイル
- `.claude/commands/analyze-csv.md` - Claude Codeカスタムコマンド（/analyze-csv）の定義

## 開発コマンド

```bash
# PRデータ取得
npx tsx get-github-pull-requests.ts

# CSV分析実行
npx tsx csv-analyzer.ts <CSVファイルパス>

# 依存関係のインストール（pnpm推奨）
pnpm install

# ビルドスクリプト承認（初回のみ）
pnpm approve-builds

# AI利用率ラベル作成（Bashスクリプト）
./create_ai_labels.sh [owner/repository]

# Claude Codeカスタムコマンド
/analyze-csv  # 最新CSVの分析と要約表示
```

## 環境設定

このツールは以下の環境変数を使用します：

### 必須環境変数

- `GITHUB_TOKEN` - GitHubのPersonal Access Token
- `GITHUB_REPOSITORIES` - 対象リポジトリ（例：`"owner1/repo1,owner2/repo2"`）

### オプション環境変数

- `START_DATE` - 開始日（例：`"2026-02-11"`）※
- `END_DATE` - 終了日（例：`"2026-02-17"`）※
- `OUTPUT_PATH` - 出力パス（オプション、デフォルト：日付から自動生成）

※ **START_DATEとEND_DATEは両方設定するか、両方未設定にする必要があります**

### 日付の解釈（12時基準）⚠️ **破壊的変更**

このツールは業務要件に合わせ、**12時基準**でデータを取得します：

**絶対日付モード（START_DATE/END_DATE両方設定時）**:
- `START_DATE='2026-02-11'` → 実際の開始は **2026-02-10 12:00:00**（指定日の前日12時）
- `END_DATE='2026-02-17'` → 実際の終了は **2026-02-17 11:59:59**（指定日の11時59分59秒）
- 例: START_DATE='2026-02-11', END_DATE='2026-02-17' → **2026-02-10 12:00:00 〜 2026-02-17 11:59:59**

**相対日付モード（START_DATE/END_DATE両方未設定時）**:
- 実行日の7日前12:00:00から実行日11:59:59までを自動取得
- 例: 2026-02-17 12:00に実行 → **2026-02-10 12:00:00 〜 2026-02-17 11:59:59**
- 出力ファイル名: `./output/pull_requests_202602101200_202602171159.csv`（自動生成）

設定は`.env`ファイルでも可能です。

## アーキテクチャ

### メインモジュール（get-github-pull-requests.ts）

関数ベースの設計で以下の責務に分かれています：

1. **GitHub API関連関数** - PRデータの取得と変換（`fetchPullRequests`, `fetchAllPullRequests`）
2. **CSV生成関数** - PRデータをCSV形式に変換（`generateCSV`）
3. **ファイル出力関数** - ファイル出力の管理（`writeToFile`）
4. **統計レポート関数** - 統計情報の表示（`reportStats`）
5. **メイン処理関数** - 全体の処理を統合（`processPullRequests`, `main`）
6. **設定管理関数** - 環境変数からの設定読み込み（`loadConfigFromEnv`, `createConfig`）

### AI利用率ラベルシステム

- ラベル形式：`AI{数値}%`（例：AI25%、AI80%）
- 0%から100%まで5%刻みでラベルを作成・管理
- `create_ai_labels.sh`スクリプトで一括作成可能

### データフロー

1. 環境変数から設定を読み込み
2. 指定リポジトリからPRを取得
3. AI利用率ラベルを解析
4. CSVファイルに出力
5. 統計情報を表示

## 使用する依存関係

- `@octokit/rest` - GitHub API クライアント
- `duckdb` - CSV分析用の高速データベースエンジン
- `dotenv` - 環境変数管理
- `@date-fns/tz` - タイムゾーン対応の日付処理
- Node.js標準ライブラリ（fs/promises、path）

## プロジェクト実行前の準備

1. 環境変数の設定（`.env`ファイルまたはシェル環境）
2. `pnpm install`で依存関係をインストール
3. `pnpm approve-builds`でduckdbとesbuildのビルドを承認（初回のみ）
4. 必要に応じて`./create_ai_labels.sh`でAI利用率ラベルを作成

## 実行方法

```bash
# PRデータ取得・CSV出力
npx tsx get-github-pull-requests.ts

# CSV分析
npx tsx csv-analyzer.ts ./output/pull_requests.csv

# AI利用率ラベル作成
./create_ai_labels.sh [owner/repository]

# Claude Codeで要約分析（推奨）
/analyze-csv
```

## CSV分析機能

`csv-analyzer.ts`は以下の分析を提供します：

1. **AI使用率グループ別統計** - AI利用率を4段階（0-25%、25-49%、50-74%、75-100%）に分類して集計
2. **リードタイム分析** - マージ済みPRの作成からマージまでの時間を分析
3. **AI利用率とリードタイムの相関分析** - AI高利用率（50%以上）と低利用率（0-49%）でリードタイムを比較

### Claude Codeカスタムコマンド

`/analyze-csv`コマンドは以下を自動実行します：

1. 最新のCSVファイルを特定
2. `csv-analyzer.ts`を実行して統計を取得
3. AI使用率グループ別統計を要約形式で表示
   - PRタイトルを汎用化して簡潔にまとめる
   - 同種の作業を「×N」形式でまとめる