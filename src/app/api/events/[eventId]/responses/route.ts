import { NextResponse } from "next/server";
import { interpretAvailabilityCommentWithOllama } from "@/lib/availability-comment-interpretation-server";
import { buildDefaultAnswers } from "@/lib/comment-parser";
import type { AutoInterpretationResult, ParsedCommentConstraint, ParticipantAnswerRecord } from "@/lib/domain";
import { getEventDetail, saveParticipantResponse } from "@/lib/repository";
import { interpretCommentWithSelfConsistency, projectSelfConsistencyToRankingArtifacts } from "@/lib/self-consistency";
import { parseSubmitResponsePayload } from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

type SubmissionInterpretation = {
  autoInterpretation: AutoInterpretationResult;
  parsedConstraints: ParsedCommentConstraint[];
  answers: ParticipantAnswerRecord[];
  usedDefault: boolean;
  defaultReason: "empty" | "unparsed" | null;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const detail = await getEventDetail(eventId);

    if (!detail) {
      return NextResponse.json({ error: "イベントが見つかりません。" }, { status: 404 });
    }

    const payload = await request.json();
    const input = parseSubmitResponsePayload(payload, detail.candidates);
    const trimmedNote = input.note?.trim() ?? "";
    let submissionInterpretation: SubmissionInterpretation | null = null;

    if (input.answers.length === 0) {
      if (trimmedNote) {
        const result = await interpretCommentWithSelfConsistency(trimmedNote, detail.candidates);
        const projected = projectSelfConsistencyToRankingArtifacts(trimmedNote, result, detail.candidates);

        submissionInterpretation = {
          autoInterpretation: projected.autoInterpretation,
          parsedConstraints: projected.parsedConstraints,
          answers: projected.answers,
          usedDefault: projected.parsedConstraints.length === 0,
          defaultReason: projected.parsedConstraints.length === 0 ? "unparsed" : null,
        };
      } else {
        submissionInterpretation = {
          autoInterpretation: {
            status: "skipped",
            sourceComment: input.note ?? "",
            rules: [],
            ambiguities: [],
            failureReason: "コメント未入力のため自動解釈を実行しませんでした。",
          },
          parsedConstraints: [],
          answers: buildDefaultAnswers(detail.candidates),
          usedDefault: true,
          defaultReason: "empty",
        };
      }
    }
    const response = await saveParticipantResponse(eventId, {
      ...input,
      answers: submissionInterpretation?.answers ?? input.answers,
      parsedConstraints: submissionInterpretation?.parsedConstraints ?? input.parsedConstraints ?? [],
      autoInterpretation: submissionInterpretation?.autoInterpretation ?? null,
    });
    const autoInterpretation =
      submissionInterpretation?.autoInterpretation ??
      (await interpretAvailabilityCommentWithOllama(input.note ?? "", detail.candidates));

    return NextResponse.json(
      {
        response,
        interpretation: {
          usedDefault: submissionInterpretation?.usedDefault ?? false,
          defaultReason: submissionInterpretation?.defaultReason ?? null,
        },
        autoInterpretation,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "回答の保存に失敗しました。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
