mod core;

use core::{AppCore, BatchOperationResult, BatchPreview, Snapshot};
use std::sync::Mutex;
use tauri::{Manager, State};

fn with_core<T>(
    state: State<'_, Mutex<AppCore>>,
    operation: impl FnOnce(&mut AppCore) -> Result<T, String>,
) -> Result<T, String> {
    let mut core = state
        .lock()
        .map_err(|_| "应用状态暂时不可用，请重新启动".to_string())?;
    operation(&mut core)
}

#[tauri::command(async)]
fn get_snapshot(state: State<'_, Mutex<AppCore>>) -> Result<Snapshot, String> {
    with_core(state, |core| core.snapshot())
}

#[tauri::command(async)]
fn add_source(
    state: State<'_, Mutex<AppCore>>,
    path: String,
    expected_kind: Option<String>,
) -> Result<Snapshot, String> {
    with_core(state, |core| match expected_kind.as_deref() {
        Some(expected_kind) => core.add_source_with_kind(&path, Some(expected_kind)),
        None => core.add_source(&path),
    })
}

#[tauri::command(async)]
fn forget_source(state: State<'_, Mutex<AppCore>>, path: String) -> Result<Snapshot, String> {
    with_core(state, |core| core.forget_source(&path))
}

#[tauri::command(async)]
fn add_root(state: State<'_, Mutex<AppCore>>, path: String) -> Result<Snapshot, String> {
    with_core(state, |core| core.add_root(&path))
}

#[tauri::command(async)]
fn remove_root(state: State<'_, Mutex<AppCore>>, path: String) -> Result<Snapshot, String> {
    with_core(state, |core| core.remove_root(&path))
}

#[tauri::command(async)]
fn create_link(
    state: State<'_, Mutex<AppCore>>,
    source: String,
    folder: String,
    name: String,
) -> Result<Snapshot, String> {
    with_core(state, |core| core.create_link(&source, &folder, &name))
}

#[tauri::command(async)]
fn delete_link(state: State<'_, Mutex<AppCore>>, path: String) -> Result<Snapshot, String> {
    with_core(state, |core| core.delete_link(&path))
}

#[tauri::command(async)]
fn set_source_tags(
    state: State<'_, Mutex<AppCore>>,
    path: String,
    tags: Vec<String>,
) -> Result<Snapshot, String> {
    with_core(state, |core| core.set_source_tags(&path, tags))
}

#[tauri::command(async)]
fn preview_batch_create(
    state: State<'_, Mutex<AppCore>>,
    sources: Vec<String>,
    folder: String,
) -> Result<BatchPreview, String> {
    with_core(state, |core| core.preview_batch_create(sources, folder))
}

#[tauri::command(async)]
fn batch_create_links(
    state: State<'_, Mutex<AppCore>>,
    sources: Vec<String>,
    folder: String,
) -> Result<BatchOperationResult, String> {
    with_core(state, |core| core.batch_create_links(sources, folder))
}

#[tauri::command(async)]
fn preview_batch_delete(
    state: State<'_, Mutex<AppCore>>,
    sources: Vec<String>,
) -> Result<BatchPreview, String> {
    with_core(state, |core| core.preview_batch_delete(sources))
}

#[tauri::command(async)]
fn batch_delete_links(
    state: State<'_, Mutex<AppCore>>,
    sources: Vec<String>,
    paths: Vec<String>,
) -> Result<BatchOperationResult, String> {
    with_core(state, |core| core.batch_delete_links(sources, paths))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_path = app.path().app_data_dir()?.join("registry.json");
            let core = AppCore::open(config_path).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(core));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            add_source,
            forget_source,
            add_root,
            remove_root,
            create_link,
            delete_link,
            set_source_tags,
            preview_batch_create,
            batch_create_links,
            preview_batch_delete,
            batch_delete_links
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SoftConnet");
}
