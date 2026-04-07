import Link from "next/link";
import { notFound } from "next/navigation";
import { ParticipantForm } from "@/components/participant-form";
import { getEventDetail, getRepositoryMode } from "@/lib/repository";

export const dynamic = "force-dynamic";

type JoinPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

export default async function JoinPage({ params }: JoinPageProps) {
  const { eventId } = await params;
  const detail = await getEventDetail(eventId);

  if (!detail) {
    notFound();
  }

  return (
    <main className="app-shell">
      <div className="button-row" style={{ marginBottom: 16 }}>
        <Link className="button button--ghost" href="/">
          トップへ戻る
        </Link>
        <Link className="button button--secondary" href={`/events/${eventId}/organizer`}>
          主催者ページを開く
        </Link>
      </div>
      <ParticipantForm detail={detail} repositoryMode={getRepositoryMode()} />
    </main>
  );
}
