"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AVAILABILITY_LEVELS, RESULT_MODE_LABELS } from "@/lib/config";
import type { EventDetail, RankedCandidate, RepositoryMode, ResultMode } from "@/lib/domain";
import { buildAdjustmentSuggestions, rankCandidates } from "@/lib/ranking";
import { formatCandidateLabel, formatDateTime, getLevelByKey } from "@/lib/utils";
import { StatusPill } from "./status-pill";

type OrganizerDashboardProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
};

function CandidateResultCard({ candidate }: { candidate: RankedCandidate }) {
  return (
    <article className="candidate-card">
      <div className="candidate-card__header">
        <div>
          <h3>{formatCandidateLabel(candidate.candidate)}</h3>
          <div className="candidate-meta">
            <span className="pill">行ける {candidate.yesCount}人</span>
            <span className="pill">微妙 {candidate.maybeCount}人</span>
            <span className="pill">無理 {candidate.noCount}人</span>
          </div>
        </div>

        <div className="score-badge">
          <span className="muted">合計スコア</span>
          <strong>{candidate.totalScore.toFixed(1)}</strong>
        </div>
      </div>

      <div className="participant-groups">
        {AVAILABILITY_LEVELS.map((level) => (
          <section className="participant-group" key={level.key}>
            <StatusPill level={level} />
            <ul>
              {candidate.statusGroups[level.key].length > 0 ? (
                candidate.statusGroups[level.key].map((name) => <li key={name}>{name}</li>)
              ) : (
                <li>該当なし</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

export function OrganizerDashboard({ detail, repositoryMode }: OrganizerDashboardProps) {
  const [resultMode, setResultMode] = useState<ResultMode>(detail.event.defaultResultMode);

  const rankedCandidates = useMemo(() => rankCandidates(detail, resultMode), [detail, resultMode]);
  const suggestions = useMemo(() => buildAdjustmentSuggestions(rankedCandidates), [rankedCandidates]);
  const topCandidate = rankedCandidates[0] ?? null;

  return (
    <div className="split-layout">
      <section className="hero-card">
        <div className="eyebrow">Organizer View</div>
        <h1>{detail.event.title}</h1>
        <p className="lead">
          候補 {detail.candidates.length}件、回答 {detail.responses.length}人。表示モードを切り替えて、最終候補の選び方を比較できます。
        </p>
        <div className="inline-list">
          <span className="mode-chip">保存先: {repositoryMode === "supabase" ? "Supabase" : "デモモード"}</span>
          <span className="mode-chip">作成日時: {formatDateTime(detail.event.createdAt)}</span>
          <span className="mode-chip">{`参加者URL: /events/${detail.event.id}/join`}</span>
        </div>
        <div className="button-row" style={{ marginTop: 16 }}>
          <Link className="button button--primary" href={`/events/${detail.event.id}/join`}>
            参加者ページを共有する
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Summary</div>
            <h2>結果サマリー</h2>
          </div>
          <p className="section-copy">表示モードは主催者側でいつでも切り替えられます。MVPでは保存せず、その場で比較します。</p>
        </div>

        <div className="result-mode-toggle" role="tablist" aria-label="結果表示モード">
          {Object.entries(RESULT_MODE_LABELS).map(([key, label]) => (
            <button
              aria-selected={resultMode === key}
              className={`button toggle-button ${resultMode === key ? "is-active" : ""}`}
              key={key}
              onClick={() => setResultMode(key as ResultMode)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="summary-grid" style={{ marginTop: 16 }}>
          <div className="summary-card">
            <span className="muted">候補数</span>
            <strong>{detail.candidates.length}</strong>
          </div>
          <div className="summary-card">
            <span className="muted">回答人数</span>
            <strong>{detail.responses.length}</strong>
          </div>
          <div className="summary-card">
            <span className="muted">最上位候補</span>
            <strong style={{ fontSize: "1.1rem", lineHeight: 1.45 }}>
              {topCandidate ? formatCandidateLabel(topCandidate.candidate) : "回答待ち"}
            </strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Ranked Candidates</div>
            <h2>候補一覧</h2>
          </div>
          <p className="section-copy">
            {detail.responses.length === 0
              ? "まだ回答がありません。参加者ページから回答を入れると、ここにランキングが表示されます。"
              : `${RESULT_MODE_LABELS[resultMode]} で並べ替えています。`}
          </p>
        </div>

        {rankedCandidates.length === 0 ? (
          <div className="empty-state">
            <p>
              {resultMode === "strict_all"
                ? "全員参加優先モードでは、1人でも「無理」がいる候補は除外されるため、該当候補がありません。"
                : "表示できる候補がまだありません。"}
            </p>
          </div>
        ) : (
          <div className="candidate-list">
            {rankedCandidates.map((candidate) => (
              <CandidateResultCard candidate={candidate} key={candidate.candidate.id} />
            ))}
          </div>
        )}
      </section>

      {suggestions.length > 0 ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Optional</div>
              <h2>少し調整すると良くなりそうな候補</h2>
            </div>
            <p className="section-copy">余力機能として、あと一歩で有力になる候補を軽く提案しています。</p>
          </div>

          <div className="suggestion-list">
            {suggestions.map((suggestion) => (
              <article className="suggestion-card" key={suggestion.candidateId}>
                <strong>{suggestion.title}</strong>
                <p className="section-copy">{suggestion.body}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Responses</div>
            <h2>回答一覧</h2>
          </div>
          <p className="section-copy">各候補日に対して、誰が「行ける / 微妙 / 無理」かをまとめて確認できます。</p>
        </div>

        {detail.responses.length === 0 ? (
          <div className="empty-state">
            <p>まだ回答がありません。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>参加者</th>
                  {detail.candidates.map((candidate) => (
                    <th key={candidate.id}>{formatCandidateLabel(candidate)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.responses.map((response) => {
                  const answerMap = new Map(response.answers.map((answer) => [answer.candidateId, answer.availabilityKey]));
                  return (
                    <tr key={response.id}>
                      <td>
                        <strong>{response.participantName}</strong>
                        {response.note ? <div className="table-note">{response.note}</div> : null}
                      </td>
                      {detail.candidates.map((candidate) => {
                        const level = getLevelByKey(answerMap.get(candidate.id));
                        return (
                          <td key={`${response.id}-${candidate.id}`}>
                            <StatusPill level={level} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
