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
export {
  buildAttachmentResolutionMessages,
  buildAttachmentResolutionUserPrompt,
  callOllamaForAttachmentResolution,
  parseAttachmentResolutionResponse,
  resolveAttachmentsWithLlm,
  toAttachmentResolutionInput,
  toAttachmentResolutionInputFromLabeledComment,
  validateAttachmentResolutionOutput,
} from "./llm-attachment";
export {
  ATTACHMENT_FEATURE_TYPES,
  ATTACHMENT_RELATION_TYPES,
  ATTACHMENT_UNRESOLVED_REASONS,
  buildAttachmentCandidatesFromLabeledComment,
  CLAUSE_RELATION_KINDS,
  PREFERENCE_MODE_VALUES,
  REASON_MODE_VALUES,
  UNCERTAINTY_MODE_VALUES,
} from "./attachment-types";
export type {
  CommentLabelerOptions,
  Label,
  LabeledComment,
  LabeledToken,
} from "./types";
export type {
  AttachmentCandidate,
  AttachmentResolutionAttachment,
  AttachmentResolutionFeature,
  AttachmentResolutionInput,
  AttachmentResolutionOutput,
  AttachmentResolutionUnresolved,
} from "./attachment-types";

export default labelCommentText;
