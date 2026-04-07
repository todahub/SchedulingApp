# Awase Scheduler MVP

曖昧な参加可否も扱える、予定調整WebアプリのMVPです。

Next.js + TypeScript でUIとAPIをまとめ、Supabase が未設定でもデモモードでそのまま動くようにしています。

## MVPでできること

- 主催者がイベントを作成できる
- イベント名を入力できる
- 候補日を複数登録できる
- 各候補日に時間帯を設定できる
  - `昼`
  - `夜`
  - `オール`
- 参加者が各候補日に対して参加可否を入力できる
- 参加可否は `行ける / 微妙 / 無理` の3段階
- 主催者が結果表示モードを切り替えられる
  - `全員参加優先モード`
  - `できるだけ全員参加モード`
- 候補日ごとに、誰がどのステータスか見られる
- 余力機能として「少し調整すると良くなりそうな候補」を簡易提案

## 技術スタック

- Next.js App Router
- TypeScript
- Supabase
- デモモード用のインメモリリポジトリ

## 起動方法

### 1. 依存関係をインストール

```bash
npm install
```

### 2. デモモードで起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開くと、デモイベント付きで動作します。

### 3. Supabase を使う場合

`.env.example` をコピーして `.env.local` を作成し、以下を設定します。

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

そのうえで `supabase/schema.sql` と `supabase/seed.sql` を実行してください。

未設定時は自動でデモモードになります。

## 表示モードの仕様

### 全員参加優先モード

- 1人でも `無理` がいる候補日は除外
- 残った候補日を合計スコアの高い順に表示

### できるだけ全員参加モード

- `無理` が少ない順に並べる
- 同率なら合計スコアが高い順

### 重み

- `行ける = 1.0`
- `微妙 = 0.5`
- `無理 = 0.0`

## DB設計

将来的な拡張を見据えて、参加可否ラベルと時間帯をマスタ化しています。

### 主なテーブル

- `availability_levels`
  - 参加可否ラベルと重み
  - 将来 `4段階以上` に増やしやすい
- `time_slot_presets`
  - 時間帯プリセット
  - 将来 `朝 / 午前 / 夕方` などを増やしやすい
- `events`
  - イベント本体
- `event_candidates`
  - 候補日
- `participant_responses`
  - 参加者ごとの回答ヘッダ
- `participant_candidate_answers`
  - 候補日ごとの回答明細

## ファイル構成

```text
awase-scheduler-next/
├── src/
│   ├── app/
│   │   ├── api/events/...         # イベント作成・取得・回答送信API
│   │   ├── events/[eventId]/...   # 主催者ページ / 参加者ページ
│   │   ├── globals.css            # 全体スタイル
│   │   ├── layout.tsx             # ルートレイアウト
│   │   └── page.tsx               # トップページ
│   ├── components/
│   │   ├── event-create-form.tsx  # 主催者向け作成フォーム
│   │   ├── organizer-dashboard.tsx# 結果表示UI
│   │   ├── participant-form.tsx   # 参加者回答UI
│   │   └── status-pill.tsx        # ステータス表示
│   └── lib/
│       ├── config.ts              # 可否・時間帯などの設定
│       ├── domain.ts              # 型定義
│       ├── ranking.ts             # 集計・ランキングロジック
│       ├── repository.ts          # データ取得の窓口
│       ├── repository-mock.ts     # デモモード用ストア
│       ├── repository-supabase.ts # Supabase 実装
│       ├── supabase.ts            # Supabase クライアント生成
│       ├── utils.ts               # 日付表示などの共通処理
│       └── validation.ts          # API入力バリデーション
├── supabase/
│   ├── schema.sql                 # DBスキーマ
│   └── seed.sql                   # マスターデータ投入
└── .env.example
```

## 実装の進め方

このMVPは、仕様を詰め切る前提で拡張しやすい構成にしています。

### フェーズ1: 今回のMVP

- イベント作成
- 候補日登録
- 3段階回答
- 2つの表示モード
- 候補別の参加者内訳

### フェーズ2: すぐ足しやすい拡張

- 時間帯マスタの追加
- 参加可否ラベルの追加
- 主催者向けの表示モード保存
- 共有URLのコピーUI

### フェーズ3: 本番前に必要になるもの

- 認証
- RLS
- 監査ログ
- 永続的な回答編集フロー
- 共有権限の制御

## 注意

- デモモードではデータはサーバープロセスのメモリにあり、再起動でリセットされます
- Supabase モードでは `SUPABASE_SERVICE_ROLE_KEY` をサーバー側だけで使います
- 認証やRLSはMVPではまだ入れていません
