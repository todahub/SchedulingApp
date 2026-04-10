"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatParsedConstraintLabel, inferResponseInterpretationMode } from "@/lib/comment-parser";
import { RESULT_MODE_LABELS, availabilityToneClass } from "@/lib/config";
import type { AvailabilityTone, EventDetail, RankedCandidate, RankedParticipantStatus, RepositoryMode, ResultMode } from "@/lib/domain";
import { buildAdjustmentSuggestions, rankCandidates } from "@/lib/ranking";
import { formatAnswerDetail, formatCandidateLabel, formatDateTime } from "@/lib/utils";

type OrganizerDashboardProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
};

function getVisibleRankedCandidates(candidates: RankedCandidate[], mode: ResultMode, responseCount: number) {
  if (responseCount === 0) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    if (mode === "strict_all") {
      return candidate.yesCount === responseCount;
    }

    const explicitAvailableCount = candidate.participantStatuses.filter(
      (status) => status.isExplicit && status.availabilityKey !== "no",
    ).length;
    const explicitUnavailableCount = candidate.participantStatuses.filter(
      (status) => status.isExplicit && status.availabilityKey === "no",
    ).length;
    const implicitStatusCount = candidate.participantStatuses.filter((status) => !status.isExplicit).length;
    const canReachFullAttendance = candidate.noCount === 0 && explicitAvailableCount === responseCount;
    const oneParticipantAway =
      responseCount > 1 &&
      candidate.noCount === 1 &&
      explicitUnavailableCount === 1 &&
      explicitAvailableCount === responseCount - 1 &&
      implicitStatusCount === 0;

    return canReachFullAttendance || oneParticipantAway;
  });
}

function groupParticipantStatuses(statuses: RankedParticipantStatus[]) {
  const groups = new Map<string, { tone: AvailabilityTone; names: string[] }>();

  for (const status of statuses) {
    const group = groups.get(status.label);

    if (group) {
      group.names.push(status.participantName);
      continue;
    }

    groups.set(status.label, {
      tone: status.tone,
      names: [status.participantName],
    });
  }

  return [...groups.entries()];
}

function RawStatusPill({ label, tone }: { label: string; tone: AvailabilityTone }) {
  return <span className={`status-pill ${availabilityToneClass[tone]}`}>{label}</span>;
}

