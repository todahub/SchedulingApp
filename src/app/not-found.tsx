import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-shell">
      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">404</div>
            <h2>イベントが見つかりません</h2>
          </div>
          <p className="section-copy">
            URLが間違っているか、デモデータがリセットされた可能性があります。トップに戻って別のイベントを開いてください。
          </p>
        </div>
        <Link className="button button--primary" href="/">
          トップへ戻る
        </Link>
      </section>
    </main>
  );
}
