import * as duckdb from "duckdb";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";

dotenv.config();

export class CSVAnalyzer {
  private db: duckdb.Database;

  constructor() {
    this.db = new duckdb.Database(":memory:");
  }

  async analyzeAIUsage(csvPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE prs AS
        SELECT * FROM read_csv_auto('${csvPath}')
      `, (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }

        // Get all PRs with AI rates
        this.db.all(`
          SELECT
            Number,
            Title,
            Body,
            Repository,
            TRY_CAST("AI Utilization Rate (%)" AS INTEGER) as ai_rate,
            CASE
              WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 75 THEN '高利用率グループ（75%-100%）'
              WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 50 THEN '中高利用率グループ（50%-74%）'
              WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 25 THEN '中低利用率グループ（25%-49%）'
              WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 0 THEN '低利用率グループ（0%-24%）'
              ELSE 'ラベルなし'
            END as ai_group
          FROM prs
          WHERE TRY_CAST("AI Utilization Rate (%)" AS INTEGER) IS NOT NULL
          ORDER BY ai_rate DESC, Repository, Number
        `, (err: Error | null, rows: any[]) => {
          if (err) {
            reject(err);
            return;
          }

          // Get total PR count and unlabeled count
          this.db.all(`
            SELECT
              CAST(COUNT(*) AS INTEGER) as total_prs,
              CAST(SUM(CASE WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) IS NULL THEN 1 ELSE 0 END) AS INTEGER) as unlabeled_prs
            FROM prs
          `, (err: Error | null, statsRows: any[]) => {
            if (err) {
              reject(err);
              return;
            }

            this.displayAIUsageWithDetails(rows, statsRows[0], csvPath);
            resolve();
          });
        });
      });
    });
  }

  private displayAIUsageWithDetails(rows: any[], stats: any, csvPath: string): void {
    console.log("\n🔥 AI使用率グループ別統計:");

    const groupedPRs = rows.reduce((acc, row) => {
      if (!acc[row.ai_group]) {
        acc[row.ai_group] = [];
      }
      acc[row.ai_group].push(row);
      return acc;
    }, {} as Record<string, any[]>);

    const groupOrder = [
      '高利用率グループ（75%-100%）',
      '中高利用率グループ（50%-74%）',
      '中低利用率グループ（25%-49%）',
      '低利用率グループ（0%-24%）'
    ];

    groupOrder.forEach(group => {
      const prs = groupedPRs[group];
      if (!prs || prs.length === 0) {
        console.log(`\n🛠️ ${group}: 0件`);
        return;
      }

      console.log(`\n🔥 ${group}: ${prs.length}件`);

      prs.forEach(pr => {
        console.log(`\n  📋 PR #${pr.Number} (AI${pr.ai_rate}%) - ${pr.Repository}`);
        console.log(`     タイトル: ${pr.Title}`);

