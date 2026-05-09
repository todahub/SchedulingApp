"use client";

import { useMemo } from "react";
import Link from "next/link";
import { formatParsedConstraintLabel, inferResponseInterpretationMode } from "@/lib/comment-parser";
import { availabilityToneClass } from "@/lib/config";
import type { AvailabilityTone, EventDetail, RankedCandidate, RankedParticipantStatus, RepositoryMode } from "@/lib/domain";
import { buildAiScheduleDecision, buildRankedCandidateCollections } from "@/lib/ranking";
import { formatAnswerDetail, formatCandidateLabel, formatDateTime } from "@/lib/utils";

type OrganizerDashboardProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
};

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

function CandidateSnapshotCard({
  candidate,
  eyebrow,
}: {
  candidate: RankedCandidate;
  eyebrow: string;
}) {
  const groupedStatuses = groupParticipantStatuses(candidate.participantStatuses);

  return (
    <article className="candidate-card">
      <div className="candidate-card__header">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h3>{formatCandidateLabel(candidate.candidate)}</h3>
          <div className="candidate-meta">
            <span className="pill">{`参加可能 ${candidate.availableCount}人`}</span>
            <span className="pill">{`条件付き ${candidate.conditionalCount}人`}</span>
            <span className="pill">{`不明 ${candidate.unknownCount}人`}</span>
            <span className="pill">{`不可 ${candidate.unavailableCount}人`}</span>
          </div>
        </div>
      </div>

      <div className="participant-groups">
        {groupedStatuses.map(([label, group]) => (
          <section className="participant-group" key={`${candidate.candidate.id}-${label}`}>
            <RawStatusPill label={label} tone={group.tone} />
            <ul>
              {group.names.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

export function OrganizerDashboard({ detail, repositoryMode }: OrganizerDashboardProps) {
  const collections = useMemo(() => buildRankedCandidateCollections(detail), [detail]);
  const aiDecision = useMemo(() => buildAiScheduleDecision(detail), [detail]);
  const rankedForStatusMap = collections.bestAttendanceRanking;

  const candidateStatusMap = useMemo(
    () =>
      new Map(
        rankedForStatusMap.flatMap((candidate) =>
          candidate.participantStatuses.map((status) => [`${candidate.candidate.id}:${status.responseId}`, status] as const),
        ),
      ),
    [rankedForStatusMap],
  );

  const supplementaryCandidates = aiDecision.alternatives;
  const displayCandidates = useMemo(
    () =>
      aiDecision.primaryCandidate
        ? [aiDecision.primaryCandidate.candidate, ...supplementaryCandidates.map((candidate) => candidate.candidate)]
        : supplementaryCandidates.map((candidate) => candidate.candidate),
    [aiDecision.primaryCandidate, supplementaryCandidates],
  );

  const commentReflectionCandidates = useMemo(
    () =>
      [aiDecision.primaryCandidate, ...supplementaryCandidates]
        .filter((candidate): candidate is RankedCandidate => Boolean(candidate))
        .filter(
          (candidate) =>
            candidate.commentImpacts.length > 0 ||
            candidate.commentScore !== 0 ||
            candidate.preferenceExplanations.length > 0 ||
            candidate.conditionExplanations.length > 0,
        ),
    [aiDecision.primaryCandidate, supplementaryCandidates],
  );

  return (
    <div className="split-layout">
      <section className="hero-card">
        <div className="eyebrow">Organizer View</div>
        <h1>{detail.event.title}</h1>
        <p className="lead">
          AI が幹事の代わりに、今の回答から一番まとまりやすい候補を 1 件に絞って提案します。
        </p>
        <div className="inline-list">
          <span className="mode-chip">保存先: {repositoryMode === "supabase" ? "Supabase" : "デモモード"}</span>
          <span className="mode-chip">作成日時: {formatDateTime(detail.event.createdAt)}</span>
          <span className="mode-chip">{`回答 ${detail.responses.length}人`}</span>
        </div>
        <div className="button-row" style={{ marginTop: 16 }}>
          <Link className="button button--primary" href={`/events/${detail.event.id}/join`}>
            参加者ページを開く
          </Link>
        </div>
      </section>

      <section className="panel recommendation-panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">AI Recommendation</div>
            <h2>{aiDecision.headline}</h2>
          </div>
          <p className="section-copy">{aiDecision.explanation}</p>
        </div>

        <div className="recommendation-hero">
          <div>
            <div className="eyebrow">結論</div>
            <p className="recommendation-conclusion">{aiDecision.conclusion}</p>
          </div>

          {aiDecision.primaryCandidate ? (
            <div className="recommendation-candidate-card">
              <strong className="recommendation-candidate-label">{formatCandidateLabel(aiDecision.primaryCandidate.candidate)}</strong>
              <div className="candidate-meta" style={{ marginTop: 12 }}>
                <span className="pill">{`参加可能 ${aiDecision.primaryCandidate.availableCount}人`}</span>
                <span className="pill">{`条件付き ${aiDecision.primaryCandidate.conditionalCount}人`}</span>
                <span className="pill">{`不明 ${aiDecision.primaryCandidate.unknownCount}人`}</span>
                <span className="pill">{`不可 ${aiDecision.primaryCandidate.unavailableCount}人`}</span>
              </div>
            </div>
          ) : null}
        </div>

        {aiDecision.reasons.length > 0 ? (
          <ul className="recommendation-reasons">
            {aiDecision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {aiDecision.conditionsToCheck.length > 0 ? (
          <div className="recommendation-grid">
            {aiDecision.conditionsToCheck.map((condition) => (
              <article className="suggestion-card" key={`${condition.responseId}-${condition.participantName}-${condition.sourceComment}`}>
                <strong>{condition.participantName}さんに確認したいこと</strong>
                <p className="section-copy">{condition.summary}</p>
                <div className="table-note">{condition.sourceComment}</div>
              </article>
            ))}
          </div>
        ) : null}

        {aiDecision.participantNotes.length > 0 ? (
          <div className="recommendation-grid">
            {aiDecision.participantNotes.map((note) => (
              <article className="mini-card" key={`${note.responseId}-${note.participantName}-${note.label}`}>
                <strong>{note.participantName}さん</strong>
                <div style={{ marginTop: 10 }}>
                  <RawStatusPill label={note.label} tone={note.tone} />
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {supplementaryCandidates.length > 0 ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Secondary Options</div>
              <h2>他の候補を見る</h2>
            </div>
            <p className="section-copy">初期表示では第一候補を優先し、他の候補は必要な時だけ確認できるようにしています。</p>
          </div>

          <details className="details-panel">
            <summary>代替候補を開く</summary>
            <div className="candidate-list details-panel__content">
              {supplementaryCandidates.map((candidate, index) => (
                <CandidateSnapshotCard candidate={candidate} eyebrow={`補助候補 ${index + 1}`} key={candidate.candidate.id} />
              ))}
            </div>
          </details>
        </section>
      ) : null}

      {commentReflectionCandidates.length > 0 ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Transparency</div>
              <h2>AI が見ていたコメント解釈</h2>
            </div>
            <p className="section-copy">必要なときだけ、どのコメントが候補判断に効いたかを確認できます。</p>
          </div>

          <details className="details-panel">
            <summary>解釈の内訳を見る</summary>
            <div className="card-list details-panel__content">
              {commentReflectionCandidates.map((candidate) => (
                <article className="mini-card" key={`comment-impact-${candidate.candidate.id}`}>
                  <div className="mini-card__header">
                    <div>
                      <strong>{formatCandidateLabel(candidate.candidate)}</strong>
                      <p className="helper-text">この候補に影響しているコメント解釈です。</p>
                    </div>
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
          </details>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Responses</div>
            <h2>回答一覧</h2>
          </div>
          <p className="section-copy">最終提案の根拠として、各候補日に対する参加状況を確認できます。</p>
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
                  {displayCandidates.map((candidate) => (
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
                      {displayCandidates.map((candidate) => {
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
                            {rankedStatus ? <RawStatusPill label={rankedStatus.label} tone={rankedStatus.tone} /> : null}
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
