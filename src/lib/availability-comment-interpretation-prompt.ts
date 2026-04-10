import type { AvailabilityInterpretationExecutionInput } from "@/lib/availability-comment-interpretation";

export const AVAILABILITY_COMMENT_INTERPRETATION_SYSTEM_PROMPT = [
  "あなたは availability comment の relation graph 生成器です。",
  "入力は token 抽出済み・grouping 済みの JSON です。",
  "あなたの仕事は、入力 JSON にある token index と grouping だけを使って、安全な relation graph を生成することです。",
  "",
  "絶対に守ること:",
  "- token を再抽出しない",
  "- label を変更しない",
  "- grouping を新規作成しない",
  "- 入力にない token index を使わない",
  "- 新しい relation を作らない",
  "- JSON 以外を返さない",
  "",
  "今回使用可能な relation:",
  '- "applies_to"',
  '- "contrast_with"',
  '- "residual_of"',
  '- "exception_to"',
  "",
  "今回禁止する relation:",
  '- "modifies"',
  '- "condition_for"',
  "",
  "relation object は必須 field をすべて埋めること:",
  '- applies_to: relation / targetTokenIndexes / availabilityTokenIndexes / confidence',
  '- contrast_with: relation / sourceTokenIndexes / targetTokenIndexes / markerTokenIndexes / confidence',
  '- residual_of: relation / sourceTokenIndexes / targetTokenIndexes / confidence',
  '- exception_to: relation / sourceTokenIndexes / targetTokenIndexes / confidence',
  "- required field が揃わない relation は作らない",
  "- partial object を返さない",
  '- confidence は "high" または "medium" のみ使う',
  '- low を使う代わりに relation を省略する',
  "",
  "relation ごとの制約:",
  "1. applies_to",
  "- availabilityGroups 1 件と、targetGroups または scopeGroups 1 件を安全に対応付けできる場合のみ作る",
  "- clauseGroups.appliesToTargetTokenIndexes が空でない場合は、その配列を applies_to の targetTokenIndexes にそのまま使う",
  "- targetTokenIndexes は targetGroups または scopeGroups の tokenIndexes と完全一致させる",
  "- availabilityTokenIndexes は availabilityGroups の tokenIndexes と完全一致させる",
  "- modifierTokenIndexes は任意",
  "- modifierTokenIndexes に入れてよい label は uncertainty_marker / desire_marker / hypothetical_marker / emphasis_marker のみ",
  "- clauseGroups.semanticModifierTokenIndexes が空でない場合は、その index を modifierTokenIndexes にそのまま入れる",
  "",
  "2. contrast_with",
  "- conjunction_contrast があり、両側の clauseGroups に availability_* がある場合のみ作る",
  "- sourceTokenIndexes と targetTokenIndexes は clauseGroups の tokenIndexes をそのまま使う",
  "- markerTokenIndexes は contrastMarkers の tokenIndexes をそのまま使う",
  "",
  "3. residual_of",
  "- scope_residual がある場合のみ作る",
  "- sourceTokenIndexes は residualScopeGroups 1 件と完全一致させる",
  "- targetTokenIndexes には target_* token のみを入れる",
  "- targetTokenIndexes は、その residual scope より前に出現した targetGroups 全体の tokenIndexes を連結した集合でよい",
  "- 原則として既出 targetGroups 全体を参照してよい",
  "- ただし参照範囲が曖昧なら residual_of は作らない",
  "",
  "4. exception_to",
  "- scope_exception がある場合のみ作る",
  "- sourceTokenIndexes は exceptionScopeGroups 1 件と完全一致させる",
  "- targetTokenIndexes は targetGroups 1 件と完全一致させる",
  "- clauseGroups.appliesToTargetTokenIndexes が scope_exception で、contextTargetGroups に targetGroup が 1 件だけあるなら、その targetGroup を exception_to の target に使う",
  "- 明示 target group がない場合は作らない",
  "",
  "安全優先ルール:",
  "- 迷ったら relation を作らない",
  '- 1 件も安全に作れない場合は {"links":[]} を返す',
  "- 曖昧な relation を近似で補わない",
  "- 説明文、理由、Markdown、コードフェンスは禁止",
  "",
  "短い例:",
  '- 「平日は無理」 -> applies_to 1 件だけ',
  '- 「5日は午前が無理」 -> applies_to 1 件だけ。target は複合 target group',
  '- 「あとはいける」 -> applies_to は scope_residual に対して作ってよい。先行 target が不明なら residual_of は作らない',
  '- 「平日ならいけるけど金曜は厳しい」 -> applies_to 2 件と contrast_with だけ。condition_for は作らない',
  '- 「金曜の夜以外はいける」 -> applies_to は scope_exception を target にし、さらに exception_to を 1 件作る',
  '- 「5日はたぶんいける、6日は無理ではない」 -> 1 件目の applies_to には semanticModifierTokenIndexes をそのまま入れる',
].join("\n");

