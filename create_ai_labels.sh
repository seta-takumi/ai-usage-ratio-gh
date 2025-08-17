#!/bin/bash

set -euo pipefail

# GitHub AI利用率ラベル作成スクリプト
# 0%から100%まで5%刻みでラベルを作成

# 色（単色：青）
COLOR="0066CC"

# リポジトリの指定（引数で指定可能）
REPO=${1:-}

echo "=== GitHub AI利用率ラベル作成スクリプト ==="
echo

# GitHub CLIの確認
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) がインストールされていません。"
    echo "   インストール方法: https://cli.github.com/"
    exit 1
fi

# GitHub認証の確認
if ! gh auth status &> /dev/null; then
    echo "❌ GitHub CLIで認証されていません。"
    echo "   SAML SSOが必須の組織の場合："
    echo "   1. gh auth login --web"
    echo "   2. ブラウザでSAML認証を完了"
    echo "   3. gh auth refresh -s repo"
    exit 1
fi

echo "✅ GitHub CLI認証済み"

# SAML SSO環境での権限確認
echo "🔐 SAML SSO環境での権限を確認中..."
if ! gh api user &> /dev/null; then
    echo "❌ APIアクセスに失敗しました。SAML SSOの再認証が必要な可能性があります。"
    echo "   以下を実行してください："
    echo "   gh auth refresh -s repo"
    echo "   またはブラウザでSAML認証: gh auth login --web"
    exit 1
fi

# リポジトリの確認
if [ -n "$REPO" ]; then
    echo "📁 指定リポジトリ: $REPO"
else
    # 現在のディレクトリがGitリポジトリかチェック
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        echo "❌ 現在のディレクトリはGitリポジトリではありません。"
        echo "   使用方法: $0 [owner/repository]"
        exit 1
    fi
    
    # リモートURLからリポジトリ名を取得
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
    if [ -z "$REPO" ]; then
        echo "❌ リポジトリ情報を取得できませんでした。"
        echo "   使用方法: $0 owner/repository"
        exit 1
    fi
    echo "📁 現在のリポジトリ: $REPO"
fi

echo
echo "🏷️  AI利用率ラベルを作成します（0%〜100%、5%刻み）"
echo

# ラベル作成
success_count=0
skip_count=0
error_count=0

for i in {0..20}; do
    percentage=$((i * 5))
    label_name="AI${percentage}%"
    description="AI利用率${percentage}%を示すラベル"
    
    printf "%-8s " "$label_name"
    
    # ラベルが既に存在するかチェック
    if gh label list --repo "$REPO" --json name -q '.[].name' | grep -q "^${label_name}$" 2>/dev/null; then
        echo "⏭️  スキップ（既存）"
        ((skip_count++))
        continue
    fi
    
    # ラベル作成（SAML環境でのエラーハンドリング強化）
    if gh label create "$label_name" --color "$COLOR" --description "$description" --repo "$REPO" 2>/dev/null; then
        echo "✅ 作成完了"
        ((success_count++))
    else
        # 詳細なエラー情報を取得
        error_msg=$(gh label create "$label_name" --color "$COLOR" --description "$description" --repo "$REPO" 2>&1 || true)
        if echo "$error_msg" | grep -q "SAML\|SSO\|authentication"; then
            echo "❌ SAML認証エラー"
            echo "   SAML SSOの再認証が必要です: gh auth refresh -s repo"
            exit 1
        elif echo "$error_msg" | grep -q "permission\|forbidden"; then
            echo "❌ 権限不足"
            echo "   組織管理者にリポジトリの書き込み権限を確認してください"
            ((error_count++))
        else
            echo "❌ 作成失敗"
            ((error_count++))
        fi
    fi
    
    # API制限回避のため少し待機
    sleep 0.5
done

echo
echo "=== 結果 ==="
echo "✅ 作成成功: ${success_count}個"
echo "⏭️  スキップ: ${skip_count}個"
echo "❌ 作成失敗: ${error_count}個"
echo "📊 合計: $((success_count + skip_count + error_count))個"

if [ $error_count -eq 0 ]; then
    echo
    echo "🎉 すべてのラベルの処理が完了しました！"
    echo "   リポジトリURL: https://github.com/$REPO/labels"
else
    echo
    echo "⚠️  一部のラベル作成に失敗しました。権限やネットワークを確認してください。"
    exit 1
fi
