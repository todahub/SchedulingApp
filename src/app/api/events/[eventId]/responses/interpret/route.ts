import { NextResponse } from "next/server";
import { getEventDetail } from "@/lib/repository";
import { interpretCommentWithSelfConsistency } from "@/lib/self-consistency";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

function parseInterpretPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new Error("解釈データが不正です。");
  }

  const note = "note" in payload && typeof payload.note === "string" ? payload.note.trim() : "";

  if (!note) {
    throw new Error("解釈するコメントを入力してください。");
  }

  if (note.length > 2000) {
    throw new Error("コメントは2000文字以内で入力してください。");
  }

  return { note };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const detail = await getEventDetail(eventId);

    if (!detail) {
      return NextResponse.json({ error: "イベントが見つかりません。" }, { status: 404 });
    }

    const payload = await request.json();
    const { note } = parseInterpretPayload(payload);
    const result = await interpretCommentWithSelfConsistency(note, detail.candidates);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "コメント解釈に失敗しました。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
