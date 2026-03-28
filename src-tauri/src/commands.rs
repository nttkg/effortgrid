use crate::db::{
    self, ActualCost, ActualCostBulkItem, DailyAllocationBulkItem, PlanVersion,
    Portfolio, ProgressUpdate, PvAllocation, SqlitePool, User, WbsElementDetail,
};
use crate::evm;
use crate::settings::{self, AppSettings};
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
pub struct UpdateWbsElementDetailsPayload {
    id: i64,
    title: String,
    description: Option<String>,
    element_type: db::WbsElementType,
    tags: Option<Vec<String>>,
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

use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappedImportRow {
    pub wbs_id: Option<i64>,
    pub hierarchy: Vec<String>, // L1〜L10まで、存在する階層の文字列配列
    pub estimated_pv: Option<f64>,
    pub assignee: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub element_type: Option<db::WbsElementType>,
    pub daily_pvs: HashMap<NaiveDate, f64>,
    pub daily_acs: HashMap<NaiveDate, f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMappedWbsPayload {
    pub plan_version_id: i64,
    pub rows: Vec<MappedImportRow>,
}


// ----- Tauri Commands -----

#[tauri::command]
pub async fn create_portfolio(
    state: State<'_, crate::db::AppState>,
    name: String,
) -> AppResult<CreatePortfolioResult> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let (portfolio, plan_version) = db::create_portfolio(pool, &name).await?;
    Ok(CreatePortfolioResult {
        portfolio,
        initial_plan_version: plan_version,
    })
}

#[tauri::command]
pub async fn add_wbs_element(
    state: State<'_, crate::db::AppState>,
    payload: AddWbsElementPayload,
) -> AppResult<WbsElementDetail> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let new_element = db::add_wbs_element(
        pool,
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
    state: State<'_, crate::db::AppState>,
    plan_version_id: i64,
) -> AppResult<Vec<WbsElementDetail>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let elements = db::list_wbs_elements(pool, plan_version_id).await?;
    Ok(elements)
}

#[tauri::command]
pub async fn list_portfolios(state: State<'_, crate::db::AppState>) -> AppResult<Vec<Portfolio>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let portfolios = db::list_portfolios(pool).await?;
    Ok(portfolios)
}

#[tauri::command]
pub async fn list_plan_versions_for_portfolio(
    state: State<'_, crate::db::AppState>,
    portfolio_id: i64,
) -> AppResult<Vec<PlanVersion>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let versions = db::list_plan_versions_for_portfolio(pool, portfolio_id).await?;
    Ok(versions)
}

#[tauri::command]
pub async fn update_wbs_element_pv(
    state: State<'_, crate::db::AppState>,
    payload: UpdateWbsElementPvPayload,
) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    // ARCHITECTURE.md: "末端入力の原則" を適用
    let element_type: String =
        sqlx::query_scalar("SELECT element_type FROM wbs_element_details WHERE id = ?")
            .bind(payload.id)
            .fetch_one(pool)
            .await
            .map_err(db::DbError::from)?;

    if element_type != "Activity" {
        return Err(AppError::DbError(
            "PV can only be estimated for 'Activity' elements.".to_string(),
        ));
    }

    db::update_wbs_element_pv(pool, payload.id, payload.estimated_pv).await?;
    Ok(())
}

#[tauri::command]
pub async fn update_wbs_element_details(
    state: State<'_, crate::db::AppState>,
    payload: UpdateWbsElementDetailsPayload,
) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let tags_json = payload.tags.map(|t| serde_json::to_string(&t).unwrap_or_default());
    db::update_wbs_element_details(
        pool,
        payload.id,
        &payload.title,
        payload.description.as_deref(),
        payload.element_type,
        tags_json.as_deref(),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_pv_allocations_for_wbs_element(
    state: State<'_, crate::db::AppState>,
    payload: ListPvAllocationsPayload,
) -> AppResult<Vec<PvAllocation>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let allocations = db::list_pv_allocations_for_wbs_element(
        pool,
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
    state: State<'_, crate::db::AppState>,
    payload: AddPvAllocationPayload,
) -> AppResult<PvAllocation> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    check_is_activity(pool, payload.wbs_element_id, payload.plan_version_id).await?;

    let new_allocation = db::add_pv_allocation(
        pool,
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
    state: State<'_, crate::db::AppState>,
    payload: UpdatePvAllocationPayload,
) -> AppResult<PvAllocation> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    // No need to check type on update, as it's an existing allocation linked to an activity.
    let updated_allocation = db::update_pv_allocation(
        pool,
        payload.id,
        payload.start_date,
        payload.end_date,
        payload.planned_value,
    )
    .await?;
    Ok(updated_allocation)
}

