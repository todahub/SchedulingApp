import type { EventCandidateRecord } from "@/lib/domain";
import { formatCandidateLabel, getCandidateDateValues } from "@/lib/utils";
import type { ReviewTask } from "./types";

const TARGET_TYPE_LIST = [
  "単日日付",
  "日付範囲",
  "複数日付",
  "曜日",
  "曜日群",
  "月全体",
  "月の一部",
  "時間帯",
  "単日日付と時間帯",
  "期間と時間帯",
];

const AVAILABILITY_LIST = ["行ける", "行けない", "まだわからない", "条件付きで行ける"];
const PREFERENCE_LIST = [
  "かなり行きたい",
  "行きたい",
  "少し行きたい",
  "中立",
  "少し避けたい",
  "避けたい",
  "かなり避けたい",
];

function buildCandidateSummary(candidates: EventCandidateRecord[]) {
  const dates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const lines = candidates.map((candidate) => `- ${formatCandidateLabel(candidate)}`);

  return [
    `候補日の総数: ${candidates.length}`,
    dates.length > 0 ? `候補日レンジ: ${dates[0]} 〜 ${dates[dates.length - 1]}` : "候補日レンジ: なし",
    "候補一覧:",
    ...lines,
  ].join("\n");
}

export function buildBaseInterpretationSchema() {
  return {
    type: "object",
    properties: {
      evaluations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            targetText: { type: "string" },
            targetType: { type: "string", enum: TARGET_TYPE_LIST },
            memberTexts: { type: "array", items: { type: "string" } },
            availability: { type: "string", enum: AVAILABILITY_LIST },
            preference: { type: ["string", "null"], enum: [...PREFERENCE_LIST, null] },
            conditionText: { type: ["string", "null"] },
            evidenceText: { type: "string" },
          },
          required: ["targetText", "targetType", "memberTexts", "availability", "preference", "conditionText", "evidenceText"],
        },
      },
      comparisons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidateSetText: { type: ["string", "null"] },
            candidateTargets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  targetText: { type: "string" },
                  targetType: { type: "string", enum: TARGET_TYPE_LIST },
                  memberTexts: { type: "array", items: { type: "string" } },
                },
                required: ["targetText", "targetType", "memberTexts"],
              },
            },
            preferredTargetText: { type: "string" },
            preference: { type: "string", enum: PREFERENCE_LIST },
            conditionText: { type: ["string", "null"] },
            evidenceText: { type: "string" },
          },
          required: [
            "candidateSetText",
            "candidateTargets",
            "preferredTargetText",
            "preference",
            "conditionText",
            "evidenceText",
          ],
        },
      },
      conditions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            targetText: { type: "string" },
            targetType: { type: "string", enum: TARGET_TYPE_LIST },
            memberTexts: { type: "array", items: { type: "string" } },
            availability: { type: "string", enum: AVAILABILITY_LIST },
            conditionText: { type: "string" },
            evidenceText: { type: "string" },
          },
          required: ["targetText", "targetType", "memberTexts", "availability", "conditionText", "evidenceText"],
        },
      },
      unresolved: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            reason: { type: "string" },
          },
          required: ["text", "reason"],
        },
      },
    },
    required: ["evaluations", "comparisons", "conditions", "unresolved"],
  } satisfies Record<string, unknown>;
}

export function buildBaseInterpretationSystemPrompt() {
  return [
    "あなたは日本語の日程希望コメントを意味ドラフトJSONへ変換する解釈器です。",
    "出力は JSON のみです。",
    "ランキングやスコア計算はしてはいけません。",
    "",
    "重要:",
    "- targetText, memberTexts, candidateSetText, preferredTargetText, conditionText, evidenceText, unresolved.text は入力コメントの語句をそのまま使ってください。",
    "- 言い換え、要約、新しい日付の補完は禁止です。",
    "- 1, 2, T1 のような不透明なIDは禁止です。",
    "- availability, preference, targetType だけは指定候補から選んでください。",
    "- evaluation の preference は、明示的な希望・避けたい・嬉しい・助かる・方がいいのような選好表現がある時だけ設定してください。可否だけを述べている文では preference を null にしてください。",
    "",
    "availability 候補:",
    ...AVAILABILITY_LIST.map((value) => `- ${value}`),
    "",
    "preference 候補:",
    ...PREFERENCE_LIST.map((value) => `- ${value}`),
    "",
    "targetType 候補:",
    ...TARGET_TYPE_LIST.map((value) => `- ${value}`),
    "",
    "解釈原則:",
    "- 可否の向きを逆にしない。",
    "- 比較の向きを逆にしない。",
    "- 条件がかかる対象を勝手に変えない。",
    "- 複数日付を一まとまりで話している場合は、candidateSetText や memberTexts でそのまとまりを残してよい。",
    "- 判断できない内容は unresolved に回す。",
    "",
    "出力は JSON のみです。",
  ].join("\n");
}

