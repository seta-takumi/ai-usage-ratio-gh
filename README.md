# AI使用率分析ツール

GitHubのプルリクエストからAI利用率を分析し、CSV形式で出力するツールです。

## 🚀 特徴

- **GitHub PR分析**: 指定したリポジトリのプルリクエストを一括取得
- **AI利用率解析**: PRに付与されたAI利用率ラベル（AI0%〜AI100%）を自動解析
- **CSV出力**: 分析結果をCSV形式で出力し、Excelなどで詳細分析が可能
- **統計レポート**: リポジトリ別、状態別の統計情報を表示
- **ラベル管理**: AI利用率ラベルの一括作成スクリプトを提供

## 📋 前提条件

- Node.js 18以上
- GitHub Personal Access Token
- GitHub CLI（ラベル作成時）

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

`.env`ファイルを作成して以下の環境変数を設定：

```env
# GitHub Personal Access Token
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 対象リポジトリ（カンマ区切りで複数指定可能）
GITHUB_REPOSITORIES=owner1/repo1,owner2/repo2

# 分析期間
START_DATE=2024-01-01
END_DATE=2024-12-31

# 出力ファイルパス（オプション）
OUTPUT_PATH=./output/pull_requests.csv
```

### 2. AI利用率ラベルの作成（初回のみ）

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
📅 期間: 2024-01-01 〜 2024-12-31
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
✅ CSVファイルを出力しました: ./output/pull_requests.csv
```

### CSV出力フォーマット
```csv
Number,Title,Body,Author,Repository,State,Created At,Updated At,Merged At,Closed At,AI Utilization Rate (%),Labels,URL
123,"機能追加: ユーザー認証機能","認証機能を追加しました。JWT...",developer1,owner1/repo1,merged,2024-03-15,2024-03-16,2024-03-16,,45,"feature; AI45%",https://github.com/owner1/repo1/pull/123
```

## 🏷️ AI利用率ラベルシステム

このツールは以下のラベル形式でAI利用率を管理します：

- **ラベル形式**: `AI{数値}%`（例：AI25%、AI80%）
- **範囲**: 0%から100%まで5%刻み（AI0%, AI5%, AI10%, ..., AI100%）
- **用途**: PRの作成時にAI利用率に応じてラベルを手動で付与

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
- `tsx`: TypeScript実行環境

### アーキテクチャ

メインモジュールは関数ベースで以下の責務に分かれています：

1. **GitHub API関連**: PRデータの取得と変換
2. **CSV生成**: PRデータをCSV形式に変換
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

ISC License

## 🐛 トラブルシューティング

### よくある問題

**Q: `GH_TOKEN環境変数が設定されていません` エラーが出る**
A: GitHub Personal Access Tokenを`.env`ファイルまたは環境変数に設定してください。

**Q: API制限エラーが発生する**
A: GitHub APIには制限があります。大量のリポジトリを処理する場合は時間を置いて実行してください。

**Q: ラベル作成で権限エラーが出る**
A: リポジトリの書き込み権限が必要です。組織管理者に権限を確認してください。

**Q: SAML SSO環境でラベル作成に失敗する**
A: `gh auth refresh -s repo` を実行してSAML認証を更新してください。