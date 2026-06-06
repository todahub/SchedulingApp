# Legacy Interpretation Pipeline

この文書は、Self-Consistency 再設計前の自然言語解釈実装がどこにあるかを、あとから見返しやすくするための整理メモである。  
新しい前段実装は `src/lib/self-consistency/` に追加し、以下の旧実装はそのまま残している。

## 1. 旧パイプラインの中心

- `src/lib/availability-comment-interpretation-server.ts`
  - コメント送信時の自動解釈全体をまとめていた入口
- `src/lib/availability-comment-interpretation.ts`
  - auto interpretation から `parsedConstraints` と `answers` を導出する中心処理
- `src/app/api/events/[eventId]/responses/route.ts`
  - 旧パイプラインを直接呼んでいる既存 submit ルート

## 2. 旧パイプラインの主要サブモジュール

- `src/lib/comment-labeler/`
  - 辞書ベースのラベル付与と LLM 補完
- `src/lib/comparison-preference-interpretation.ts`
  - 比較・選好解釈
- `src/lib/condition-interpretation.ts`
  - 条件文解釈
- `src/lib/comment-parser.ts`
  - 旧来のルール寄りコメント解釈と `parsedConstraints` 生成
- `src/lib/date-sequence/`
  - 日付列やまとまりの補助ロジック

## 3. 今回の位置づけ

- 旧実装は ranking を含む既存動作の保全のため残している
- 新しい前段実装は `src/lib/self-consistency/` と `src/app/api/events/[eventId]/responses/interpret/route.ts` に分離した
- まだ既存 submit ルートは legacy 側を使用しており、今回の変更では ranking ロジックには触れていない

## 4. 使い分け

- 現行 submit 動作の確認
  - `src/app/api/events/[eventId]/responses/route.ts`
- 新しい自然言語 -> JSON 前段の確認
  - `src/app/api/events/[eventId]/responses/interpret/route.ts`