export function buildAvailabilityCommentInterpretationUserPrompt(input: AvailabilityInterpretationExecutionInput) {
  return [
    "以下の入力 JSON から、安全に作れる relation graph だけを生成してください。",
    "",
    "手順:",
    "1. tokens と grouping をそのまま使う",
    "2. applies_to / contrast_with / residual_of / exception_to 以外は作らない",
    "3. modifies と condition_for は絶対に作らない",
    "4. grouping にない token の組み合わせを新規作成しない",
    "5. residual_of だけは、既出 targetGroups 全体の tokenIndexes 連結を許可する",
    "6. 範囲や対応が曖昧なら、その relation は作らない",
    "7. 1 件も安全に作れなければ {\"links\":[]} を返す",
    "8. relation object を作るときは required field を省略しない",
    "9. required field を埋められない relation は出力しない",
    "10. applies_to の target は、まず clauseGroups.appliesToTargetTokenIndexes をそのまま使う",
    "11. clauseGroups.semanticModifierTokenIndexes がある applies_to では、その index を落とさず modifierTokenIndexes に入れる",
    "",
    "clause ごとの決定済みヒント:",
    formatClauseHints(input),
    "",
    "入力 JSON:",
    JSON.stringify(input, null, 2),
    "",
    "出力は JSON オブジェクト 1 個のみ。",
  ].join("\n");
}

export function buildAvailabilityCommentInterpretationRepairPrompt(args: {
  input: AvailabilityInterpretationExecutionInput;
  invalidResponse: string;
  validationError: string;
}) {
  return [
    "前回の出力は無効でした。入力 JSON は同じです。",
    "無効理由:",
    args.validationError,
    "",
    "前回の出力:",
    args.invalidResponse,
    "",
    "修正ルール:",
    "- 有効な relation だけを残す",
    "- partial object を返さない",
    "- required field を埋められない relation は削除する",
    '- modifies と condition_for は返さない',
    '- low を使わず、必要なら {"links":[]} を返す',
    "- applies_to は clauseGroups.appliesToTargetTokenIndexes をそのまま target にする",
    "- clauseGroups.semanticModifierTokenIndexes は落とさない",
    "",
    "clause ごとの決定済みヒント:",
    formatClauseHints(args.input),
    "",
    "入力 JSON:",
    JSON.stringify(args.input, null, 2),
    "",
    "JSON オブジェクト 1 個のみを返してください。",
  ].join("\n");
}

function formatClauseHints(input: AvailabilityInterpretationExecutionInput) {
  const availabilityGroupsById = new Map(
    input.grouping.availabilityGroups.map((group) => [group.id, group]),
  );

  return input.grouping.clauseGroups
    .map((clauseGroup) => {
      const availabilityGroup = availabilityGroupsById.get(clauseGroup.availabilityGroupId);
      const targetHint = clauseGroup.appliesToTargetTokenIndexes;
      const modifierHint = clauseGroup.semanticModifierTokenIndexes;
      const targetLabels = targetHint.map((tokenIndex) => input.tokens[tokenIndex]?.label).filter(Boolean);
      const isScopeException = targetLabels.includes("scope_exception");
      const isScopeResidual = targetLabels.includes("scope_residual");

      const lines = [
        `- ${clauseGroup.id}: applies_to target=${JSON.stringify(targetHint)} availability=${JSON.stringify(availabilityGroup?.tokenIndexes ?? [])} modifiers=${JSON.stringify(modifierHint)}`,
      ];

      if (isScopeException && clauseGroup.contextTargetGroups.length === 1) {
        lines.push(
          `- ${clauseGroup.id}: exception_to source=${JSON.stringify(targetHint)} target=${JSON.stringify(clauseGroup.contextTargetGroups[0]?.tokenIndexes ?? [])}`,
        );
      }

      if (isScopeResidual) {
        lines.push(`- ${clauseGroup.id}: residual_of は先行 target 範囲が明確な場合のみ追加`);
      }

      return lines.join("\n");
    })
    .join("\n");
}
