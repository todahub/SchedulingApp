import Link from "next/link";
import { notFound } from "next/navigation";
import { OrganizerDashboard } from "@/components/organizer-dashboard";
import { getEventDetail, getRepositoryMode } from "@/lib/repository";

export const dynamic = "force-dynamic";

type ResultsPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

export default async function ResultsPage({ params }: ResultsPageProps) {
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
        <Link className="button button--secondary" href={`/events/${eventId}/join`}>
          参加者ページを開く
        </Link>
      </div>
      <OrganizerDashboard detail={detail} repositoryMode={getRepositoryMode()} />
    </main>
  );
}
