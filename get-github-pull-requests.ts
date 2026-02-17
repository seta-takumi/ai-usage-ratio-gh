import { Octokit } from "@octokit/rest";
import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { TZDate } from "@date-fns/tz";
import { subDays, set, format } from "date-fns";

// .envファイルを読み込み
dotenv.config();

// 型定義
interface DateRange {
  start: Date;
  end: Date;
}

interface Repository {
  owner: string;
  repo: string;
}

interface PullRequestData {
  number: number;
  title: string;
  body: string;
  author: string;
  repository: string;
  state: "open" | "closed" | "merged";
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  leadTimeDays: number | null;
  aiUtilizationRate: number | null;
  labels: string[];
  url: string;
}

interface Config {
  repositories: Repository[];
  dateRange: DateRange;
  outputPath: string;
  githubToken: string;
}

// 定数定義
const API_DELAY_MS = 1000;
const BODY_TEXT_TRUNCATE_LENGTH = 1000;

// GitHub API 関数群
const createGitHubClient = (token: string): Octokit => {
  return new Octokit({ auth: token });
};

const determinePrState = (pr: any): "open" | "closed" | "merged" => {
  if (pr.state === "open") return "open";
  return pr.merged_at ? "merged" : "closed";
};

const extractAiUtilizationRate = (labels: string[]): number | null => {
  const aiLabel = labels.find((label) => /^AI\d{1,3}%$/.test(label));
  if (!aiLabel) return null;

  const match = aiLabel.match(/^AI(\d{1,3})%$/);
  return match ? parseInt(match[1], 10) : null;
};

const calculateLeadTimeDays = (createdAt: Date, mergedAt: Date | null, hasAiLabel: boolean): number | null => {
  if (!mergedAt || !hasAiLabel) return null;

  const timeDiffMs = mergedAt.getTime() - createdAt.getTime();
  const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

  return Math.round(timeDiffDays * 10) / 10; // 小数点1桁まで
};


const transformPullRequest = (
  pr: any,
  repository: Repository
): PullRequestData => {
  const createdAt = new TZDate(pr.created_at, "Asia/Tokyo");
  const mergedAt = pr.merged_at ? new TZDate(pr.merged_at, "Asia/Tokyo") : null;
  const labels = pr.labels.map((l: any) => l.name);
  const aiUtilizationRate = extractAiUtilizationRate(labels);
  const hasAiLabel = aiUtilizationRate !== null;

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || "",
    author: pr.user.login,
    repository: `${repository.owner}/${repository.repo}`,
    state: determinePrState(pr),
    createdAt,
    updatedAt: new TZDate(pr.updated_at, "Asia/Tokyo"),
    mergedAt,
    closedAt: pr.closed_at ? new TZDate(pr.closed_at, "Asia/Tokyo") : null,
    aiUtilizationRate,
    labels,
    url: pr.html_url,
    leadTimeDays: calculateLeadTimeDays(createdAt, mergedAt, hasAiLabel),
  };
};

const fetchPullRequests = async (
  client: Octokit,
  repository: Repository,
  dateRange: DateRange
): Promise<PullRequestData[]> => {
  const allPrs: any[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data: prs } = await client.rest.pulls.list({
      owner: repository.owner,
      repo: repository.repo,
      state: "all",
      sort: "created",
      direction: "desc",
      per_page: perPage,
      page,
    });

    if (prs.length === 0) break;

    // 最新のPRが開始日より前なら以降は全て期間外
    const latestPrDate = new TZDate(prs[0].created_at, "Asia/Tokyo");
    if (latestPrDate < dateRange.start) {
      break;
    }

    // created_atベースで指定した期間内でフィルタ
    const relevantPrs = prs.filter((pr) => {
      const createdAt = new TZDate(pr.created_at, "Asia/Tokyo");
      return createdAt >= dateRange.start && createdAt <= dateRange.end;
    });
    allPrs.push(...relevantPrs);
    page++;
  }

  const transformedPrs = allPrs
    .map((pr) => transformPullRequest(pr, repository))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return transformedPrs;
};

const fetchAllPullRequests = async (
  token: string,
  repositories: Repository[],
  dateRange: DateRange
): Promise<PullRequestData[]> => {
  console.log(`🔍 ${repositories.length}個のリポジトリからPRを取得中...`);

  const client = createGitHubClient(token);
  const allPullRequests: PullRequestData[] = [];

  for (const repo of repositories) {
    console.log(`📁 処理中: ${repo.owner}/${repo.repo}`);
    try {
      const prs = await fetchPullRequests(client, repo, dateRange);
      allPullRequests.push(...prs);
      console.log(`  ✅ ${prs.length}件のPRを取得`);
    } catch (error) {
      console.error(`  ❌ ${repo.owner}/${repo.repo} の取得に失敗:`, error);
    }

    // API制限を考慮して指定のmsec待機
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
  }

  // 作成日時でソート
  return allPullRequests.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
};

