use tauri::{
    menu::{Menu, MenuItem},
    PhysicalPosition, PhysicalSize,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow,
};
use std::sync::Mutex;

const EXPANDED_MIN_WIDTH: f64 = 360.0;
const EXPANDED_MIN_HEIGHT: f64 = 640.0;
const COLLAPSED_WIDTH: f64 = 38.0;
const COLLAPSED_HEIGHT: f64 = 54.0;

#[derive(Clone, Copy)]
struct ExpandedWindow {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

struct CollapseState(Mutex<Option<ExpandedWindow>>);

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_collapsed(
    window: WebviewWindow,
    state: tauri::State<'_, CollapseState>,
    collapsed: bool,
) -> Result<(), String> {
    let mut expanded = state.0.lock().map_err(|_| "No se pudo acceder al estado de la ventana")?;

    if collapsed {
        // `set_size` cambia el área interior. Guardar `outer_size` aquí hacía que
        // la sombra/borde se sumara otra vez al expandir en cada ciclo.
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let position = window.outer_position().map_err(|error| error.to_string())?;
        *expanded = Some(ExpandedWindow { size, position });

        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let collapsed_width = (COLLAPSED_WIDTH * scale).round() as u32;
        let collapsed_height = (COLLAPSED_HEIGHT * scale).round() as u32;
        let monitor = window
            .current_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("No se encontró un monitor")?;
        let work_area = monitor.work_area();
        let margin = (10.0 * scale).round() as i32;
        let fixed_x = work_area.position.x + work_area.size.width as i32 - collapsed_width as i32 - margin;
        let fixed_y = work_area.position.y + (work_area.size.height as i32 - collapsed_height as i32) / 2;
        window
            .set_min_size(Some(PhysicalSize::new(collapsed_width, collapsed_height)))
            .map_err(|error| error.to_string())?;
        window.set_resizable(false).map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(collapsed_width, collapsed_height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(PhysicalPosition::new(fixed_x, fixed_y))
            .map_err(|error| error.to_string())?;
    } else if let Some(previous) = expanded.take() {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let min_width = (EXPANDED_MIN_WIDTH * scale).round() as u32;
        let min_height = (EXPANDED_MIN_HEIGHT * scale).round() as u32;
        window.set_resizable(true).map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(
                previous.size.width.max(min_width),
                previous.size.height.max(min_height),
            ))
            .map_err(|error| error.to_string())?;
        window
            .set_position(previous.position)
            .map_err(|error| error.to_string())?;
        apply_expanded_min_size(&window)?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CollapseState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![quit_app, set_collapsed])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = place_on_right(&window);
                let _ = apply_expanded_min_size(&window);
            }

            let open = MenuItem::with_id(app, "open", "Abrir Lumi", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("Lumi icon").clone())
                .tooltip("Lumi — Tu profe personal")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_lumi(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_lumi(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lumi");
}

fn show_lumi(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn apply_expanded_min_size(window: &WebviewWindow) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(PhysicalSize::new(
            (EXPANDED_MIN_WIDTH * scale).round() as u32,
            (EXPANDED_MIN_HEIGHT * scale).round() as u32,
        )))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn place_on_right(window: &WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("No se encontró un monitor")?;
    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let margin = (10.0 * scale) as i32;
    let max_width = (work_area.size.width as i32 - margin * 2).max((EXPANDED_MIN_WIDTH * scale) as i32) as u32;
    let max_height = (work_area.size.height as i32 - margin * 2).max((EXPANDED_MIN_HEIGHT * scale) as i32) as u32;
    let width = ((EXPANDED_MIN_WIDTH * scale) as u32).min(max_width);
    let height = ((EXPANDED_MIN_HEIGHT * scale) as u32).min(max_height);
    let x = work_area.position.x + work_area.size.width as i32 - width as i32 - margin;
    let y = work_area.position.y + (work_area.size.height as i32 - height as i32) / 2;

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    Ok(())
}
