import { NextResponse } from "next/server";
import { createEvent, getRepositoryMode, listEventSummaries } from "@/lib/repository";
import { parseCreateEventPayload } from "@/lib/validation";

export async function GET() {
  const events = await listEventSummaries();
  return NextResponse.json({ events, repositoryMode: getRepositoryMode() });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = parseCreateEventPayload(payload);
    const event = await createEvent(input);
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "イベントの作成に失敗しました。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
