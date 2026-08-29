use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use std::io::Cursor;
use std::process::Command;
use std::sync::Mutex;
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Lado más largo al que se reduce la captura antes de enviarla al modelo de
/// visión. Mismo tope que usa Clicky (`CompanionScreenCaptureUtility.swift:84`):
/// suficiente para leer la interfaz, ligero para la subida y el documento.
const CAPTURE_MAX_EDGE: u32 = 1280;
/// Etiquetas de las ventanas propias que se ocultan (alfa 0) durante la captura.
const OWN_WINDOW_LABELS: [&str; 2] = ["main", "overlay"];

/// Mostrar/ocultar el panel desde cualquier app.
fn toggle_panel_shortcut() -> Shortcut {
    Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::META),
        Code::KeyK,
    )
}

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCapture {
    /// Data URL `data:image/jpeg;base64,...` listo para `pendingImage` en el frontend.
    image_base64: String,
    /// Dimensiones de la imagen ya reducida, en píxeles. El overlay las usa para
    /// proyectar las coordenadas normalizadas 0..1 del backend.
    width: u32,
    height: u32,
}

/// Captura el monitor principal. Antes de disparar la captura oculta las
/// ventanas de la app poniéndoles alfa 0 (no `hide()`: `show()` roba el foco y
/// reordena una ventana always-on-top). Las ventanas ya llevan
/// `contentProtected: true`; el alfa 0 es el cinturón por si la exclusión no
/// aplica dentro del mismo proceso.
///
/// Comando síncrono a propósito: Tauri lo ejecuta en un hilo de trabajo, así el
/// respiro al compositor y el subproceso `screencapture` no congelan la UI.
#[tauri::command]
fn capture_screen(app: AppHandle) -> Result<ScreenCapture, String> {
    ensure_screen_recording_permission()?;
    let _guard = HiddenWindowsGuard::hide(&app);
    // Dejar que WindowServer componga un par de frames sin las ventanas.
    std::thread::sleep(std::time::Duration::from_millis(60));
    capture_primary_monitor()
    // `_guard` restaura el alfa al salir, incluso si la captura falla.
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontmostApp {
    /// Nombre de la aplicación en primer plano (ej. "DaVinci Resolve").
    app: String,
    /// Título de la ventana activa (necesita permiso de Grabación de pantalla en macOS).
    title: String,
}

/// Devuelve la app que el usuario está mirando ahora mismo. `None` si la ventana
/// activa es la propia Michi (el usuario pulsó un botón nuestro) — en ese caso
/// el backend cae a la identificación por visión.
#[tauri::command]
fn frontmost_app() -> Option<FrontmostApp> {
    let win = active_win_pos_rs::get_active_window().ok()?;
    if win.process_id == std::process::id() as u64 {
        return None;
    }
    let app = win.app_name.trim();
    if app.is_empty() {
        return None;
    }
    Some(FrontmostApp {
        app: app.to_string(),
        title: win.title,
    })
}

#[cfg(target_os = "macos")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// En macOS 15+ `screencapture` falla con "could not create image from display"
/// si la app no tiene permiso de Grabación de pantalla. El diálogo del sistema
/// solo aparece cuando la app lo pide explícitamente vía CoreGraphics; en dev,
/// además, cada `cargo build` cambia el hash y macOS vuelve a pedirlo.
#[cfg(target_os = "macos")]
fn ensure_screen_recording_permission() -> Result<(), String> {
    unsafe {
        if CGPreflightScreenCaptureAccess() {
            return Ok(());
        }
        // Dispara el diálogo y registra la app en la lista de Ajustes.
        CGRequestScreenCaptureAccess();
    }
    Err(
        "Michi necesita permiso de Grabación de pantalla. Ábrelo en Ajustes del \
         Sistema → Privacidad y seguridad → Grabación de pantalla, activa «lumi», \
         y vuelve a pulsar capturar."
            .into(),
    )
}

#[cfg(not(target_os = "macos"))]
fn ensure_screen_recording_permission() -> Result<(), String> {
    Ok(())
}

/// Pone las ventanas propias a alfa 0 y las restaura al soltarse (Drop).
struct HiddenWindowsGuard {
    windows: Vec<WebviewWindow>,
}

impl HiddenWindowsGuard {
    fn hide(app: &AppHandle) -> Self {
        let windows: Vec<WebviewWindow> = OWN_WINDOW_LABELS
            .iter()
            .filter_map(|label| app.get_webview_window(label))
            .filter(|w| w.is_visible().unwrap_or(false))
            .collect();
        set_windows_alpha(&windows, 0.0, true);
        Self { windows }
    }
}

impl Drop for HiddenWindowsGuard {
    fn drop(&mut self) {
        // Restaurar es fire-and-forget: no hace falta bloquear.
        set_windows_alpha(&self.windows, 1.0, false);
    }
}

/// Ajusta `alphaValue` de las ventanas en el hilo principal. Con `block`, espera
/// a que la actualización se haya ejecutado (mata la carrera antes de capturar).
#[cfg(target_os = "macos")]
fn set_windows_alpha(windows: &[WebviewWindow], alpha: f64, block: bool) {
    use objc2_app_kit::NSWindow;

    if windows.is_empty() {
        return;
    }
    let ptrs: Vec<usize> = windows
        .iter()
        .filter_map(|w| w.ns_window().ok())
        .map(|p| p as usize)
        .collect();
    if ptrs.is_empty() {
        return;
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let run = windows[0].run_on_main_thread(move || {
        for ptr in &ptrs {
            let ns_window = *ptr as *mut NSWindow;
            unsafe { (*ns_window).setAlphaValue(alpha) };
        }
        let _ = tx.send(());
    });
    if block && run.is_ok() {
        let _ = rx.recv();
    }
}

#[cfg(not(target_os = "macos"))]
fn set_windows_alpha(windows: &[WebviewWindow], alpha: f64, _block: bool) {
    // Sin API de alfa portable: caemos a hide/show.
    for window in windows {
        let _ = if alpha == 0.0 { window.hide() } else { window.show() };
    }
}

fn capture_primary_monitor() -> Result<ScreenCapture, String> {
    let raw = capture_with_screencapture()?;

    // `screencapture` entrega la pantalla completa a resolución Retina; la
    // reducimos preservando el aspecto para que el modelo de visión mapee las
    // coordenadas normalizadas sin distorsión y la subida pese poco.
    let decoded = image::load_from_memory(&raw)
        .map_err(|e| format!("No se pudo decodificar la captura: {e}"))?;
    let (src_w, src_h) = (decoded.width(), decoded.height());
    let longest = src_w.max(src_h);
    let scaled = if longest > CAPTURE_MAX_EDGE {
        let ratio = CAPTURE_MAX_EDGE as f32 / longest as f32;
        let dst_w = (src_w as f32 * ratio).round().max(1.0) as u32;
        let dst_h = (src_h as f32 * ratio).round().max(1.0) as u32;
        decoded.resize_exact(dst_w, dst_h, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };

    let (out_w, out_h) = (scaled.width(), scaled.height());
    let rgb = scaled.to_rgb8();

    let mut buffer = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut buffer, 80)
        .encode_image(&rgb)
        .map_err(|e| format!("No se pudo codificar el JPEG: {e}"))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(buffer.into_inner());
    Ok(ScreenCapture {
        image_base64: format!("data:image/jpeg;base64,{encoded}"),
        width: out_w,
        height: out_h,
    })
}

/// Captura la pantalla principal con la herramienta del sistema
/// `/usr/sbin/screencapture`. En macOS 15+ la vía por librería
/// (`CGWindowListCreateImage`, que usaba `xcap`) devuelve solo el fondo de
/// pantalla sin las ventanas; `screencapture` es la ruta soportada y captura lo
/// que el usuario está viendo. Respeta `contentProtected`, así que las ventanas
/// de la app quedan excluidas igual.
fn capture_with_screencapture() -> Result<Vec<u8>, String> {
    let path = std::env::temp_dir().join(format!("michi-capture-{}.jpg", std::process::id()));

    let output = Command::new("/usr/sbin/screencapture")
        .arg("-x") // sin sonido de obturador
        .arg("-o") // sin sombra de ventana
        .arg("-t")
        .arg("jpg")
        .arg("-D")
        .arg("1") // pantalla principal
        .arg(&path)
        .output()
        .map_err(|e| format!("No se pudo ejecutar screencapture: {e}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "screencapture falló ({}). ¿Está concedido el permiso de Grabación de pantalla? {stderr}",
            output.status
        ));
    }

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("No se pudo leer la captura temporal: {e}"))?;
    let _ = std::fs::remove_file(&path);

    if bytes.is_empty() {
        return Err("La captura salió vacía".into());
    }
    Ok(bytes)
}

