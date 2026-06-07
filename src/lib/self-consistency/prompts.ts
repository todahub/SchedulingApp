import type { EventCandidateRecord } from "@/lib/domain";
import { formatCandidateLabel, getCandidateDateValues } from "@/lib/utils";

const DATE_SCOPE_TYPE_LIST = [
  "単日日付",
  "日付範囲",
  "複数日付",
  "曜日",
  "曜日群",
  "月全体",
  "月の一部",
  "全日付",
];

const TIME_SCOPE_TYPE_LIST = ["全時間", "時間帯"];
const PLACE_SCOPE_TYPE_LIST = ["全場所", "場所"];
const AVAILABILITY_LIST = ["行ける", "行けない", "条件付きで行ける"];
const AVAILABILITY_WEIGHT_LIST = ["強い", "普通", "弱い"];
const PREFERENCE_LIST = [
  "かなり行きたい",
  "行きたい",
  "少し行きたい",
  "中立",
  "少し避けたい",
  "避けたい",
  "かなり避けたい",
];

function buildScopeProperties() {
  return {
    dateText: { type: "string" },
    dateType: { type: "string", enum: DATE_SCOPE_TYPE_LIST },
    dateMemberTexts: { type: "array", items: { type: "string" } },
    timeText: { type: "string" },
    timeType: { type: "string", enum: TIME_SCOPE_TYPE_LIST },
    placeText: { type: "string" },
    placeType: { type: "string", enum: PLACE_SCOPE_TYPE_LIST },
  };
}

function buildScopeRequired() {
  return ["dateText", "dateType", "dateMemberTexts", "timeText", "timeType", "placeText", "placeType"];
}

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
            scope: {
              type: "object",
              properties: buildScopeProperties(),
              required: buildScopeRequired(),
            },
            availability: { type: "string", enum: AVAILABILITY_LIST },
            availabilityWeight: { type: "string", enum: AVAILABILITY_WEIGHT_LIST },
            preference: { type: ["string", "null"], enum: [...PREFERENCE_LIST, null] },
            externalConditionTexts: { type: "array", items: { type: "string" } },
            evidenceText: { type: "string" },
          },
          required: ["scope", "availability", "availabilityWeight", "preference", "externalConditionTexts", "evidenceText"],
        },
      },
      comparisons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidateSetText: { type: ["string", "null"] },
            candidateScopes: {
              type: "array",
              items: {
                type: "object",
                properties: buildScopeProperties(),
                required: buildScopeRequired(),
              },
            },
            preferredScopeText: { type: "string" },
            preference: { type: "string", enum: PREFERENCE_LIST },
            externalConditionTexts: { type: "array", items: { type: "string" } },
            evidenceText: { type: "string" },
          },
          required: ["candidateSetText", "candidateScopes", "preferredScopeText", "preference", "externalConditionTexts", "evidenceText"],
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
    required: ["evaluations", "comparisons", "unresolved"],
  } satisfies Record<string, unknown>;
}

export function buildBaseInterpretationSystemPrompt() {
  return [
    "あなたは日本語の日程希望コメントを意味ドラフトJSONへ変換する解釈器です。",
    "出力は JSON のみです。",
    "ランキングやスコア計算はしてはいけません。",
    "",
    "重要:",
    "- evaluations と comparisons は別です。比較だけを述べた文から availability を作ってはいけません。",
    "- 19日と20日なら19日の方が嬉しい、のような文は comparison だけを返してください。19日も20日も行けると補完してはいけません。",
    "- scope.dateText, scope.dateMemberTexts, scope.timeText, scope.placeText, candidateSetText, preferredScopeText, externalConditionTexts, evidenceText, unresolved.text は入力コメントの語句をそのまま使ってください。",
    "- ただし scope.dateText, scope.timeText, scope.placeText では、入力に明示がない軸だけ特別値を使えます。未指定の日付は 全日付、未指定の時間は 全時間、未指定の場所は 全場所 です。",
    "- 言い換え、要約、新しい日付の補完は禁止です。",
    "- 1, 2, T1 のような不透明なIDは禁止です。",
    "- availability, availabilityWeight, preference, dateType, timeType, placeType だけは指定候補から選んでください。",
    "- availability は必須で、参加可否の向きだけを表します。曖昧な表現でも まだわからない のような逃げ方はせず、行ける・行けない・条件付きで行ける のどれかに倒してください。",
    "- availabilityWeight は必須で、可否表現の強さだけを表します。無理です は 強い、厳しいかも は 弱い、行けると思う は 弱い、行ける は 普通 のように扱ってください。",
    "- preference は任意で、好み・感情・優先度だけを表します。片方をもう片方の代わりに使ってはいけません。",
    "- evaluation の preference は、明示的な希望・避けたい・嬉しい・助かる・方がいいのような選好表現がある時だけ設定してください。可否だけを述べている文では preference を null にしてください。",
    "- 無理・行けない・難しい・厳しいは、まず availability を決める語です。これだけで強い preference を付けてはいけません。",
    "- 避けたい・できれば避けたいは preference を決める語です。これだけで availability を 行けない にしてはいけません。",
    "",
    "availability 候補:",
    ...AVAILABILITY_LIST.map((value) => `- ${value}`),
    "",
    "availabilityWeight 候補:",
    ...AVAILABILITY_WEIGHT_LIST.map((value) => `- ${value}`),
    "",
    "preference 候補:",
    ...PREFERENCE_LIST.map((value) => `- ${value}`),
    "",
    "dateType 候補:",
    ...DATE_SCOPE_TYPE_LIST.map((value) => `- ${value}`),
    "",
    "timeType 候補:",
    ...TIME_SCOPE_TYPE_LIST.map((value) => `- ${value}`),
    "",
    "placeType 候補:",
    ...PLACE_SCOPE_TYPE_LIST.map((value) => `- ${value}`),
    "",
    "解釈原則:",
    "- 日付・時間・場所は同格の scope です。時間や場所を externalConditionTexts に入れてはいけません。",
    "- 夜なら行ける、平日夜なら助かる、のような文では 夜 は time scope です。外部条件ではありません。",
    "- バイトがなければ、みんなの予定が合うなら、Aさんが行くなら、のような scope ではない条件だけを externalConditionTexts に入れてください。",
    "- 日付だけが明示される文では timeText を 全時間、placeText を 全場所 にしてください。",
    "- 時間だけが明示される文では dateText を 全日付、placeText を 全場所 にしてください。",
    "- 場所だけが明示される文では dateText を 全日付、timeText を 全時間 にしてください。",
    "- 複数日付を一まとまりで話している場合は candidateSetText や dateMemberTexts でそのまとまりを残してよいです。",
    "- 可否の向きを逆にしない。",
    "- 比較の向きを逆にしない。",
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