#[tauri::command]
pub async fn delete_pv_allocation(state: State<'_, crate::db::AppState>, id: i64) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    db::delete_pv_allocation(pool, id).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_all_allocations_for_plan_version(
    state: State<'_, crate::db::AppState>,
    plan_version_id: i64,
) -> AppResult<Vec<PvAllocation>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let allocations = db::list_all_allocations_for_plan_version(pool, plan_version_id).await?;
    Ok(allocations)
}

#[tauri::command]
pub async fn list_all_actuals_for_plan_version(
    state: State<'_, crate::db::AppState>,
    plan_version_id: i64,
) -> AppResult<Vec<ActualCost>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let actuals = db::list_all_actuals_for_plan_version(pool, plan_version_id).await?;
    Ok(actuals)
}

#[tauri::command]
pub async fn list_allocations_for_period(
    state: State<'_, crate::db::AppState>,
    payload: ListAllocationsForPeriodPayload,
) -> AppResult<Vec<PvAllocation>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let allocations = db::list_allocations_for_period(
        pool,
        payload.plan_version_id,
        payload.start_date,
        payload.end_date,
    )
    .await?;
    Ok(allocations)
}

#[tauri::command]
pub async fn upsert_daily_allocation(
    state: State<'_, crate::db::AppState>,
    payload: UpsertDailyAllocationPayload,
) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    check_is_activity(pool, payload.wbs_element_id, payload.plan_version_id).await?;

    db::upsert_daily_allocation(
        pool,
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
    state: State<'_, crate::db::AppState>,
    payload: UpsertDailyAllocationsBulkPayload,
) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let wbs_ids: Vec<i64> = payload.allocations.iter().map(|a| a.wbs_element_id).collect();
    check_are_activities(pool, &wbs_ids, payload.plan_version_id).await?;

    db::upsert_daily_allocations_bulk(pool, payload.plan_version_id, &payload.allocations).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_baseline(
    state: State<'_, crate::db::AppState>,
    payload: CreateBaselinePayload,
) -> AppResult<PlanVersion> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let new_baseline =
        db::create_baseline(pool, payload.portfolio_id, &payload.baseline_name).await?;
    Ok(new_baseline)
}

#[tauri::command]
pub async fn add_actual_cost(
    state: State<'_, crate::db::AppState>,
    payload: AddActualCostPayload,
) -> AppResult<ActualCost> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    check_is_activity_in_draft(pool, payload.wbs_element_id).await?;
    let record = db::add_actual_cost(
        pool,
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
    state: State<'_, crate::db::AppState>,
    payload: UpsertActualCostPayload,
) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    check_is_activity_in_draft(pool, payload.wbs_element_id).await?;
    db::upsert_actual_cost(
        pool,
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
    state: State<'_, crate::db::AppState>,
    payload: UpsertActualCostsBulkPayload,
) -> AppResult<()> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let wbs_ids: Vec<i64> = payload.costs.iter().map(|c| c.wbs_element_id).collect();
    check_are_activities_in_draft(pool, &wbs_ids).await?;

    db::upsert_actual_costs_bulk(pool, &payload.costs).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_actual_costs_for_element(
    state: State<'_, crate::db::AppState>,
    wbs_element_id: i64,
) -> AppResult<Vec<ActualCost>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let records = db::get_actual_costs_for_element(pool, wbs_element_id).await?;
    Ok(records)
}

#[tauri::command]
pub async fn add_progress_update(
    state: State<'_, crate::db::AppState>,
    payload: AddProgressUpdatePayload,
) -> AppResult<ProgressUpdate> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    check_is_activity_in_draft(pool, payload.wbs_element_id).await?;
    // For now, hardcode user_id as 1.
    let user_id = 1;
    let record = db::add_progress_update(
        pool,
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
    state: State<'_, crate::db::AppState>,
    wbs_element_id: i64,
) -> AppResult<Vec<ProgressUpdate>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let records = db::get_progress_updates_for_element(pool, wbs_element_id).await?;
    Ok(records)
}

#[tauri::command]
pub async fn get_evm_kpis(
    state: State<'_, crate::db::AppState>,
    payload: GetEvmKpisPayload,
) -> AppResult<evm::EvmKpis> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let kpis = evm::calculate_evm_kpis(pool, &payload.filter, payload.date).await?;
    Ok(kpis)
}

