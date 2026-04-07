import { NextResponse } from "next/server";
import { getEventDetail, getRepositoryMode } from "@/lib/repository";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const detail = await getEventDetail(eventId);

  if (!detail) {
    return NextResponse.json({ error: "イベントが見つかりません。" }, { status: 404 });
  }

  return NextResponse.json({ detail, repositoryMode: getRepositoryMode() });
}