        const bodySummary = this.summarizeBody(pr.Body);
        console.log(`     内容: ${bodySummary}`);
      });
    });

    // Display summary statistics
    this.displaySummaryStatistics(groupedPRs, stats, csvPath);
  }

  private calculateStatistics(rates: number[]): { avg: number; median: number; min: number; max: number } | null {
    if (rates.length === 0) return null;

    const sorted = [...rates].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const avg = sum / sorted.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    return {
      avg,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }

  private displaySummaryStatistics(groupedPRs: Record<string, any[]>, stats: any, csvPath: string): void {
    console.log("\n---");
    console.log("\n📈 分析結果サマリー\n");

    // Extract filename from path
    const filename = csvPath.split('/').pop() || csvPath;

    // Parse date range from filename if available (format: pull_requestsYYYYMMDD_YYYYMMDD.csv)
    const dateMatch = filename.match(/(\d{8})_(\d{8})/);
    let dateRange = "分析期間不明";
    if (dateMatch) {
      const startDate = dateMatch[1];
      const endDate = dateMatch[2];
      const formatDate = (d: string) => `${d.substring(0, 4)}年${d.substring(4, 6)}月${d.substring(6, 8)}日`;
      dateRange = `${formatDate(startDate)}〜${formatDate(endDate)}`;
    }

    const totalPRs = stats.total_prs;
    const labeledPRs = totalPRs - stats.unlabeled_prs;
    const labeledPercent = totalPRs > 0 ? ((labeledPRs / totalPRs) * 100).toFixed(0) : 0;
    const unlabeledPercent = totalPRs > 0 ? ((stats.unlabeled_prs / totalPRs) * 100).toFixed(0) : 0;

    console.log(`- **分析期間**: ${dateRange}`);
    console.log(`- **対象ファイル**: \`${filename}\``);
    console.log(`- **総PR数**: ${totalPRs}件`);
    console.log(`- **AI利用率ラベル付きPR**: ${labeledPRs}件（${labeledPercent}%）`);

    // Calculate AI utilization rate statistics
    const allAIRates = Object.values(groupedPRs)
      .flatMap(prs => prs)
      .map(pr => pr.ai_rate)
      .filter((rate): rate is number => rate !== null && rate !== undefined);

    const aiStats = this.calculateStatistics(allAIRates);
    if (aiStats) {
      console.log(`\n📊 AI利用率統計:`);
      console.log(`- **平均AI利用率**: ${aiStats.avg.toFixed(1)}%`);
      console.log(`- **中央値AI利用率**: ${aiStats.median.toFixed(1)}%`);
      console.log(`- **最小値**: ${aiStats.min}%`);
      console.log(`- **最大値**: ${aiStats.max}%`);
    }

    console.log(``);

    // Display each group statistics
    const groupLabels = [
      { key: '高利用率グループ（75%-100%）', label: 'AI高利用率（75-100%）' },
      { key: '中高利用率グループ（50%-74%）', label: 'AI中高利用率（50-74%）' },
      { key: '中低利用率グループ（25%-49%）', label: 'AI中低利用率（25-49%）' },
      { key: '低利用率グループ（0%-24%）', label: 'AI低利用率（0-24%）' }
    ];

    groupLabels.forEach(({ key, label }) => {
      const prs = groupedPRs[key] || [];
      const summary = this.summarizeGroupContent(prs);
      console.log(`- **${label}**: ${prs.length}件${summary ? ` - ${summary}` : ''}`);
    });

    console.log(`- **ラベルなしPR**: ${stats.unlabeled_prs}件（${unlabeledPercent}%）`);

    // Add trend analysis
    const trend = this.analyzeTrend(groupedPRs);
    if (trend) {
      console.log(`- **主な傾向**: ${trend}`);
    }
  }

  private summarizeGroupContent(prs: any[]): string {
    if (prs.length === 0) return "";

    // Extract key themes from titles
    const titles = prs.map(pr => pr.Title);
    const commonPatterns = [
      { pattern: /(hotfix|HOTFIX|緊急|修正)/i, label: 'hotfix対応' },
      { pattern: /(リリース|release)/i, label: 'リリース作業' },
      { pattern: /(STG|stg|環境)/i, label: '環境設定' },
      { pattern: /(Docker|docker|コンテナ)/i, label: 'Docker関連' },
      { pattern: /(テスト|test)/i, label: 'テスト関連' },
      { pattern: /(リファクタ|refactor)/i, label: 'リファクタリング' },
      { pattern: /(ドキュメント|doc|コメント)/i, label: 'ドキュメント整備' }
    ];

    const themes = new Set<string>();
    titles.forEach(title => {
      for (const { pattern, label } of commonPatterns) {
        if (pattern.test(title)) {
          themes.add(label);
        }
      }
    });

    if (themes.size > 0) {
      return Array.from(themes).slice(0, 2).join('、');
    }

    return "様々な開発作業";
  }

  private analyzeTrend(groupedPRs: Record<string, any[]>): string {
    const highRate = (groupedPRs['高利用率グループ（75%-100%）'] || []).length;
    const midHighRate = (groupedPRs['中高利用率グループ（50%-74%）'] || []).length;
    const midLowRate = (groupedPRs['中低利用率グループ（25%-49%）'] || []).length;
    const lowRate = (groupedPRs['低利用率グループ（0%-24%）'] || []).length;

    const total = highRate + midHighRate + midLowRate + lowRate;
    if (total === 0) return "";

    const highRatePRs = groupedPRs['高利用率グループ（75%-100%）'] || [];
    const lowRatePRs = groupedPRs['低利用率グループ（0%-24%）'] || [];

    // Analyze what types of work have high vs low AI usage
    const trends: string[] = [];

    if (highRate > 0 && lowRate > 0) {
      const highThemes = this.extractThemes(highRatePRs);
      const lowThemes = this.extractThemes(lowRatePRs);

      if (highThemes.length > 0) {
        trends.push(`${highThemes[0]}でAI高活用`);
      }
      if (lowThemes.length > 0) {
        trends.push(`${lowThemes[0]}でAI低活用`);
      }
    } else if (highRate > 0) {
      trends.push("AI高活用のPRが中心");
    } else if (lowRate > 0) {
      trends.push("AI低活用のPRが中心");
    }

    return trends.join("、") || "データ量が少なく傾向分析は困難";
  }

  private extractThemes(prs: any[]): string[] {
    if (prs.length === 0) return [];

    const patterns = [
      { pattern: /(Docker|Snowflake|環境設定|インフラ)/i, label: '複雑なインフラ設定' },
      { pattern: /(hotfix|HOTFIX|緊急|修正)/i, label: '緊急対応' },
      { pattern: /(manifest|設定ファイル|config)/i, label: '定型的な設定作業' },
      { pattern: /(リファクタ|refactor)/i, label: 'リファクタリング' },
      { pattern: /(コメント|ドキュメント)/i, label: 'ドキュメント整備' }
    ];

    const themes: string[] = [];
    prs.forEach(pr => {
      for (const { pattern, label } of patterns) {
        if (pattern.test(pr.Title) && !themes.includes(label)) {
          themes.push(label);
        }
      }
    });

    return themes;
  }

  private summarizeBody(body: string): string {
    if (!body || body.trim() === '') {
      return '（説明なし）';
    }

    // 改行を削除し、最初の200文字程度を取得
    const cleanBody = body.replace(/\r?\n/g, ' ').trim();
    if (cleanBody.length <= 100) {
      return cleanBody;
    }

    // 最初の文またはピリオドまで、または100文字で切り詰め
    const firstSentence = cleanBody.match(/^[^.!?]*[.!?]/);
    if (firstSentence && firstSentence[0].length <= 150) {
      return firstSentence[0];
    }

    return cleanBody.substring(0, 100) + '...';
  }

  async analyzeLeadTime(csvPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT
          Number,
          Title,
          Body,
          Repository,
          TRY_CAST("Lead Time (Days)" AS FLOAT) as lead_time_days
        FROM prs
        WHERE TRY_CAST("Lead Time (Days)" AS FLOAT) IS NOT NULL
        ORDER BY lead_time_days DESC, Repository, Number
      `, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }

        this.displayLeadTimeWithDetails(rows);
        resolve();
      });
    });
  }

  async analyzeAIvsLeadTime(csvPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT
          Number,
          Title,
          Repository,
          TRY_CAST("AI Utilization Rate (%)" AS INTEGER) as ai_rate,
          TRY_CAST("Lead Time (Days)" AS FLOAT) as lead_time_days,
          CASE
            WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 50 THEN 'AI高利用率（50%以上）'
            WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 0 THEN 'AI低利用率（0-49%）'
            ELSE 'AI利用率不明'
          END as ai_category
        FROM prs
        WHERE TRY_CAST("AI Utilization Rate (%)" AS INTEGER) IS NOT NULL
          AND TRY_CAST("Lead Time (Days)" AS FLOAT) IS NOT NULL
        ORDER BY ai_rate DESC, lead_time_days ASC
      `, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }

        this.displayAIvsLeadTimeAnalysis(rows);
        resolve();
      });
    });
  }

  private displayLeadTimeWithDetails(rows: any[]): void {
    console.log("\n⏱️ リードタイム分析（マージされたPRのみ）:");

    // リードタイムでカテゴリ分け
    const categories = [
      { name: '⚡ 高速（1日以内）', min: 0, max: 1 },
      { name: '🚀 迅速（1-3日）', min: 1, max: 3 },
      { name: '📅 標準（3-7日）', min: 3, max: 7 },
      { name: '⏳ 長期（7日以上）', min: 7, max: Infinity }
    ];

    categories.forEach(category => {
      const categoryPRs = rows.filter(pr => 
        pr.lead_time_days >= category.min && pr.lead_time_days <= category.max
      );

      if (categoryPRs.length === 0) {
        console.log(`\n${category.name}: 0件`);
        return;
      }

      console.log(`\n${category.name}: ${categoryPRs.length}件`);

      // リードタイムの短い順に表示（上位5件まで）
      categoryPRs.slice(0, 5).forEach(pr => {
        console.log(`\n  📋 PR #${pr.Number} (${pr.lead_time_days}日) - ${pr.Repository}`);
        console.log(`     タイトル: ${pr.Title}`);

        const bodySummary = this.summarizeBody(pr.Body);
        console.log(`     内容: ${bodySummary}`);
      });

      if (categoryPRs.length > 5) {
        console.log(`     ... 他${categoryPRs.length - 5}件`);
      }
    });

    // 統計サマリー
    const repoStats = rows.reduce<Record<string, { total: number; sum: number; min: number; max: number }>>((acc, pr) => {
      if (!acc[pr.Repository]) {
        acc[pr.Repository] = { total: 0, sum: 0, min: Infinity, max: 0 };
      }
      acc[pr.Repository].total += 1;
      acc[pr.Repository].sum += pr.lead_time_days;
      acc[pr.Repository].min = Math.min(acc[pr.Repository].min, pr.lead_time_days);
      acc[pr.Repository].max = Math.max(acc[pr.Repository].max, pr.lead_time_days);
      return acc;
    }, {});

    console.log("\n📊 リポジトリ別統計サマリー:");
    Object.entries(repoStats).forEach(([repo, stats]) => {
      const avg = stats.sum / stats.total;
      console.log(`  📁 ${repo}: 平均${avg.toFixed(1)}日 (${stats.min.toFixed(1)}-${stats.max.toFixed(1)}日, ${stats.total}件)`);
    });
  }

  private displayAIvsLeadTimeAnalysis(rows: any[]): void {
    console.log("\n🤖⚡ AI利用率 vs リードタイム相関分析:");

    // カテゴリ別にグループ化
    const aiHighRows = rows.filter(row => row.ai_category === 'AI高利用率（50%以上）');
    const aiLowRows = rows.filter(row => row.ai_category === 'AI低利用率（0-49%）');

    // 統計計算
    const calculateStats = (data: any[]) => {
      if (data.length === 0) return null;

      const leadTimes = data.map(row => row.lead_time_days).sort((a, b) => a - b);
      const sum = leadTimes.reduce((acc, val) => acc + val, 0);
      const avg = sum / leadTimes.length;
      const median = leadTimes.length % 2 === 0
        ? (leadTimes[leadTimes.length / 2 - 1] + leadTimes[leadTimes.length / 2]) / 2
        : leadTimes[Math.floor(leadTimes.length / 2)];

      return {
        count: data.length,
        avg: avg,
        median: median,
        min: leadTimes[0],
        max: leadTimes[leadTimes.length - 1],
        data: data
      };
    };

    const aiHighStats = calculateStats(aiHighRows);
    const aiLowStats = calculateStats(aiLowRows);

    // AI高利用率グループの結果表示
    if (aiHighStats) {
      console.log(`\n🚀 AI高利用率グループ（50%以上）: ${aiHighStats.count}件`);
      console.log(`   📊 リードタイム統計:`);
      console.log(`     - 平均: ${aiHighStats.avg.toFixed(1)}日`);
      console.log(`     - 中央値: ${aiHighStats.median.toFixed(1)}日`);
      console.log(`     - 範囲: ${aiHighStats.min.toFixed(1)}日 〜 ${aiHighStats.max.toFixed(1)}日`);

      console.log(`\n   📋 個別PR詳細:`);
      aiHighStats.data.forEach(pr => {
        console.log(`     • PR #${pr.Number} (AI${pr.ai_rate}%, ${pr.lead_time_days.toFixed(1)}日) - ${pr.Repository}`);
        console.log(`       ${pr.Title}`);
      });
    } else {
      console.log(`\n🚀 AI高利用率グループ（50%以上）: 0件`);
    }

    // AI低利用率グループの結果表示
    if (aiLowStats) {
      console.log(`\n🛠️ AI低利用率グループ（0-49%）: ${aiLowStats.count}件`);
      console.log(`   📊 リードタイム統計:`);
      console.log(`     - 平均: ${aiLowStats.avg.toFixed(1)}日`);
      console.log(`     - 中央値: ${aiLowStats.median.toFixed(1)}日`);
      console.log(`     - 範囲: ${aiLowStats.min.toFixed(1)}日 〜 ${aiLowStats.max.toFixed(1)}日`);

      console.log(`\n   📋 個別PR詳細:`);
      aiLowStats.data.forEach(pr => {
        console.log(`     • PR #${pr.Number} (AI${pr.ai_rate}%, ${pr.lead_time_days.toFixed(1)}日) - ${pr.Repository}`);
        console.log(`       ${pr.Title}`);
      });
    } else {
      console.log(`\n🛠️ AI低利用率グループ（0-49%）: 0件`);
    }

    // 比較分析
    if (aiHighStats && aiLowStats) {
      console.log(`\n📈 比較分析:`);
      const avgDiff = aiHighStats.avg - aiLowStats.avg;
      const medianDiff = aiHighStats.median - aiLowStats.median;

      console.log(`   🎯 平均リードタイム差: ${avgDiff > 0 ? '+' : ''}${avgDiff.toFixed(1)}日`);
      console.log(`   🎯 中央値リードタイム差: ${medianDiff > 0 ? '+' : ''}${medianDiff.toFixed(1)}日`);

      if (Math.abs(avgDiff) < 1) {
        console.log(`   💡 結論: AI利用率とリードタイムに大きな相関は見られない`);
      } else if (avgDiff > 0) {
        console.log(`   💡 結論: AI高利用率の方がリードタイムが長い傾向（${avgDiff.toFixed(1)}日差）`);
      } else {
        console.log(`   💡 結論: AI高利用率の方がリードタイムが短い傾向（${Math.abs(avgDiff).toFixed(1)}日短縮）`);
      }
    } else if (aiHighStats) {
      console.log(`\n💡 AI高利用率のみのデータのため、比較分析は実行できません`);
    } else if (aiLowStats) {
      console.log(`\n💡 AI低利用率のみのデータのため、比較分析は実行できません`);
    }
  }

  close(): void {
    this.db.close();
  }
}

const main = async (): Promise<void> => {
  const csvPath = process.argv[2] || process.env.OUTPUT_PATH;

  if (!csvPath) {
    console.error("❌ CSVファイルのパスが指定されていません");
    console.log("\n📋 使用方法:");
    console.log("  npx tsx csv-analyzer.ts <csvファイルパス>");
    console.log("  または OUTPUT_PATH 環境変数を設定してください");
    process.exit(1);
  }

  console.log(`📊 CSV分析を開始します: ${csvPath}`);

  const analyzer = new CSVAnalyzer();

  try {
    await analyzer.analyzeAIUsage(csvPath);
    await analyzer.analyzeLeadTime(csvPath);
    await analyzer.analyzeAIvsLeadTime(csvPath);

    console.log("\n✅ 分析が完了しました");
  } catch (error) {
    console.error("❌ 分析中にエラーが発生しました:", error);
  } finally {
    analyzer.close();
  }
};

// コマンドライン実行用
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error("❌ 処理中にエラーが発生しました:", error);
    process.exit(1);
  });
}
