use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
pub use sqlx::SqlitePool;
use sqlx::FromRow;
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
}

// データベース操作用のカスタムResult型
pub type DbResult<T> = Result<T, DbError>;

/// データベース接続を初期化します。
/// データベースファイルが存在しない場合は作成し、マイグレーションを実行します。
pub async fn init_db(app_handle: &AppHandle) -> DbResult<SqlitePool> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
    }
    let db_path = app_data_dir.join("sqlite.db");
    // `?mode=rwc` (read-write-create) はファイルの自動作成を処理します。
    let db_url = format!(
        "sqlite:{}?mode=rwc",
        db_path.to_str().expect("DB path is not valid UTF-8")
    );

    let pool = SqlitePool::connect(&db_url).await?;

    // 起動時にマイグレーションを自動実行します。
    sqlx::migrate!("./migrations").run(&pool).await?;

    // --- Seed initial data ---
    // Create a default user if none exists. This is necessary for
    // creating actual_costs and progress_updates which require a user_id.
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await?;

    if user_count == 0 {
        sqlx::query("INSERT INTO users (id, name, role) VALUES (1, 'Default User', 'Developer')")
            .execute(&pool)
            .await?;
    }

    Ok(pool)
}

// ----- Model Structs -----

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT")]
#[serde(rename_all = "PascalCase")]
pub enum WbsElementType {
    Project,
    WorkPackage,
    Activity,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanVersion {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub is_draft: bool,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WbsElementDetail {
    pub id: i64,
    pub plan_version_id: i64,
    pub wbs_element_id: i64,
    pub parent_element_id: Option<i64>,
    pub milestone_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub element_type: WbsElementType,
    pub estimated_pv: Option<f64>,
    pub tags: Option<String>,
    pub is_deleted: bool,
}

#[derive(Debug, Serialize, FromRow, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActualCost {
    pub id: i64,
    pub wbs_element_id: i64,
    pub user_id: i64,
    pub work_date: NaiveDate,
    pub actual_cost: f64,
    pub is_deleted: bool,
}

#[derive(Debug, Serialize, FromRow, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressUpdate {
    pub id: i64,
    pub wbs_element_id: i64,
    pub reported_by_user_id: i64,
    pub report_date: NaiveDate,
    pub progress_percent: f64,
    pub notes: Option<String>,
    pub is_deleted: bool,
}

#[derive(Debug, Serialize, FromRow, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PvAllocation {
    pub id: i64,
    pub plan_version_id: i64,
    pub wbs_element_id: i64,
    pub user_id: Option<i64>,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub planned_value: f64,
}


// ----- DB Access Functions -----

/// 新規プロジェクトを作成し、初期ドラフト版の計画バージョンも併せて作成します。
pub async fn create_project(pool: &SqlitePool, name: &str) -> DbResult<(Project, PlanVersion)> {
    let mut tx = pool.begin().await?;

    // 1. projectsテーブルにレコードを挿入
    let project_id = sqlx::query("INSERT INTO projects (name) VALUES (?)")
        .bind(name)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();

    // 2. 作成したプロジェクトの情報を取得
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(&mut *tx)
        .await?;

    // 3. 初期ドラフトのplan_versionsレコードを挿入
    let plan_version_id = sqlx::query(
        "INSERT INTO plan_versions (project_id, name, is_draft) VALUES (?, ?, ?)",
    )
    .bind(project_id)
    .bind("Working Draft")
    .bind(true)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    let plan_version =
        sqlx::query_as::<_, PlanVersion>("SELECT * FROM plan_versions WHERE id = ?")
            .bind(plan_version_id)
            .fetch_one(&mut *tx)
            .await?;

    tx.commit().await?;

    Ok((project, plan_version))
}

