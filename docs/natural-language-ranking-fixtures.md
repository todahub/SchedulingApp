# Natural Language Ranking Fixtures

自然言語コメントを `self-consistency -> ranking bridge -> ranking` に通して検証するための fixture 集です。

- `expectedInterpretation` は LLM 出力そのものの完全一致ではなく、正規化後の `dateValues / timeValues / availability / comparison` を主に持ちます。
- `expectedRanking` は完全順位だけでなく、`decisionKind`、`topCandidateId`、`perfectIfResolvedTopCandidateId`、`blockedCandidateIds` のような assertion 型も使います。
- これにより、ranking の正解を 1 本の総合点ではなく「何が成立していれば正しいか」から逆算して検証できます。

利用テンプレート

- `pair_days`
  - 候補: `2026-04-18 昼`, `2026-04-19 昼`
  - ベース回答: 2 人とも両日 `yes`
- `split_same_day`
  - 候補: `2026-04-18 昼`, `2026-04-18 夜`
  - ベース回答: 2 人とも両候補 `yes`

```json fixture-cases
{
  "formatVersion": 1,
  "cases": [
    {
      "id": "clear_two_day_availability",
      "description": "明示的な可否で 19 日だけを通す",
      "template": "pair_days",
      "note": "18日は無理、19日は行ける",
      "expectedInterpretation": {
        "evaluationsCount": 2,
        "comparisonsCount": 0,
        "unresolvedCount": 0,
        "evaluations": [
          {
            "dateValues": ["2026-04-18"],
            "timeValues": ["all_times"],
            "availabilityOneOf": ["行けない"],
            "reviewStatusOneOf": ["base_only", "stable"],
            "minAvailabilityConfidence": 0.5,
            "externalConditionTexts": []
          },
          {
            "dateValues": ["2026-04-19"],
            "timeValues": ["all_times"],
            "availabilityOneOf": ["行ける"],
            "reviewStatusOneOf": ["base_only", "stable"],
            "minAvailabilityConfidence": 0.5,
            "externalConditionTexts": []
          }
        ]
      },
      "expectedRanking": {
        "mode": "maximize_attendance",
        "rankedCandidateIds": ["cand-19-day", "cand-18-day"],
        "topCandidateId": "cand-19-day",
        "decisionKind": "perfect_now",
        "perfectNowTopCandidateId": "cand-19-day",
        "perfectIfResolvedTopCandidateId": null
      }
    },
    {
      "id": "comparison_only_preference",
      "description": "可否を増やさず比較だけで 19 日を上にする",
      "template": "pair_days",
      "note": "18と19なら19がいい",
      "expectedInterpretation": {
        "evaluationsCount": 0,
        "comparisonsCount": 1,
        "unresolvedCount": 0,
        "comparisons": [
          {
            "candidateScopes": [
              { "dateValues": ["2026-04-18"], "timeValues": ["all_times"] },
              { "dateValues": ["2026-04-19"], "timeValues": ["all_times"] }
            ],
            "preferredScope": { "dateValues": ["2026-04-19"], "timeValues": ["all_times"] },
            "preferenceRepresentativeOneOf": ["少し行きたい", "行きたい", "かなり行きたい"],
            "reviewStatusOneOf": ["stable", "base_only"],
            "minDirectionConfidence": 0.5
          }
        ]
      },
      "expectedRanking": {
        "mode": "maximize_attendance",
        "rankedCandidateIds": ["cand-19-day", "cand-18-day"],
        "topCandidateId": "cand-19-day",
        "decisionKind": "perfect_now",
        "perfectNowTopCandidateId": "cand-19-day",
        "perfectIfResolvedTopCandidateId": null
      }
    },
    {
      "id": "time_specific_positive",
      "description": "同日候補のうち夜だけ可にする",
      "template": "split_same_day",
      "note": "18日の夜なら行ける",
      "expectedInterpretation": {
        "evaluationsCount": 1,
        "comparisonsCount": 0,
        "unresolvedCount": 0,
        "evaluations": [
          {
            "dateValues": ["2026-04-18"],
            "timeValues": ["night"],
            "availabilityOneOf": ["行ける"],
            "reviewStatusOneOf": ["base_only", "stable"],
            "minAvailabilityConfidence": 0.5,
            "externalConditionTexts": []
          }
        ]
      },
      "expectedRanking": {
        "mode": "maximize_attendance",
        "rankedCandidateIds": ["cand-18-night", "cand-18-day"],
        "topCandidateId": "cand-18-night",
        "decisionKind": "perfect_now",
        "perfectNowTopCandidateId": "cand-18-night",
        "perfectIfResolvedTopCandidateId": null
      }
    },
    {
      "id": "conditional_night_candidate",
      "description": "夜だけ可だが外部条件つきなので projected 側で持ち上がる",
      "template": "split_same_day",
      "note": "18日の夜なら行けるけど、仕事次第",
      "expectedInterpretation": {
        "evaluationsCount": 1,
        "comparisonsCount": 0,
        "unresolvedCount": 0,
        "evaluations": [
          {
            "dateValues": ["2026-04-18"],
            "timeValues": ["night"],
            "availabilityOneOf": ["行ける", "条件付きで行ける"],
            "reviewStatusOneOf": ["stable", "base_only"],
            "minAvailabilityConfidence": 0.5,
            "externalConditionTextsContains": ["仕事次第"]
          }
        ]
      },
      "expectedRanking": {
        "mode": "maximize_attendance",
        "decisionKind": "conditional_unanimous",
        "perfectNowTopCandidateId": null,
        "perfectIfResolvedTopCandidateId": "cand-18-night",
        "blockedCandidateIds": ["cand-18-night"]
      }
    },
    {
      "id": "time_specific_negative",
      "description": "夜だけ不可のとき、昼は unknown 扱いのまま上に残る",
      "template": "split_same_day",
      "note": "18日の夜は無理",
      "expectedInterpretation": {
        "evaluationsCount": 1,
        "comparisonsCount": 0,
        "unresolvedCount": 0,
        "evaluations": [
          {
            "dateValues": ["2026-04-18"],
            "timeValues": ["night"],
            "availabilityOneOf": ["行けない"],
            "reviewStatusOneOf": ["base_only", "stable"],
            "minAvailabilityConfidence": 0.5,
            "externalConditionTexts": []
          }
        ]
      },
      "expectedRanking": {
        "mode": "maximize_attendance",
        "rankedCandidateIds": ["cand-18-day", "cand-18-night"],
        "topCandidateId": "cand-18-day",
        "decisionKind": "best_attendance",
        "perfectNowTopCandidateId": null,
        "perfectIfResolvedTopCandidateId": null
      }
    }
  ]
}
```
