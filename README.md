# AI 使用率分析ツール

GitHub のプルリクエストから AI 利用率を分析し、CSV 形式で出力するツールです。

## 🚀 特徴

- **GitHub PR 分析**: 指定したリポジトリのプルリクエストを一括取得
- **AI 利用率解析**: PR に付与された AI 利用率ラベル（AI0%〜AI100%）を自動解析
- **CSV 出力**: 分析結果を CSV 形式で出力し、Excel などで詳細分析が可能
- **統計レポート**: リポジトリ別、状態別の統計情報を表示
- **ラベル管理**: AI 利用率ラベルの一括作成スクリプトを提供
- **柔軟な期間指定**: 絶対日付モードと相対日付モード（直近1週間自動取得）をサポート
- **12時基準取得**: 業務要件に合わせた12時基準でのデータ取得

## 📋 前提条件

- Node.js 22 以上
- GitHub Personal Access Token
- GitHub CLI（ラベル作成時）

### GitHub CLI セットアップ

ラベル作成機能を使用するには GitHub CLI が必要です：

```bash
# インストール
# 詳細は公式ドキュメントを参照: https://github.com/cli/cli?tab=readme-ov-file#installation

# Homebrew (macOS/Linux)
brew install gh

# 認証（初回のみ）
gh auth login

# Personal Access Token を環境変数に設定
export GITHUB_TOKEN=$(gh auth token)

# SAML SSO 環境の場合は追加で認証更新
gh auth refresh -s repo
```

## 🔧 インストール

```bash
# リポジトリをクローン
git clone https://github.com/seta-takumi/ai-usage-ratio.git
cd ai-usage-ratio

# 依存関係をインストール
npm install
```

## ⚙️ 設定

### 1. 環境変数の設定

GitHub CLI を使用している場合、token を自動取得できます：

```bash
# GitHub CLI の token を環境変数に設定
export GITHUB_TOKEN=$(gh auth token)
```

または `.env` ファイルを作成して設定：

```env
# ===== 必須環境変数 =====
# GitHub Personal Access Token
# GitHub CLI使用時: export GITHUB_TOKEN=$(gh auth token) で自動設定可能
GITHUB_TOKEN=gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 対象リポジトリ（カンマ区切りで複数指定可能）
GITHUB_REPOSITORIES=owner1/repo1,owner2/repo2

# ===== オプション環境変数 =====
# 分析期間（両方設定または両方未設定）
# ⚠️ 12時基準で解釈されます：
#   START_DATE='2026-02-11' → 実際の開始: 2026-02-10 12:00:00（前日12時）
#   END_DATE='2026-02-17' → 実際の終了: 2026-02-17 11:59:59（当日11時59分）
# 未設定の場合: 実行日の7日前12:00〜実行日11:59を自動取得（1週間分）
START_DATE=2026-02-11
END_DATE=2026-02-17

# 出力ファイルパス（オプション、未設定時は日付から自動生成）
OUTPUT_PATH=./output/pull_requests_20260210_20260217.csv
```

### 日付の解釈ルール ⚠️ **破壊的変更**

このツールは業務要件に合わせ、**12時基準**でデータを取得します：

**絶対日付モード（START_DATE/END_DATE両方設定時）**:
- 指定日の**前日12:00:00**から指定日の**11:59:59**までを取得
- 例: `START_DATE=2026-02-11, END_DATE=2026-02-17`
  - → 実際の取得期間: **2026-02-10 12:00:00 〜 2026-02-17 11:59:59**

**相対日付モード（START_DATE/END_DATE両方未設定時）**:
- 実行日の**7日前12:00:00**から実行日の**11:59:59**までを自動取得（1週間分）
- 出力ファイル名も自動生成: `./output/pull_requests_YYYYMMDD_YYYYMMDD.csv`
- 例: 2026-02-17に実行した場合
  - → 取得期間: **2026-02-10 12:00:00 〜 2026-02-17 11:59:59**
  - → ファイル名: `./output/pull_requests_20260210_20260217.csv`

### 2. AI 利用率ラベルの作成（初回のみ）

```bash
# 指定リポジトリにAI利用率ラベル（AI0%〜AI100%、5%刻み）を作成
./create_ai_labels.sh owner/repository

# 現在のディレクトリがGitリポジトリの場合
./create_ai_labels.sh
```

