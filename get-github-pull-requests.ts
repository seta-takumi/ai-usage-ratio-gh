import { Octokit } from "@octokit/rest";
import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { addDays } from "date-fns";

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


const transformPullRequest = (
  pr: any,
  repository: Repository
): PullRequestData => {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || "",
    author: pr.user.login,
    repository: `${repository.owner}/${repository.repo}`,
    state: determinePrState(pr),
    createdAt: new Date(pr.created_at),
    updatedAt: new Date(pr.updated_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    aiUtilizationRate: extractAiUtilizationRate(
      pr.labels.map((l: any) => l.name)
    ),
    labels: pr.labels.map((l: any) => l.name),
    url: pr.html_url,
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
    const latestPrDate = new Date(prs[0].created_at);
    if (latestPrDate < dateRange.start) {
      break;
    }

    // created_atベースで指定した期間内でフィルタ
    const relevantPrs = prs.filter((pr) => {
      const createdAt = new Date(pr.created_at);
      // 終了日の23:59:59まで含めるために1日追加
      const endDate = addDays(dateRange.end, 1);
      return createdAt >= dateRange.start && createdAt <= endDate;
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

    // API制限を考慮して少し待機
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
  }

  // 作成日時でソート
  return allPullRequests.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
};

// CSV生成関数群
const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

const sanitizeBodyText = (body: string): string => {
  if (!body) return "";

  // 改行をスペースに変換し、ダブルクォートをエスケープ
  return body
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '""')
    .trim()
    .substring(0, BODY_TEXT_TRUNCATE_LENGTH); // 長すぎる場合はBODY_TEXT_TRUNCATE_LENGTH文字で切り詰め
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
    formatDate(pr.createdAt),
    formatDate(pr.updatedAt),
    pr.mergedAt ? formatDate(pr.mergedAt) : "",
    pr.closedAt ? formatDate(pr.closedAt) : "",
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
    `📅 期間: ${formatDate(config.dateRange.start)} 〜 ${formatDate(
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

// 環境変数からの設定読み込み
const loadConfigFromEnv = (): Config => {
  const repositories = parseRepositories(process.env.GITHUB_REPOSITORIES || "");
  const startDate = process.env.START_DATE || "";
  const endDate = process.env.END_DATE || "";
  const outputPath = process.env.OUTPUT_PATH || "./output/pull_requests.csv";
  const githubToken = process.env.GH_TOKEN || "";

  if (!githubToken) {
    throw new Error("GH_TOKEN環境変数が設定されていません");
  }

  if (repositories.length === 0) {
    throw new Error(
      'GITHUB_REPOSITORIES環境変数が設定されていません (例: "owner1/repo1,owner2/repo2")'
    );
  }

  if (!startDate || !endDate) {
    throw new Error(
      'START_DATE及びEND_DATE環境変数が設定されていません (例: "2024-01-01")'
    );
  }

  return {
    repositories,
    dateRange: {
      start: new Date(startDate),
      end: new Date(endDate),
    },
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
    console.log("\n📋 必要な環境変数:");
    console.log("  GH_TOKEN: GitHubのPersonal Access Token");
    console.log(
      '  GITHUB_REPOSITORIES: 対象リポジトリ (例: "owner1/repo1,owner2/repo2")'
    );
    console.log('  START_DATE: 開始日 (例: "2024-01-01")');
    console.log('  END_DATE: 終了日 (例: "2024-12-31")');
    console.log(
      '  OUTPUT_PATH: 出力パス (オプション、デフォルト: "./output/pull_requests.csv")'
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
