# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

このリポジトリは「AI使用率分析ツール」です。GitHubのプルリクエストからAI利用率を分析し、CSV形式で出力するツールを提供します。

## 主要ファイル構成

- `get-github-pull-requests.ts` - メインのTypeScriptファイル。GitHub API経由でPRデータを取得し、AI利用率ラベルを解析してCSV出力
- `create_ai_labels.sh` - GitHub リポジトリにAI利用率ラベル（AI0%〜AI100%、5%刻み）を作成するBashスクリプト
- `package.json` - Node.js プロジェクトの設定ファイル

## 開発コマンド

```bash
# TypeScriptファイルを実行
npx tsx get-github-pull-requests.ts

# 依存関係のインストール
npm install

# AI利用率ラベル作成（Bashスクリプト）
./create_ai_labels.sh [owner/repository]

# テスト実行（現在は未定義）
npm test
```

## 環境設定

このツールは以下の環境変数を必要とします：

- `GITHUB_TOKEN` - GitHubのPersonal Access Token
- `GITHUB_REPOSITORIES` - 対象リポジトリ（例：`"owner1/repo1,owner2/repo2"`）
- `START_DATE` - 開始日（例：`"2024-01-01"`）
- `END_DATE` - 終了日（例：`"2024-12-31"`）
- `OUTPUT_PATH` - 出力パス（オプション、デフォルト：`"./output/pull_requests.csv"`）

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
- `dotenv` - 環境変数管理
- Node.js標準ライブラリ（fs/promises、path）

## プロジェクト実行前の準備

1. 環境変数の設定（`.env`ファイルまたはシェル環境）
2. `npm install`で依存関係をインストール
3. 必要に応じて`./create_ai_labels.sh`でAI利用率ラベルを作成

## 実行方法

```bash
# TypeScriptファイルを実行（実際の推奨方法）
npx tsx get-github-pull-requests.ts

# AI利用率ラベル作成
./create_ai_labels.sh [owner/repository]
```