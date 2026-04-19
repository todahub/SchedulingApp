import { labelCommentText } from "./rule-labeler";

export { labelCommentText } from "./rule-labeler";
export { normalizeCommentLabelText } from "./normalize";
export {
  COMMENT_LABEL_COMPLETION_ALLOWED_LABELS,
  COMMENT_LABEL_COMPLETION_RULES,
  COMMENT_LABEL_MEANING_GUIDE,
  applyLlmLabelCompletion,
  callOllamaForLabelCompletion,
  buildCommentLabelCompletionMessages,
  buildCommentLabelCompletionSystemPrompt,
  buildCommentLabelCompletionUserPrompt,
  completeLabeledCommentWithLlm,
  completeLabelsWithLlm,
  extractUnlabeledSegments,
  labelCommentTextWithLlm,
  parseCommentLabelCompletionResponse,
  toCommentLabelCompletionInput,
  validateCommentLabelCompletionOutput,
} from "./llm-label-completion";
export type {
  CommentLabelerOptions,
  Label,
  LabeledComment,
  LabeledToken,
} from "./types";

export default labelCommentText;
