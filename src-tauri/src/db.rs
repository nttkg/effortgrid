use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
pub use sqlx::SqlitePool;
use sqlx::{FromRow, Executor, Sqlite, Transaction};
use thiserror::Error;
use tokio::sync::RwLock;

#[derive(Debug, Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("{0}")]
    Constraint(String),
}

// データベース操作用のカスタムResult型
pub type DbResult<T> = Result<T, DbError>;

pub struct AppState {
    pub pool: RwLock<Option<SqlitePool>>,
    pub current_db_path: RwLock<Option<String>>,
}

pub async fn connect_db(db_path: &str) -> DbResult<SqlitePool> {
    let db_url = format!("sqlite:{}?mode=rwc", db_path);
    let pool = SqlitePool::connect(&db_url).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Seed initial data
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&pool).await?;
    if user_count == 0 {
        sqlx::query("INSERT INTO users (id, name, role, email) VALUES (1, 'Default User', 'Developer', 'default@example.com')")
            .execute(&pool).await?;
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
pub struct Portfolio {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanVersion {
    pub id: i64,
    pub portfolio_id: i64,
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
pub struct User {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub email: Option<String>,
    pub daily_capacity: Option<f64>,
}

#[derive(Debug, Serialize, FromRow, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMilestone {
    pub id: i64,
    pub plan_version_id: i64,
    pub milestone_id: i64,
    pub name: String,
    pub target_date: String,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyAllocationBulkItem {
    pub wbs_element_id: i64,
    pub user_id: Option<i64>,
    pub date: NaiveDate,
    pub planned_value: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActualCostBulkItem {
    pub wbs_element_id: i64,
    pub user_id: i64,
    pub work_date: NaiveDate,
    pub actual_cost: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressUpdateBulkItem {
    pub wbs_element_id: i64,
    pub report_date: NaiveDate,
    pub progress_percent: Option<f64>,
}


// ----- DB Access Functions -----

async fn ensure_plan_is_draft<'e, E>(executor: E, plan_version_id: i64) -> DbResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    let is_draft: bool = sqlx::query_scalar("SELECT is_draft FROM plan_versions WHERE id = ?")
        .bind(plan_version_id)
        .fetch_one(executor)
        .await?;
    if !is_draft {
        return Err(DbError::Constraint("Cannot modify a saved baseline.".to_string()));
    }
    Ok(())
}

/// 新規ポートフォリオを作成し、初期ドラフト版の計画バージョンも併せて作成します。
pub async fn create_portfolio(pool: &SqlitePool, name: &str) -> DbResult<(Portfolio, PlanVersion)> {
    let mut tx = pool.begin().await?;

    // 1. portfoliosテーブルにレコードを挿入
    let portfolio_id = sqlx::query("INSERT INTO portfolios (name) VALUES (?)")
        .bind(name)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();

    // 2. 作成したポートフォリオの情報を取得
    let portfolio = sqlx::query_as::<_, Portfolio>("SELECT * FROM portfolios WHERE id = ?")
        .bind(portfolio_id)
        .fetch_one(&mut *tx)
        .await?;

    // 3. 初期ドラフトのplan_versionsレコードを挿入
    let plan_version_id = sqlx::query(
        "INSERT INTO plan_versions (portfolio_id, name, is_draft) VALUES (?, ?, ?)",
    )
    .bind(portfolio_id)
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

    Ok((portfolio, plan_version))
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
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;

    // 1. plan_versionからportfolio_idを取得
    let portfolio_id: i64 = sqlx::query_scalar("SELECT portfolio_id FROM plan_versions WHERE id = ?")
        .bind(plan_version_id)
        .fetch_one(&mut *tx)
        .await?;

    // 2. 不変のwbs_elementsレコードを作成し、Global IDを取得
    let wbs_element_id = sqlx::query("INSERT INTO wbs_elements (portfolio_id) VALUES (?)")
        .bind(portfolio_id)
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

/// すべてのポートフォリオを取得します。
pub async fn list_portfolios(pool: &SqlitePool) -> DbResult<Vec<Portfolio>> {
    let portfolios = sqlx::query_as::<_, Portfolio>("SELECT * FROM portfolios ORDER BY name")
        .fetch_all(pool)
        .await?;
    Ok(portfolios)
}

/// 指定されたポートフォリオIDに属する全ての計画バージョンを取得します。
pub async fn list_plan_versions_for_portfolio(
    pool: &SqlitePool,
    portfolio_id: i64,
) -> DbResult<Vec<PlanVersion>> {
    let versions = sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE portfolio_id = ? ORDER BY id DESC",
    )
    .bind(portfolio_id)
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
    let (plan_version_id,): (i64,) = sqlx::query_as("SELECT plan_version_id FROM wbs_element_details WHERE id = ?").bind(id).fetch_one(pool).await?;
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let rows_affected = sqlx::query("UPDATE wbs_element_details SET estimated_pv = ? WHERE id = ?")
        .bind(estimated_pv)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

    Ok(rows_affected)
}

pub async fn update_wbs_element_details(
    pool: &SqlitePool,
    id: i64,
    title: &str,
    description: Option<&str>,
    element_type: WbsElementType,
    tags: Option<&str>,
    milestone_id: Option<i64>,
) -> DbResult<u64> {
    let (plan_version_id,): (i64,) = sqlx::query_as("SELECT plan_version_id FROM wbs_element_details WHERE id = ?").bind(id).fetch_one(pool).await?;
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let rows_affected = sqlx::query(
        "UPDATE wbs_element_details SET title = ?, description = ?, element_type = ?, tags = ?, milestone_id = ? WHERE id = ?"
    )
    .bind(title)
    .bind(description)
    .bind(&element_type)
    .bind(tags)
    .bind(milestone_id)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(rows_affected)
}

pub async fn delete_wbs_elements_bulk(
    pool: &SqlitePool,
    plan_version_id: i64,
    detail_ids: &[i64],
) -> DbResult<u64> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let ids_json = serde_json::to_string(detail_ids).unwrap();

    let rows_affected = sqlx::query(r#"
        WITH RECURSIVE elements_to_delete(wbs_id) AS (
            SELECT wbs_element_id FROM wbs_element_details WHERE id IN (SELECT value FROM json_each(?)) AND plan_version_id = ?
            UNION
            SELECT d.wbs_element_id FROM wbs_element_details d JOIN elements_to_delete ON d.parent_element_id = elements_to_delete.wbs_id WHERE d.plan_version_id = ?
        )
        UPDATE wbs_element_details SET is_deleted = 1
        WHERE plan_version_id = ? AND wbs_element_id IN (SELECT wbs_id FROM elements_to_delete)
    "#)
    .bind(ids_json)
    .bind(plan_version_id)
    .bind(plan_version_id)
    .bind(plan_version_id)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(rows_affected)
}

pub async fn update_wbs_elements_bulk(
    pool: &SqlitePool,
    plan_version_id: i64,
    detail_ids: &[i64],
    element_type: Option<WbsElementType>,
    milestone_id: Option<Option<i64>>, // Option<Option<i64>> to distinguish "set to NULL" from "do not change"
    estimated_pv: Option<Option<f64>>,
) -> DbResult<u64> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;
    let ids_json = serde_json::to_string(detail_ids).unwrap();
    let mut total_rows_affected = 0;

    if let Some(milestone_id_val) = milestone_id {
        total_rows_affected += sqlx::query(
            "UPDATE wbs_element_details SET milestone_id = ? WHERE plan_version_id = ? AND id IN (SELECT value FROM json_each(?))"
        )
        .bind(milestone_id_val)
        .bind(plan_version_id)
        .bind(&ids_json)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    }

    if let Some(pv_val) = estimated_pv {
        total_rows_affected += sqlx::query(
            "UPDATE wbs_element_details SET estimated_pv = ? WHERE plan_version_id = ? AND element_type = 'Activity' AND id IN (SELECT value FROM json_each(?))"
        )
        .bind(pv_val)
        .bind(plan_version_id)
        .bind(&ids_json)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    }
    
    if let Some(et_val) = element_type {
        if et_val == WbsElementType::Activity {
            // Safety check: only update if it has no active children
            total_rows_affected += sqlx::query(
                r#"
                UPDATE wbs_element_details SET element_type = ?
                WHERE plan_version_id = ? AND id IN (SELECT value FROM json_each(?))
                AND NOT EXISTS (
                    SELECT 1 FROM wbs_element_details AS children
                    WHERE children.parent_element_id = wbs_element_details.wbs_element_id
                    AND children.plan_version_id = ? AND children.is_deleted = false
                )
                "#
            )
            .bind(&et_val)
            .bind(plan_version_id)
            .bind(&ids_json)
            .bind(plan_version_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        } else {
            total_rows_affected += sqlx::query(
                "UPDATE wbs_element_details SET element_type = ? WHERE plan_version_id = ? AND id IN (SELECT value FROM json_each(?))"
            )
            .bind(&et_val)
            .bind(plan_version_id)
            .bind(&ids_json)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        }
    }

    tx.commit().await?;
    Ok(total_rows_affected)
}

pub async fn list_all_allocations_for_plan_version(
    pool: &SqlitePool,
    plan_version_id: i64,
) -> DbResult<Vec<PvAllocation>> {
    let allocations = sqlx::query_as::<_, PvAllocation>(
        "SELECT * FROM pv_allocations WHERE plan_version_id = ?",
    )
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;
    Ok(allocations)
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
    user_id: Option<i64>,
    date: NaiveDate,
    planned_value: Option<f64>,
) -> DbResult<()> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;
    upsert_daily_allocation_tx(&mut tx, plan_version_id, wbs_element_id, user_id, date, planned_value).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_daily_allocation_tx(
    tx: &mut Transaction<'_, Sqlite>,
    plan_version_id: i64,
    wbs_element_id: i64,
    user_id: Option<i64>,
    date: NaiveDate,
    planned_value: Option<f64>,
) -> DbResult<()> {
    // Find existing allocation for this specific day
    let existing_id: Option<i64> = if let Some(uid) = user_id {
        sqlx::query_scalar(
            "SELECT id FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id = ? AND user_id = ? AND start_date = ?",
        )
        .bind(plan_version_id)
        .bind(wbs_element_id)
        .bind(uid)
        .bind(date)
        .fetch_optional(&mut **tx).await?
    } else {
        sqlx::query_scalar(
            "SELECT id FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id = ? AND user_id IS NULL AND start_date = ?",
        )
        .bind(plan_version_id)
        .bind(wbs_element_id)
        .bind(date)
        .fetch_optional(&mut **tx).await?
    };

    let pv_to_use = planned_value.filter(|&pv| pv > 0.0);

    match (pv_to_use, existing_id) {
        // Value is present, so update or insert
        (Some(pv), Some(id)) => {
            sqlx::query("UPDATE pv_allocations SET planned_value = ? WHERE id = ?")
                .bind(pv)
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
        (Some(pv), None) => {
            sqlx::query(
                "INSERT INTO pv_allocations (plan_version_id, wbs_element_id, user_id, start_date, end_date, planned_value) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(plan_version_id)
            .bind(wbs_element_id)
            .bind(user_id)
            .bind(date)
            .bind(date)
            .bind(pv)
            .execute(&mut **tx)
            .await?;
        }
        // Value is zero or None, so delete
        (None, Some(id)) => {
            sqlx::query("DELETE FROM pv_allocations WHERE id = ?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
        // No value and no record, nothing to do
        (None, None) => {}
    }

    Ok(())
}

pub async fn upsert_daily_allocations_bulk(
    pool: &SqlitePool,
    plan_version_id: i64,
    allocations: &[DailyAllocationBulkItem],
) -> DbResult<()> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;

    for alloc in allocations {
        let existing_id: Option<i64> = if let Some(uid) = alloc.user_id {
            sqlx::query_scalar(
                "SELECT id FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id = ? AND user_id = ? AND start_date = ?",
            )
            .bind(plan_version_id)
            .bind(alloc.wbs_element_id)
            .bind(uid)
            .bind(alloc.date)
            .fetch_optional(&mut *tx).await?
        } else {
            sqlx::query_scalar(
                "SELECT id FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id = ? AND user_id IS NULL AND start_date = ?",
            )
            .bind(plan_version_id)
            .bind(alloc.wbs_element_id)
            .bind(alloc.date)
            .fetch_optional(&mut *tx).await?
        };

        let pv_to_use = alloc.planned_value.filter(|&pv| pv > 0.0);

        match (pv_to_use, existing_id) {
            (Some(pv), Some(id)) => {
                sqlx::query("UPDATE pv_allocations SET planned_value = ? WHERE id = ?")
                    .bind(pv)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            (Some(pv), None) => {
                sqlx::query(
                    "INSERT INTO pv_allocations (plan_version_id, wbs_element_id, user_id, start_date, end_date, planned_value) VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(plan_version_id)
                .bind(alloc.wbs_element_id)
                .bind(alloc.user_id)
                .bind(alloc.date)
                .bind(alloc.date)
                .bind(pv)
                .execute(&mut *tx)
                .await?;
            }
            (None, Some(id)) => {
                sqlx::query("DELETE FROM pv_allocations WHERE id = ?")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            (None, None) => {}
        }
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
    ensure_plan_is_draft(pool, plan_version_id).await?;
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
    let (plan_version_id,): (i64,) = sqlx::query_as("SELECT plan_version_id FROM pv_allocations WHERE id = ?").bind(id).fetch_one(pool).await?;
    ensure_plan_is_draft(pool, plan_version_id).await?;

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
    let (plan_version_id,): (i64,) = sqlx::query_as("SELECT plan_version_id FROM pv_allocations WHERE id = ?").bind(id).fetch_one(pool).await?;
    ensure_plan_is_draft(pool, plan_version_id).await?;

    let rows_affected = sqlx::query("DELETE FROM pv_allocations WHERE id = ?").bind(id)
        .execute(pool).await?.rows_affected();
    Ok(rows_affected)
}

pub async fn sync_pv_to_ac_up_to_date(
    pool: &SqlitePool,
    plan_version_id: i64,
    up_to_date: NaiveDate,
) -> DbResult<()> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;

    // 1. 指定日以前のPV割当をすべて削除
    sqlx::query(
        "DELETE FROM pv_allocations WHERE plan_version_id = ? AND start_date <= ?"
    )
    .bind(plan_version_id)
    .bind(up_to_date)
    .execute(&mut *tx)
    .await?;

    // 2. 指定日以前のAC（実績コスト）を元に、新しいPV割当を一括作成
    sqlx::query(
        r#"
        INSERT INTO pv_allocations (plan_version_id, wbs_element_id, user_id, start_date, end_date, planned_value)
        SELECT ?, ac.wbs_element_id, ac.user_id, ac.work_date, ac.work_date, ac.actual_cost
        FROM actual_costs ac
        JOIN wbs_element_details wed ON ac.wbs_element_id = wed.wbs_element_id
        WHERE wed.plan_version_id = ? AND ac.work_date <= ? AND ac.is_deleted = false AND wed.is_deleted = false AND wed.element_type = 'Activity'
        "#
    )
    .bind(plan_version_id)
    .bind(plan_version_id)
    .bind(up_to_date)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
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

/// Checks if a WBS element is an 'Activity' in the portfolio's current draft plan.
async fn ensure_wbs_is_draft_activity(pool: &SqlitePool, wbs_element_id: i64) -> DbResult<()> {
    let (is_draft_activity,): (bool,) = sqlx::query_as(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM wbs_element_details wed
            JOIN plan_versions pv ON wed.plan_version_id = pv.id
            WHERE wed.wbs_element_id = ? AND pv.is_draft = 1 AND wed.element_type = 'Activity'
        )
        "#,
    )
    .bind(wbs_element_id)
    .fetch_one(pool)
    .await?;

    if !is_draft_activity {
        return Err(DbError::Constraint(
            "Actual costs and progress can only be reported for 'Activity' elements in the working draft.".to_string(),
        ));
    }
    Ok(())
}

/// Efficiently checks if a list of WBS elements are all 'Activity' types in the draft plan.
async fn ensure_wbs_list_are_draft_activities(pool: &SqlitePool, wbs_element_ids: &[i64]) -> DbResult<()> {
    if wbs_element_ids.is_empty() {
        return Ok(());
    }

    let unique_ids: std::collections::HashSet<_> = wbs_element_ids.iter().cloned().collect();
    if unique_ids.is_empty() {
        return Ok(());
    }

    let params = unique_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT COUNT(DISTINCT wd.wbs_element_id) FROM wbs_element_details wd
         JOIN plan_versions pv ON wd.plan_version_id = pv.id
         WHERE wd.wbs_element_id IN ({}) AND pv.is_draft = true AND wd.element_type = 'Activity'",
        params
    );

    let mut query = sqlx::query_scalar::<_, i64>(&sql);
    for id in &unique_ids {
        query = query.bind(id);
    }

    let activity_count = query.fetch_one(pool).await?;

    if activity_count as usize == unique_ids.len() {
        Ok(())
    } else {
        Err(DbError::Constraint(
            "All elements must be 'Activity' types in the current draft plan.".to_string(),
        ))
    }
}

pub async fn create_baseline(pool: &SqlitePool, portfolio_id: i64, baseline_name: &str) -> DbResult<PlanVersion> {
    let mut tx = pool.begin().await?;

    // 1. Find the current draft plan version
    let draft_version = sqlx::query_as::<_, PlanVersion>(
        "SELECT * FROM plan_versions WHERE portfolio_id = ? AND is_draft = true",
    )
    .bind(portfolio_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    // 2. Insert the new baseline version
    let new_version_id = sqlx::query(
        "INSERT INTO plan_versions (portfolio_id, name, is_draft) VALUES (?, ?, ?)",
    )
    .bind(portfolio_id)
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
    ensure_wbs_is_draft_activity(pool, wbs_element_id).await?;
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

pub async fn upsert_actual_cost(
    pool: &SqlitePool,
    wbs_element_id: i64,
    user_id: i64,
    work_date: NaiveDate,
    actual_cost: Option<f64>,
) -> DbResult<()> {
    ensure_wbs_is_draft_activity(pool, wbs_element_id).await?;
    let mut tx = pool.begin().await?;
    upsert_actual_cost_tx(&mut tx, wbs_element_id, user_id, work_date, actual_cost).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_actual_cost_tx(
    tx: &mut Transaction<'_, Sqlite>,
    wbs_element_id: i64,
    user_id: i64,
    work_date: NaiveDate,
    actual_cost: Option<f64>,
) -> DbResult<()> {
    let existing_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM actual_costs WHERE wbs_element_id = ? AND user_id = ? AND work_date = ?",
    )
    .bind(wbs_element_id)
    .bind(user_id)
    .bind(work_date)
    .fetch_optional(&mut **tx)
    .await?;

    let cost_to_use = actual_cost.filter(|&ac| ac > 0.0);

    match (cost_to_use, existing_id) {
        (Some(ac), Some(id)) => {
            sqlx::query("UPDATE actual_costs SET actual_cost = ? WHERE id = ?")
                .bind(ac)
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
        (Some(ac), None) => {
            sqlx::query(
                "INSERT INTO actual_costs (wbs_element_id, user_id, work_date, actual_cost) VALUES (?, ?, ?, ?)",
            )
            .bind(wbs_element_id)
            .bind(user_id)
            .bind(work_date)
            .bind(ac)
            .execute(&mut **tx)
            .await?;
        }
        (None, Some(id)) => {
            sqlx::query("DELETE FROM actual_costs WHERE id = ?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
        (None, None) => {}
    }
    Ok(())
}

pub async fn upsert_actual_costs_bulk(
    pool: &SqlitePool,
    costs: &[ActualCostBulkItem],
) -> DbResult<()> {
    let wbs_ids: Vec<i64> = costs.iter().map(|c| c.wbs_element_id).collect();
    ensure_wbs_list_are_draft_activities(pool, &wbs_ids).await?;
    let mut tx = pool.begin().await?;

    for cost in costs {
        let existing_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM actual_costs WHERE wbs_element_id = ? AND user_id = ? AND work_date = ?",
        )
        .bind(cost.wbs_element_id)
        .bind(cost.user_id)
        .bind(cost.work_date)
        .fetch_optional(&mut *tx)
        .await?;

        let cost_to_use = cost.actual_cost.filter(|&ac| ac > 0.0);

        match (cost_to_use, existing_id) {
            (Some(ac), Some(id)) => {
                sqlx::query("UPDATE actual_costs SET actual_cost = ? WHERE id = ?")
                    .bind(ac)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            (Some(ac), None) => {
                sqlx::query(
                    "INSERT INTO actual_costs (wbs_element_id, user_id, work_date, actual_cost) VALUES (?, ?, ?, ?)",
                )
                .bind(cost.wbs_element_id)
                .bind(cost.user_id)
                .bind(cost.work_date)
                .bind(ac)
                .execute(&mut *tx)
                .await?;
            }
            (None, Some(id)) => {
                sqlx::query("DELETE FROM actual_costs WHERE id = ?")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            (None, None) => {}
        }
    }

    tx.commit().await?;
    Ok(())
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

pub async fn list_actuals_for_period(
    pool: &SqlitePool,
    plan_version_id: i64,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> DbResult<Vec<ActualCost>> {
    let activity_ids: Vec<(i64,)> = sqlx::query_as(
        "SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ? AND element_type = 'Activity' AND is_deleted = false",
    )
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;

    let activity_ids: Vec<i64> = activity_ids.into_iter().map(|(id,)| id).collect();

    if activity_ids.is_empty() {
        return Ok(vec![]);
    }

    // Since sqlx `IN (?)` binding for a vec is not directly supported for sqlite, we build the query string.
    // This is safe because we are not injecting user input, only placeholders.
    let params = activity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT * FROM actual_costs WHERE wbs_element_id IN ({}) AND work_date >= ? AND work_date <= ? AND is_deleted = false",
        params
    );
    
    let mut query = sqlx::query_as::<_, ActualCost>(&sql);
    for id in &activity_ids {
        query = query.bind(id);
    }
    query = query.bind(start_date).bind(end_date);
    
    let records = query.fetch_all(pool).await?;

    Ok(records)
}

pub async fn list_all_actuals_for_plan_version(
    pool: &SqlitePool,
    plan_version_id: i64,
) -> DbResult<Vec<ActualCost>> {
    let activity_ids: Vec<(i64,)> = sqlx::query_as(
        "SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ? AND element_type = 'Activity' AND is_deleted = false",
    )
    .bind(plan_version_id)
    .fetch_all(pool)
    .await?;

    let activity_ids: Vec<i64> = activity_ids.into_iter().map(|(id,)| id).collect();

    if activity_ids.is_empty() {
        return Ok(vec![]);
    }

    let params = activity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT * FROM actual_costs WHERE wbs_element_id IN ({}) AND is_deleted = false",
        params
    );
    
    let mut query = sqlx::query_as::<_, ActualCost>(&sql);
    for id in &activity_ids {
        query = query.bind(id);
    }
    
    let records = query.fetch_all(pool).await?;

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
    ensure_wbs_is_draft_activity(pool, wbs_element_id).await?;
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

pub async fn list_users<'e, E>(executor: E) -> DbResult<Vec<User>>
where
    E: Executor<'e, Database = Sqlite>,
{
    let users = sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY name")
        .fetch_all(executor)
        .await?;
    Ok(users)
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

pub async fn list_all_progress_updates_for_plan_version(pool: &SqlitePool, plan_version_id: i64) -> DbResult< Vec< ProgressUpdate > > {
    let activity_ids: Vec< (i64,) > = sqlx::query_as("SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ? AND element_type = 'Activity' AND is_deleted = false").bind(plan_version_id).fetch_all(pool).await?;
    if activity_ids.is_empty() { return Ok(vec![]); }
    let activity_ids: Vec< i64 > = activity_ids.into_iter().map(|(id,)| id).collect();
    let params = activity_ids.iter().map(|_| "?").collect::< Vec< _ > >().join(", ");
    let sql = format!("SELECT * FROM progress_updates WHERE wbs_element_id IN ({}) AND is_deleted = false ORDER BY report_date ASC", params);
    let mut query = sqlx::query_as::< _, ProgressUpdate >(&sql);
    for id in &activity_ids { query = query.bind(id); }
    Ok(query.fetch_all(pool).await?)
}

pub async fn upsert_progress_update(pool: &SqlitePool, wbs_element_id: i64, reported_by_user_id: i64, report_date: NaiveDate, progress_percent: Option< f64 >) -> DbResult< () > {
    ensure_wbs_is_draft_activity(pool, wbs_element_id).await?;
    let mut tx = pool.begin().await?;
    upsert_progress_update_tx(&mut tx, wbs_element_id, reported_by_user_id, report_date, progress_percent).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_progress_update_tx(
    tx: &mut Transaction<'_, Sqlite>,
    wbs_element_id: i64,
    reported_by_user_id: i64,
    report_date: NaiveDate,
    progress_percent: Option< f64 >,
) -> DbResult< () > {
    let existing_id: Option< i64 > = sqlx::query_scalar("SELECT id FROM progress_updates WHERE wbs_element_id = ? AND report_date = ? AND is_deleted = false").bind(wbs_element_id).bind(report_date).fetch_optional(&mut **tx).await?;
    match (progress_percent, existing_id) {
        (Some(p), Some(id)) => { sqlx::query("UPDATE progress_updates SET progress_percent = ? WHERE id = ?").bind(p).bind(id).execute(&mut **tx).await?; }
        (Some(p), None) => { sqlx::query("INSERT INTO progress_updates (wbs_element_id, reported_by_user_id, report_date, progress_percent) VALUES (?, ?, ?, ?)").bind(wbs_element_id).bind(reported_by_user_id).bind(report_date).bind(p).execute(&mut **tx).await?; }
        (None, Some(id)) => { sqlx::query("UPDATE progress_updates SET is_deleted = true WHERE id = ?").bind(id).execute(&mut **tx).await?; }
        (None, None) => {}
    }
    Ok(())
}

pub async fn upsert_progress_updates_bulk(pool: &SqlitePool, reported_by_user_id: i64, items: &[ProgressUpdateBulkItem]) -> DbResult< () > {
    let wbs_ids: Vec<i64> = items.iter().map(|i| i.wbs_element_id).collect();
    ensure_wbs_list_are_draft_activities(pool, &wbs_ids).await?;
    for item in items {
        upsert_progress_update(pool, item.wbs_element_id, reported_by_user_id, item.report_date, item.progress_percent).await?;
    }
    Ok(())
}

// ----- User Management -----

pub async fn add_user(
    pool: &SqlitePool,
    name: &str,
    role: &str,
    email: Option<&str>,
    daily_capacity: Option<f64>,
) -> DbResult<User> {
    let mut tx = pool.begin().await?;
    let user = add_user_tx(&mut tx, name, role, email, daily_capacity).await?;
    tx.commit().await?;
    Ok(user)
}

pub async fn add_user_tx<'a>(
    tx: &mut Transaction<'a, Sqlite>,
    name: &str,
    role: &str,
    email: Option<&str>,
    daily_capacity: Option<f64>,
) -> DbResult<User> {
    let id = sqlx::query("INSERT INTO users (name, role, email, daily_capacity) VALUES (?, ?, ?, ?)")
        .bind(name)
        .bind(role)
        .bind(email)
        .bind(daily_capacity)
        .execute(&mut **tx)
        .await?
        .last_insert_rowid();

    let new_user = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;

    Ok(new_user)
}

pub async fn update_user(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    role: &str,
    email: Option<&str>,
    daily_capacity: Option<f64>,
) -> DbResult<User> {
    sqlx::query("UPDATE users SET name = ?, role = ?, email = ?, daily_capacity = ? WHERE id = ?")
        .bind(name)
        .bind(role)
        .bind(email)
        .bind(daily_capacity)
        .bind(id)
        .execute(pool)
        .await?;

    let updated_user = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;

    Ok(updated_user)
}

pub async fn delete_user(pool: &SqlitePool, id: i64) -> DbResult<u64> {
    // Note: This is a hard delete. If there are foreign key constraints,
    // this will fail if the user is referenced in other tables.
    let rows_affected = sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(rows_affected)
}

// ----- Milestone Management -----

pub async fn list_plan_milestones(pool: &SqlitePool, plan_version_id: i64) -> DbResult<Vec<PlanMilestone>> {
    let milestones = sqlx::query_as::<_, PlanMilestone>(
        "SELECT * FROM plan_milestones WHERE plan_version_id = ? AND is_deleted = 0 ORDER BY target_date ASC"
    ).bind(plan_version_id).fetch_all(pool).await?;
    Ok(milestones)
}

pub async fn add_plan_milestone(pool: &SqlitePool, plan_version_id: i64, portfolio_id: i64, name: &str, target_date: &str) -> DbResult<PlanMilestone> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;
    let global_id = sqlx::query("INSERT INTO milestones (portfolio_id) VALUES (?)").bind(portfolio_id).execute(&mut *tx).await?.last_insert_rowid();
    let id = sqlx::query("INSERT INTO plan_milestones (plan_version_id, milestone_id, name, target_date) VALUES (?, ?, ?, ?)").bind(plan_version_id).bind(global_id).bind(name).bind(target_date).execute(&mut *tx).await?.last_insert_rowid();
    let milestone = sqlx::query_as::<_, PlanMilestone>("SELECT * FROM plan_milestones WHERE id = ?").bind(id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(milestone)
}

pub async fn update_plan_milestone(pool: &SqlitePool, id: i64, name: &str, target_date: &str) -> DbResult<PlanMilestone> {
    let (plan_version_id,): (i64,) = sqlx::query_as("SELECT plan_version_id FROM plan_milestones WHERE id = ?").bind(id).fetch_one(pool).await?;
    ensure_plan_is_draft(pool, plan_version_id).await?;
    sqlx::query("UPDATE plan_milestones SET name = ?, target_date = ? WHERE id = ?").bind(name).bind(target_date).bind(id).execute(pool).await?;
    let milestone = sqlx::query_as::<_, PlanMilestone>("SELECT * FROM plan_milestones WHERE id = ?").bind(id).fetch_one(pool).await?;
    Ok(milestone)
}

pub async fn delete_plan_milestone(pool: &SqlitePool, id: i64, plan_version_id: i64) -> DbResult<u64> {
    ensure_plan_is_draft(pool, plan_version_id).await?;
    let mut tx = pool.begin().await?;
    let rows = sqlx::query("UPDATE plan_milestones SET is_deleted = 1 WHERE id = ?").bind(id).execute(&mut *tx).await?.rows_affected();
    sqlx::query("UPDATE wbs_element_details SET milestone_id = NULL WHERE plan_version_id = ? AND milestone_id = (SELECT milestone_id FROM plan_milestones WHERE id = ?)").bind(plan_version_id).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(rows)
}
