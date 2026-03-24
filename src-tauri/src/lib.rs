mod commands;
mod db;
mod evm;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let pool = tauri::async_runtime::block_on(db::init_db(&app_handle))
                .expect("database initialization failed");
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::create_project,
            commands::add_wbs_element,
            commands::list_wbs_elements,
            commands::list_projects,
            commands::list_plan_versions_for_project,
            commands::update_wbs_element_pv,
            commands::list_pv_allocations_for_wbs_element,
            commands::add_pv_allocation,
            commands::update_pv_allocation,
            commands::delete_pv_allocation,
            commands::list_allocations_for_period,
            commands::upsert_daily_allocation,
            commands::create_baseline,
            commands::add_actual_cost,
            commands::get_actual_costs_for_element,
            commands::add_progress_update,
            commands::get_progress_updates_for_element,
            commands::get_evm_kpis,
            commands::get_s_curve_data,
            commands::get_filterable_wbs_nodes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
