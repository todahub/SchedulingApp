import { NextResponse } from "next/server";
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
    const response = await saveParticipantResponse(eventId, input);
    return NextResponse.json({ response }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "回答の保存に失敗しました。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
