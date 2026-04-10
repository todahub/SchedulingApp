import { normalizeCommentTimeText } from "@/lib/comment-target-extractor";

export function normalizeCommentLabelText(comment: string) {
  return normalizeCommentTimeText(comment);
}
