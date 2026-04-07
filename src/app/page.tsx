import Link from "next/link";
import { EventCreateForm } from "@/components/event-create-form";
import { AVAILABILITY_LEVELS, TIME_SLOT_OPTIONS } from "@/lib/config";
import { getRepositoryMode, listEventSummaries } from "@/lib/repository";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [events, repositoryMode] = await Promise.all([
    listEventSummaries(),
    Promise.resolve(getRepositoryMode()),
  ]);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="eyebrow">Awase Scheduler MVP</div>
        <h1>曖昧な参加可否も扱える、シンプルな日程調整アプリ</h1>
        <p className="lead">
          「行ける / 微妙 / 無理」の3段階を重み付きで集計し、主催者が表示モードを切り替えながら候補日を比較できます。
        </p>
        <div className="inline-list">
          <span className="mode-chip">
            データ保存: {repositoryMode === "supabase" ? "Supabase" : "デモモード"}
          </span>
          <span className="mode-chip">
            時間帯: {TIME_SLOT_OPTIONS.map((slot) => slot.label).join(" / ")}
          </span>
          <span className="mode-chip">
            参加可否: {AVAILABILITY_LEVELS.map((level) => `${level.label}=${level.weight}`).join(" / ")}
          </span>
        </div>
      </section>

      <section className="page-grid">
        <div className="panel">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Step 1</div>
              <h2>イベントを作る</h2>
            </div>
            <p className="section-copy">
              MVP ではイベント名と候補日だけを入力します。作成後に主催者ページと参加者用リンクが発行されます。
            </p>
          </div>
          <EventCreateForm />
        </div>

        <div className="stack">
          <div className="panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Step 2</div>
                <h2>参加者に共有する</h2>
              </div>
              <p className="section-copy">
                作成後の主催者ページから参加者URLをコピーできます。同じ名前で再送すると回答は上書きされます。
              </p>
            </div>
            <div className="rule-list">
              <div className="rule-card">
                <strong>全員参加優先モード</strong>
                <p>1人でも「無理」がいる候補日は除外し、その中で合計スコア順に並べます。</p>
              </div>
              <div className="rule-card">
                <strong>できるだけ全員参加モード</strong>
                <p>「無理」が少ない順、次に合計スコア順で並べて、最も参加しやすい候補を出します。</p>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Events</div>
                <h2>最近のイベント</h2>
              </div>
              <p className="section-copy">デモデータも含め、作成済みイベントをすぐ開けます。</p>
            </div>

            {events.length === 0 ? (
              <div className="empty-state">
                <p>まだイベントがありません。左のフォームから最初のイベントを作ってみてください。</p>
              </div>
            ) : (
              <div className="card-list">
                {events.map((event) => (
                  <article className="mini-card" key={event.id}>
                    <div className="mini-card__header">
                      <div>
                        <h3>{event.title}</h3>
                        <p className="muted">{formatDateTime(event.createdAt)} に作成</p>
                      </div>
                      <span className="mode-chip">
                        候補 {event.candidateCount}件 / 回答 {event.participantCount}人
                      </span>
                    </div>
                    <div className="button-row">
                      <Link className="button button--secondary" href={`/events/${event.id}/organizer`}>
                        主催者ページ
                      </Link>
                      <Link className="button button--ghost" href={`/events/${event.id}/join`}>
                        参加者ページ
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
