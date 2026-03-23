# Coding Conventions (Best Practices)

## Tech Stack
- **Frontend:** React, TypeScript, Mantine UI, Vite
- **Backend:** Rust, Tauri (v2), sqlx (SQLite), tokio

## Frontend (React / TypeScript) Best Practices
1. **Custom Hooks for IPC:** コンポーネント内で直接 `@tauri-apps/api/core` の `invoke` を呼び出さないこと。必ず `useTasks.ts` のようなカスタムフックを作成し、データ取得や保存のロジックをUIから分離（カプセル化）すること。
2. **Form Validation:** フォームの入力やバリデーションには `@mantine/form` と `zod`（スキーマ定義）を組み合わせて使用し、型安全な入力チェックを徹底すること。
3. **State Management:** サーバー状態（Rustから取得したデータ）と、UIのローカル状態（モーダルの開閉など）を明確に区別すること。
4. **Immutability & Types:** `any` の使用は厳禁。Rustから返却されるJSONには必ず完全な `interface` または `type` を定義すること。

## Backend (Rust / sqlx) Best Practices
1. **Custom Error Type:** Tauriコマンドの戻り値 `Result<T, E>` のエラー型 `E` には `String` を使わず、必ず `serde::Serialize` を実装した独自の `AppError` 列挙型を定義すること（`thiserror` クレートの利用を推奨）。
2. **Repository Pattern:** `main.rs` や `lib.rs` のTauriコマンドハンドラ内に直接複雑なSQLやビジネスロジックを書かないこと。DBアクセス用の関数は別のモジュール（例: `db::tasks`）に切り出すこと。
3. **sqlx Macros:** 常に `sqlx::query!` または `sqlx::query_as!` を使用し、コンパイル時のSQL構文チェックと型チェックを有効にすること。
4. **Offline Mode:** 将来的なCI/CDを考慮し、`sqlx-data.json` を用いたオフラインビルドが可能な状態を保つこと。

## Communication Rules
- Rust側の引数・フィールドはスネークケース（`project_id`）、TypeScript側はキャメルケース（`projectId`）を厳守する。Tauriの自動変換機能を活用し、手動でのマッピングコードは書かないこと。
