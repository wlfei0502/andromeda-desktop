use std::time::Duration;

use tauri::{AppHandle, Manager, Webview};

#[tauri::command]
pub fn browser_reload(app: AppHandle, label: String) -> Result<(), String> {
    let webview = get_browser_webview(&app, &label)?;
    webview.reload().map_err(|err| err.to_string())
}

/// Hard-reload the current page, bypassing HTTP cache (like Ctrl+Shift+R).
/// Does not wipe the whole profile disk cache — that belongs to "清除缓存".
#[tauri::command]
pub fn browser_hard_reload(app: AppHandle, label: String) -> Result<(), String> {
    let webview = get_browser_webview(&app, &label)?;
    hard_reload_webview(&webview)
}

#[tauri::command]
pub fn browser_clear_data(app: AppHandle, label: String, kind: String) -> Result<(), String> {
    let webview = get_browser_webview(&app, &label)?;
    clear_browsing_data(&webview, &kind)
}

/// Capture only the child WebView page pixels (not tab chrome / menus)
/// and copy a PNG to the system clipboard.
#[tauri::command]
pub async fn browser_screenshot(app: AppHandle, label: String) -> Result<(), String> {
    let webview = get_browser_webview(&app, &label)?;
    let png = capture_webview_content_png(webview).await?;
    copy_png_to_clipboard(&png)
}

fn get_browser_webview(app: &AppHandle, label: &str) -> Result<Webview, String> {
    app.get_webview(label)
        .ok_or_else(|| format!("browser webview not found: {label}"))
}

fn clear_browsing_data(webview: &Webview, kind: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        clear_browsing_data_windows(webview, kind)
    }
    #[cfg(not(windows))]
    {
        let _ = kind;
        webview
            .clear_all_browsing_data()
            .map_err(|err| err.to_string())
    }
}

fn hard_reload_webview(webview: &Webview) -> Result<(), String> {
    #[cfg(windows)]
    {
        hard_reload_webview_windows(webview)
    }
    #[cfg(not(windows))]
    {
        webview.reload().map_err(|err| err.to_string())
    }
}

#[cfg(windows)]
fn hard_reload_webview_windows(webview: &Webview) -> Result<(), String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::w;

    webview
        .with_webview(|platform| {
            unsafe {
                let controller = platform.controller();
                let core = match controller.CoreWebView2() {
                    Ok(core) => core,
                    Err(err) => {
                        eprintln!("hard reload: CoreWebView2 failed: {err}");
                        return;
                    }
                };
                // Page.reload with ignoreCache — fast, page-scoped (not whole-profile wipe).
                if let Err(err) = core.CallDevToolsProtocolMethod(
                    w!("Page.reload"),
                    w!("{\"ignoreCache\":true}"),
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|hr, _| {
                        if hr.is_err() {
                            eprintln!("hard reload CDP failed: {hr:?}");
                        }
                        Ok(())
                    })),
                ) {
                    eprintln!("hard reload: CallDevToolsProtocolMethod failed: {err}");
                }
            }
        })
        .map_err(|err| err.to_string())
}

async fn capture_webview_content_png(webview: Webview) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        capture_preview_png_async(webview).await
    }
    #[cfg(not(windows))]
    {
        let _ = webview;
        Err("screenshot is only available on Windows".into())
    }
}

fn copy_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    let image = image::load_from_memory(png)
        .map_err(|err| format!("decode screenshot png: {err}"))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let mut clipboard =
        arboard::Clipboard::new().map_err(|err| format!("open clipboard: {err}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: image.into_raw().into(),
        })
        .map_err(|err| format!("set clipboard image: {err}"))
}

