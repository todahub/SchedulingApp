# Supabase Setup

このアプリは、アプリ側の Supabase repository 実装までは入っています。  
本番で使うには、Supabase 側でテーブルを作成し、Vercel に接続情報を入れれば動きます。

## 1. Supabase にテーブルを作る

Supabase の SQL Editor で、次の順番で実行します。

1. [schema.sql](/Users/kenta/Documents/New%20project/awase-scheduler-next/supabase/schema.sql)
2. [seed.sql](/Users/kenta/Documents/New%20project/awase-scheduler-next/supabase/seed.sql)

`schema.sql` はテーブル定義です。  
`seed.sql` は、可否ラベルと時間帯プリセットの初期データです。

## 2. Vercel に環境変数を入れる

Vercel の Project Settings → Environment Variables に次を設定します。

```env
REPOSITORY_MODE=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OLLAMA_BASE_URL=https://your-ollama-public-url/api
OLLAMA_MODEL=gpt-oss:20b
```

参考:
- env の雛形は [.env.example](/Users/kenta/Documents/New%20project/awase-scheduler-next/.env.example)

## 3. Supabase から使う値

必要なのはこの 2 つです。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

どちらも Supabase Project Settings → API から取得できます。

## 4. 設定後に期待される動作

- イベント作成 API は Supabase にイベントを保存する
- 参加者回答 API は Supabase に回答を保存する
- 結果ページは Supabase からイベント詳細を読む

## 5. よくある詰まりポイント

### `本番環境では Supabase 環境変数を設定するか、REPOSITORY_MODE を明示してください。`

本番で `REPOSITORY_MODE` と Supabase 接続情報が足りていません。

### `Supabase 環境変数が設定されていません。`

`SUPABASE_URL` または `SUPABASE_SERVICE_ROLE_KEY` が未設定です。

### イベント作成時に外部キーエラーが出る

`seed.sql` がまだ流れていない可能性があります。  
`availability_levels` と `time_slot_presets` の初期データが必要です。

## 6. ローカルでも Supabase を使いたい時

`.env.local` に同じ値を入れれば、ローカルからも Supabase repository を使えます。

```env
REPOSITORY_MODE=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OLLAMA_BASE_URL=https://your-ollama-public-url/api
OLLAMA_MODEL=gpt-oss:20b
```