## 🏃‍♂️ 使用方法

```bash
# PRデータを取得してCSV出力
npx tsx get-github-pull-requests.ts
```

## 📊 出力例

### コンソール出力

```
🚀 GitHub PR取得を開始します...
📁 対象リポジトリ: owner1/repo1, owner2/repo2
📅 期間: 2026-02-10 12:00:00 〜 2026-02-17 11:59:59
🔍 2個のリポジトリからPRを取得中...
📁 処理中: owner1/repo1
  ✅ 45件のPRを取得
📁 処理中: owner2/repo2
  ✅ 23件のPRを取得
✅ 68件のPRを取得しました
📋 リポジトリ別PR数: { 'owner1/repo1': 45, 'owner2/repo2': 23 }
🤖 AI利用率ラベル付きPR: 42件
📊 平均AI利用率: 35.2%
📈 AI利用率範囲: 0% 〜 85%
📋 PR状態別統計: { merged: 58, closed: 7, open: 3 }
📄 CSVファイルを生成中...
✅ CSVファイルを出力しました: ./output/pull_requests_20260210_20260217.csv
```

### CSV 出力フォーマット

```csv
Number,Title,Body,Author,Repository,State,Created At,Updated At,Merged At,Closed At,AI Utilization Rate (%),Labels,URL
123,"機能追加: ユーザー認証機能","認証機能を追加しました。JWT...",developer1,owner1/repo1,merged,2024-03-15,2024-03-16,2024-03-16,,45,"feature; AI45%",https://github.com/owner1/repo1/pull/123
```

## 🏷️ AI 利用率ラベルシステム

このツールは以下のラベル形式で AI 利用率を管理します：

- **ラベル形式**: `AI{数値}%`（例：AI25%、AI80%）
- **範囲**: 0%から 100%まで 5%刻み（AI0%, AI5%, AI10%, ..., AI100%）
- **用途**: PR の作成時に AI 利用率に応じてラベルを手動で付与

## 📁 ファイル構成

```
ai-usage-ratio/
├── get-github-pull-requests.ts  # メイン処理（PR取得・CSV出力）
├── create_ai_labels.sh          # AI利用率ラベル作成スクリプト
├── package.json                 # プロジェクト設定
├── .env                         # 環境変数設定（要作成）
└── output/                      # CSV出力ディレクトリ
    └── pull_requests.csv        # 出力ファイル
```

## 🔨 開発

### 依存関係

- `@octokit/rest`: GitHub API クライアント
- `dotenv`: 環境変数管理
- `tsx`: TypeScript 実行環境

### アーキテクチャ

メインモジュールは関数ベースで以下の責務に分かれています：

1. **GitHub API 関連**: PR データの取得と変換
2. **CSV 生成**: PR データを CSV 形式に変換
3. **ファイル出力**: ファイル出力の管理
4. **統計レポート**: 統計情報の表示
5. **設定管理**: 環境変数からの設定読み込み

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📝 ライセンス

なし

## 🐛 トラブルシューティング

### よくある問題

**Q: `GITHUB_TOKEN環境変数が設定されていません` エラーが出る**
A: GitHub Personal Access Token を`.env`ファイルまたは環境変数に設定してください。

**Q: API 制限エラーが発生する**
A: GitHub API には制限があります。大量のリポジトリを処理する場合は時間を置いて実行してください。

**Q: ラベル作成で権限エラーが出る**
A: リポジトリの書き込み権限が必要です。組織管理者に権限を確認してください。

**Q: SAML SSO 環境でラベル作成に失敗する**
A: `gh auth refresh -s repo` を実行して SAML 認証を更新してください。

**Q: `START_DATEが設定されている場合、END_DATEも必須です` エラーが出る**
A: START_DATEとEND_DATEは両方設定するか、両方未設定（コメントアウト）にしてください。片方だけの設定はできません。

**Q: 取得期間が想定と異なる**
A: 日付は12時基準で解釈されます。`START_DATE=2026-02-11`の場合、実際の開始は**2026-02-10 12:00:00**（前日12時）になります。詳細は「日付の解釈ルール」セクションを参照してください。
