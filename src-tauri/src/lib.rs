use tauri::Emitter;
use tauri::Manager;

mod binaries;

fn position_window_bottom_right(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let monitor_size = monitor.size();
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 380,
            height: 550,
        });
        let margin_right: i32 = 12;
        let margin_bottom: i32 = 48;
        let x = (monitor_size.width as i32) - (win_size.width as i32) - margin_right;
        let y = (monitor_size.height as i32) - (win_size.height as i32) - margin_bottom;
        let _ = window.set_position(tauri::PhysicalPosition { x, y });
    }
}

fn toggle_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Janela não encontrada")?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        position_window_bottom_right(&window);
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_bin_path() -> String {
    binaries::get_bin_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn open_bin_dir() {
    let path = binaries::get_bin_dir();
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
}

#[tauri::command]
fn check_binary(name: String) -> bool {
    binaries::check_binary_exists(&name)
}

#[tauri::command]
async fn get_binary_version(name: String) -> Result<String, String> {
    let bin_dir = binaries::get_bin_dir();
    let bin_path = if cfg!(target_os = "windows") {
        bin_dir.join(format!("{}.exe", name))
    } else {
        bin_dir.join(&name)
    };

    if !bin_path.exists() {
        return Err("Not installed".to_string());
    }

    let mut cmd = std::process::Command::new(&bin_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    if name == "yt-dlp" {
        cmd.arg("--version");
        let output = cmd.output().map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else if name == "ffmpeg" {
        cmd.arg("-version");
        let output = cmd.output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let first_line = stdout.lines().next().unwrap_or("Unknown");
        // "ffmpeg version 7.0.1-essentials_build-www.gyan.dev ..." -> "7.0.1"
        let raw_version = first_line
            .replace("ffmpeg version ", "")
            .split(' ')
            .next()
            .unwrap_or("Unknown")
            .to_string();
        let version = raw_version
            .split('-')
            .next()
            .unwrap_or(&raw_version)
            .to_string();
        Ok(version)
    } else {
        Err("Unsupported binary".to_string())
    }
}

#[tauri::command]
async fn download_binary(app: tauri::AppHandle, name: String, lang: String) -> Result<(), String> {
    let msg_start = if lang == "en" {
        "Starting process for:"
    } else if lang == "es" {
        "Iniciando proceso para:"
    } else {
        "Iniciando processo para:"
    };
    let msg_ffmpeg = if lang == "en" {
        "Downloading release for your OS..."
    } else if lang == "es" {
        "Descargando release para su OS..."
    } else {
        "Baixando release para seu OS..."
    };
    let msg_success = if lang == "en" {
        "successfully installed!"
    } else if lang == "es" {
        "instalado con éxito!"
    } else {
        "instalado com sucesso!"
    };
    let msg_ffmpeg_success = if lang == "en" {
        "FFmpeg extracted and configured!"
    } else if lang == "es" {
        "¡FFmpeg extraído y configurado!"
    } else {
        "FFmpeg extraído e configurado!"
    };

    let _ = app.emit("download-log", format!("{} {}", msg_start, name));

    if name == "yt-dlp" {
        let result = binaries::download_yt_dlp().await;
        match result {
            Ok(_) => {
                let _ = app.emit("download-log", format!("yt-dlp {}", msg_success));
                Ok(())
            }
            Err(e) => {
                let _ = app.emit("download-log", format!("Error: {}", e));
                Err(e)
            }
        }
    } else if name == "ffmpeg" {
        let _ = app.emit("download-log", msg_ffmpeg.to_string());
        let result = binaries::download_ffmpeg().await;
        match result {
            Ok(_) => {
                let _ = app.emit("download-log", msg_ffmpeg_success.to_string());
                Ok(())
            }
            Err(e) => {
                let _ = app.emit("download-log", format!("Error: {}", e));
                Err(e)
            }
        }
    } else {
        Err("Binary not supported".to_string())
    }
}

#[derive(serde::Serialize)]
struct VideoInfo {
    title: String,
    thumbnail: String,
    formats: Vec<FormatInfo>,
}

#[derive(serde::Serialize)]
struct FormatInfo {
    format_id: String,
    ext: String,
    resolution: String,
    height: u64,
    filesize: Option<u64>,
    vcodec: String,
}

#[tauri::command]
async fn get_video_info(url: String) -> Result<VideoInfo, String> {
    let bin_dir = binaries::get_bin_dir();
    let yt_dlp_path = if cfg!(target_os = "windows") {
        bin_dir.join("yt-dlp.exe")
    } else {
        bin_dir.join("yt-dlp")
    };

    if !yt_dlp_path.exists() {
        return Err("yt-dlp not installed".to_string());
    }

    let mut cmd = std::process::Command::new(&yt_dlp_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .arg("-j")
        .arg("--no-playlist")
        .arg(&url)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;

    let title = json["title"].as_str().unwrap_or("Unknown").to_string();
    let thumbnail = json["thumbnail"].as_str().unwrap_or("").to_string();

    let mut formats: Vec<FormatInfo> = Vec::new();
    let mut has_audio = false;

    if let Some(formats_array) = json["formats"].as_array() {
        for f in formats_array {
            let vcodec = f["vcodec"].as_str().unwrap_or("none");
            let acodec = f["acodec"].as_str().unwrap_or("none");
            
            if vcodec == "none" && acodec == "none" {
                continue;
            }

            if acodec != "none" {
                has_audio = true;
            }

            let mut resolution = f["resolution"].as_str().unwrap_or("?").to_string();
            let height = f["height"].as_u64().unwrap_or(0);

            if vcodec == "none" {
                resolution = "Audio Only".to_string();
            }

            let ext = f["ext"].as_str().unwrap_or("").to_string();
            let filesize = f["filesize"]
                .as_u64()
                .or_else(|| f["filesize_approx"].as_u64());

            // Deduplicate: only keep the best version of each resolution + extension
            if let Some(existing) = formats.iter_mut().find(|fmt| fmt.height == height && fmt.ext == ext) {
                if filesize.unwrap_or(0) > existing.filesize.unwrap_or(0) {
                    existing.filesize = filesize;
                    existing.format_id = f["format_id"].as_str().unwrap_or("").to_string();
                }
                continue;
            }

            formats.push(FormatInfo {
                format_id: f["format_id"].as_str().unwrap_or("").to_string(),
                ext,
                resolution,
                height,
                filesize,
                vcodec: vcodec.to_string(),
            });
        }
    }

    // Add virtual MP3 format if audio is available
    if has_audio {
        formats.push(FormatInfo {
            format_id: "best-mp3".to_string(),
            ext: "mp3".to_string(),
            resolution: "Audio Only".to_string(),
            height: 0,
            filesize: None,
            vcodec: "none".to_string(),
        });
    }

    // Sort: highest resolution first, then MP4, then size
    // Audio Only (height 0) will go to the end or beginning? Let's put at the end.
    formats.sort_by(|a, b| {
        b.height.cmp(&a.height).then_with(|| {
            let a_mp4 = if a.ext == "mp4" { 0 } else if a.ext == "mp3" { 1 } else { 2 };
            let b_mp4 = if b.ext == "mp4" { 0 } else if b.ext == "mp3" { 1 } else { 2 };
            a_mp4.cmp(&b_mp4)
        }).then_with(|| {
            b.filesize.unwrap_or(0).cmp(&a.filesize.unwrap_or(0))
        })
    });

    Ok(VideoInfo {
        title,
        thumbnail,
        formats,
    })
}

#[tauri::command]
async fn download_video(
    app: tauri::AppHandle,
    url: String,
    format_id: String,
    format_ext: String,
    format_height: u64,
    output_format: String,
    custom_path: Option<String>,
    state: tauri::State<'_, ProcessState>,
) -> Result<String, String> {
    let bin_dir = binaries::get_bin_dir();
    let yt_dlp_path = if cfg!(target_os = "windows") {
        bin_dir.join("yt-dlp.exe")
    } else {
        bin_dir.join("yt-dlp")
    };
    let ffmpeg_path = if cfg!(target_os = "windows") {
        bin_dir.join("ffmpeg.exe")
    } else {
        bin_dir.join("ffmpeg")
    };

    if !yt_dlp_path.exists() {
        return Err("yt-dlp not installed".to_string());
    }

    let dest_path = if let Some(p) = custom_path {
        std::path::PathBuf::from(p)
    } else {
        app.path()
            .resolve("", tauri::path::BaseDirectory::Download)
            .map_err(|e| e.to_string())?
    };

    // Build a robust format string using quality-based selection (always respected by yt-dlp)
    // with the original format_id as fallback.
    let video_sel = if format_height > 0 {
        format!("bestvideo[height={}][ext={}]", format_height, format_ext)
    } else {
        format_id.clone()
    };

    let format_str = if format_height == 0 {
        format_id.clone()
    } else if format_ext == "mp4" {
        format!(
            "{v}+bestaudio[ext=m4a]/{v}+bestaudio/{f}+bestaudio[ext=m4a]/{f}+bestaudio/{v}/{f}/best",
            v = video_sel,
            f = format_id
        )
    } else if format_ext == "webm" {
        format!(
            "{v}+bestaudio[ext=webm]/{v}+bestaudio/{f}+bestaudio[ext=webm]/{f}+bestaudio/{v}/{f}/best",
            v = video_sel,
            f = format_id
        )
    } else {
        format!(
            "{v}+bestaudio/{f}+bestaudio/{v}/{f}/best",
            v = video_sel,
            f = format_id
        )
    };

    let is_premiere_mp4 = output_format == "premiere_mp4" && format_id != "best-mp3";
    let output_ext = if is_premiere_mp4 {
        "MP4".to_string()
    } else {
        format_ext.to_uppercase()
    };

    let _ = app.emit(
        "download-log",
        format!(
            "Baixando {}p {} — seletor: {}",
            format_height,
            output_ext,
            video_sel
        ),
    );

    let mut cmd = std::process::Command::new(&yt_dlp_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    cmd.arg("--ffmpeg-location").arg(&ffmpeg_path);

    cmd.stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    if format_id == "best-mp3" {
        cmd.arg("-x")
           .arg("--audio-format")
           .arg("mp3")
           .arg("--audio-quality")
           .arg("0")
           .arg("-o")
           .arg(format!("{}/%(title)s.%(ext)s", dest_path.to_string_lossy()))
           .arg(&url);
    } else {
        cmd.arg("-f").arg(&format_str);
        
        if is_premiere_mp4 {
            let _ = app.emit(
                "download-log",
                "Após o download, o vídeo será convertido para MP4 H.264/AAC compatível com Premiere...".to_string(),
            );
            cmd.arg("--print").arg("after_move:filepath");
        } else if format_height > 0 {
            cmd.arg("--merge-output-format").arg(&format_ext);
        }

        cmd.arg("-o")
           .arg(format!("{}/%(title)s.%(ext)s", dest_path.to_string_lossy()))
           .arg(&url);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    // Capture stdout and stderr
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    
    // Store child for potential cancellation
    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = app_clone.emit("download-log", l);
            }
        }
    });

    use std::io::BufRead;
    let reader = std::io::BufReader::new(stdout);
    let mut downloaded_file: Option<String> = None;
    for line in reader.lines() {
        if let Ok(l) = line {
            if is_premiere_mp4 {
                let trimmed = l.trim();
                if !trimmed.is_empty() && !trimmed.starts_with('[') {
                    downloaded_file = Some(trimmed.to_string());
                }
            }
            let _ = app.emit("download-log", l);
        }
    }

    // Re-acquire child from state to wait for it
    let mut child = {
        let mut lock = state.0.lock().unwrap();
        lock.take().ok_or("Download cancelado")?
    };

    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        if is_premiere_mp4 {
            let input_file = downloaded_file
                .ok_or("Download concluído, mas o arquivo baixado não foi localizado")?;
            let input_path = std::path::PathBuf::from(&input_file);
            let parent = input_path
                .parent()
                .ok_or("Não foi possível localizar a pasta do vídeo baixado")?;
            let stem = input_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let output_path = parent.join(format!("{}_premiere.mp4", stem));

            let _ = app.emit(
                "download-log",
                "Convertendo para MP4 H.264/AAC compatível com Premiere...".to_string(),
            );

            let mut convert_cmd = std::process::Command::new(&ffmpeg_path);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                convert_cmd.creation_flags(0x08000000);
            }

            convert_cmd
                .arg("-y")
                .arg("-i")
                .arg(&input_path)
                .arg("-map")
                .arg("0:v:0")
                .arg("-map")
                .arg("0:a?")
                .arg("-c:v")
                .arg("libx264")
                .arg("-preset")
                .arg("fast")
                .arg("-crf")
                .arg("18")
                .arg("-pix_fmt")
                .arg("yuv420p")
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("192k")
                .arg("-movflags")
                .arg("+faststart")
                .arg(&output_path)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            let mut convert_child = convert_cmd.spawn().map_err(|e| e.to_string())?;
            let convert_stderr = convert_child.stderr.take().unwrap();

            {
                let mut lock = state.0.lock().unwrap();
                *lock = Some(convert_child);
            }

            let convert_reader = std::io::BufReader::new(convert_stderr);
            for line in convert_reader.lines() {
                if let Ok(l) = line {
                    let _ = app.emit("download-log", l);
                }
            }

            let mut convert_child = {
                let mut lock = state.0.lock().unwrap();
                lock.take().ok_or("Conversão cancelada")?
            };

            let convert_status = convert_child.wait().map_err(|e| e.to_string())?;
            if !convert_status.success() {
                return Err("Processo do ffmpeg falhou".to_string());
            }

            if input_path != output_path {
                let _ = std::fs::remove_file(&input_path);
            }
        }

        let _ = app.emit("download-log", "✅ Download concluído!".to_string());
        Ok(dest_path.to_string_lossy().to_string())
    } else {
        Err("Processo do yt-dlp falhou".to_string())
    }
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let folder = rx.await.map_err(|e| e.to_string())?;
    Ok(folder.map(|f| f.to_string()))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn compress_video(
    app: tauri::AppHandle,
    input_path: String,
    format_ext: String,
    quality_crf: String,
    resolution: String,
    state: tauri::State<'_, ProcessState>,
) -> Result<String, String> {
    let bin_dir = binaries::get_bin_dir();
    let ffmpeg_path = if cfg!(target_os = "windows") {
        bin_dir.join("ffmpeg.exe")
    } else {
        bin_dir.join("ffmpeg")
    };

    if !ffmpeg_path.exists() {
        return Err("ffmpeg not installed".to_string());
    }

    let dest_dir = app
        .path()
        .resolve("", tauri::path::BaseDirectory::Download)
        .map_err(|e| e.to_string())?;

    let input_path_buf = std::path::PathBuf::from(&input_path);
    let original_name = input_path_buf
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    
    let dest_path = dest_dir.join(format!("{}_compressed.{}", original_name, format_ext));

    let _ = app.emit(
        "compress-log",
        format!(
            "Comprimindo para {}...",
            format_ext.to_uppercase()
        ),
    );

    let mut cmd = std::process::Command::new(&ffmpeg_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    cmd.arg("-y") // Overwrite output files
       .arg("-i")
       .arg(&input_path);
       
    if format_ext == "mp3" {
        let bitrate = match quality_crf.as_str() {
            "23" => "320k",
            "35" => "128k",
            _ => "192k",
        };
        cmd.arg("-vn")
           .arg("-c:a")
           .arg("libmp3lame")
           .arg("-b:a")
           .arg(bitrate);
    } else {
        let vcodec = if format_ext == "webm" { "libvpx-vp9" } else { "libx264" };

        if resolution != "original" {
            // scale height to resolution, proportional width
            cmd.arg("-vf").arg(format!("scale=-2:{}", resolution));
        }

        cmd.arg("-c:v")
           .arg(vcodec)
           .arg("-crf")
           .arg(&quality_crf) // Use selected quality
           .arg("-preset")
           .arg("fast");
    }

    cmd.arg(&dest_path)
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stderr = child.stderr.take().unwrap();
    
    // Store child for potential cancellation
    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    let reader = std::io::BufReader::new(stderr);

    use std::io::BufRead;
    for line in reader.lines() {
        if let Ok(l) = line {
            // ffmpeg outputs progress to stderr
            let _ = app.emit("compress-log", l);
        }
    }

    // Re-acquire child from state to wait for it
    let mut child = {
        let mut lock = state.0.lock().unwrap();
        lock.take().ok_or("Compressão cancelada")?
    };

    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        let _ = app.emit("compress-log", "✅ Compressão concluída!".to_string());
        Ok(dest_path.to_string_lossy().to_string())
    } else {
        Err("Processo do ffmpeg falhou".to_string())
    }
}

#[derive(serde::Serialize)]
struct PickedVideo {
    path: String,
    size_mb: f64,
}

#[tauri::command]
async fn pick_video_file(app: tauri::AppHandle) -> Result<Option<PickedVideo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().add_filter("Video", &["mp4", "mkv", "avi", "mov", "webm", "flv"]).pick_file(move |file| {
        let _ = tx.send(file);
    });
    let file = rx.await.map_err(|e| e.to_string())?;
    
    if let Some(f) = file {
        let path = f.to_string();
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let size_mb = size_bytes as f64 / 1024.0 / 1024.0;
        Ok(Some(PickedVideo { path, size_mb }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn download_and_open_installer(
    app: tauri::AppHandle,
    url: String,
    ext: String,
) -> Result<(), String> {
    let _ = app.emit("download-log", format!("Iniciando download da atualização..."));
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    
    let temp_dir = std::env::temp_dir();
    let fname = format!("mevideo_update_{}.{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(), ext.trim_start_matches('.'));
    let temp_file = temp_dir.join(&fname);
    
    let mut file = tokio::fs::File::create(&temp_file).await.map_err(|e| e.to_string())?;
    
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    
    let _ = app.emit("download-log", format!("Abrindo instalador..."));
    
    #[cfg(target_os = "windows")]
    {
        let path_str = temp_file.to_string_lossy().to_string();
        if ext.to_lowercase().ends_with("msi") {
            std::process::Command::new("msiexec")
                .arg("/i")
                .arg(&path_str)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("cmd")
                .arg("/c")
                .arg("start")
                .arg("")
                .arg(&path_str)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if ext.to_lowercase().contains("appimage") {
            let _ = std::process::Command::new("chmod")
                .arg("+x")
                .arg(&temp_file)
                .status();
        }
        std::process::Command::new("xdg-open")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

use std::sync::Mutex;
struct ProcessState(Mutex<Option<std::process::Child>>);

#[tauri::command]
async fn cancel_process(state: tauri::State<'_, ProcessState>) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        Ok(())
    } else {
        Err("Nenhum processo ativo".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProcessState(Mutex::new(None)))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = toggle_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let show_i =
                tauri::menu::MenuItem::with_id(app, "show", "Abrir App", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;

            if let Some(icon) = app.default_window_icon() {
                let _tray = tauri::tray::TrayIconBuilder::new()
                    .menu(&menu)
                    .icon(icon.clone())
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            let _ = toggle_window(app);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let _ = toggle_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window_vibrancy::apply_mica(&window, None);
                }
                position_window_bottom_right(&window);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_binary,
            get_binary_version,
            download_binary,
            get_bin_path,
            open_bin_dir,
            download_video,
            get_video_info,
            pick_folder,
            pick_video_file,
            compress_video,
            open_path,
            download_and_open_installer,
            cancel_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
