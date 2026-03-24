# Database Schema & Architecture

## 1. Overview (システム概要)
本システムは、WBS (Work Breakdown Structure) と EVM (Earned Value Management) をローカル環境で堅牢に管理するためのデータベース構造を持つ。

最大の特徴は、以下の4つの高度な設計思想に基づいている点である。
1. **IdentityとStateの完全な分離**: WBSやマイルストーンの「不変の識別子（Global ID）」と、「計画時点によって変化する名前や構造（State）」を別のテーブルで管理する。
2. **フルコピー型スナップショット (Plan Versions)**: 過去の計画（ベースライン）を保存する際、複雑な差分管理を行わず、現在の計画データを新しいバージョンIDとして丸ごと物理コピーする。これにより読み込み速度とクエリの単純性を最大化する。
3. **見積もりと割り当ての分離 (Estimating vs Allocation)**: アクティビティ全体の「見積もり工数（PV）」と、それを誰がいつやるかという「期間への割り当て」を分離し、実務に即した自然な計画ワークフローを実現する。
4. **現実（実績・進捗）の独立性保護**: 発生したコスト（AC）と成果物の進捗（EV）は計画のバージョンに依存しない絶対的な事実であるため、計画の枠組みとは切り離し、不変のGlobal IDに直接紐づける。さらに、リソース投入と進捗評価を別のテーブルに分離し、独立した履歴として追跡可能にする。

---

## 2. Entity Relationship Diagram (ER図)

```mermaid
erDiagram
    %% Master Entities
    portfolios ||--o{ wbs_elements : "has (ポートフォリオは複数の要素を持つ)"
    portfolios ||--o{ milestones : "has (横断的なマイルストーン)"
    portfolios ||--o{ plan_versions : "has baselines (計画の版)"
    users ||--o{ actual_costs : "works on (実績を記録)"
    users ||--o{ progress_updates : "reports on (進捗を報告)"
    
    %% Plan (スナップショットの中身)
    plan_versions ||--o{ plan_milestones : "contains (マイルストーンの状態)"
    plan_versions ||--o{ wbs_element_details : "contains (要素の状態/構造)"
    plan_versions ||--o{ pv_allocations : "contains (タイムフェーズへの割当)"

    %% Identity as Anchor (不変の錨)
    wbs_elements ||--o{ wbs_element_details : "is described by (要素の本体)"
    wbs_elements ||--o{ pv_allocations : "allocated to (要素の予定)"
    wbs_elements ||--o{ actual_costs : "consumes resources (発生コスト: AC)"
    wbs_elements ||--o{ progress_updates : "achieves progress (進捗履歴: EV)"
    
    milestones ||--o{ plan_milestones : "is described by (マイルストーン本体)"
    milestones ||--o{ wbs_element_details : "targets (要素が目標として参照)"

    portfolios {
        INTEGER id PK
        TEXT name
    }
    users {
        INTEGER id PK
        TEXT name
        TEXT role
    }
    wbs_elements {
        INTEGER id PK "Global ID (不変の要素実体)"
        INTEGER portfolio_id FK
    }
    milestones {
        INTEGER id PK "Global ID (不変のマイルストーン実体)"
        INTEGER portfolio_id FK
    }
    plan_versions {
        INTEGER id PK
        INTEGER portfolio_id FK
        TEXT name "e.g., Working Draft, V1 Baseline"
        BOOLEAN is_draft "trueなら現在編集中の計画"
    }
    plan_milestones {
        INTEGER id PK
        INTEGER plan_version_id FK
        INTEGER milestone_id FK "Global ID"
        TEXT name "マイルストーン名"
        DATE target_date "目標期日"
        BOOLEAN is_deleted
    }
    wbs_element_details {
        INTEGER id PK
        INTEGER plan_version_id FK "どの計画版のデータか"
        INTEGER wbs_element_id FK "Global ID (対象の実体)"
        INTEGER parent_element_id "WBSツリー構造用 (Global IDを指定)"
        INTEGER milestone_id FK "Nullable: どの目標に向かっているか"
        TEXT title "要素名"
        TEXT description "Markdown形式のノート/詳細説明"
        TEXT element_type "種類: 'Project', 'WorkPackage', 'Activity'"
        REAL estimated_pv "アクティビティ全体の見積工数(BAC)"
        TEXT tags "任意のタグ (JSON配列等)"
        BOOLEAN is_deleted "論理削除フラグ"
    }
    pv_allocations {
        INTEGER id PK
        INTEGER plan_version_id FK
        INTEGER wbs_element_id FK
        INTEGER user_id "Nullable (担当者未定を許容)"
        DATE start_date "予定開始日"
        DATE end_date "予定終了日"
        REAL planned_value "期間内に割り当てられた工数(PV)"
    }
    actual_costs {
        INTEGER id PK
        INTEGER wbs_element_id FK "Global IDに直接紐づく(現実)"
        INTEGER user_id FK "誰が作業したか"
        DATE work_date "作業日"
        REAL actual_cost "発生コスト/工数(AC)"
        BOOLEAN is_deleted "入力ミス取消用の論理削除"
    }
    progress_updates {
        INTEGER id PK
        INTEGER wbs_element_id FK "Global IDに直接紐づく(現実)"
        INTEGER reported_by_user_id FK "誰が評価・報告したか"
        DATE report_date "報告日/評価日"
        REAL progress_percent "この日時点の進捗率(0-100%)"
        TEXT notes "進捗に関するメモ"
        BOOLEAN is_deleted "評価ミス取消用の論理削除"
    }
	