/// Ventana overlay: cubre el área del monitor principal, transparente,
/// click-through, sin foco, presente en todos los Spaces y fuera de capturas.
fn build_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let overlay = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("Michi Teach Overlay")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .focused(false)
        .resizable(false)
        .skip_taskbar(true)
        .content_protected(true)
        .accept_first_mouse(false)
        .visible(false)
        .build()?;

    overlay.set_ignore_cursor_events(true)?;
    fit_overlay_to_primary_monitor(&overlay)?;
    raise_overlay_above_everything(&overlay)?;
    overlay.show()?;
    Ok(overlay)
}

fn fit_overlay_to_primary_monitor(overlay: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = overlay.primary_monitor()? {
        overlay.set_position(*monitor.position())?;
        overlay.set_size(*monitor.size())?;
    }
    Ok(())
}

/// Sube el overlay por encima de la barra de menús y hasta los Spaces en pantalla
/// completa de otras apps. `always_on_top` de Tauri solo llega a nivel 3
/// (`NSFloatingWindowLevel`), que no basta.
#[cfg(target_os = "macos")]
fn raise_overlay_above_everything(overlay: &WebviewWindow) -> tauri::Result<()> {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    let ptr = overlay.ns_window()? as usize;
    overlay.run_on_main_thread(move || unsafe {
        let ns_window = &*(ptr as *mut NSWindow);
        // 25 == NSStatusWindowLevel: sobre la barra de menús (24), bajo los menús.
        ns_window.setLevel(25);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_window.setIgnoresMouseEvents(true);
    })?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn raise_overlay_above_everything(_overlay: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// Menú de edición mínimo. Sin él, `LSUIElement`/`Accessory` deja la app sin
/// barra de menús y ⌘C/⌘V/⌘A dejan de funcionar en el textarea del chat.
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let edit = Submenu::with_items(
        app,
        "Edición",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&edit])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut == &toggle_panel_shortcut()
                        && event.state == ShortcutState::Pressed
                    {
                        toggle_panel(app);
                    }
                })
                .build(),
        )
        .manage(CollapseState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            quit_app,
            set_collapsed,
            capture_screen,
            frontmost_app
        ])
        .setup(|app| {
            let handle = app.handle();

            #[cfg(target_os = "macos")]
            let _ = handle.set_activation_policy(ActivationPolicy::Accessory);

            if let Ok(menu) = build_app_menu(handle) {
                let _ = app.set_menu(menu);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = place_on_right(&window);
                let _ = apply_expanded_min_size(&window);
            }

            if let Err(error) = build_overlay(handle) {
                eprintln!("No se pudo crear el overlay: {error}");
            }

            spawn_push_to_talk_watcher(handle.clone());

            if let Err(error) = app.global_shortcut().register(toggle_panel_shortcut()) {
                eprintln!("No se pudo registrar el atajo del panel (Ctrl+Alt+Cmd+K): {error}");
            }

            let open = MenuItem::with_id(app, "open", "Abrir Michi Teach", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("Michi Teach icon").clone())
                .tooltip("Michi Teach — Tu profe personal")
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
        .expect("error while running Michi Teach");
}

fn show_lumi(app: &AppHandle) {
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

/// Alterna la visibilidad del panel: lo oculta si está visible y con foco, lo
/// trae al frente en caso contrario.
fn toggle_panel(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            show_lumi(app);
        }
    }
}

