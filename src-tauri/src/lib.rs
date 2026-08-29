use tauri::{
    menu::{Menu, MenuItem},
    PhysicalPosition, PhysicalSize,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow,
};

#[tauri::command]
fn set_collapsed(window: WebviewWindow, collapsed: bool) -> Result<(), String> {
    place_on_right(&window, collapsed)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_collapsed, quit_app])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = place_on_right(&window, false);
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

fn place_on_right(window: &WebviewWindow, collapsed: bool) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("No se encontró un monitor")?;
    let scale = monitor.scale_factor();
    let (logical_width, logical_height) = if collapsed { (52.0, 120.0) } else { (390.0, 720.0) };
    let width = (logical_width * scale) as u32;
    let height = (logical_height * scale) as u32;
    let margin = (10.0 * scale) as i32;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let x = monitor_position.x + monitor_size.width as i32 - width as i32 - margin;
    let y = monitor_position.y + (monitor_size.height as i32 - height as i32) / 2;

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    Ok(())
}
