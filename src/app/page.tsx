import { EventCreateForm } from "@/components/event-create-form";
export default function Home() {

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="eyebrow">日程調節アプリ</div>
        <h1>イベント作成</h1>
        <p className="lead">
          候補日を選んでイベントを作成し、そのまま参加者ページを共有できます。
        </p>
      </section>

      <section className="page-grid">
        <div className="panel">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Create</div>
              <h2>イベント作成</h2>
            </div>
          </div>
          <EventCreateForm />
        </div>

        <div className="panel">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Guide</div>
              <h2>使い方</h2>
            </div>
            <p className="section-copy">作成したあとは参加者ページをそのまま共有し、集まった回答は結果ページで確認できます。</p>
          </div>
          <div className="rule-list">
            <div className="rule-card">
              <strong>1. 候補日を選んで作成</strong>
              <p>今月のカレンダーから候補日を選び、必要なら期間選択や時間帯も設定します。</p>
            </div>
            <div className="rule-card">
              <strong>2. 参加者ページを共有</strong>
              <p>作成直後に参加者ページへ移動します。表示されたURLをコピーして、そのまま相手に送れます。</p>
            </div>
            <div className="rule-card">
              <strong>3. 結果ページで確認</strong>
              <p>集まったコメントは自動解釈され、参加状況や候補の並び替え結果を結果ページで確認できます。</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
