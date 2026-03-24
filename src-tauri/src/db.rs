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
