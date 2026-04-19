type NormalizedCommentText = {
  originalText: string;
  normalizedText: string;
};

function normalizeFullWidthAscii(text: string) {
  return text.replace(/[！-～]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function normalizeCommentText(input: string): NormalizedCommentText {
  const originalText = input;

  const normalizedText = normalizeFullWidthAscii(
    input
      .replace(/，/gu, "、")
      .replace(/\r\n?/gu, "\n")
      .replace(/\n/gu, " ")
      .replace(/　/gu, " "),
  )
    .replace(/[ ]+/gu, " ")
    .trim();

  return {
    originalText,
    normalizedText,
  };
}

