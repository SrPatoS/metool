import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { i18n, Language } from "./i18n";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { checkForUpdates, downloadAndInstallUpdate, type UpdateCheckResult } from "./lib/updates";

interface DownloadEntry {
  id: string;
  title: string;
  url: string;
  resolution: string;
  ext: string;
  path: string;
  date: string;
  filesize?: number;
}

interface FormatOption {
  format_id: string;
  resolution: string;
  ext: string;
  height: number;
  filesize?: number;
  vcodec?: string;
}

type OutputFormat = "premiere_mp4" | "original";

function FormatSelect({
  formats,
  value,
  onChange,
  lang,
}: {
  formats: FormatOption[];
  value: string;
  onChange: (id: string) => void;
  lang: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = formats.find((f) => f.format_id === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fmt = (f: FormatOption) => {
    const size = f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + " MB" : "?";
    const res = f.resolution === "Audio Only" ? (i18n[lang as Language] as any).audio_only : f.resolution;
    return `${res} · ${f.ext.toUpperCase()} · ${size}`;
  };

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          padding: "8px 12px",
          color: "white",
          fontSize: "0.8rem",
          cursor: "pointer",
          gap: "8px",
          transition: "border-color 0.2s",
          borderColor: open ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.1)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? fmt(selected) : "Selecionar..."}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            opacity: 0.5,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "rgba(15,15,20,0.97)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            maxHeight: "280px",
            overflowY: "auto",
            zIndex: 50,
            boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
          }}
          className="custom-scroll"
        >
          {(() => {
            const grouped = formats.reduce((acc, f) => {
              let cat = "video_other";
              if (f.height === 0) cat = "audio_formats";
              else if (f.ext === "mp4") cat = "video_mp4";
              else if (f.ext === "webm") cat = "video_webm";
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(f);
              return acc;
            }, {} as Record<string, FormatOption[]>);

            const order = ["video_mp4", "video_webm", "video_other", "audio_formats"];
            
            return order.map(cat => {
              const group = grouped[cat];
              if (!group || group.length === 0) return null;

              return (
                <div key={cat}>
                  <div style={{ 
                    padding: "8px 12px 4px", 
                    fontSize: "0.62rem", 
                    textTransform: "uppercase", 
                    letterSpacing: "1px", 
                    opacity: 0.35, 
                    fontWeight: 700,
                    background: "rgba(255,255,255,0.02)"
                  }}>
                    {(i18n[lang as Language] as any)[cat]}
                  </div>
                  {group.map((f, i) => {
                    const isSelected = f.format_id === value;
                    return (
                      <button
                        key={f.format_id}
                        onClick={() => { onChange(f.format_id); setOpen(false); }}
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "9px 12px",
                          background: isSelected ? "rgba(255,255,255,0.15)" : "transparent",
                          border: "none",
                          color: isSelected ? "#ffffff" : "rgba(255,255,255,0.8)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          textAlign: "left",
                          gap: "8px",
                          borderBottom: "1px solid rgba(255,255,255,0.03)"
                        }}
                      >
                        <span style={{ fontWeight: isSelected ? 600 : 400 }}>{f.resolution === "Audio Only" ? (i18n[lang as Language] as any).audio_only : f.resolution}</span>
                        <span style={{ opacity: 0.45, fontSize: "0.72rem", display: "flex", gap: "6px" }}>
                          <span>{f.ext.toUpperCase()}</span>
                          <span>·</span>
                          <span>{f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + " MB" : "?"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

function Onboarding({ onFinish, lang, setLang }: {
  onFinish: () => void;
  lang: Language;
  setLang: (l: Language) => void;
}) {
  const [step, setStep] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [installError, setInstallError] = useState<string | null>(null);

  const TOTAL_STEPS = 4;

  const installDep = async (name: string) => {
    setInstalling(name);
    setInstallError(null);
    try {
      await invoke("download_binary", { name, lang });
      setInstalled(prev => ({ ...prev, [name]: true }));
    } catch (e) {
      setInstallError(`Falha ao instalar ${name}: ${e}`);
    } finally {
      setInstalling(null);
    }
  };

  const installAll = async () => {
    setInstallError(null);
    try {
      setInstalling("yt-dlp");
      await invoke("download_binary", { name: "yt-dlp", lang });
      setInstalled(prev => ({ ...prev, "yt-dlp": true }));

      setInstalling("ffmpeg");
      await invoke("download_binary", { name: "ffmpeg", lang });
      setInstalled(prev => ({ ...prev, "ffmpeg": true }));
    } catch (e) {
      setInstallError(`Falha na instalação: ${e}`);
    } finally {
      setInstalling(null);
    }
  };

  const allInstalled = installed["yt-dlp"] && installed["ffmpeg"];

  const labels: Record<Language, { welcome_title: string; welcome_sub: string; next: string; skip: string; lang_title: string; dep_title: string; dep_sub: string; install_all: string; finish_title: string; finish_sub: string; done: string; installing: string; download_video: string; download_audio: string; cancel: string; video_mp4: string }> = {
    pt: { welcome_title: "Bem-vindo ao Mevideo!", welcome_sub: "Baixe vídeos de YouTube, Instagram, TikTok e mais de 1.000 sites — direto do seu desktop.", next: "Próximo", skip: "Pular", lang_title: "Escolha seu idioma", dep_title: "Instalar dependências", dep_sub: "O Mevideo usa yt-dlp e ffmpeg para baixar e processar vídeos. Instale agora ou depois.", install_all: "Instalar tudo", finish_title: "Tudo pronto!", finish_sub: "Cole uma URL e baixe seu primeiro vídeo. O app fica na bandeja do sistema.", done: "Começar", installing: "Instalando...", download_video: "Baixar Vídeo", download_audio: "Baixar Áudio", cancel: "Cancelar", video_mp4: "Vídeo (MP4)" },
    en: { welcome_title: "Welcome to Mevideo!", welcome_sub: "Download videos from YouTube, Instagram, TikTok and 1,000+ sites — right from your desktop.", next: "Next", skip: "Skip", lang_title: "Choose your language", dep_title: "Install dependencies", dep_sub: "Mevideo uses yt-dlp and ffmpeg to download and process videos. Install now or later.", install_all: "Install all", finish_title: "All set!", finish_sub: "Paste a URL and download your first video. The app lives in the system tray.", done: "Get started", installing: "Installing...", download_video: "Download Video", download_audio: "Download Audio", cancel: "Cancel", video_mp4: "Video (MP4)" },
    es: { welcome_title: "¡Bienvenido a Mevideo!", welcome_sub: "Descarga videos de YouTube, Instagram, TikTok y más de 1.000 sitios — desde tu escritorio.", next: "Siguiente", skip: "Omitir", lang_title: "Elige tu idioma", dep_title: "Instalar dependencias", dep_sub: "Mevideo usa yt-dlp y ffmpeg para descargar y procesar videos. Instala ahora o después.", install_all: "Instalar todo", finish_title: "¡Todo listo!", finish_sub: "Pega una URL y descarga tu primer video. La app vive en la bandeja del sistema.", done: "Empezar", installing: "Instalando...", download_video: "Descargar Video", download_audio: "Descargar Audio", cancel: "Cancelar", video_mp4: "Video (MP4)" },
  };
  const l = labels[lang];

  const steps = [
    // Step 0 — Welcome
    <div key="welcome" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", textAlign: "center", padding: "10px 0" }}>
      <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: "linear-gradient(135deg, #ffffff, #ffffff)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 40px rgba(255,255,255,0.4)" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
      <div>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.4rem", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, background: "linear-gradient(135deg, #ffffff, #cccccc, #999999)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{l.welcome_title}</h2>
        <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6, lineHeight: 1.6, maxWidth: "260px" }}>{l.welcome_sub}</p>
      </div>
      <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
        {(["pt", "en", "es"] as Language[]).map(lg => (
          <button key={lg} onClick={() => setLang(lg)} style={{ padding: "4px 10px", fontSize: "0.7rem", background: lang === lg ? "rgba(255,255,255,0.2)" : "transparent", borderColor: lang === lg ? "#ffffff" : "rgba(255,255,255,0.1)" }}>
            {lg.toUpperCase()}
          </button>
        ))}
      </div>
    </div>,

    // Step 1 — Language (now just confirms and moves on, already selected above)
    <div key="lang" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🌐</div>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 700 }}>{l.lang_title}</h2>
        <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.5 }}>Você pode mudar isso depois nas configurações.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {([["pt", "🇧🇷", "Português"], ["en", "🇺🇸", "English"], ["es", "🇪🇸", "Español"]] as [Language, string, string][]).map(([lg, flag, name]) => (
          <button key={lg} onClick={() => setLang(lg)} style={{ padding: "12px 16px", textAlign: "left", display: "flex", alignItems: "center", gap: "12px", fontSize: "0.9rem", background: lang === lg ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.03)", borderColor: lang === lg ? "#ffffff" : "rgba(255,255,255,0.08)", borderRadius: "12px", fontWeight: lang === lg ? 600 : 400 }}>
            <span style={{ fontSize: "1.2rem" }}>{flag}</span>
            <span>{name}</span>
            {lang === lg && <span style={{ marginLeft: "auto", color: "#ffffff" }}>✓</span>}
          </button>
        ))}
      </div>
    </div>,

    // Step 2 — Dependencies
    <div key="deps" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "8px" }}>⚙️</div>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 700 }}>{l.dep_title}</h2>
        <p style={{ margin: 0, fontSize: "0.78rem", opacity: 0.5 }}>{l.dep_sub}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {[{ name: "yt-dlp", desc: "Motor de download de vídeos" }, { name: "ffmpeg", desc: "Processamento de mídia" }].map(({ name, desc }) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: installed[name] ? "#4ade80" : "rgba(255,255,255,0.15)", boxShadow: installed[name] ? "0 0 8px #4ade80" : "none", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: "0.7rem", opacity: 0.4 }}>{desc}</div>
            </div>
            {installing === name ? (
              <div className="spinner" />
            ) : installed[name] ? (
              <span style={{ color: "#4ade80", fontSize: "0.8rem" }}>✓</span>
            ) : (
              <button onClick={() => installDep(name)} disabled={installing !== null} style={{ fontSize: "0.7rem", padding: "3px 10px" }}>Instalar</button>
            )}
          </div>
        ))}
      </div>
      {installError && <p style={{ margin: 0, fontSize: "0.75rem", color: "#f87171", textAlign: "center" }}>{installError}</p>}
      {!allInstalled && (
        <button onClick={installAll} disabled={installing !== null} className="download-btn" style={{ padding: "10px", fontSize: "0.85rem" }}>
          {installing ? <><div className="spinner" />{l.installing}</> : l.install_all}
        </button>
      )}
    </div>,

    // Step 3 — Done
    <div key="done" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", textAlign: "center", padding: "10px 0" }}>
      <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "rgba(74,222,128,0.1)", border: "2px solid rgba(74,222,128,0.4)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 30px rgba(74,222,128,0.2)" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.4rem", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: "#4ade80" }}>{l.finish_title}</h2>
        <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6, lineHeight: 1.6, maxWidth: "260px" }}>{l.finish_sub}</p>
      </div>
    </div>,
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(5, 4, 8, 0.92)",
      backdropFilter: "blur(20px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: "320px",
        background: "rgba(12, 10, 16, 0.96)",
        border: "1px solid rgba(255, 255, 255, 0.10)",
        borderRadius: "20px",
        padding: "28px 24px 22px",
        display: "flex", flexDirection: "column", gap: "24px",
        boxShadow: "0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)",
      }}>
        {/* Step dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: "6px" }}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} style={{
              width: i === step ? "24px" : "6px",
              height: "6px",
              borderRadius: "99px",
              background: i === step ? "#ffffff" : i < step ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)",
              transition: "all 0.3s",
            }} />
          ))}
        </div>

        {/* Step content */}
        <div style={{ minHeight: "220px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {steps[step]}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", gap: "10px" }}>
          {step < TOTAL_STEPS - 1 ? (
            <>
              {step === 2 && !allInstalled && (
                <button onClick={() => setStep(s => s + 1)} style={{ flex: 1, fontSize: "0.8rem", opacity: 0.5, padding: "10px" }}>
                  {l.skip}
                </button>
              )}
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={step === 2 && installing !== null}
                className={step === 2 && allInstalled ? "download-btn" : ""}
                style={{ flex: 1, padding: "10px", fontSize: "0.88rem", ...(step !== 2 || allInstalled ? {} : {}) }}
              >
                {step === 2 && allInstalled ? "Continuar ✓" : l.next}
              </button>
            </>
          ) : (
            <button onClick={onFinish} className="download-btn" style={{ flex: 1, padding: "12px", fontSize: "0.9rem" }}>
              {l.done} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [lang, setLang] = useState<Language>("pt");
  const t = i18n[lang] as Record<string, string>;

  const [status, setStatus] = useState<string>(t.ready);
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>(["Mevideo Initialized..."]);
  const [view, setView] = useState<"home" | "config" | "history" | "compress">("home");
  const [isLoading, setIsLoading] = useState<string | null>(null);
  
  const handleCancel = async () => {
    try {
      await invoke("cancel_process");
      setIsLoading(null);
      setStatus(t.cancel || "Cancelado.");
    } catch (e) {
      console.error(e);
    }
  };

  const [videoUrl, setVideoUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(() => {
    const saved = localStorage.getItem("metool-output-format");
    return saved === "original" ? "original" : "premiere_mp4";
  });
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [compressFile, setCompressFile] = useState<string | null>(null);
  const [compressSizeMb, setCompressSizeMb] = useState<number>(0);
  const [compressFormat, setCompressFormat] = useState<string>("mp4");
  const [compressQuality, setCompressQuality] = useState<string>("28");
  const [compressResolution, setCompressResolution] = useState<string>("original");
  const [appVersion, setAppVersion] = useState<string>("");
  const [showOnboarding, setShowOnboarding] = useState<boolean>(
    () => !localStorage.getItem("metool-onboarding-done")
  );
  const [history, setHistory] = useState<DownloadEntry[]>(() => {
    try {
      const saved = localStorage.getItem("metool-history");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [binaries, setBinaries] = useState<{ name: string; exists: boolean; version?: string }[]>([
    { name: "yt-dlp", exists: false },
    { name: "ffmpeg", exists: false },
  ]);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "current" | "downloading" | "error">("idle");

  useEffect(() => {
    checkBinaries();
    isEnabled().then(setAutoStart).catch(console.error);
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => {})
    );
    void checkAppUpdates();

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlistenDown = await listen<string>("download-log", (event) => {
          const payload = event.payload;
          const pct = payload.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (pct) {
            setDownloadProgress(parseFloat(pct[1]));
          }
          setLogs(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${payload}`]);
        });
        const unlistenComp = await listen<string>("compress-log", (event) => {
          const payload = event.payload;
          setLogs(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${payload}`]);
        });
        return () => { unlistenDown(); unlistenComp(); };
      } catch (e) {
        console.error("Failed to setup log listener:", e);
        return () => {};
      }
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten && unlisten());
    };
  }, []);

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const checkBinaries = async () => {
    const updated = await Promise.all(
      binaries.map(async (bin) => {
        const exists = await invoke("check_binary", { name: bin.name }) as boolean;
        let version = undefined;
        if (exists) {
          try { version = await invoke("get_binary_version", { name: bin.name }) as string; } catch {}
        }
        return {
          ...bin,
          exists,
          version,
        };
      })
    );
    setBinaries(updated);
  };

  const downloadBinary = async (name: string) => {
    setIsLoading(name);
    setStatus(`${t.processing} ${name}...`);
    try {
      await invoke("download_binary", { name, lang });
      setStatus(`${name} ${t.finished}.`);
      checkBinaries();
    } catch (e) {
      setStatus(`${t.error}: ${e}`);
    } finally {
      setIsLoading(null);
    }
  };

  const fetchVideoInfo = async () => {
    if (!videoUrl) return;
    setIsLoading("fetching");
    setStatus(t.fetching_info);
    try {
      const info = await invoke("get_video_info", { url: videoUrl });
      setVideoInfo(info);
      // Formats arrive sorted: highest res first, mp4 before others at same height
      // Pick the best mp4, fallback to whatever is first
      const formats = (info as any).formats as FormatOption[];
      const bestMp4 = formats.find(f => f.ext === "mp4");
      setSelectedFormat((bestMp4 ?? formats[0])?.format_id || "");
      setStatus(t.ready);
    } catch (e) {
      setStatus(`${t.error}: ${e}`);
    } finally {
      setIsLoading(null);
    }
  };

  const handleVideoDownload = async () => {
    if (!videoUrl || !selectedFormat) return;

    const missingDeps = binaries.filter(b => !b.exists);
    if (missingDeps.length > 0) {
      setView("config");
      setStatus(t.error);
      return;
    }

    setIsLoading("video");
    setStatus(t.processing);
    try {
      const selFmt = (videoInfo?.formats as FormatOption[])?.find(f => f.format_id === selectedFormat);
      const savedPath = await invoke<string>("download_video", { 
        url: videoUrl, 
        formatId: selectedFormat,
        formatExt: selFmt?.ext || "mp4",
        formatHeight: selFmt?.height ?? 0,
        outputFormat,
        customPath: downloadPath 
      });
      // Save to history
      const entry: DownloadEntry = {
        id: Date.now().toString(),
        title: videoInfo?.title || videoUrl,
        url: videoUrl,
        resolution: selFmt?.resolution || "",
        ext: selFmt?.height === 0 ? (selFmt?.ext || "") : (outputFormat === "premiere_mp4" ? "mp4" : (selFmt?.ext || "")),
        filesize: selFmt?.filesize,
        path: savedPath,
        date: new Date().toISOString(),
      };
      setHistory(prev => {
        const updated = [entry, ...prev].slice(0, 50);
        localStorage.setItem("metool-history", JSON.stringify(updated));
        return updated;
      });

      setStatus(t.finished);
      setDownloadProgress(100);
      setVideoUrl("");
      setVideoInfo(null);

      // Open folder
      invoke("open_path", { path: savedPath }).catch(console.error);
    } catch (e) {
      console.error(e);
      setStatus(`${t.error}: ${e}`);
    } finally {
      setIsLoading(null);
      // Reset progress after a short delay so user sees 100%
      setTimeout(() => setDownloadProgress(null), 1500);
    }
  };

  const checkAppUpdates = async () => {
    setUpdateStatus("checking");
    try {
      const result = await checkForUpdates();
      setUpdateResult(result);
      setUpdateStatus(result.hasUpdate ? "available" : "current");
    } catch (e) {
      console.error("Failed to check for updates:", e);
      setUpdateStatus("error");
    }
  };

  const installAppUpdate = async () => {
    if (updateStatus === "downloading") return;
    setUpdateStatus("downloading");
    setStatus(t.downloading_update || "Baixando atualização...");
    try {
      const result = await downloadAndInstallUpdate();
      setStatus(`${t.update_installer_opened || "Instalador aberto"}: ${result.version}`);
    } catch (e) {
      console.error("Failed to install update:", e);
      setUpdateStatus("error");
      setStatus(`${t.error}: ${e}`);
    }
  };

  const updateOutputFormat = (value: OutputFormat) => {
    setOutputFormat(value);
    localStorage.setItem("metool-output-format", value);
  };

  const hideWindow = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch (e) {
      console.error(e);
    }
  };

  const minimizeWindow = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (e) {
      console.error(e);
    }
  };

  const openBinFolder = async () => {
    try {
      await invoke("open_bin_dir");
    } catch (e) {
      console.error("Erro ao abrir pasta:", e);
    }
  };

  const openRepoUrl = async (name: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      const url = name === "yt-dlp" 
        ? "https://github.com/yt-dlp/yt-dlp" 
        : "https://www.gyan.dev/ffmpeg/builds/";
      await open(url);
    } catch (e) {
      console.error("Erro ao abrir URL:", e);
    }
  };

  const selectDownloadPath = async () => {
    try {
      const result = await invoke<string | null>("pick_folder");
      if (result) {
        setDownloadPath(result);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleAutoStart = async () => {
    try {
      if (autoStart) {
        await disable();
        setAutoStart(false);
      } else {
        await enable();
        setAutoStart(true);
      }
    } catch (e) {
      console.error("Failed to toggle autostart", e);
    }
  };

  const handleCompressVideo = async () => {
    if (!compressFile || !compressFormat) return;

    const missingDeps = binaries.filter(b => !b.exists && b.name === "ffmpeg");
    if (missingDeps.length > 0) {
      setView("config");
      setStatus(t.error);
      return;
    }

    setIsLoading("compress");
    setStatus(t.processing || "Processando...");
    try {
      const savedPath = await invoke<string>("compress_video", { 
        inputPath: compressFile, 
        formatExt: compressFormat,
        qualityCrf: compressQuality,
        resolution: compressResolution
      });
      setStatus(t.finished || "Concluído!");
      setCompressFile(null);
      invoke("open_path", { path: savedPath }).catch(console.error);
    } catch (e) {
      console.error(e);
      setStatus(`${t.error}: ${e}`);
    } finally {
      setIsLoading(null);
    }
  };

  const selectCompressFile = async () => {
    try {
      const result = await invoke<{path: string, size_mb: number} | null>("pick_video_file");
      if (result) {
        setCompressFile(result.path);
        setCompressSizeMb(result.size_mb);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
    <div className="glass">
      <header style={{ marginBottom: "20px", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div onClick={() => setView("home")} style={{ cursor: "pointer" }}>
          <h1 className="gradient-text" style={{ fontSize: "1.8rem", margin: "0" }}>{t.title}</h1>
          <p style={{ opacity: 0.6, fontSize: "0.8rem" }}>
            {view === "home" ? t.home_subtitle : view === "config" ? t.config_subtitle : t.history_tab}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setView(view === "history" ? "home" : "history")}
            className="control-btn"
            title="Histórico"
            style={{ position: "relative" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            {history.length > 0 && (
              <span style={{
                position: "absolute", top: "-4px", right: "-4px",
                background: "#ffffff", borderRadius: "50%",
                width: "14px", height: "14px",
                fontSize: "8px", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, lineHeight: 1,
              }}>{Math.min(history.length, 99)}</span>
            )}
          </button>
          {/* Config button */}
          <button onClick={() => setView(view === "home" ? "config" : "home")} className="control-btn" title={t.config_subtitle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
          <button onClick={minimizeWindow} className="control-btn" title="Minimizar">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button onClick={hideWindow} className="control-btn close" title="Esconder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </header>

      {view === "home" || view === "compress" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", paddingTop: "0px", overflowY: "auto" }} className="custom-scroll">
          
          <div style={{ display: "flex", gap: "8px", padding: "4px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <button 
              onClick={() => setView("home")} 
              style={{ flex: 1, padding: "8px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600, background: view === "home" ? "rgba(255, 255, 255, 0.15)" : "transparent", color: view === "home" ? "#a5b4fc" : "rgba(255,255,255,0.4)", transition: "all 0.2s" }}
            >
              {t.tab_download_web}
            </button>
            <button 
              onClick={() => setView("compress")} 
              style={{ flex: 1, padding: "8px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600, background: view === "compress" ? "rgba(255, 255, 255, 0.15)" : "transparent", color: view === "compress" ? "#a5b4fc" : "rgba(255,255,255,0.4)", transition: "all 0.2s" }}
            >
              {t.tab_compress_local}
            </button>
          </div>

          {view === "home" ? (
            <>
              <div className="input-group">
                <div style={{ display: "flex", gap: "8px" }}>
              <input 
                type="text" 
                className="input-field" 
                style={{ flex: 1 }}
                placeholder={t.video_url_placeholder}
                value={videoUrl}
                onChange={(e) => { setVideoUrl(e.target.value); setVideoInfo(null); }}
              />
              <button 
                onClick={fetchVideoInfo} 
                disabled={!videoUrl || isLoading !== null}
                style={{ borderRadius: "12px", padding: "0 15px", background: "rgba(255,255,255,0.05)", minWidth: "46px", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                {isLoading === "fetching" ? <div className="spinner" /> : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Supported sites strip */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.58rem", opacity: 0.22, textTransform: "uppercase", letterSpacing: "0.8px", whiteSpace: "nowrap" }}>suportado</span>
              <div style={{ display: "flex", gap: "7px", alignItems: "center" }}>
                {([
                  { title: "YouTube", color: "#FF0000", d: "M23.5 6.19a3.02 3.02 0 0 0-2.13-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.08 0 12 0 12s0 3.92.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.5 20.5 12 20.5 12 20.5s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.92 24 12 24 12s0-3.92-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" },
                  { title: "X / Twitter", color: "#e7e9ea", d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" },
                  { title: "Instagram", color: "#E1306C", d: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" },
                  { title: "TikTok", color: "#ffffff", d: "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.3 6.3 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.75a4.85 4.85 0 0 1-1.01-.06z" },
                  { title: "Twitch", color: "#9146FF", d: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" },
                  { title: "SoundCloud", color: "#FF5500", d: "M1.175 12.225c-.077 0-.148.03-.2.083a.29.29 0 0 0-.083.225l.245 2.203-.245 2.137a.29.29 0 0 0 .083.225.29.29 0 0 0 .2.083c.154 0 .283-.13.283-.283l.278-2.16-.278-2.25a.286.286 0 0 0-.283-.26zm16.937-2.377a3.55 3.55 0 0 0-2.508 1.037 4.4 4.4 0 0 0-4.404-4.032 4.4 4.4 0 0 0-1.612.31v8.724h8.524A2.586 2.586 0 0 0 20.698 13.4a2.59 2.59 0 0 0-2.586-2.586v.034z" },
                  { title: "Vimeo", color: "#1AB7EA", d: "M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128C5.08 2.701 6.266 1.984 7.055 1.91c1.867-.18 3.016 1.1 3.447 3.838.465 2.953.789 4.789.971 5.507.539 2.45 1.131 3.674 1.776 3.674.502 0 1.256-.796 2.265-2.385 1.004-1.589 1.54-2.797 1.612-3.628.144-1.371-.395-2.061-1.614-2.061-.574 0-1.167.121-1.777.391 1.186-3.868 3.434-5.757 6.762-5.637 2.473.06 3.628 1.664 3.48 4.807z" },
                  { title: "Facebook", color: "#1877F2", d: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
                ] as { title: string; color: string; d: string }[]).map(({ title, color, d }) => (
                  <span
                    key={title}
                    title={title}
                    style={{ width: "13px", height: "13px", color, opacity: 0.28, display: "flex", flexShrink: 0, transition: "opacity 0.2s", cursor: "default" }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "0.28")}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "100%", height: "100%" }}>
                      <path d={d} />
                    </svg>
                  </span>
                ))}
                <span style={{ fontSize: "0.58rem", opacity: 0.18, marginLeft: "1px" }}>+1000</span>
              </div>
            </div>

            {videoInfo && (
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "15px", border: "1px solid rgba(255,255,255,0.05)" }}>
                <p style={{ margin: "0 0 12px 0", fontWeight: "600", fontSize: "0.9rem" }}>{videoInfo.title}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "0.75rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t.quality}</span>
                    <FormatSelect
                      formats={videoInfo.formats}
                      value={selectedFormat}
                      onChange={setSelectedFormat}
                      lang={lang}
                    />
                  </div>
                  
                  <button 
                    className="download-btn" 
                    disabled={isLoading !== null}
                    onClick={handleVideoDownload}
                    style={{ marginTop: "10px" }}
                  >
                    {isLoading === "video" ? <div className="spinner" /> : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        {(videoInfo?.formats as any[])?.find(f => f.format_id === selectedFormat)?.height === 0 ? t.download_audio : t.download_video}
                      </>
                    )}
                  </button>

                  {isLoading === "compress" && (
                     <button 
                      className="control-btn" 
                      onClick={handleCancel}
                      style={{ width: "100%", marginTop: "6px", height: "36px", borderColor: "rgba(248, 113, 113, 0.3)", color: "#f87171" }}
                    >
                      {t.cancel}
                    </button>
                  )}

                  {isLoading === "video" && (
                    <button 
                      className="control-btn" 
                      onClick={handleCancel}
                      style={{ width: "100%", marginTop: "6px", height: "36px", borderColor: "rgba(248, 113, 113, 0.3)", color: "#f87171" }}
                    >
                      {t.cancel}
                    </button>
                  )}

                  {/* Progress bar — visible during and briefly after download */}
                  {downloadProgress !== null && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "2px" }}>
                      <div className="progress-bar-track">
                        <div
                          className={`progress-bar-fill${downloadProgress < 1 ? " indeterminate" : ""}`}
                          style={{ width: `${Math.max(downloadProgress, 2)}%` }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", opacity: 0.45 }}>
                        <span>{downloadProgress >= 100 ? "✓ Concluído" : "Baixando..."}</span>
                        <span>{downloadProgress < 100 ? `${downloadProgress.toFixed(1)}%` : ""}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {!binaries.every(b => b.exists) && (
            <div style={{ padding: "12px", background: "rgba(248, 113, 113, 0.1)", borderRadius: "10px", border: "1px solid rgba(248, 113, 113, 0.2)" }}>
              <p style={{ fontSize: "0.75rem", margin: 0, color: "#f87171" }}>
                Dependências faltando. 
                <span onClick={() => setView("config")} style={{ textDecoration: "underline", marginLeft: "5px", cursor: "pointer" }}>
                  Resolver
                </span>
              </p>
            </div>
          )}
            </>
          ) : null}

          {view === "compress" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="input-group">
                <div style={{ display: "flex", gap: "8px" }}>
                  <div 
                    className="input-field" 
                    style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: compressFile ? 1 : 0.5, cursor: "pointer", display: "flex", alignItems: "center", padding: "0 12px" }}
                    onClick={selectCompressFile}
                  >
                    {compressFile || t.select_video_pc}
                  </div>
                  <button 
                    onClick={selectCompressFile} 
                    style={{ borderRadius: "12px", padding: "0 15px", background: "rgba(255,255,255,0.05)", minWidth: "46px", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <path d="M12 3v12"></path>
                      <path d="M16 11l-4 4-4-4"></path>
                    </svg>
                  </button>
                </div>
                
                {compressFile && (
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "15px", border: "1px solid rgba(255,255,255,0.05)", marginTop: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                         <span style={{ fontSize: "0.7rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t.format}</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {[{v: "mp4", l: "MP4"}, {v: "webm", l: "WebM"}, {v: "mkv", l: "MKV"}, {v: "mp3", l: t.mp3_audio}].map(f => (
                            <button 
                              key={f.v} 
                              onClick={() => setCompressFormat(f.v)}
                              style={{ flex: 1, padding: "6px", fontSize: "0.75rem", borderRadius: "6px", background: compressFormat === f.v ? "rgba(255, 255, 255, 0.3)" : "rgba(255,255,255,0.05)", border: `1px solid ${compressFormat === f.v ? "#ffffff" : "transparent"}`, color: compressFormat === f.v ? "#fff" : "rgba(255,255,255,0.6)" }}
                            >
                              {f.l}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "0.7rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t.target_quality}</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {[
                            {v: "23", l: compressFormat === "mp3" ? "320k" : t.quality_high, e: compressFormat === "mp3" ? "Alta fidelidade" : "~80% original"}, 
                            {v: "28", l: compressFormat === "mp3" ? "192k" : t.quality_medium, e: compressFormat === "mp3" ? "Equilibrado" : "~50% original"}, 
                            {v: "35", l: compressFormat === "mp3" ? "128k" : t.quality_low, e: compressFormat === "mp3" ? "Econômico" : "~30% original"}
                          ].map(q => (
                            <button 
                              key={q.v} 
                              onClick={() => setCompressQuality(q.v)}
                              style={{ flex: 1, padding: "6px", fontSize: "0.75rem", borderRadius: "6px", background: compressQuality === q.v ? "rgba(255, 255, 255, 0.3)" : "rgba(255,255,255,0.05)", border: `1px solid ${compressQuality === q.v ? "#ffffff" : "transparent"}`, color: compressQuality === q.v ? "#fff" : "rgba(255,255,255,0.6)", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}
                            >
                              <span style={{ fontWeight: 600 }}>{q.l}</span>
                              <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>{compressFormat !== "mp3" && compressSizeMb > 0 ? `~${(compressSizeMb * (q.v === "23" ? 0.8 : q.v === "28" ? 0.5 : 0.25)).toFixed(1)}MB` : q.e}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {compressFormat !== "mp3" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <span style={{ fontSize: "0.7rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t.resolution_height}</span>
                          <div style={{ display: "flex", gap: "6px", overflowX: "auto" }} className="custom-scroll pb-1">
                            {[{v: "original", l: t.res_original}, {v: "1080", l: "1080p"}, {v: "720", l: "720p"}, {v: "480", l: "480p"}].map(r => (
                              <button 
                                key={r.v} 
                                onClick={() => setCompressResolution(r.v)}
                                style={{ flex: "1 0 auto", padding: "6px 10px", fontSize: "0.75rem", borderRadius: "6px", background: compressResolution === r.v ? "rgba(255, 255, 255, 0.3)" : "rgba(255,255,255,0.05)", border: `1px solid ${compressResolution === r.v ? "#ffffff" : "transparent"}`, color: compressResolution === r.v ? "#fff" : "rgba(255,255,255,0.6)" }}
                              >
                                {r.l}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <button 
                        className="download-btn" 
                        disabled={isLoading !== null}
                        onClick={handleCompressVideo}
                        style={{ marginTop: "10px" }}
                      >
                        {isLoading === "compress" ? <div className="spinner" /> : (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
                              <line x1="12" y1="8" x2="12" y2="16" />
                              <line x1="8" y1="12" x2="16" y2="12" />
                            </svg>
                            {compressFormat === "mp3" ? t.convert_audio : t.compress_video}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
                
              </div>
              
              <section style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <h2 style={{ fontSize: "0.8rem", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5 }}>{t.compression_logs}</h2>
                <div 
                  ref={scrollRef}
                  style={{ 
                    height: "140px",
                    background: "rgba(6, 5, 8, 0.7)", 
                    borderRadius: "8px", 
                    padding: "12px", 
                    fontFamily: "monospace", 
                    fontSize: "0.75rem", 
                    color: "rgba(235, 228, 255, 0.7)",
                    overflowY: "auto",
                    border: "1px solid var(--border-soft)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px"
                  }}
                  className="custom-scroll"
                >
                  {logs.map((log, i) => (
                    <div key={i} style={{ borderLeft: "2px solid rgba(255, 255, 255, 0.3)", paddingLeft: "8px" }}>
                      {log}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

        </div>
      ) : view === "config" ? (
        <div style={{ textAlign: "left", flex: 1, display: "flex", flexDirection: "column", gap: "15px", overflowY: "auto", paddingRight: "2px" }} className="custom-scroll">
          <section>
            <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, marginBottom: "10px" }}>{t.download_path}</h2>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "10px" }}>
              <span style={{ fontSize: "0.75rem", opacity: 0.6, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {downloadPath || "Padrão (Downloads)"}
              </span>
              <button onClick={selectDownloadPath} style={{ fontSize: "0.7rem", padding: "4px 8px" }}>
                {t.select_folder}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, marginBottom: "10px" }}>{t.output_video_format}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {([
                { value: "premiere_mp4", label: t.output_premiere_mp4, desc: t.output_premiere_mp4_desc },
                { value: "original", label: t.output_original, desc: t.output_original_desc },
              ] as { value: OutputFormat; label: string; desc: string }[]).map(option => (
                <button
                  key={option.value}
                  onClick={() => updateOutputFormat(option.value)}
                  style={{
                    padding: "10px",
                    textAlign: "left",
                    borderRadius: "10px",
                    background: outputFormat === option.value ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${outputFormat === option.value ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.06)"}`,
                    color: "white",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "0.78rem", fontWeight: 700 }}>{option.label}</span>
                  <span style={{ fontSize: "0.68rem", opacity: 0.5, lineHeight: 1.35 }}>{option.desc}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, margin: 0 }}>{t.language}</h2>
              <div style={{ display: "flex", gap: "5px" }}>
                {(['pt', 'en', 'es'] as Language[]).map(l => (
                  <button key={l} onClick={() => setLang(l)} style={{ 
                    padding: "2px 8px", 
                    fontSize: "0.7rem", 
                    background: lang === l ? "rgba(255, 255, 255, 0.2)" : "transparent",
                    borderColor: lang === l ? "#ffffff" : "rgba(255,255,255,0.1)"
                  }}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
               <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, margin: 0 }}>{t.system}</h2>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "10px", marginBottom: "16px" }}>
               <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>{t.autostart}</span>
               <button 
                  onClick={toggleAutoStart} 
                  style={{ 
                    padding: "4px 10px", 
                    fontSize: "0.7rem", 
                    borderRadius: "6px", 
                    background: autoStart ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.05)", 
                    color: autoStart ? "#4ade80" : "rgba(255,255,255,0.5)",
                    border: `1px solid ${autoStart ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}>
                 {autoStart ? t.enabled : t.disabled}
               </button>
            </div>
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, margin: 0 }}>{t.dependencies}</h2>
              <button onClick={openBinFolder} style={{ fontSize: "0.7rem", padding: "4px 8px", opacity: 0.7 }}>
                {t.open_folder}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {binaries.map((bin) => (
                <div key={bin.name} className="binary-card" style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center", 
                  padding: "10px 14px", 
                  background: "rgba(255,255,255,0.02)", 
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.05)"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ 
                      width: "6px", 
                      height: "6px", 
                      borderRadius: "50%", 
                      background: bin.exists ? "#4ade80" : "#f87171",
                      boxShadow: bin.exists ? "0 0 10px #4ade80" : "none"
                    }} />
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>{bin.name}</span>
                      {bin.version && <span style={{ fontSize: "0.65rem", opacity: 0.5, fontFamily: "monospace" }}>v{bin.version}</span>}
                    </div>
                    <button onClick={() => openRepoUrl(bin.name)} style={{ border: "none", background: "none", padding: 0, opacity: 0.3, cursor: "pointer" }} title={t.repo_tooltip}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </button>
                  </div>
                  <button 
                    disabled={isLoading !== null}
                    onClick={() => downloadBinary(bin.name)} 
                    style={{ fontSize: "0.7rem", padding: "4px 10px", display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    {isLoading === bin.name ? <div className="spinner" /> : (bin.exists ? t.update : t.install)}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ fontSize: "0.8rem", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5 }}>{t.output_console}</h2>
            <div 
              ref={scrollRef}
              style={{ 
                height: "140px",
                background: "rgba(6, 5, 8, 0.7)", 
                borderRadius: "8px", 
                padding: "12px", 
                fontFamily: "monospace", 
                fontSize: "0.75rem", 
                color: "rgba(235, 228, 255, 0.7)",
                overflowY: "auto",
                border: "1px solid var(--border-soft)",
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}
              className="custom-scroll"
            >
              {logs.map((log, i) => (
                <div key={i} style={{ borderLeft: "2px solid rgba(255, 255, 255, 0.3)", paddingLeft: "8px" }}>
                  {log}
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : view === "history" ? (
        // History view
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" }} className="custom-scroll">
          {history.length === 0 ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.35, gap: "8px", paddingTop: "40px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>Nenhum download ainda</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.72rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{history.length} download{history.length !== 1 ? "s" : ""}</span>
                <button
                  onClick={() => {
                    if (confirm("Limpar histórico?")) {
                      setHistory([]);
                      localStorage.removeItem("metool-history");
                    }
                  }}
                  style={{ fontSize: "0.65rem", padding: "2px 8px", opacity: 0.5 }}
                >Limpar</button>
              </div>
              {history.map(entry => (
                <div key={entry.id} style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.title}
                    </span>
                    <button
                      onClick={() => invoke("open_path", { path: entry.path }).catch(console.error)}
                      title="Abrir pasta"
                      style={{ padding: "2px 6px", fontSize: "0.65rem", flexShrink: 0, display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                      Abrir
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: "8px", fontSize: "0.7rem", opacity: 0.45 }}>
                    <span>{entry.resolution}</span>
                    {entry.ext && <span>· {entry.ext.toUpperCase()}</span>}
                    {entry.filesize && <span>· {(entry.filesize / 1024 / 1024).toFixed(1)} MB</span>}
                    <span style={{ marginLeft: "auto" }}>{new Date(entry.date).toLocaleDateString("pt-BR")}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}

      <footer style={{ marginTop: "15px", padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.03)" }}>
        <div style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: status.includes(t.error) ? "#f87171" : "#ffffff", opacity: 0.9 }}>●</span>
          <span style={{ opacity: 0.65, flex: 1 }}>{status}</span>
          {appVersion && (
            <span style={{ opacity: 0.2, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.02em", fontSize: "0.65rem" }}>v{appVersion}</span>
          )}
        </div>
      </footer>
      {(updateStatus === "available" || updateStatus === "downloading") && updateResult && (
        <div style={{
          marginTop: "16px",
          padding: "16px",
          background: "rgba(10, 10, 10, 0.8)",
          backdropFilter: "blur(20px)",
          borderRadius: "16px",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          boxShadow: "0 10px 40px rgba(255, 255, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#ffffff", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ffffff", boxShadow: "0 0 12px #ffffff" }} />
              {t.update_available}: v{updateResult.latestVersion}
            </span>
            <button
              onClick={() => { import("@tauri-apps/plugin-shell").then(({ open }) => open(updateResult.releaseUrl)).catch(console.error); }}
              style={{ fontSize: "0.7rem", padding: "4px 10px", background: "transparent", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", cursor: "pointer" }}
            >
              {t.view_github}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.62, lineHeight: 1.5 }}>
              {t.update_description
                .replace("{current}", updateResult.currentVersion)
                .replace("{latest}", updateResult.latestVersion)}
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={installAppUpdate}
                disabled={updateStatus === "downloading"}
                className="download-btn"
                style={{ flex: 1, padding: "9px 12px", fontSize: "0.78rem" }}
              >
                {updateStatus === "downloading" ? <><div className="spinner" />{t.downloading_update}</> : t.download_update}
              </button>
              <button
                onClick={() => setUpdateStatus("idle")}
                disabled={updateStatus === "downloading"}
                style={{ padding: "9px 12px", fontSize: "0.72rem", opacity: 0.7 }}
              >
                {t.later}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {showOnboarding && (
      <Onboarding
        lang={lang}
        setLang={setLang}
        onFinish={() => {
          localStorage.setItem("metool-onboarding-done", "1");
          setShowOnboarding(false);
          checkBinaries();
        }}
      />
    )}
    </>
  );
}

export default App;
