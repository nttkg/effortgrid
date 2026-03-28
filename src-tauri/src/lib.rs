mod commands;
mod db;
mod evm;
mod settings;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let settings = settings::load_settings(&app_handle);
            
            let mut initial_pool = None;
            let mut initial_path = None;
            
            // 履歴の最初のパスを開いてみる
            if let Some(path) = settings.recent_db_paths.first() {
                if let Ok(pool) = tauri::async_runtime::block_on(db::connect_db(path)) {
                    initial_pool = Some(pool);
                    initial_path = Some(path.clone());
                }
            }
            
            app.manage(db::AppState {
                pool: tokio::sync::RwLock::new(initial_pool),
                current_db_path: tokio::sync::RwLock::new(initial_path),
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::create_portfolio,
            commands::add_wbs_element,
            commands::list_wbs_elements,
            commands::list_portfolios,
            commands::list_plan_versions_for_portfolio,
            commands::update_wbs_element_pv,
            commands::update_wbs_element_details,
            commands::list_pv_allocations_for_wbs_element,
            commands::add_pv_allocation,
            commands::update_pv_allocation,
            commands::delete_pv_allocation,
            commands::list_all_allocations_for_plan_version,
            commands::list_all_actuals_for_plan_version,
            commands::list_allocations_for_period,
            commands::upsert_daily_allocation,
            commands::upsert_daily_allocations_bulk,
            commands::create_baseline,
            commands::add_actual_cost,
            commands::upsert_actual_cost,
            commands::upsert_actual_costs_bulk,
            commands::get_actual_costs_for_element,
            commands::add_progress_update,
            commands::get_progress_updates_for_element,
            commands::get_evm_kpis,
            commands::get_s_curve_data,
            commands::get_execution_data,
            commands::import_mapped_wbs,
            commands::get_filterable_wbs_nodes,
            commands::get_settings,
            commands::update_settings,
            commands::open_database_file,
            commands::get_current_db_path,
            // User Management Commands
            commands::list_users,
            commands::add_user,
            commands::update_user,
            commands::delete_user
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
