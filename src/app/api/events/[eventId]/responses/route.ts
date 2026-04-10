import { NextResponse } from "next/server";
import { buildDerivedResponseFromComment, parseCommentConstraints } from "@/lib/comment-parser";
import { interpretAvailabilityCommentWithOllama } from "@/lib/availability-comment-interpretation-server";
import { getEventDetail, saveParticipantResponse } from "@/lib/repository";
import { parseSubmitResponsePayload } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
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
    const derived = input.answers.length === 0 ? buildDerivedResponseFromComment(input.note ?? "", detail.candidates) : null;
    const response = await saveParticipantResponse(eventId, {
      ...input,
      answers: derived?.answers ?? input.answers,
      parsedConstraints: derived?.parsedConstraints ?? parseCommentConstraints(input.note ?? "", detail.candidates),
    });
    const autoInterpretation = await interpretAvailabilityCommentWithOllama(input.note ?? "", detail.candidates);
    return NextResponse.json(
      {
        response,
        interpretation: {
          usedDefault: derived?.usedDefault ?? false,
          defaultReason: derived?.defaultReason ?? null,
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
