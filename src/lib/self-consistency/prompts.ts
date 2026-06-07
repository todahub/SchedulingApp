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
            preference: { type: ["string", "null"], enum: [...PREFERENCE_LIST, null] },
            externalConditionTexts: { type: "array", items: { type: "string" } },
            evidenceText: { type: "string" },
          },
          required: ["scope", "availability", "preference", "externalConditionTexts", "evidenceText"],
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
    "- evaluations と comparisons は別です。可否を述べる文は evaluations、候補同士の優先関係を述べる文は comparisons に分けてください。",
    "- 比較だけを述べた文から availability を作ってはいけません。優先関係は、その候補が参加可能であることを必ずしも意味しません。",
    "- 候補同士の優先が表現されている場合は、表現の語形に依存せず必ず comparisons に出してください。availability がないことを理由に空にしてはいけません。",
    "- 複数候補の集合の中から一部を選ぶ、推す、より望ましいと述べる文は comparisons です。可否が書かれていなくても unresolved や空配列にしてはいけません。",
    "- 候補集合を作るための仮定表現は externalConditionTexts ではありません。選択肢の中での優先関係として扱ってください。",
    "- scope.dateText, scope.dateMemberTexts, scope.timeText, scope.placeText, candidateSetText, preferredScopeText, externalConditionTexts, evidenceText, unresolved.text は入力コメントの語句をそのまま使ってください。",
    "- ただし scope.dateText, scope.timeText, scope.placeText では、入力に明示がない軸だけ特別値を使えます。未指定の日付は 全日付、未指定の時間は 全時間、未指定の場所は 全場所 です。",
    "- 言い換え、要約、新しい日付の補完は禁止です。",
    "- 1, 2, T1 のような不透明なIDは禁止です。",
    "- availability, preference, dateType, timeType, placeType だけは指定候補から選んでください。",
    "- availability は必須で、参加可否の向きを表します。可否について述べている evaluation では、自信が弱くても 行ける・行けない・条件付きで行ける のどれかに倒してください。",
    "- 条件付きで行ける は、日付・時間・場所では表せない外部条件が明示され、その条件が満たされれば参加できる場合だけ使ってください。",
    "- 外部条件が明示されていない可否表現では、迷っても 条件付きで行ける に逃げず、行ける または 行けない に倒してください。",
    "- preference はランキング上の上げ下げの重みです。単なる感情ラベルではありません。",
    "- 弱い可否、婉曲表現、控えめな言い方、自信のなさは preference の強弱で表現してください。",
    "- preference は単語単体ではなく、コメント全体での言い方の傾向、他候補との相対差、話者が全体的に柔らかく表現している可能性を考慮して選んでください。",
    "- 同じ可否方向の中でも、断定の強さ・婉曲さ・相対差がある場合は preference に差をつけてください。",
    "- 可否と希望が衝突する場合、availability は実際に参加できるかどうかを優先し、preference はランキング上の希望や気持ちを残してください。",
    "- 可否だけを述べていてランキング上の強弱を判断できない場合は preference を 中立 にしてください。判断できる弱さや強さがある場合は null にせず preference で表現してください。",
    "- 否定的な選好だけが述べられている場合でも、日程調整上その候補を避けるべきだと読めるなら availability を 行けない として扱ってよいです。",
    "",
    "availability 候補:",
    ...AVAILABILITY_LIST.map((value) => `- ${value}`),
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
    "- 日付・時間・場所で対象範囲を絞れる表現は scope として扱ってください。scope で表せる制約を externalConditionTexts に入れてはいけません。",
    "- scope で対象範囲を絞った場合、その絞られた対象に対する availability を返してください。scope 条件だけを理由に 条件付きで行ける にしないでください。",
    "- externalConditionTexts は、日付・時間・場所では表せない外部事情や他者依存の条件だけに使ってください。",
    "- comparison.externalConditionTexts は比較関係そのものに条件がかかる場合だけ使ってください。片方の候補の可否条件は、その候補の evaluation.externalConditionTexts にだけ入れてください。",
    "- 一文の中に比較と片方の候補条件が同時にある場合、比較は comparisons、候補条件は該当する evaluation に分離してください。",
    "- 日付だけが明示される文では timeText を 全時間、placeText を 全場所 にしてください。",
    "- 時間だけが明示される文では dateText を 全日付、placeText を 全場所 にしてください。",
    "- 場所だけが明示される文では dateText を 全日付、timeText を 全時間 にしてください。",
    "- 複数日付を一まとまりで話している場合は candidateSetText や dateMemberTexts でそのまとまりを残してよいです。",
    "- 可否の向きを逆にしない。",
    "- 比較の向きを逆にしない。",
    "- 判断できない内容は unresolved に回す。",
    "- 候補一覧にない日付・期間・曜日でも、ユーザーが明示しているなら evaluations または comparisons に出してください。候補一覧外であることだけを理由に unresolved にしてはいけません。",
    "",
    "補助例:",
    "- 例は判断原則を示すためのものです。ここにある語句だけに反応してはいけません。",
    "- 11日は無理そうかな、12日は絶対無理だわ: 両方 availability は 行けない。強さの差は preference で表現します。",
    "- 11,12,13が行ける。13だと嬉しい: 11/12/13 は evaluations、13 の相対的な嬉しさは preference で表現します。",
    "- 19日と20日なら19日の方が嬉しい: availability は補完せず、comparison だけを返します。",
    "- 19日と20日なら19日の方が嬉しいが、他の日が難しければ20日でも大丈夫: comparison は 19日 > 20日、外部条件は20日の evaluation にだけ入れます。",
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
