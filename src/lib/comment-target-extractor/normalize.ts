export function normalizeCommentTimeText(comment: string) {
  return comment
    .replace(/\r\n?/gu, "\n")
    .replace(/　/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .trim();
}