export function buildBaseInterpretationUserPrompt(note: string, candidates: EventCandidateRecord[]) {
  return [
    "次のコメントを解釈してJSONで返してください。",
    "",
    buildCandidateSummary(candidates),
    "",
    "入力コメント:",
    note,
    "",
    "補足:",
    "- 候補日一覧は文脈理解の補助です。",
    "- 出力の引用フィールドは入力コメントからの原文引用だけにしてください。",
    "- 出力は JSON のみです。",
  ].join("\n");
}

export function buildEvaluationReviewSchema() {
  return {
    type: "object",
    properties: {
      targetText: { type: "string" },
      availability: { type: "string", enum: AVAILABILITY_LIST },
      preference: { type: ["string", "null"], enum: [...PREFERENCE_LIST, null] },
      evidenceText: { type: "string" },
    },
    required: ["targetText", "availability", "preference", "evidenceText"],
  } satisfies Record<string, unknown>;
}

export function buildComparisonReviewSchema() {
  return {
    type: "object",
    properties: {
      candidateSetText: { type: ["string", "null"] },
      preferredTargetText: { type: "string" },
      preference: { type: "string", enum: PREFERENCE_LIST },
      conditionText: { type: ["string", "null"] },
      evidenceText: { type: "string" },
    },
    required: ["candidateSetText", "preferredTargetText", "preference", "conditionText", "evidenceText"],
  } satisfies Record<string, unknown>;
}

export function buildConditionReviewSchema() {
  return {
    type: "object",
    properties: {
      targetText: { type: "string" },
      targetType: { type: "string", enum: TARGET_TYPE_LIST },
      availability: { type: "string", enum: AVAILABILITY_LIST },
      conditionText: { type: "string" },
      evidenceText: { type: "string" },
    },
    required: ["targetText", "targetType", "availability", "conditionText", "evidenceText"],
  } satisfies Record<string, unknown>;
}

export function buildLocalReviewSystemPrompt(task: ReviewTask) {
  const common = [
    "あなたは日程希望コメントの局所確認を行うレビュー役です。",
    "出力は JSON のみです。",
    "不透明なIDは禁止です。",
    "targetText, candidateSetText, preferredTargetText, conditionText, evidenceText は入力コメントの語句をそのまま使ってください。",
    "可否の向きや比較の向きを逆にしてはいけません。",
  ];

  if (task.kind === "evaluation") {
    return [
      ...common,
      "今回は評価対象の可否と希望度だけを確認してください。",
      "availability は 4 択、preference は 7 択または null だけを使ってください。",
      "明示的な希望・避けたい表現が無い場合は preference を null にしてください。",
    ].join("\n");
  }

  if (task.kind === "comparison") {
    return [
      ...common,
      "今回は比較方向と希望度だけを確認してください。",
      "preferredTargetText は比較の中でより好ましい対象です。",
      "曖昧なら強さを弱い側に寄せてもよいですが、向きは逆にしないでください。",
    ].join("\n");
  }

  return [
    ...common,
    "今回は条件がどの対象にかかり、条件付きでどの可否になるかだけを確認してください。",
    "availability は 4 択だけを使ってください。",
  ].join("\n");
}

export function buildLocalReviewUserPrompt(task: ReviewTask) {
  return [
    "元のコメント全文と焦点部分を見て、焦点部分だけを再解釈してください。",
    "",
    "元のコメント全文:",
    task.note,
    "",
    "焦点部分:",
    task.focusText,
    "",
    "参考となる初回解釈:",
    JSON.stringify(task.base, null, 2),
    "",
    "出力は JSON のみです。",
  ].join("\n");
}