#[tauri::command]
pub async fn get_s_curve_data(
    state: State<'_, crate::db::AppState>,
    payload: GetSCurveDataPayload,
) -> AppResult<Vec<evm::SCurveDataPoint>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let data = evm::calculate_s_curve_data(pool, &payload.filter, payload.granularity).await?;
    Ok(data)
}

#[tauri::command]
pub async fn get_execution_data(
    state: State<'_, crate::db::AppState>,
    payload: GetExecutionDataPayload,
) -> AppResult<ExecutionDataResult> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let pv_allocations = db::list_allocations_for_period(
        pool,
        payload.plan_version_id,
        payload.start_date,
        payload.end_date,
    )
    .await?;

    let actual_costs =
        db::list_actuals_for_period(pool, payload.plan_version_id, payload.start_date, payload.end_date)
            .await?;

    Ok(ExecutionDataResult {
        pv_allocations,
        actual_costs,
    })
}

#[tauri::command]
pub async fn import_mapped_wbs(
    state: State<'_, crate::db::AppState>,
    payload: ImportMappedWbsPayload,
) -> AppResult<usize> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let mut tx = pool.begin().await.map_err(db::DbError::from)?;
    let plan_version_id = payload.plan_version_id;

    let portfolio_id: i64 =
        sqlx::query_scalar("SELECT portfolio_id FROM plan_versions WHERE id = ?")
            .bind(plan_version_id)
            .fetch_one(&mut *tx)
            .await.map_err(db::DbError::from)?;

    // Caches for performance
    let mut user_cache: HashMap<String, i64> = HashMap::new();
    let users = db::list_users(&mut *tx).await?;
    for user in users {
        user_cache.insert(user.name.clone(), user.id);
    }
    let mut wbs_cache: HashMap<(Option<i64>, String), i64> = HashMap::new();

    for row in &payload.rows {
        let activity_wbs_id_opt: Option<i64> = if let Some(id) = row.wbs_id {
            Some(id)
        } else {
            if row.hierarchy.is_empty() { continue; }

            let mut parent_wbs_id: Option<i64> = None;
            for (i, title) in row.hierarchy.iter().enumerate() {
                let cache_key = (parent_wbs_id, title.clone());
                if let Some(cached_id) = wbs_cache.get(&cache_key) {
                    parent_wbs_id = Some(*cached_id);
                } else {
                     let existing_element: Option<(i64,)> = if let Some(id) = parent_wbs_id {
                        sqlx::query_as("SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ? AND title = ? AND parent_element_id = ?")
                            .bind(plan_version_id).bind(title).bind(id)
                            .fetch_optional(&mut *tx).await.map_err(db::DbError::from)?
                    } else {
                        sqlx::query_as("SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ? AND title = ? AND parent_element_id IS NULL")
                            .bind(plan_version_id).bind(title)
                            .fetch_optional(&mut *tx).await.map_err(db::DbError::from)?
                    };

                    let wbs_element_id = if let Some((id,)) = existing_element {
                        id
                    } else {
                        let new_wbs_id =
                            sqlx::query("INSERT INTO wbs_elements (portfolio_id) VALUES (?)")
                                .bind(portfolio_id).execute(&mut *tx).await.map_err(db::DbError::from)?
                                .last_insert_rowid();

                        let element_type = if i == row.hierarchy.len() - 1 { db::WbsElementType::Activity }
                            else if i == 0 { db::WbsElementType::Project }
                            else { db::WbsElementType::WorkPackage };

                        sqlx::query("INSERT INTO wbs_element_details (plan_version_id, wbs_element_id, parent_element_id, title, element_type) VALUES (?, ?, ?, ?, ?)")
                            .bind(plan_version_id).bind(new_wbs_id).bind(parent_wbs_id).bind(title).bind(element_type)
                            .execute(&mut *tx).await.map_err(db::DbError::from)?;
                        
                        new_wbs_id
                    };
                    wbs_cache.insert(cache_key, wbs_element_id);
                    parent_wbs_id = Some(wbs_element_id);
                }
            }
            parent_wbs_id
        };

        if let Some(activity_wbs_id) = activity_wbs_id_opt {
            // --- Update details for the identified WBS element ---
            let mut updates: Vec<&str> = Vec::new();
            if row.description.is_some() { updates.push("description = ?"); }
            if row.tags.is_some() { updates.push("tags = ?"); }
            if row.element_type.is_some() { updates.push("element_type = ?"); }
            if row.estimated_pv.is_some() { updates.push("estimated_pv = ?"); }
            
            if !updates.is_empty() {
                let sql = format!("UPDATE wbs_element_details SET {} WHERE plan_version_id = ? AND wbs_element_id = ?", updates.join(", "));
                let mut query = sqlx::query(&sql);
                if let Some(d) = &row.description { query = query.bind(d); }
                if let Some(t) = &row.tags {
                    let tags_json = serde_json::to_string(t).map_err(|e| AppError::DbError(e.to_string()))?;
                    query = query.bind(tags_json);
                }
                if let Some(et) = &row.element_type { query = query.bind(et); }
                if let Some(pv) = row.estimated_pv { query = query.bind(pv); }

                query.bind(plan_version_id).bind(activity_wbs_id)
                    .execute(&mut *tx).await.map_err(db::DbError::from)?;
            }

            // --- Get or create user ---
            let user_id: Option<i64> = if let Some(assignee) = &row.assignee {
                if let Some(id) = user_cache.get(assignee) { Some(*id) }
                else {
                    let new_user = db::add_user_tx(&mut tx, assignee, "Member", None, None).await?;
                    user_cache.insert(assignee.clone(), new_user.id);
                    Some(new_user.id)
                }
            } else { None };
            
            // --- Upsert PVs and ACs ---
            for (&date, &pv) in &row.daily_pvs {
                db::upsert_daily_allocation_tx(&mut tx, plan_version_id, activity_wbs_id, user_id, date, Some(pv)).await?;
            }
            if let Some(uid) = user_id { // AC requires a user
                for (&date, &ac) in &row.daily_acs {
                    db::upsert_actual_cost_tx(&mut tx, activity_wbs_id, uid, date, Some(ac)).await?;
                }
            }
        }
    }

    tx.commit().await.map_err(db::DbError::from)?;
    Ok(payload.rows.len())
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
pub async fn add_user(state: State<'_, crate::db::AppState>, payload: UserPayload) -> AppResult<User> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let new_user =
        db::add_user(pool, &payload.name, &payload.role, payload.email.as_deref(), payload.daily_capacity)
            .await?;
    Ok(new_user)
}