// CSV生成関数群
const formatDateTime = (date: Date): string => {
  // TZDateの場合はそのまま、Dateの場合はJSTに変換
  let targetDate: TZDate;
  if (date instanceof TZDate) {
    targetDate = date;
  } else {
    targetDate = new TZDate(date, "Asia/Tokyo");
  }
  
  // YYYY-MM-DD hh:mm:ss形式で出力
  // Asia/Tokyoタイムゾーン（+09:00）でローカル時刻を出力
  return targetDate.toISOString().replace('T', ' ').replace(/\.\d{3}(Z|[+-]\d{2}:\d{2})$/, '');
};

const sanitizeBodyText = (body: string): string => {
  if (!body) return "";

  // 改行をスペースに変換し、ダブルクォートをエスケープ
  return body
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '""')
    .trim();
};

const generateCSV = (prs: PullRequestData[]): string => {
  const headers = [
    "Number",
    "Title",
    "Body",
    "Author",
    "Repository",
    "State",
    "Created At",
    "Updated At",
    "Merged At",
    "Closed At",
    "Lead Time (Days)",
    "AI Utilization Rate (%)",
    "Labels",
    "URL",
  ];

  const rows = prs.map((pr) => [
    pr.number.toString(),
    `"${pr.title.replace(/"/g, '""')}"`,
    `"${sanitizeBodyText(pr.body)}"`,
    pr.author,
    pr.repository,
    pr.state,
    formatDateTime(pr.createdAt),
    formatDateTime(pr.updatedAt),
    pr.mergedAt ? formatDateTime(pr.mergedAt) : "",
    pr.closedAt ? formatDateTime(pr.closedAt) : "",
    pr.leadTimeDays?.toString() ?? "",
    pr.aiUtilizationRate?.toString() ?? "",
    `"${pr.labels.join("; ")}"`,
    pr.url,
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
};

// ファイル出力関数
const writeToFile = async (
  filePath: string,
  content: string
): Promise<void> => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
};

// 統計情報出力関数
const reportStats = (prs: PullRequestData[]): void => {
  console.log(`✅ ${prs.length}件のPRを取得しました`);

  // リポジトリ別統計
  const repoStats = prs.reduce((acc, pr) => {
    acc[pr.repository] = (acc[pr.repository] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("📋 リポジトリ別PR数:", repoStats);

  const aiRatedPrs = prs.filter((pr) => pr.aiUtilizationRate !== null);
  console.log(`🤖 AI利用率ラベル付きPR: ${aiRatedPrs.length}件`);

  if (aiRatedPrs.length > 0) {
    const avgAiRate =
      aiRatedPrs.reduce((sum, pr) => sum + (pr.aiUtilizationRate || 0), 0) /
      aiRatedPrs.length;
    console.log(`📊 平均AI利用率: ${avgAiRate.toFixed(1)}%`);

    const maxAiRate = Math.max(
      ...aiRatedPrs.map((pr) => pr.aiUtilizationRate || 0)
    );
    const minAiRate = Math.min(
      ...aiRatedPrs.map((pr) => pr.aiUtilizationRate || 0)
    );
    console.log(`📈 AI利用率範囲: ${minAiRate}% 〜 ${maxAiRate}%`);
  }

  const stateStats = prs.reduce((acc, pr) => {
    acc[pr.state] = (acc[pr.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("📋 PR状態別統計:", stateStats);
};

// メインプロセッサ関数
const processPullRequests = async (config: Config): Promise<void> => {
  console.log("🚀 GitHub PR取得を開始します...");
  console.log(
    `📁 対象リポジトリ: ${config.repositories
      .map((r) => `${r.owner}/${r.repo}`)
      .join(", ")}`
  );
  console.log(
    `📅 期間: ${formatDateTime(config.dateRange.start)} 〜 ${formatDateTime(
      config.dateRange.end
    )}`
  );

  try {
    const pullRequests = await fetchAllPullRequests(
      config.githubToken,
      config.repositories,
      config.dateRange
    );

    reportStats(pullRequests);

    console.log("📄 CSVファイルを生成中...");
    const csvContent = generateCSV(pullRequests);

    await writeToFile(config.outputPath, csvContent);
    console.log(`✅ CSVファイルを出力しました: ${config.outputPath}`);
  } catch (error) {
    console.error("❌ エラーが発生しました:", error);
    throw error;
  }
};

/**
 * 相対的な日付範囲を生成する（実行日基準）
 * - start: 実行日の7日前12:00:00（Asia/Tokyo）
 * - end: 実行日の11:59:59（Asia/Tokyo）
 * @returns DateRange オブジェクト
 */
const createRelativeDateRange = (): DateRange => {
  const timezone = "Asia/Tokyo";
  const now = new TZDate(new Date(), timezone);

  // 実行日の7日前12:00:00（開始時刻）
  const startDate = new TZDate(
    set(subDays(now, 7), {
      hours: 12,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    }),
    timezone
  );

  // 実行日の11:59:59（終了時刻）
  const endDate = new TZDate(
    set(now, {
      hours: 11,
      minutes: 59,
      seconds: 59,
      milliseconds: 0,
    }),
    timezone
  );

  return {
    start: startDate,
    end: endDate,
  };
};

/**
 * 絶対日付範囲を生成する（環境変数基準）
 * - start: START_DATEの前日12:00:00（Asia/Tokyo）
 * - end: END_DATEの11:59:59（Asia/Tokyo）
 * @param startDateStr 開始日文字列（YYYY-MM-DD形式）
 * @param endDateStr 終了日文字列（YYYY-MM-DD形式）
 * @returns DateRange オブジェクト
 */
const createAbsoluteDateRange = (startDateStr: string, endDateStr: string): DateRange => {
  const timezone = "Asia/Tokyo";

  // START_DATEの前日12:00:00
  const startDateBase = new TZDate(`${startDateStr}T00:00:00`, timezone);
  const startDate = new TZDate(
    set(subDays(startDateBase, 1), {
      hours: 12,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    }),
    timezone
  );

  // END_DATEの11:59:59
  const endDate = new TZDate(`${endDateStr}T11:59:59`, timezone);

  return {
    start: startDate,
    end: endDate,
  };
};

/**
 * 日付範囲から出力ファイル名を生成
 * 開始日と終了日を実際の日付（前日と当日）でフォーマット
 * @param dateRange 日付範囲
 * @returns ファイルパス文字列（例: "./output/pull_requests_20260216_20260217.csv"）
 */
const generateDefaultOutputPath = (dateRange: DateRange): string => {
  const startStr = format(dateRange.start, "yyyyMMdd");
  const endStr = format(dateRange.end, "yyyyMMdd");

  return `./output/pull_requests_${startStr}_${endStr}.csv`;
};

// 環境変数からの設定読み込み
const loadConfigFromEnv = (): Config => {
  const repositories = parseRepositories(process.env.GITHUB_REPOSITORIES || "");
  const startDateEnv = process.env.START_DATE || "";
  const endDateEnv = process.env.END_DATE || "";
  const outputPathEnv = process.env.OUTPUT_PATH || "";
  const githubToken = process.env.GITHUB_TOKEN || "";

  // 必須項目のバリデーション
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN環境変数が設定されていません");
  }

  if (repositories.length === 0) {
    throw new Error(
      'GITHUB_REPOSITORIES環境変数が設定されていません (例: "owner1/repo1,owner2/repo2")'
    );
  }

  // 環境変数の組み合わせバリデーション
  if (startDateEnv && !endDateEnv) {
    throw new Error("START_DATEが設定されている場合、END_DATEも必須です");
  }
  if (!startDateEnv && endDateEnv) {
    throw new Error("END_DATEが設定されている場合、START_DATEも必須です");
  }

  // 日付範囲の決定
  let dateRange: DateRange;
  if (startDateEnv && endDateEnv) {
    // 絶対日付モード（新仕様: 指定日の前日12:00〜指定日11:59）
    dateRange = createAbsoluteDateRange(startDateEnv, endDateEnv);
  } else {
    // 相対日付モード（新機能: 実行日の前日12:00〜実行日11:59）
    dateRange = createRelativeDateRange();
  }

  // 出力パスの決定
  const outputPath = outputPathEnv || generateDefaultOutputPath(dateRange);

  return {
    repositories,
    dateRange,
    outputPath,
    githubToken,
  };
};

// リポジトリ文字列のパース
const parseRepositories = (repoString: string): Repository[] => {
  if (!repoString.trim()) return [];

  return repoString
    .split(",")
    .map((repo) => repo.trim())
    .filter((repo) => repo.includes("/"))
    .map((repo) => {
      const [owner, repoName] = repo.split("/");
      return { owner, repo: repoName };
    });
};


// 使用例とメイン関数
const main = async (): Promise<void> => {
  // 環境変数から設定を読み込み
  let config: Config;

  try {
    config = loadConfigFromEnv();
  } catch (error) {
    console.error("❌ 設定エラー:", error);
    console.log("\n📋 必須環境変数:");
    console.log("  GITHUB_TOKEN: GitHubのPersonal Access Token");
    console.log(
      '  GITHUB_REPOSITORIES: 対象リポジトリ (例: "owner1/repo1,owner2/repo2")'
    );
    console.log("\n📋 オプション環境変数（両方設定または両方未設定）:");
    console.log('  START_DATE: 開始日（例: "2024-01-01"）');
    console.log('    ※実際の開始は指定日の前日12:00:00（Asia/Tokyo）');
    console.log('  END_DATE: 終了日（例: "2024-12-31"）');
    console.log('    ※実際の終了は指定日の11:59:59（Asia/Tokyo）');
    console.log('  ※未設定の場合: 実行日の7日前12:00〜実行日11:59のデータを取得');
    console.log(
      '  OUTPUT_PATH: 出力パス（オプション、デフォルト: 日付から自動生成）'
    );
    console.log("\n💡 .envファイルでも設定可能です");
    process.exit(1);
  }

  await processPullRequests(config);
};

// コマンドライン実行用
// ESM-compatible main check
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error("❌ 処理中にエラーが発生しました:", error);
    process.exit(1);
  });
}
