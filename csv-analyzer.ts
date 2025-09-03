import * as duckdb from "duckdb";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";

dotenv.config();

interface AIUsageStats {
  ai_group: string;
  count: number;
  Repository: string;
}

interface GroupSummary {
  total: number;
  repos: string[];
}

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
              WHEN TRY_CAST("AI Utilization Rate (%)" AS INTEGER) >= 0 THEN '低利用率グループ（0%-25%）'
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

          this.displayAIUsageWithDetails(rows);
          resolve();
        });
      });
    });
  }

  private displayAIUsageWithDetails(rows: any[]): void {
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
      '低利用率グループ（0%-25%）'
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