#[tauri::command]
pub async fn update_user(
    state: State<'_, crate::db::AppState>,
    payload: UpdateUserPayload,
) -> AppResult<User> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let updated_user = db::update_user(
        pool,
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
pub async fn delete_user(state: State<'_, crate::db::AppState>, id: i64) -> AppResult<u64> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let rows_affected = db::delete_user(pool, id).await?;
    Ok(rows_affected)
}

#[tauri::command]
pub async fn list_users(state: State<'_, crate::db::AppState>) -> AppResult<Vec<User>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let users = db::list_users(pool).await?;
    Ok(users)
}

#[tauri::command]
pub async fn get_filterable_wbs_nodes(
    state: State<'_, crate::db::AppState>,
    plan_version_id: i64,
) -> AppResult<Vec<WbsElementDetail>> {
    let pool_guard = state.pool.read().await;
    let pool = pool_guard.as_ref().ok_or_else(|| AppError::DbError("No database is currently open".to_string()))?;
    let nodes = db::get_filterable_wbs_nodes(pool, plan_version_id).await?;
    Ok(nodes)
}

#[tauri::command]
pub async fn open_database_file(
    state: State<'_, crate::db::AppState>,
    app_handle: tauri::AppHandle,
    path: String,
) -> AppResult<()> {
    let new_pool = crate::db::connect_db(&path).await?;
    
    // プールとパスを更新
    let mut pool_guard = state.pool.write().await;
    let mut path_guard = state.current_db_path.write().await;
    *pool_guard = Some(new_pool);
    *path_guard = Some(path.clone());

    // 設定の履歴を更新
    let mut settings = crate::settings::load_settings(&app_handle);
    settings.recent_db_paths.retain(|p| p != &path);
    settings.recent_db_paths.insert(0, path.clone());
    let _ = crate::settings::save_settings(&app_handle, &settings);

    Ok(())
}

#[tauri::command]
pub async fn get_current_db_path(state: State<'_, crate::db::AppState>) -> Result<Option<String>, String> {
    let path_guard = state.current_db_path.read().await;
    Ok(path_guard.clone())
}

#[tauri::command]
pub async fn get_settings(app_handle: tauri::AppHandle) -> Result<crate::settings::AppSettings, String> {
    Ok(crate::settings::load_settings(&app_handle))
}

#[tauri::command]
pub async fn update_settings(app_handle: tauri::AppHandle, settings: crate::settings::AppSettings) -> Result<(), String> {
    crate::settings::save_settings(&app_handle, &settings)?;
    Ok(())
}