/// Push-to-talk solo-modificadores: `Ctrl+Option` en macOS, `Ctrl+Alt` en
/// Windows (Option ES Alt, así que el mismo par de modificadores sirve en
/// ambos). El plugin de atajos globales de Tauri no admite combos sin tecla,
/// así que vigilamos el estado global del teclado por sondeo.
///
/// Emite `ptt:pressed` en cuanto Ctrl y Alt están mantenidos a la vez, y
/// `ptt:released` al soltar cualquiera de los dos. El frontend arranca/para la
/// grabación con esos eventos.
///
/// En macOS necesita permiso de **Accesibilidad** para «lumi»; sin él
/// `get_keys()` no devuelve nada y el push-to-talk queda inerte — el botón de
/// micrófono sigue funcionando.
fn spawn_push_to_talk_watcher(app: AppHandle) {
    use device_query::{DeviceQuery, DeviceState, Keycode};

    // En macOS dispara el diálogo del sistema y añade «lumi» a la lista de
    // Accesibilidad. El permiso surte efecto tras relanzar la app.
    #[cfg(target_os = "macos")]
    if !macos_accessibility_client::accessibility::application_is_trusted_with_prompt() {
        eprintln!(
            "Push-to-talk: concede Accesibilidad a «lumi» en Ajustes del Sistema → \
             Privacidad y seguridad → Accesibilidad y relanza la app."
        );
    }

    std::thread::spawn(move || {
        let Some(device_state) = DeviceState::checked_new() else {
            eprintln!("Push-to-talk desactivado: no se pudo leer el estado del teclado.");
            return;
        };

        let mut active = false;
        loop {
            let keys = device_state.get_keys();
            let ctrl = keys.contains(&Keycode::LControl) || keys.contains(&Keycode::RControl);
            let alt = keys.contains(&Keycode::LAlt)
                || keys.contains(&Keycode::RAlt)
                || keys.contains(&Keycode::LOption)
                || keys.contains(&Keycode::ROption);
            let held = ctrl && alt;

            if held != active {
                active = held;
                let _ = app.emit(if active { "ptt:pressed" } else { "ptt:released" }, ());
            }

            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    });
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