#[cfg(windows)]
fn clear_browsing_data_windows(webview: &Webview, kind: &str) -> Result<(), String> {
    use std::sync::mpsc;
    use std::sync::mpsc::RecvTimeoutError;
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_13, ICoreWebView2Profile2, COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    };
    use windows::core::Interface;

    let kinds = match kind {
        "cookies" => COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES,
        "cache" => COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE
            | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
        other => {
            return Err(format!("unsupported clear kind: {other}"));
        }
    };

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    // Run wait off the UI thread so ClearBrowsingData callbacks can complete.
    let webview = webview.clone();
    std::thread::spawn(move || {
        let tx_err = tx.clone();
        let start = webview
            .with_webview(move |platform| {
                let result = (|| {
                    unsafe {
                        let controller = platform.controller();
                        let core = controller.CoreWebView2().map_err(|e| e.to_string())?;
                        let profile = core
                            .cast::<ICoreWebView2_13>()
                            .map_err(|e| e.to_string())?
                            .Profile()
                            .map_err(|e| e.to_string())?
                            .cast::<ICoreWebView2Profile2>()
                            .map_err(|e| e.to_string())?;

                        let tx_done = tx.clone();
                        profile
                            .ClearBrowsingData(
                                kinds,
                                &ClearBrowsingDataCompletedHandler::create(Box::new(move |hr| {
                                    let _ = tx_done.send(if hr.is_ok() {
                                        Ok(())
                                    } else {
                                        Err(format!("clear browsing data failed: {hr:?}"))
                                    });
                                    Ok(())
                                })),
                            )
                            .map_err(|e| e.to_string())?;
                    }
                    Ok(())
                })();
                if let Err(err) = result {
                    let _ = tx.send(Err(err));
                }
            })
            .map_err(|err| err.to_string());
        if let Err(err) = start {
            let _ = tx_err.send(Err(err));
        }
    });

    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => Err("clear browsing data timed out".into()),
        Err(RecvTimeoutError::Disconnected) => Err("clear browsing data cancelled".into()),
    }
}

#[cfg(windows)]
async fn capture_preview_png_async(webview: Webview) -> Result<Vec<u8>, String> {
    use std::sync::mpsc;
    use std::sync::mpsc::RecvTimeoutError;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

    tokio::task::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        let tx_err = tx.clone();
        webview
            .with_webview(move |platform| {
                let result = (|| {
                    unsafe {
                        let controller = platform.controller();
                        let core = controller.CoreWebView2().map_err(|e| e.to_string())?;
                        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)
                            .map_err(|e| e.to_string())?;
                        let stream_for_read = stream.clone();
                        let tx_done = tx.clone();
                        core.CapturePreview(
                            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                            &stream,
                            &CapturePreviewCompletedHandler::create(Box::new(move |hr| {
                                let payload = if hr.is_ok() {
                                    read_istream_png(&stream_for_read)
                                } else {
                                    Err(format!("capture preview failed: {hr:?}"))
                                };
                                let _ = tx_done.send(payload);
                                Ok(())
                            })),
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    Ok(())
                })();
                if let Err(err) = result {
                    let _ = tx.send(Err(err));
                }
            })
            .map_err(|err| {
                let _ = tx_err.send(Err(err.to_string()));
                err.to_string()
            })?;

        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err("screenshot timed out".into()),
            Err(RecvTimeoutError::Disconnected) => Err("screenshot cancelled".into()),
        }
    })
    .await
    .map_err(|err| format!("screenshot task failed: {err}"))?
}

#[cfg(windows)]
unsafe fn read_istream_png(
    stream: &windows::Win32::System::Com::IStream,
) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG, STATSTG, STREAM_SEEK_SET};

    stream
        .Seek(0, STREAM_SEEK_SET, None)
        .map_err(|e| e.to_string())?;

    let mut stat = STATSTG::default();
    stream
        .Stat(&mut stat, STATFLAG(0))
        .map_err(|e| e.to_string())?;
    let size = stat.cbSize as usize;
    if size == 0 {
        return Err("screenshot was empty".into());
    }

    let mut buf = vec![0u8; size];
    let mut read = 0u32;
    stream
        .Read(
            buf.as_mut_ptr() as *mut std::ffi::c_void,
            size as u32,
            Some(&mut read),
        )
        .ok()
        .map_err(|e| e.to_string())?;
    buf.truncate(read as usize);
    if buf.is_empty() {
        return Err("screenshot read failed".into());
    }
    Ok(buf)
}
