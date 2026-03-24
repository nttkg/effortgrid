use crate::db::{self, DbResult, SqlitePool};
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvmFilter {
    pub plan_version_id: i64,
    pub wbs_ids: Option<Vec<i64>>,
    pub user_ids: Option<Vec<i64>>,
    pub milestone_ids: Option<Vec<i64>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Granularity {
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Serialize, FromRow, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvmKpis {
    pub bac: f64,
    pub pv: f64,
    pub ev: f64,
    pub ac: f64,
    pub cpi: f64,
    pub spi: f64,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SCurveDataPoint {
    pub date: String,
    pub cumulative_pv: f64,
    pub cumulative_ev: f64,
    pub cumulative_ac: f64,
    pub bac: f64,
    pub planned_etc: f64,
    pub actual_etc: f64,
}

#[derive(FromRow)]
struct ActivityInfo {
    wbs_element_id: i64,
    estimated_pv: Option<f64>,
}

#[derive(FromRow)]
struct ProgressInfo {
    progress_percent: f64,
}

async fn get_filtered_activity_ids(pool: &SqlitePool, filter: &EvmFilter) -> DbResult<Vec<i64>> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ",
    );
    qb.push_bind(filter.plan_version_id)
        .push(" AND element_type = 'Activity' ");

    if let Some(wbs_ids) = filter.wbs_ids.as_ref().filter(|v| !v.is_empty()) {
        let wbs_ids_json = serde_json::to_string(wbs_ids).unwrap();
        qb.push(" AND wbs_element_id IN (WITH RECURSIVE descendants(id) AS (SELECT value as id FROM json_each(")
            .push_bind(wbs_ids_json)
            .push(") UNION SELECT wed.wbs_element_id FROM wbs_element_details wed JOIN descendants ON wed.parent_element_id = descendants.id WHERE wed.plan_version_id = ")
            .push_bind(filter.plan_version_id)
            .push(") SELECT id FROM descendants) ");
    }
    
    if let Some(milestone_ids) = filter.milestone_ids.as_ref().filter(|v| !v.is_empty()) {
        let milestone_ids_json = serde_json::to_string(milestone_ids).unwrap();
        qb.push(" AND wbs_element_id IN (WITH RECURSIVE descendants(id) AS (SELECT wbs_element_id FROM wbs_element_details WHERE plan_version_id = ")
            .push_bind(filter.plan_version_id)
            .push(" AND milestone_id IN (SELECT value FROM json_each(")
            .push_bind(milestone_ids_json)
            .push(")) UNION SELECT wed.wbs_element_id FROM wbs_element_details wed JOIN descendants ON wed.parent_element_id = descendants.id WHERE wed.plan_version_id = ")
            .push_bind(filter.plan_version_id)
            .push(") SELECT id FROM descendants) ");
    }

    if let Some(user_ids) = filter.user_ids.as_ref().filter(|v| !v.is_empty()) {
        let user_ids_json = serde_json::to_string(user_ids).unwrap();
        qb.push(" AND EXISTS (SELECT 1 FROM pv_allocations pa WHERE pa.wbs_element_id = wbs_element_details.wbs_element_id AND pa.plan_version_id = ")
            .push_bind(filter.plan_version_id)
            .push(" AND pa.user_id IN (SELECT value FROM json_each(")
            .push_bind(user_ids_json)
            .push("))) ");
    }
    
    if let Some(tags) = filter.tags.as_ref().filter(|v| !v.is_empty()) {
        let tags_json = serde_json::to_string(tags).unwrap();
        qb.push(" AND json_valid(tags) AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value IN (SELECT value FROM json_each(")
            .push_bind(tags_json)
            .push("))) ");
    }

    let activity_ids: Vec<(i64,)> = qb.build_query_as().fetch_all(pool).await?;
    Ok(activity_ids.into_iter().map(|(id,)| id).collect())
}

pub async fn calculate_evm_kpis(
    pool: &SqlitePool,
    filter: &EvmFilter,
    up_to_date: NaiveDate,
) -> DbResult<EvmKpis> {
    let activity_ids = get_filtered_activity_ids(pool, filter).await?;
    if activity_ids.is_empty() {
        return Ok(EvmKpis::default());
    }
    let plan_version_id = filter.plan_version_id;

    let activity_ids_json =
        serde_json::to_string(&activity_ids).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

    let activities: Vec<ActivityInfo> = sqlx::query_as(
        "SELECT wbs_element_id, estimated_pv FROM wbs_element_details WHERE plan_version_id = ? AND wbs_element_id IN (SELECT value FROM json_each(?))",
    )
    .bind(plan_version_id)
    .bind(&activity_ids_json)
    .fetch_all(pool)
    .await?;

    // 1. BAC (Budget at Completion)
    let bac = activities.iter().filter_map(|a| a.estimated_pv).sum();

    // 2. PV (Planned Value)
    let pv_row: (Option<f64>,) = sqlx::query_as(
        "SELECT SUM(planned_value) FROM pv_allocations WHERE plan_version_id = ? AND end_date <= ? AND wbs_element_id IN (SELECT value FROM json_each(?))",
    )
    .bind(plan_version_id)
    .bind(up_to_date)
    .bind(&activity_ids_json)
    .fetch_one(pool)
    .await?;
    let pv = pv_row.0.unwrap_or(0.0);

    // 3. AC (Actual Cost)
    let ac_row: (Option<f64>,) = sqlx::query_as(
        "SELECT SUM(actual_cost) FROM actual_costs WHERE wbs_element_id IN (SELECT value FROM json_each(?)) AND work_date <= ?",
    )
    .bind(&activity_ids_json)
    .bind(up_to_date)
    .fetch_one(pool)
    .await?;
    let ac = ac_row.0.unwrap_or(0.0);

    // 4. EV (Earned Value)
    let mut ev = 0.0;
    for activity in &activities {
        let activity_bac = activity.estimated_pv.unwrap_or(0.0);
        if activity_bac > 0.0 {
            let progress_row: Option<ProgressInfo> = sqlx::query_as(
                "SELECT progress_percent FROM progress_updates WHERE wbs_element_id = ? AND report_date <= ? ORDER BY report_date DESC, id DESC LIMIT 1",
            )
            .bind(activity.wbs_element_id)
            .bind(up_to_date)
            .fetch_optional(pool)
            .await?;
            
            if let Some(progress) = progress_row {
                ev += activity_bac * (progress.progress_percent / 100.0);
            }
        }
    }

    // 5. CPI & SPI
    let cpi = if ac > 0.0 { ev / ac } else { 0.0 };
    let spi = if pv > 0.0 { ev / pv } else { 0.0 };

    Ok(EvmKpis { bac, pv, ev, ac, cpi, spi })
}

fn end_of_month(date: NaiveDate) -> NaiveDate {
    let next_month_start = if date.month() == 12 {
        date.with_year(date.year() + 1)
            .unwrap()
            .with_month(1)
            .unwrap()
    } else {
        date.with_month(date.month() + 1).unwrap()
    };
    next_month_start.with_day(1).unwrap() - Duration::days(1)
}

pub async fn calculate_s_curve_data(
    pool: &SqlitePool,
    filter: &EvmFilter,
    granularity: Granularity,
) -> DbResult<Vec<SCurveDataPoint>> {
    let activity_ids = get_filtered_activity_ids(pool, filter).await?;
    if activity_ids.is_empty() {
        return Ok(vec![]);
    }
    let plan_version_id = filter.plan_version_id;
    
    let activity_ids_json =
        serde_json::to_string(&activity_ids).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

    let range: Option<(Option<NaiveDate>, Option<NaiveDate>)> = sqlx::query_as(
        r#"
        SELECT MIN(t.d), MAX(t.d) FROM (
            SELECT start_date as d FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id IN (SELECT value FROM json_each(?))
            UNION ALL
            SELECT work_date as d FROM actual_costs WHERE wbs_element_id IN (SELECT value FROM json_each(?))
        ) as t
        "#,
    )
    .bind(plan_version_id)
    .bind(&activity_ids_json)
    .bind(&activity_ids_json)
    .fetch_optional(pool)
    .await?;

    let (start_date, end_date) = match range {
        Some((Some(min), Some(max))) => (min, max),
        _ => return Ok(vec![]),
    };

    let all_activities: Vec<ActivityInfo> = sqlx::query_as(
        "SELECT wbs_element_id, estimated_pv FROM wbs_element_details WHERE plan_version_id = ? AND wbs_element_id IN (SELECT value FROM json_each(?))",
    )
    .bind(plan_version_id)
    .bind(&activity_ids_json)
    .fetch_all(pool)
    .await?;

    let bac: f64 = all_activities.iter().filter_map(|a| a.estimated_pv).sum();

    let all_allocations: Vec<(NaiveDate, f64)> = sqlx::query_as("SELECT end_date, planned_value FROM pv_allocations WHERE plan_version_id = ? AND wbs_element_id IN (SELECT value FROM json_each(?))")
        .bind(plan_version_id)
        .bind(&activity_ids_json)
        .fetch_all(pool)
        .await?;
    let all_costs: Vec<(NaiveDate, f64)> = sqlx::query_as("SELECT work_date, actual_cost FROM actual_costs WHERE wbs_element_id IN (SELECT value FROM json_each(?))").bind(&activity_ids_json).fetch_all(pool).await?;
    let all_progress: Vec<(i64, NaiveDate, f64)> = sqlx::query_as("SELECT wbs_element_id, report_date, progress_percent FROM progress_updates WHERE wbs_element_id IN (SELECT value FROM json_each(?)) ORDER BY report_date ASC, id ASC").bind(&activity_ids_json).fetch_all(pool).await?;
    
    let mut progress_map: BTreeMap<(i64, NaiveDate), f64> = BTreeMap::new();
    for (wbs_id, report_date, percent) in all_progress {
        progress_map.insert((wbs_id, report_date), percent);
    }
    
    let mut results = Vec::new();
    let mut date_points = Vec::<NaiveDate>::new();
    let mut current_date = start_date;

    match granularity {
        Granularity::Daily => {
            while current_date <= end_date {
                date_points.push(current_date);
                current_date += Duration::days(1);
            }
        }
        Granularity::Weekly => {
            while current_date <= end_date {
                let end_of_week = current_date + Duration::days(6 - current_date.weekday().num_days_from_sunday() as i64);
                date_points.push(if end_of_week > end_date { end_date } else { end_of_week });
                current_date = end_of_week + Duration::days(1);
            }
        }
        Granularity::Monthly => {
            while current_date <= end_date {
                let end_of_month = end_of_month(current_date);
                date_points.push(if end_of_month > end_date { end_date } else { end_of_month });
                current_date = end_of_month + Duration::days(1);
            }
        }
    }
    date_points.sort();
    date_points.dedup();

    for report_date in date_points {
        let cumulative_pv: f64 = all_allocations.iter().filter(|(d, _)| *d <= report_date).map(|(_, pv)| pv).sum();
        let cumulative_ac: f64 = all_costs.iter().filter(|(d, _)| *d <= report_date).map(|(_, ac)| ac).sum();

        let mut cumulative_ev = 0.0;
        for activity in &all_activities {
            let activity_bac = activity.estimated_pv.unwrap_or(0.0);
            if activity_bac > 0.0 {
                let latest_progress = progress_map
                    .range(..=((activity.wbs_element_id, report_date)))
                    .filter(|((wbs_id, _), _)| *wbs_id == activity.wbs_element_id)
                    .last()
                    .map(|(_, &percent)| percent);

                if let Some(percent) = latest_progress {
                    cumulative_ev += activity_bac * (percent / 100.0);
                }
            }
        }

        let planned_etc = (bac - cumulative_pv).max(0.0);
        let actual_etc = (bac - cumulative_ev).max(0.0);

        results.push(SCurveDataPoint {
            date: report_date.format(match granularity {
                Granularity::Monthly => "%Y-%m",
                _ => "%Y-%m-%d",
            }).to_string(),
            cumulative_pv,
            cumulative_ac,
            cumulative_ev,
            bac,
            planned_etc,
            actual_etc,
        });
    }

    Ok(results)
}