function CandidateResultCard({ candidate }: { candidate: RankedCandidate }) {
  const groupedStatuses = groupParticipantStatuses(candidate.participantStatuses);

  return (
    <article className="candidate-card">
      <div className="candidate-card__header">
        <div>
          <h3>{formatCandidateLabel(candidate.candidate)}</h3>
          <div className="candidate-meta">
            {groupedStatuses.map(([label, group]) => (
              <span className="pill" key={`${candidate.candidate.id}-${label}`}>
                {`${label} ${group.names.length}人`}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="participant-groups">
        {groupedStatuses.map(([label, group]) => (
          <section className="participant-group" key={`${candidate.candidate.id}-${label}`}>
            <RawStatusPill label={label} tone={group.tone} />
            <ul>
              {group.names.length > 0 ? (
                group.names.map((name) => <li key={name}>{name}</li>)
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
  const commentAwareCandidates = useMemo(() => rankCandidates(detail, "maximize_attendance"), [detail]);
  const visibleRankedCandidates = useMemo(
    () => getVisibleRankedCandidates(rankedCandidates, resultMode, detail.responses.length),
    [detail.responses.length, rankedCandidates, resultMode],
  );
  const visibleCommentAwareCandidates = useMemo(
    () => getVisibleRankedCandidates(commentAwareCandidates, "maximize_attendance", detail.responses.length),
    [commentAwareCandidates, detail.responses.length],
  );
  const candidateStatusMap = useMemo(
    () =>
      new Map(
        commentAwareCandidates.flatMap((candidate) =>
          candidate.participantStatuses.map((status) => [`${candidate.candidate.id}:${status.responseId}`, status] as const),
        ),
      ),
    [commentAwareCandidates],
  );
  const visibleDisplayCandidates = useMemo(() => visibleRankedCandidates.map((candidate) => candidate.candidate), [visibleRankedCandidates]);
  const suggestions = useMemo(() => buildAdjustmentSuggestions(visibleRankedCandidates), [visibleRankedCandidates]);
  const topCandidate = visibleRankedCandidates[0] ?? null;
  const commentReflectionCandidates = visibleCommentAwareCandidates.filter(
    (candidate) => candidate.commentImpacts.length > 0 || candidate.commentScore !== 0 || candidate.hasHardNoConstraint,
  );

  return (
    <div className="split-layout">
      <section className="hero-card">
        <div className="eyebrow">Result View</div>
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
            参加者ページを開く
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Summary</div>
            <h2>結果サマリー</h2>
          </div>
          <p className="section-copy">表示モードは結果ページ上でいつでも切り替えられます。MVPでは保存せず、その場で比較します。</p>
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
            <span className="muted">表示候補数</span>
            <strong>{visibleRankedCandidates.length}</strong>
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

        {visibleRankedCandidates.length === 0 ? (
          <div className="empty-state">
            <p>
              {resultMode === "strict_all"
                ? "全員が参加可能な候補はまだありません。"
                : "全員参加できる候補、またはあと1人の調整で全員参加に近づく候補はまだありません。"}
            </p>
          </div>
        ) : (
          <div className="candidate-list">
            {visibleRankedCandidates.map((candidate) => (
              <CandidateResultCard candidate={candidate} key={candidate.candidate.id} />
            ))}
          </div>
        )}
      </section>

      {commentReflectionCandidates.length > 0 ? (
        <section className="panel">
          <div className="section-heading">
          <div>
            <div className="eyebrow">Comment Effects</div>
            <h2>コメントの反映</h2>
          </div>
          <p className="section-copy">どのコメントが各候補にマッチし、どんな解釈ラベルとして反映されたかを確認できます。</p>
        </div>

          <div className="card-list">
            {commentReflectionCandidates.map((candidate) => (
              <article className="mini-card" key={`comment-impact-${candidate.candidate.id}`}>
                <div className="mini-card__header">
                  <div>
                    <strong>{formatCandidateLabel(candidate.candidate)}</strong>
                    <p className="helper-text">この候補に影響しているコメント解釈を確認できます。</p>
                  </div>
                  {candidate.hasHardNoConstraint ? <span className="pill">全員参加優先では除外</span> : null}
                </div>

                {candidate.commentImpacts.length > 0 ? (
                  <div className="card-list">
                    {candidate.commentImpacts.map((impact, index) => (
                      <div className="table-note" key={`${candidate.candidate.id}-${impact.participantName}-${impact.label}-${index}`}>
                        <strong>{impact.participantName}</strong>
                        {` ${impact.label}`}
                        {impact.reasonText ? ` / 元コメント: ${impact.reasonText}` : ""}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="table-note">コメント補正はありません。</div>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

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
          <p className="section-copy">各候補日に対して、誰がどの解釈ラベルになっているかをまとめて確認できます。</p>
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
                  {visibleDisplayCandidates.map((candidate) => (
                    <th key={candidate.id}>{formatCandidateLabel(candidate)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.responses.map((response) => {
                  const interpretationMode = inferResponseInterpretationMode(response, detail.candidates);
                  const responseAnswerDetails = [
                    ...new Set(
                      detail.candidates.flatMap((candidate) => {
                        const answer = response.answers.find((item) => item.candidateId === candidate.id);
                        return answer ? formatAnswerDetail(answer, candidate) : [];
                      }),
                    ),
                  ];

                  return (
                    <tr key={response.id}>
                      <td>
                        <strong>{response.participantName}</strong>
                        {response.note ? <div className="table-note">{response.note}</div> : null}
                        {interpretationMode === "unparsed_default" ? (
                          <div className="table-note">コメントは受け取りましたが自動解釈できなかったため、結果集計では全候補を微妙として扱っています。</div>
                        ) : null}
                        {response.parsedConstraints?.map((constraint) => (
                          <div className="table-note" key={`${response.id}-${constraint.targetType}-${constraint.targetValue}-${constraint.level}`}>
                            {formatParsedConstraintLabel(constraint)}
                          </div>
                        ))}
                        {responseAnswerDetails.map((detailText) => (
                          <div className="table-note" key={`${response.id}-${detailText}`}>
                            {detailText}
                          </div>
                        ))}
                      </td>
                      {visibleDisplayCandidates.map((candidate) => {
                        const rankedStatus = candidateStatusMap.get(`${candidate.id}:${response.id}`);
                        const answer = response.answers.find((item) => item.candidateId === candidate.id);
                        const details =
                          rankedStatus?.detailLabels.length && rankedStatus.source !== "manual_answer"
                            ? rankedStatus.detailLabels
                            : answer
                              ? formatAnswerDetail(answer, candidate)
                              : [];
                        return (
                          <td key={`${response.id}-${candidate.id}`}>
                            {rankedStatus ? (
                              <RawStatusPill label={rankedStatus.label} tone={rankedStatus.tone} />
                            ) : null}
                            {details.map((detailText) => (
                              <div className="table-note" key={detailText}>
                                {detailText}
                              </div>
                            ))}
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
