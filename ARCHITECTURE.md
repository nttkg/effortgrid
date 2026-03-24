# System Architecture

## 1. Overview
本アプリケーションは、WBS (Work Breakdown Structure) と EVM (Earned Value Management) を管理するローカルファーストなデスクトップアプリケーションである。
Tauri (v2) を基盤とし、重厚なデータ処理とEVM計算（ロールアップ等）はバックエンドの Rust が、リッチで宣言的なマトリックスUIの描画はフロントエンドの React (Mantine) が担当する。

## 2. Directory & Module Structure
責務を明確にするため、以下の構造を厳守してコードを生成・配置すること。
- `/src/components`: 再利用可能なMantineのUI部品（Presentational Components）
- `/src/hooks`: Tauri IPC通信や状態管理をカプセル化したカスタムフック。UIコンポーネントから直接 `invoke` を呼ばないこと。
- `/src/types`: Rust側の構造体と完全に同期するTypeScriptの型定義
- `/src-tauri/src/commands`: フロントから呼ばれるTauriのコマンド群（ルーティング・入出力のバリデーションを担当）
- `/src-tauri/src/db`: sqlxを用いたデータベースアクセスと、複雑なEVM集計ロジック（Repository/Service層）
- `/src-tauri/migrations`: sqlxマイグレーションファイル（`.sql`）

## 3. Database Design: Full-Copy Snapshot & EVM Engine
計画（ベースライン）と実績を矛盾なく管理し、PMBOK/PMP準拠の厳格なEVM計算を実現するためのコアアーキテクチャ。AIはこの概念を絶対に破壊してはならない。

### 3.1 Identity and State Separation (IDと状態の分離)
- **不変の錨（Global ID）:** WBS要素（`wbs_elements`）とマイルストーン（`milestones`）はシステム上の不変のIDのみを持つ。
- **計画状態（State）:** 計画の版（`plan_versions`）ごとに、その時点の要素名、説明文（Markdown）、ツリー構造、全体の「見積工数（estimated_pv）」を `wbs_element_details` に保持する。

### 3.2 Full-Copy Snapshot (ベースライン保存機構)
- 計画を凍結（ベースライン化）する際は、複雑な差分計算を行わない。
- 現在のドラフト（`is_draft = true`）に紐づく `plan_milestones`, `wbs_element_details`, `pv_allocations` の全レコードを、1つのトランザクション内で新しい `plan_version_id` を用いて一括コピー（`INSERT INTO ... SELECT`）する。

### 3.3 Estimating vs Allocation (見積もりと割り当ての分離)
- **Estimating (見積もり):** アクティビティ全体の予定工数（BAC）は `wbs_element_details.estimated_pv` に保持する。
- **Allocation (タイムフェーズ割当):** 見積もった総量を、「いつ・誰がやるか」という期間情報として `pv_allocations` に分割・登録する。

### 3.4 Reality vs Plan (現実の独立性)
- 実績コスト（`actual_costs`: AC）と、進捗評価（`progress_updates`: EVの源泉）は完全に独立したテーブルで管理し、時系列の履歴として残す。
- これらは計画の版（スナップショット）には依存せず、不変のGlobal ID（`wbs_elements`）に直接紐づけることで、計画変更後も過去の事実が絶対に保護される。

## 4. Backend Business Logic Constraints (厳守すべき制約)
Rust側でデータベース操作およびEVM計算を行う際、以下のビジネスルールを強制すること。

1. **末端入力の原則 (Activity-Only Rule):**
   `estimated_pv` (全体見積), `pv_allocations` (期間割当), `actual_costs` (コスト実績), `progress_updates` (進捗) は、`wbs_element_details.element_type` が `'Activity'`（末端ノード）である要素に対してのみ INSERT/UPDATE を許可する。`'Project'` や `'WorkPackage'` に対する直接の入力・紐づけ要求は、Rust側のバリデーションで弾くこと。
2. **動的ロールアップ (Dynamic Rollup):**
   フロントエンドに `'Project'` や `'WorkPackage'`（親ノード）のPV, AC, EVを返す際は、データベースに集計値を永続化せず、Rust側で再帰クエリ（CTE: `WITH RECURSIVE`）等を用いて、配下の全 `'Activity'` の数値を動的に合算して返すこと。
3. **論理削除 (Soft Delete):**
   実績入力のミスや、計画からのタスク除外は、監査証跡を残すため物理削除（`DELETE`）ではなく `is_deleted = true` による論理削除として実装すること。
4. **Database Initialization:**
   アプリ起動時の生の `CREATE TABLE` 文字列の実行は禁止。必ず `sqlx::migrate!("./migrations").run(&pool).await` を使用してマイグレーションを行うこと。
