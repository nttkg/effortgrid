use crate::db::{
    self, ActualCost, ActualCostBulkItem, DailyAllocationBulkItem, PlanVersion,
    Portfolio, ProgressUpdate, PvAllocation, SqlitePool, User, WbsElementDetail,
};
use crate::evm;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tauri::State;

// ----- Custom Error Type -----

#[derive(Debug, thiserror::Error, Serialize)]
pub enum AppError {
    #[error("Database error: {0}")]
    DbError(String),
}

impl From<db::DbError> for AppError {
    fn from(e: db::DbError) -> Self {
        AppError::DbError(e.to_string())
    }
}

type AppResult<T> = Result<T, AppError>;

// ----- Command Payloads & Results -----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortfolioResult {
    portfolio: Portfolio,
    initial_plan_version: PlanVersion,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWbsElementPayload {
    plan_version_id: i64,
    parent_element_id: Option<i64>,
    milestone_id: Option<i64>,
    title: String,
    description: Option<String>,
    element_type: db::WbsElementType,
    estimated_pv: Option<f64>,
    tags: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWbsElementPvPayload {
    id: i64,
    estimated_pv: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPvAllocationsPayload {
    wbs_element_id: i64,
    plan_version_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPvAllocationPayload {
    plan_version_id: i64,
    wbs_element_id: i64,
    user_id: Option<i64>,
    start_date: NaiveDate,
    end_date: NaiveDate,
    planned_value: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePvAllocationPayload {
    id: i64,
    start_date: NaiveDate,
    end_date: NaiveDate,
    planned_value: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAllocationsForPeriodPayload {
    plan_version_id: i64,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDailyAllocationPayload {
    plan_version_id: i64,
    wbs_element_id: i64,
    user_id: Option<i64>,
    date: NaiveDate,
    planned_value: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertActualCostPayload {
    wbs_element_id: i64,
    user_id: i64,
    work_date: NaiveDate,
    actual_cost: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDailyAllocationsBulkPayload {
    plan_version_id: i64,
    allocations: Vec<DailyAllocationBulkItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertActualCostsBulkPayload {
    costs: Vec<ActualCostBulkItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBaselinePayload {
    portfolio_id: i64,
    baseline_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddActualCostPayload {
    wbs_element_id: i64,
    user_id: i64,
    work_date: NaiveDate,
    actual_cost: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProgressUpdatePayload {
    wbs_element_id: i64,
    report_date: NaiveDate,
    progress_percent: f64,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetEvmKpisPayload {
    filter: evm::EvmFilter,
    date: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSCurveDataPayload {
    filter: evm::EvmFilter,
    granularity: evm::Granularity,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetExecutionDataPayload {
    plan_version_id: i64,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionDataResult {
    pv_allocations: Vec<PvAllocation>,
    actual_costs: Vec<ActualCost>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    level: u8,
    title: String,
    estimated_pv: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWbsDataPayload {
    plan_version_id: i64,
    rows: Vec<ImportRow>,
}


// ----- Tauri Commands -----

#[tauri::command]
pub async fn create_portfolio(
    pool: State<'_, SqlitePool>,
    name: String,
) -> AppResult<CreatePortfolioResult> {
    let (portfolio, plan_version) = db::create_portfolio(&pool, &name).await?;
    Ok(CreatePortfolioResult {
        portfolio,
        initial_plan_version: plan_version,
    })
}

#[tauri::command]
pub async fn add_wbs_element(
    pool: State<'_, SqlitePool>,
    payload: AddWbsElementPayload,
) -> AppResult<WbsElementDetail> {
    let new_element = db::add_wbs_element(
        &pool,
        payload.plan_version_id,
        payload.parent_element_id,
        payload.milestone_id,
        &payload.title,
        payload.description.as_deref(),
        payload.element_type,
        payload.estimated_pv,
        payload.tags.as_deref(),
    )
    .await?;
    Ok(new_element)
}

#[tauri::command]
pub async fn list_wbs_elements(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<WbsElementDetail>> {
    let elements = db::list_wbs_elements(&pool, plan_version_id).await?;
    Ok(elements)
}

#[tauri::command]
pub async fn list_portfolios(pool: State<'_, SqlitePool>) -> AppResult<Vec<Portfolio>> {
    let portfolios = db::list_portfolios(&pool).await?;
    Ok(portfolios)
}

#[tauri::command]
pub async fn list_plan_versions_for_portfolio(
    pool: State<'_, SqlitePool>,
    portfolio_id: i64,
) -> AppResult<Vec<PlanVersion>> {
    let versions = db::list_plan_versions_for_portfolio(&pool, portfolio_id).await?;
    Ok(versions)
}

#[tauri::command]
pub async fn update_wbs_element_pv(
    pool: State<'_, SqlitePool>,
    payload: UpdateWbsElementPvPayload,
) -> AppResult<()> {
    // ARCHITECTURE.md: "末端入力の原則" を適用
    let element_type: String =
        sqlx::query_scalar("SELECT element_type FROM wbs_element_details WHERE id = ?")
            .bind(payload.id)
            .fetch_one(&*pool)
            .await
            .map_err(db::DbError::from)?;

    if element_type != "Activity" {
        return Err(AppError::DbError(
            "PV can only be estimated for 'Activity' elements.".to_string(),
        ));
    }

    db::update_wbs_element_pv(&pool, payload.id, payload.estimated_pv).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_pv_allocations_for_wbs_element(
    pool: State<'_, SqlitePool>,
    payload: ListPvAllocationsPayload,
) -> AppResult<Vec<PvAllocation>> {
    let allocations = db::list_pv_allocations_for_wbs_element(
        &pool,
        payload.wbs_element_id,
        payload.plan_version_id,
    )
    .await?;
    Ok(allocations)
}

/// Checks if a WBS element is an 'Activity' in the portfolio's current draft plan.
async fn check_is_activity_in_draft(pool: &SqlitePool, wbs_element_id: i64) -> AppResult<()> {
    let (portfolio_id,): (i64,) = sqlx::query_as("SELECT portfolio_id FROM wbs_elements WHERE id = ?")
        .bind(wbs_element_id)
        .fetch_one(pool)
        .await
        .map_err(db::DbError::from)?;

    let (draft_plan_id,): (i64,) =
        sqlx::query_as("SELECT id FROM plan_versions WHERE portfolio_id = ? AND is_draft = true")
            .bind(portfolio_id)
            .fetch_one(pool)
            .await
            .map_err(db::DbError::from)?;

    let (element_type,): (String,) = sqlx::query_as(
        "SELECT element_type FROM wbs_element_details WHERE wbs_element_id = ? AND plan_version_id = ?",
    )
    .bind(wbs_element_id)
    .bind(draft_plan_id)
    .fetch_one(pool)
    .await
    .map_err(db::DbError::from)?;

    if element_type == "Activity" {
        Ok(())
    } else {
        Err(AppError::DbError(
            "Actual costs and progress can only be reported for 'Activity' elements.".to_string(),
        ))
    }
}

/// Efficiently checks if a list of WBS elements are all 'Activity' types in the draft plan.
async fn check_are_activities_in_draft(pool: &SqlitePool, wbs_element_ids: &[i64]) -> AppResult<()> {
    if wbs_element_ids.is_empty() {
        return Ok(());
    }

    let unique_ids: std::collections::HashSet<_> = wbs_element_ids.iter().collect();
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

    let activity_count = query.fetch_one(pool).await.map_err(db::DbError::from)?;

    if activity_count as usize == unique_ids.len() {
        Ok(())
    } else {
        Err(AppError::DbError(
            "All elements must be 'Activity' types in the current draft plan.".to_string(),
        ))
    }
}


async fn check_is_activity(
    pool: &SqlitePool,
    wbs_element_id: i64,
    plan_version_id: i64,
) -> AppResult<()> {
    let element_type: String =
        sqlx::query_scalar("SELECT element_type FROM wbs_element_details WHERE wbs_element_id = ? AND plan_version_id = ?")
            .bind(wbs_element_id)
            .bind(plan_version_id)
            .fetch_one(pool)
            .await
            .map_err(db::DbError::from)?;

    if element_type == "Activity" {
        Ok(())
    } else {
        Err(AppError::DbError(
            "PV allocations can only be managed for 'Activity' elements.".to_string(),
        ))
    }
}

/// Efficiently checks if a list of WBS elements are all 'Activity' types for a given plan version.
async fn check_are_activities(
    pool: &SqlitePool,
    wbs_element_ids: &[i64],
    plan_version_id: i64,
) -> AppResult<()> {
    if wbs_element_ids.is_empty() {
        return Ok(());
    }

    let unique_ids: std::collections::HashSet<_> = wbs_element_ids.iter().collect();
     if unique_ids.is_empty() {
        return Ok(());
    }

    let params = unique_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT COUNT(DISTINCT wbs_element_id) FROM wbs_element_details WHERE wbs_element_id IN ({}) AND plan_version_id = ? AND element_type = 'Activity'",
        params
    );

    let mut query = sqlx::query_scalar::<_, i64>(&sql);
    for id in &unique_ids {
        query = query.bind(id);
    }
    query = query.bind(plan_version_id);

    let activity_count = query.fetch_one(pool).await.map_err(db::DbError::from)?;

    if activity_count as usize == unique_ids.len() {
        Ok(())
    } else {
        Err(AppError::DbError(
            "All elements must be 'Activity' types for the given plan version.".to_string(),
        ))
    }
}

#[tauri::command]
pub async fn add_pv_allocation(
    pool: State<'_, SqlitePool>,
    payload: AddPvAllocationPayload,
) -> AppResult<PvAllocation> {
    check_is_activity(&pool, payload.wbs_element_id, payload.plan_version_id).await?;

    let new_allocation = db::add_pv_allocation(
        &pool,
        payload.plan_version_id,
        payload.wbs_element_id,
        payload.user_id,
        payload.start_date,
        payload.end_date,
        payload.planned_value,
    )
    .await?;
    Ok(new_allocation)
}

#[tauri::command]
pub async fn update_pv_allocation(
    pool: State<'_, SqlitePool>,
    payload: UpdatePvAllocationPayload,
) -> AppResult<PvAllocation> {
    // No need to check type on update, as it's an existing allocation linked to an activity.
    let updated_allocation = db::update_pv_allocation(
        &pool,
        payload.id,
        payload.start_date,
        payload.end_date,
        payload.planned_value,
    )
    .await?;
    Ok(updated_allocation)
}

#[tauri::command]
pub async fn delete_pv_allocation(pool: State<'_, SqlitePool>, id: i64) -> AppResult<()> {
    db::delete_pv_allocation(&pool, id).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_all_allocations_for_plan_version(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<PvAllocation>> {
    let allocations = db::list_all_allocations_for_plan_version(&pool, plan_version_id).await?;
    Ok(allocations)
}

#[tauri::command]
pub async fn list_all_actuals_for_plan_version(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<ActualCost>> {
    let actuals = db::list_all_actuals_for_plan_version(&pool, plan_version_id).await?;
    Ok(actuals)
}

#[tauri::command]
pub async fn list_allocations_for_period(
    pool: State<'_, SqlitePool>,
    payload: ListAllocationsForPeriodPayload,
) -> AppResult<Vec<PvAllocation>> {
    let allocations = db::list_allocations_for_period(
        &pool,
        payload.plan_version_id,
        payload.start_date,
        payload.end_date,
    )
    .await?;
    Ok(allocations)
}

#[tauri::command]
pub async fn upsert_daily_allocation(
    pool: State<'_, SqlitePool>,
    payload: UpsertDailyAllocationPayload,
) -> AppResult<()> {
    check_is_activity(&pool, payload.wbs_element_id, payload.plan_version_id).await?;

    db::upsert_daily_allocation(
        &pool,
        payload.plan_version_id,
        payload.wbs_element_id,
        payload.user_id,
        payload.date,
        payload.planned_value,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn upsert_daily_allocations_bulk(
    pool: State<'_, SqlitePool>,
    payload: UpsertDailyAllocationsBulkPayload,
) -> AppResult<()> {
    let wbs_ids: Vec<i64> = payload.allocations.iter().map(|a| a.wbs_element_id).collect();
    check_are_activities(&pool, &wbs_ids, payload.plan_version_id).await?;

    db::upsert_daily_allocations_bulk(&pool, payload.plan_version_id, &payload.allocations).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_baseline(
    pool: State<'_, SqlitePool>,
    payload: CreateBaselinePayload,
) -> AppResult<PlanVersion> {
    let new_baseline =
        db::create_baseline(&pool, payload.portfolio_id, &payload.baseline_name).await?;
    Ok(new_baseline)
}

#[tauri::command]
pub async fn add_actual_cost(
    pool: State<'_, SqlitePool>,
    payload: AddActualCostPayload,
) -> AppResult<ActualCost> {
    check_is_activity_in_draft(&pool, payload.wbs_element_id).await?;
    let record = db::add_actual_cost(
        &pool,
        payload.wbs_element_id,
        payload.user_id,
        payload.work_date,
        payload.actual_cost,
    )
    .await?;
    Ok(record)
}

#[tauri::command]
pub async fn upsert_actual_cost(
    pool: State<'_, SqlitePool>,
    payload: UpsertActualCostPayload,
) -> AppResult<()> {
    check_is_activity_in_draft(&pool, payload.wbs_element_id).await?;
    db::upsert_actual_cost(
        &pool,
        payload.wbs_element_id,
        payload.user_id,
        payload.work_date,
        payload.actual_cost,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn upsert_actual_costs_bulk(
    pool: State<'_, SqlitePool>,
    payload: UpsertActualCostsBulkPayload,
) -> AppResult<()> {
    let wbs_ids: Vec<i64> = payload.costs.iter().map(|c| c.wbs_element_id).collect();
    check_are_activities_in_draft(&pool, &wbs_ids).await?;

    db::upsert_actual_costs_bulk(&pool, &payload.costs).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_actual_costs_for_element(
    pool: State<'_, SqlitePool>,
    wbs_element_id: i64,
) -> AppResult<Vec<ActualCost>> {
    let records = db::get_actual_costs_for_element(&pool, wbs_element_id).await?;
    Ok(records)
}

#[tauri::command]
pub async fn add_progress_update(
    pool: State<'_, SqlitePool>,
    payload: AddProgressUpdatePayload,
) -> AppResult<ProgressUpdate> {
    check_is_activity_in_draft(&pool, payload.wbs_element_id).await?;
    // For now, hardcode user_id as 1.
    let user_id = 1;
    let record = db::add_progress_update(
        &pool,
        payload.wbs_element_id,
        user_id,
        payload.report_date,
        payload.progress_percent,
        payload.notes.as_deref(),
    )
    .await?;
    Ok(record)
}

#[tauri::command]
pub async fn get_progress_updates_for_element(
    pool: State<'_, SqlitePool>,
    wbs_element_id: i64,
) -> AppResult<Vec<ProgressUpdate>> {
    let records = db::get_progress_updates_for_element(&pool, wbs_element_id).await?;
    Ok(records)
}

#[tauri::command]
pub async fn get_evm_kpis(
    pool: State<'_, SqlitePool>,
    payload: GetEvmKpisPayload,
) -> AppResult<evm::EvmKpis> {
    let kpis = evm::calculate_evm_kpis(&pool, &payload.filter, payload.date).await?;
    Ok(kpis)
}

#[tauri::command]
pub async fn get_s_curve_data(
    pool: State<'_, SqlitePool>,
    payload: GetSCurveDataPayload,
) -> AppResult<Vec<evm::SCurveDataPoint>> {
    let data = evm::calculate_s_curve_data(&pool, &payload.filter, payload.granularity).await?;
    Ok(data)
}

#[tauri::command]
pub async fn get_execution_data(
    pool: State<'_, SqlitePool>,
    payload: GetExecutionDataPayload,
) -> AppResult<ExecutionDataResult> {
    let pv_allocations = db::list_allocations_for_period(
        &pool,
        payload.plan_version_id,
        payload.start_date,
        payload.end_date,
    )
    .await?;

    let actual_costs =
        db::list_actuals_for_period(&pool, payload.plan_version_id, payload.start_date, payload.end_date)
            .await?;

    Ok(ExecutionDataResult {
        pv_allocations,
        actual_costs,
    })
}

#[tauri::command]
pub async fn import_wbs_data(
    pool: State<'_, SqlitePool>,
    payload: ImportWbsDataPayload,
) -> AppResult<u64> { // Returns number of rows imported
    let mut tx = pool.begin().await.map_err(db::DbError::from)?;
    let mut current_project_id: Option<i64> = None;
    let mut current_wp_id: Option<i64> = None;
    let mut count = 0;

    let portfolio_id: i64 = sqlx::query_scalar("SELECT portfolio_id FROM plan_versions WHERE id = ?")
        .bind(payload.plan_version_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db::DbError::from)?;

    for row in payload.rows {
        let parent_id = match row.level {
            1 => None,
            2 => current_project_id,
            3 => current_wp_id,
            _ => return Err(AppError::DbError(format!("Invalid level '{}' for row '{}'. Level must be 1, 2, or 3.", row.level, row.title))),
        };

        let element_type = match row.level {
            1 => db::WbsElementType::Project,
            2 => db::WbsElementType::WorkPackage,
            3 => db::WbsElementType::Activity,
            _ => unreachable!(),
        };

        if row.level == 2 && parent_id.is_none() {
            return Err(AppError::DbError(format!(
                "Invalid hierarchy: WorkPackage '{}' cannot be created without a parent Project.",
                row.title
            )));
        }
        if row.level == 3 && parent_id.is_none() {
            return Err(AppError::DbError(format!(
                "Invalid hierarchy: Activity '{}' cannot be created without a parent WorkPackage.",
                row.title
            )));
        }

        // 1. Create the immutable wbs_element (Global ID)
        let wbs_element_id = sqlx::query("INSERT INTO wbs_elements (portfolio_id) VALUES (?)")
            .bind(portfolio_id)
            .execute(&mut *tx)
            .await
            .map_err(db::DbError::from)?
            .last_insert_rowid();

        // 2. Create the version-specific details for this plan version
        sqlx::query(
            "INSERT INTO wbs_element_details (plan_version_id, wbs_element_id, parent_element_id, title, element_type, estimated_pv)
                VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(payload.plan_version_id)
        .bind(wbs_element_id)
        .bind(parent_id)
        .bind(&row.title)
        .bind(element_type)
        .bind(row.estimated_pv)
        .execute(&mut *tx)
        .await
        .map_err(db::DbError::from)?;
        
        count += 1;

        match row.level {
            1 => {
                current_project_id = Some(wbs_element_id);
                current_wp_id = None; // Reset WorkPackage parent when a new Project starts
            },
            2 => current_wp_id = Some(wbs_element_id),
            3 => {}, // Activity does not become a parent
            _ => unreachable!(),
        }
    }

    tx.commit().await.map_err(db::DbError::from)?;
    Ok(count)
}

// ----- User Management -----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPayload {
    name: String,
    role: String,
    email: Option<String>,
    daily_capacity: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserPayload {
    id: i64,
    name: String,
    role: String,
    email: Option<String>,
    daily_capacity: Option<f64>,
}

#[tauri::command]
pub async fn add_user(pool: State<'_, SqlitePool>, payload: UserPayload) -> AppResult<User> {
    let new_user =
        db::add_user(&pool, &payload.name, &payload.role, payload.email.as_deref(), payload.daily_capacity)
            .await?;
    Ok(new_user)
}

#[tauri::command]
pub async fn update_user(
    pool: State<'_, SqlitePool>,
    payload: UpdateUserPayload,
) -> AppResult<User> {
    let updated_user = db::update_user(
        &pool,
        payload.id,
        &payload.name,
        &payload.role,
        payload.email.as_deref(),
        payload.daily_capacity,
    )
    .await?;
    Ok(updated_user)
}

#[tauri::command]
pub async fn delete_user(pool: State<'_, SqlitePool>, id: i64) -> AppResult<u64> {
    let rows_affected = db::delete_user(&pool, id).await?;
    Ok(rows_affected)
}

#[tauri::command]
pub async fn list_users(pool: State<'_, SqlitePool>) -> AppResult<Vec<User>> {
    let users = db::list_users(&pool).await?;
    Ok(users)
}

#[tauri::command]
pub async fn get_filterable_wbs_nodes(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<WbsElementDetail>> {
    let nodes = db::get_filterable_wbs_nodes(&pool, plan_version_id).await?;
    Ok(nodes)
}
