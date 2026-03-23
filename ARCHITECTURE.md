# System Architecture

## Overview
WBSおよびEVMを管理するローカルファーストなデスクトップアプリケーション。
Tauri (v2) を基盤とし、重厚なデータ処理とEVM計算はRustが、リッチで宣言的なマトリックスUIの描画はReact(Mantine)が担当する。

## Directory & Module Structure
責務を明確にするため、以下の構造を厳守する。
- `/src/components`: 再利用可能なMantineのUI部品（Presentational）
- `/src/hooks`: Tauri IPC通信や状態管理をカプセル化したカスタムフック
- `/src/types`: Rust側の構造体と同期するTypeScriptの型定義
- `/src-tauri/src/commands`: フロントから呼ばれるTauriのコマンド群（ルーティングのみ担当）
- `/src-tauri/src/db`: sqlxを用いたデータベースアクセスロジック（Repository層）
- `/src-tauri/migrations`: sqlxマイグレーションファイル（`.sql`）

## Database Design: Git-like Snapshot Model (Copy-on-Write)
プロジェクトの計画（ベースライン）と実績を矛盾なく管理するためのコアアーキテクチャ。AIはこの概念を絶対に破壊してはならない。

### Core Mechanisms
1. **Master vs Revisions:** `tasks` テーブルは不変のグローバルIDと、最新データへのポインタ（`head_revision_id`）のみを持つ。タスクの具体的な内容（名前、WBS階層）はすべて `task_revisions` テーブルに記録される。
2. **Copy-on-Write (CoW) Logic:** タスク編集時、対象リビジョンの `is_locked` が `false`（作業中）なら `UPDATE` する。
   `true`（スナップショットに紐づきコミット済）なら、新しい行を `INSERT` し、`tasks` のHEADポインタを付け替える。
3. **Baselines (Snapshots):** 特定時点の計画を凍結するため `snapshots` を作成し、その時点で有効だった全リビジョンIDを `snapshot_task_refs` に不変のログとして記録する。
4. **Actuals (現実):** 実績（`actual_entries`）は計画のバージョンに依存せず、「そのタスク自体」に紐づくため、リビジョンIDではなく `tasks` テーブルのグローバルIDを直接参照する。

### Database Initialization
- アプリ起動時の生の `CREATE TABLE` 文字列の実行は禁止。
- 必ず `sqlx::migrate!("./migrations").run(&pool).await` を使用し、マイグレーションファイルによるバージョン管理を行うこと。
