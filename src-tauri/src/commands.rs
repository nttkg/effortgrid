use crate::db::{
    self, ActualCost, PlanMilestone, PlanVersion, Portfolio, ProgressUpdate, PvAllocation,
    SqlitePool, User, WbsElementDetail,
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
    date: NaiveDate,
    planned_value: Option<f64>,
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
        payload.date,
        payload.planned_value,
    )
    .await?;
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
    // For now, hardcode user_id as 1. User management is out of scope.
    let user_id = 1;
    let record =
        db::add_actual_cost(&pool, payload.wbs_element_id, user_id, payload.work_date, payload.actual_cost)
            .await?;
    Ok(record)
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
pub async fn list_users(pool: State<'_, SqlitePool>) -> AppResult<Vec<User>> {
    let users = db::list_users(&pool).await?;
    Ok(users)
}

#[tauri::command]
pub async fn list_plan_milestones(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<PlanMilestone>> {
    let milestones = db::list_plan_milestones(&pool, plan_version_id).await?;
    Ok(milestones)
}

#[tauri::command]
pub async fn list_all_tags_for_plan_version(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<String>> {
    let tags = db::list_all_tags_for_plan_version(&pool, plan_version_id).await?;
    Ok(tags)
}

#[tauri::command]
pub async fn get_filterable_wbs_nodes(
    pool: State<'_, SqlitePool>,
    plan_version_id: i64,
) -> AppResult<Vec<WbsElementDetail>> {
    let nodes = db::get_filterable_wbs_nodes(&pool, plan_version_id).await?;
    Ok(nodes)
}