/// 新しいWBS要素を作成します。
pub async fn add_wbs_element(
    pool: &SqlitePool,
    plan_version_id: i64,
    parent_element_id: Option<i64>,
    milestone_id: Option<i64>,
    title: &str,
    description: Option<&str>,
    element_type: WbsElementType,
    estimated_pv: Option<f64>,
    tags: Option<&str>,
) -> DbResult<WbsElementDetail> {
    let mut tx = pool.begin().await?;

    // 1. plan_versionからproject_idを取得
    let project_id: i64 = sqlx::query_scalar("SELECT project_id FROM plan_versions WHERE id = ?")
        .bind(plan_version_id)
        .fetch_one(&mut *tx)
        .await?;

    // 2. 不変のwbs_elementsレコードを作成し、Global IDを取得
    let wbs_element_id = sqlx::query("INSERT INTO wbs_elements (project_id) VALUES (?)")
        .bind(project_id)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();

    // 3. wbs_element_detailsに具体的な情報を挿入
    let detail_id = sqlx::query(
        r#"
        INSERT INTO wbs_element_details
        (plan_version_id, wbs_element_id, parent_element_id, milestone_id, title, description, element_type, estimated_pv, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(plan_version_id)
    .bind(wbs_element_id)
    .bind(parent_element_id)
    .bind(milestone_id)
    .bind(title)
    .bind(description)
    .bind(&element_type)
    .bind(estimated_pv)
    .bind(tags)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    let new_detail =
        sqlx::query_as::<_, WbsElementDetail>("SELECT * FROM wbs_element_details WHERE id = ?")
            .bind(detail_id)
            .fetch_one(&mut *tx)
            .await?;

    tx.commit().await?;

    Ok(new_detail)
}

/// 指定された計画バージョンに属する全てのWBS要素を取得します。
pub async fn list_wbs_elements(
    pool: &SqlitePool,
    plan_version_id: i64,
) -> DbResult<Vec<WbsElementDetail>> {
    let elements = sqlx::query_as::<_, WbsElementDetail>(
        "SELECT * FROM wbs_element_details WHERE plan_version_id = ? AND is_deleted = false",
    )
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;
    Ok(elements)
}

/// すべてのプロジェクトを取得します。
pub async fn list_projects(pool: &SqlitePool) -> DbResult<Vec<Project>> {
    let projects = sqlx::query_as::<_, Project>("SELECT * FROM projects ORDER BY name")
        .fetch_all(pool)
        .await?;
    Ok(projects)
}

/// 指定されたプロジェクトIDに属する全ての計画バージョンを取得します。
pub async fn list_plan_versions_for_project(
    pool: &SqlitePool,
    project_id: i64,
) -> DbResult<Vec<PlanVersion>> {
    let versions = sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE project_id = ? ORDER BY id DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(versions)
}

/// WBS要素の見積もりPVを更新します。
pub async fn update_wbs_element_pv(
    pool: &SqlitePool,
    id: i64, // This is wbs_element_details.id
    estimated_pv: Option<f64>,
) -> DbResult<u64> {
    let rows_affected = sqlx::query("UPDATE wbs_element_details SET estimated_pv = ? WHERE id = ?")
        .bind(estimated_pv)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

    Ok(rows_affected)
}

pub async fn list_allocations_for_period(
    pool: &SqlitePool,
    plan_version_id: i64,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> DbResult<Vec<PvAllocation>> {
    let allocations = sqlx::query_as::<_, PvAllocation>(
        "SELECT * FROM pv_allocations WHERE plan_version_id = ? AND start_date >= ? AND start_date <= ?",
    )
    .bind(plan_version_id)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await?;
    Ok(allocations)
}

pub async fn upsert_daily_allocation(
    pool: &SqlitePool,
    plan_version_id: i64,
    wbs_element_id: i64,
    date: NaiveDate,
    planned_value: Option<f64>,
) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    // Find existing allocation for this specific day
    let existing_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id = ? AND start_date = ?",
    )
    .bind(plan_version_id)
    .bind(wbs_element_id)
    .bind(date)
    .fetch_optional(&mut *tx)
    .await?;

    let pv_to_use = planned_value.filter(|&pv| pv > 0.0);

    match (pv_to_use, existing_id) {
        // Value is present, so update or insert
        (Some(pv), Some(id)) => {
            sqlx::query("UPDATE pv_allocations SET planned_value = ? WHERE id = ?")
                .bind(pv)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        (Some(pv), None) => {
            sqlx::query(
                "INSERT INTO pv_allocations (plan_version_id, wbs_element_id, start_date, end_date, planned_value) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(plan_version_id)
            .bind(wbs_element_id)
            .bind(date)
            .bind(date)
            .bind(pv)
            .execute(&mut *tx)
            .await?;
        }
        // Value is zero or None, so delete
        (None, Some(id)) => {
            sqlx::query("DELETE FROM pv_allocations WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        // No value and no record, nothing to do
        (None, None) => {}
    }

    tx.commit().await?;
    Ok(())
}

// ----- PV Allocations -----

pub async fn list_pv_allocations_for_wbs_element(
    pool: &SqlitePool,
    wbs_element_id: i64,
    plan_version_id: i64,
) -> DbResult<Vec<PvAllocation>> {
    let allocations = sqlx::query_as::<_, PvAllocation>(
        "SELECT * FROM pv_allocations WHERE wbs_element_id = ? AND plan_version_id = ?",
    )
    .bind(wbs_element_id)
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;
    Ok(allocations)
}

pub async fn add_pv_allocation(
    pool: &SqlitePool,
    plan_version_id: i64,
    wbs_element_id: i64,
    user_id: Option<i64>,
    start_date: NaiveDate,
    end_date: NaiveDate,
    planned_value: f64,
) -> DbResult<PvAllocation> {
    let id = sqlx::query(
        "INSERT INTO pv_allocations (plan_version_id, wbs_element_id, user_id, start_date, end_date, planned_value) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(plan_version_id).bind(wbs_element_id).bind(user_id).bind(start_date).bind(end_date).bind(planned_value)
    .execute(pool)
    .await?
    .last_insert_rowid();

    let new_allocation = sqlx::query_as::<_, PvAllocation>("SELECT * FROM pv_allocations WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;

    Ok(new_allocation)
}

pub async fn update_pv_allocation(
    pool: &SqlitePool,
    id: i64,
    start_date: NaiveDate,
    end_date: NaiveDate,
    planned_value: f64,
) -> DbResult<PvAllocation> {
    sqlx::query("UPDATE pv_allocations SET start_date = ?, end_date = ?, planned_value = ? WHERE id = ?")
        .bind(start_date)
        .bind(end_date)
        .bind(planned_value)
        .bind(id)
        .execute(pool)
        .await?;

    let updated_allocation = sqlx::query_as::<_, PvAllocation>("SELECT * FROM pv_allocations WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(updated_allocation)
}

pub async fn delete_pv_allocation(pool: &SqlitePool, id: i64) -> DbResult<u64> {
    let rows_affected = sqlx::query("DELETE FROM pv_allocations WHERE id = ?").bind(id)
        .execute(pool).await?.rows_affected();
    Ok(rows_affected)
}

pub async fn get_descendant_wbs_element_ids(pool: &SqlitePool, plan_version_id: i64, root_wbs_id: i64) -> DbResult<Vec<i64>> {
    let ids: Vec<(i64,)> = sqlx::query_as(
        r#"
        WITH RECURSIVE descendants(id) AS (
            VALUES(?)
            UNION
            SELECT wed.wbs_element_id
            FROM wbs_element_details wed
            JOIN descendants ON wed.parent_element_id = descendants.id
            WHERE wed.plan_version_id = ?
        )
        SELECT id FROM descendants
        "#,
    )
    .bind(root_wbs_id)
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;

    Ok(ids.into_iter().map(|(id,)| id).collect())
}

pub async fn get_filterable_wbs_nodes(pool: &SqlitePool, plan_version_id: i64) -> DbResult<Vec<WbsElementDetail>> {
    let nodes = sqlx::query_as(
        "SELECT * FROM wbs_element_details WHERE plan_version_id = ? AND element_type IN ('Project', 'WorkPackage') AND is_deleted = false ORDER BY id"
    )
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;
    Ok(nodes)
}

pub async fn create_baseline(pool: &SqlitePool, project_id: i64, baseline_name: &str) -> DbResult<PlanVersion> {
    let mut tx = pool.begin().await?;

    // 1. Find the current draft plan version
    let draft_version = sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE project_id = ? AND is_draft = true",
    )
    .bind(project_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    // 2. Insert the new baseline version
    let new_version_id = sqlx::query(
        "INSERT INTO plan_versions (project_id, name, is_draft) VALUES (?, ?, ?)",
    )
    .bind(project_id)
    .bind(baseline_name)
    .bind(false)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    // 3. Copy wbs_element_details
    sqlx::query(
        r#"
        INSERT INTO wbs_element_details (plan_version_id, wbs_element_id, parent_element_id, milestone_id, title, description, element_type, estimated_pv, tags, is_deleted)
        SELECT ?, wbs_element_id, parent_element_id, milestone_id, title, description, element_type, estimated_pv, tags, is_deleted
        FROM wbs_element_details
        WHERE plan_version_id = ?
        "#,
    )
    .bind(new_version_id)
    .bind(draft_version.id)
    .execute(&mut *tx)
    .await?;

    // 4. Copy pv_allocations
    sqlx::query(
        r#"
        INSERT INTO pv_allocations (plan_version_id, wbs_element_id, user_id, start_date, end_date, planned_value)
        SELECT ?, wbs_element_id, user_id, start_date, end_date, planned_value
        FROM pv_allocations
        WHERE plan_version_id = ?
        "#,
    )
    .bind(new_version_id)
    .bind(draft_version.id)
    .execute(&mut *tx)
    .await?;

    // 5. Copy plan_milestones
    sqlx::query(
        r#"
        INSERT INTO plan_milestones (plan_version_id, milestone_id, name, target_date, is_deleted)
        SELECT ?, milestone_id, name, target_date, is_deleted
        FROM plan_milestones
        WHERE plan_version_id = ?
        "#,
    )
    .bind(new_version_id)
    .bind(draft_version.id)
    .execute(&mut *tx)
    .await?;

    // Fetch the newly created plan version to return it
    let new_version = sqlx::query_as::<_, PlanVersion>("SELECT * FROM plan_versions WHERE id = ?")
        .bind(new_version_id)
        .fetch_one(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(new_version)
}

// ----- Execution: Actual Costs (AC) -----

pub async fn add_actual_cost(
    pool: &SqlitePool,
    wbs_element_id: i64,
    user_id: i64,
    work_date: NaiveDate,
    actual_cost: f64,
) -> DbResult<ActualCost> {
    let id = sqlx::query(
        "INSERT INTO actual_costs (wbs_element_id, user_id, work_date, actual_cost) VALUES (?, ?, ?, ?)",
    )
    .bind(wbs_element_id)
    .bind(user_id)
    .bind(work_date)
    .bind(actual_cost)
    .execute(pool)
    .await?
    .last_insert_rowid();

    let record = sqlx::query_as("SELECT * FROM actual_costs WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(record)
}

pub async fn get_actual_costs_for_element(
    pool: &SqlitePool,
    wbs_element_id: i64,
) -> DbResult<Vec<ActualCost>> {
    let records = sqlx::query_as(
        "SELECT * FROM actual_costs WHERE wbs_element_id = ? AND is_deleted = false ORDER BY work_date DESC",
    )
    .bind(wbs_element_id)
    .fetch_all(pool)
    .await?;
    Ok(records)
}

// ----- Execution: Progress Updates (EV) -----

pub async fn add_progress_update(
    pool: &SqlitePool,
    wbs_element_id: i64,
    reported_by_user_id: i64,
    report_date: NaiveDate,
    progress_percent: f64,
    notes: Option<&str>,
) -> DbResult<ProgressUpdate> {
    let id = sqlx::query(
        "INSERT INTO progress_updates (wbs_element_id, reported_by_user_id, report_date, progress_percent, notes) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(wbs_element_id)
    .bind(reported_by_user_id)
    .bind(report_date)
    .bind(progress_percent)
    .bind(notes)
    .execute(pool)
    .await?
    .last_insert_rowid();

    let record = sqlx::query_as("SELECT * FROM progress_updates WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(record)
}

pub async fn get_progress_updates_for_element(
    pool: &SqlitePool,
    wbs_element_id: i64,
) -> DbResult<Vec<ProgressUpdate>> {
    let records = sqlx::query_as(
        "SELECT * FROM progress_updates WHERE wbs_element_id = ? AND is_deleted = false ORDER BY report_date DESC",
    )
    .bind(wbs_element_id)
    .fetch_all(pool)
    .await?;
    Ok(records)
}
