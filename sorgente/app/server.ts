// Brsket — server locale portatile (Deno + yt-dlp + FFmpeg, tutto nella cartella bin/)
// Avvio: ./bin/deno run --allow-all server.ts

const WIN = Deno.build.os === "windows";
const MAC = Deno.build.os === "darwin";
const LINUX = Deno.build.os === "linux";
const SEP = WIN ? "\\" : "/";
const join = (...p: string[]) => p.join(SEP);
const ROOT = import.meta.dirname!;
// quando è stato aggiornato questo file: se l'app viene aggiornata, Brsket riavvia il motore vecchio
const BUILD = (() => { try { return Math.floor((Deno.statSync(join(import.meta.dirname!, "server.ts")).mtime?.getTime() || 0) / 1000); } catch { return 0; } })();
// dati scrivibili (strumenti, impostazioni) separati dall'app, che può essere in sola lettura
const DATA = Deno.env.get("SCARICA_DATA") || ROOT;
const BIN = join(DATA, "bin");
const EXE = WIN ? ".exe" : "";
const YTDLP = Deno.env.get("SCARICA_YTDLP") || join(BIN, "yt-dlp" + EXE);
const FFMPEG_DIR = Deno.env.get("SCARICA_FFMPEG_DIR") || BIN;
const FFMPEG = join(FFMPEG_DIR, "ffmpeg" + EXE);
const FFPROBE = join(FFMPEG_DIR, "ffprobe" + EXE);
const HOME = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ROOT;
const OUT = Deno.env.get("SCARICA_DIR") || join(HOME, "Downloads", "Brsket");
const TMP = join(OUT, ".scarica-tmp");
const PORT = Number(Deno.env.get("SCARICA_PORT") || 8765);
const LAN_PORT = PORT + 1;
const SETTINGS_FILE = join(DATA, "impostazioni.json");
const SEP_DIR = join(BIN, "separa");
const MODEL = Deno.env.get("SCARICA_MODEL") || join(SEP_DIR, "Kim_Vocal_2.onnx");
const MODEL_URL = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx";
const STEMS_READY = join(SEP_DIR, ".strumenti-pronti");
const PY = "3.11";
await Deno.mkdir(TMP, { recursive: true });

const ENV: Record<string, string> = {
  ...Deno.env.toObject(),
  PATH: [BIN, Deno.env.get("PATH") || ""].join(WIN ? ";" : ":"),
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};

const LOG_FILE = join(DATA, "brsket.log");
function log(...parts: unknown[]) {
  const line = `[${new Date().toLocaleTimeString("it-IT")}] ${parts.map((x) => typeof x === "string" ? x : (x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(" ")}\n`;
  try { Deno.writeTextFileSync(LOG_FILE, line, { append: true }); } catch { /* registro non scrivibile */ }
  if (!Deno.env.get("SCARICA_HOSTED")) { try { console.log(line.trimEnd()); } catch { /* */ } }   // evita righe doppie nel registro
}
globalThis.addEventListener("error", (e) => { log("ERRORE NON GESTITO", (e as ErrorEvent).error ?? (e as ErrorEvent).message); e.preventDefault(); });
globalThis.addEventListener("unhandledrejection", (e) => { log("PROMESSA RIFIUTATA", (e as PromiseRejectionEvent).reason); e.preventDefault(); });
globalThis.addEventListener("unload", () => log("il motore si sta chiudendo"));
for (const sig of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
  try { Deno.addSignalListener(sig, () => { log(`ricevuto ${sig}: chiudo`); Deno.exit(0); }); } catch { /* non disponibile */ }
}

const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
const rm = async (p?: string | null) => { if (p) try { await Deno.remove(p, { recursive: true }); } catch { /* già rimosso */ } };

// ---------- impostazioni ----------
type Settings = { schema: string; notify: boolean; lan: boolean; token: string; clients: string[]; cookies: string };
const DEFAULTS: Settings = { schema: "{titolo}_{taglio}", notify: true, lan: false, token: "", clients: [], cookies: "" };
// browser da cui yt-dlp può prendere l'accesso già fatto (Instagram, Facebook, YouTube con limite d'età…)
const COOKIE_BROWSERS = ["safari", "chrome", "firefox", "brave", "edge", "arc", "opera", "vivaldi", "chromium"];
const cookieArgs = (): string[] => settings.cookies && COOKIE_BROWSERS.includes(settings.cookies) ? ["--cookies-from-browser", settings.cookies] : [];
const LOUD = new Set(["-14", "-16", "-23"]);
const FPS = new Set(["24", "25", "30", "50", "60"]);
const RES: Record<string, [number, number]> = { "1080": [1920, 1080], "2160": [3840, 2160] };
let settings: Settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(await Deno.readTextFile(SETTINGS_FILE)) }; } catch { /* prima volta */ }
if (!settings.token) settings.token = String(Math.floor(100000 + Math.random() * 900000));
const saveSettings = () => Deno.writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(() => {});
await saveSettings();

// ---------- formati ----------
const VIDEO_STD = new Set(["mp4", "mov", "mkv", "webm", "avi"]);
const AUDIO = new Set(["mp3", "m4a", "alac", "flac", "wav", "opus", "ogg"]);
const LOSSLESS = new Set(["flac", "wav", "alac"]);
const THUMB_OK = new Set(["mp3", "m4a", "alac", "flac", "opus", "mp4", "mkv"]);
const AUDIO_EXT: Record<string, string> = { alac: "m4a" };
const FORMAT_LABEL: Record<string, string> = {
  mp4: "MP4", mov: "MOV", mkv: "MKV", webm: "WebM", avi: "AVI", mp3: "MP3", m4a: "M4A", alac: "ALAC",
  flac: "FLAC", wav: "WAV", opus: "Opus", ogg: "OGG",
  prores: "ProRes", prores4444: "ProRes 4444", hap: "HAP", hapq: "HAP Q",
};
const PRO: Record<string, { encoder: string; args: string[]; mult4?: boolean }> = {
  prores: { encoder: "prores_ks", args: ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0", "-c:a", "pcm_s16le"] },
  prores4444: { encoder: "prores_ks", args: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-c:a", "pcm_s16le"] },
  hap: { encoder: "hap", args: ["-c:v", "hap", "-format", "hap", "-c:a", "pcm_s16le"], mult4: true },
  hapq: { encoder: "hap", args: ["-c:v", "hap", "-format", "hap_q", "-c:a", "pcm_s16le"], mult4: true },
};
const VIDEO = new Set([...VIDEO_STD, ...Object.keys(PRO)]);
const ASPECTS: Record<string, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
const STEMS_IT: Record<string, string> = {
  vocals: "voce", drums: "batteria", bass: "basso", guitar: "chitarra", piano: "piano", other: "altro", instrumental: "strumentale",
};

let proAvailable: string[] = [];
let hwH264 = false;   // codifica H.264 con il chip del Mac (molto più veloce)
async function detectPro() {
  try {
    const r = await new Deno.Command(FFMPEG, { args: ["-hide_banner", "-encoders"], stdout: "piped", stderr: "null" }).output();
    const list = new TextDecoder().decode(r.stdout);
    hwH264 = MAC && /\sh264_videotoolbox\s/.test(list);
    proAvailable = Object.entries(PRO).filter(([, v]) => new RegExp(`\\s${v.encoder}\\s`).test(list)).map(([k]) => k);
  } catch { /* ffmpeg non ancora pronto */ }
}
let ytdlpVersion = "";
async function detectYtdlp() {
  try {
    const r = await new Deno.Command(YTDLP, { args: ["--version"], env: ENV, stdout: "piped", stderr: "null" }).output();
    if (r.success) ytdlpVersion = new TextDecoder().decode(r.stdout).trim();
  } catch { /* non ancora scaricato */ }
}
detectPro(); detectYtdlp();
// pronto quando yt-dlp e FFmpeg ci sono (al primo avvio arrivano mentre la pagina è già aperta)
async function toolsReady() {
  const ff = await exists(FFMPEG) && await exists(FFPROBE);
  const yt = await exists(YTDLP) && !await exists(join(BIN, ".setup-in-corso"));
  if (ff && !proAvailable.length) await detectPro();
  if (yt && !ytdlpVersion) await detectYtdlp();
  return { ff, yt: yt && !!ytdlpVersion };
}

// ---------- utilità ----------
function cleanError(msg: string): string {
  const line = msg.split("\n").filter((l) => l.includes("ERROR")).pop() || msg.trim().split("\n").pop() || "";
  const m = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/^.*?ERROR:\s*/, "");
  if (/Unsupported URL/i.test(m)) return "Questo link non è supportato.";
  if (/Private video/i.test(m)) return "Il video è privato.";
  if (/cookies?.*(Operation not permitted|permission denied)|Binarycookies|Full Disk Access/i.test(m))
    return "macOS non lascia leggere l'accesso di Safari: in Impostazioni di Sistema → Privacy e sicurezza → Accesso completo al disco attiva Brsket, poi riprova.";
  if (/could not (find|copy|decrypt).*cookie|cookie.*(database|keyring)/i.test(m)) return "Non riesco a leggere l'accesso dal browser scelto: controlla di averlo aperto almeno una volta con l'accesso fatto, oppure scegline un altro nelle Impostazioni.";
  if (/Sign in to confirm|age.?restrict|login required|log in|requires? (a )?login|cookies.*(needed|required)|inappropriate|rate-limit reached|empty media response/i.test(m))
    return settings.cookies ? "Il sito chiede un accesso che il browser scelto non ha: accedi al sito in quel browser e riprova." : "Il sito chiede l'accesso. In Impostazioni attiva «Usa l'accesso del browser» e scegli il browser dove sei già collegato.";
  if (/Unable to (download webpage|connect)|getaddrinfo|timed out/i.test(m)) return "Impossibile raggiungere il sito: controlla il link e la connessione.";
  if (/HTTP Error 404/i.test(m)) return "Contenuto non trovato (404).";
  return m.replace(/;?\s*please report this issue.*$/i, "").trim().slice(0, 300) || "Qualcosa è andato storto.";
}
function toSec(t: unknown): number | null {
  const s = String(t ?? "").trim();
  if (!s || !/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return null;
  return s.split(":").reduce((a, p) => a * 60 + parseFloat(p), 0);
}
const mmss = (n: number) => `${Math.floor(n / 60)}m${String(Math.floor(n % 60)).padStart(2, "0")}`;
const safeName = (t: string) => t.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 180);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const num = (s: string) => (s && s !== "NA" && s !== "None" ? Number(s) : null);

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (l: string) => void) {
  let buf = "";
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    const parts = buf.split(/\r?\n|\r/);
    buf = parts.pop() || "";
    parts.forEach(onLine);
  }
  if (buf) onLine(buf);
}

type Probe = { duration: number; width: number; height: number; vcodec: string; acodec: string; channels: number };
async function probe(file: string): Promise<Probe> {
  const res: Probe = { duration: 0, width: 0, height: 0, vcodec: "", acodec: "", channels: 2 };
  try {
    const r = await new Deno.Command(FFPROBE, {
      args: ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,channels:format=duration", "-of", "json", file],
      stdout: "piped", stderr: "null",
    }).output();
    const j = JSON.parse(new TextDecoder().decode(r.stdout));
    res.duration = parseFloat(j.format?.duration) || 0;
    for (const s of j.streams || []) {
      if (s.codec_type === "video" && !res.vcodec && s.codec_name !== "mjpeg" && s.codec_name !== "png") {
        res.vcodec = s.codec_name; res.width = s.width || 0; res.height = s.height || 0;
      }
      if (s.codec_type === "audio" && !res.acodec) { res.acodec = s.codec_name; res.channels = s.channels || 2; }
    }
  } catch { /* file non leggibile */ }
  return res;
}

// Le notifiche le mostra la pagina (cliccandole si apre il file nel Finder).
// Niente osascript: le sue notifiche aprirebbero Script Editor.
function notify(_subtitle: string, _message: string) { /* gestite dalla pagina */ }

// informazioni già lette con "Continua": il download parte subito senza rianalizzare il sito
const infoCache = new Map<string, { path: string; at: number }>();
async function cacheInfo(url: string, info: unknown) {
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(url))))
    .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const path = join(TMP, `info-${h}.json`);
  await Deno.writeTextFile(path, JSON.stringify(info));
  infoCache.set(url, { path, at: Date.now() });
}

// ---------- lavori ----------
type Phase = { key: string; label: string; w: number; p: number | null; state: "todo" | "active" | "done" };
type Job = Record<string, unknown> & { id: string; stage: string; created_at: number };
type AnyJob = Job & {
  _proc?: Deno.ChildProcess; _file?: string; _cancel?: boolean; _meta?: unknown; _res?: string;
  _files?: string[]; _tmp?: string[]; _dl?: { expected: number | null; doneParts: number; lastTotal: number };
  phases?: Phase[];
};
const jobs = new Map<string, AnyJob>();
const order: string[] = [];
let queueRunning = false;
let active: string | null = null;
let doneInRun = 0;

// ---------- nomi dei file ----------
function fileName(j: AnyJob, ext: string, extra = ""): string {
  const meta = (j._meta || {}) as Record<string, unknown>;
  const trim = j.start != null || j.end != null;
  const tokens: Record<string, string> = {
    data: today(),
    cliente: String(j.client || ""),
    titolo: String(meta.title || j.title || "video"),
    canale: String(meta.uploader || meta.channel || ""),
    id: String(meta.id || ""),
    formato: FORMAT_LABEL[j.format as string] || String(j.format).toUpperCase(),
    risoluzione: String(j._res || ""),
    proporzione: j.aspect && j.aspect !== "orig" ? String(j.aspect).replace(":", "x") : "",
    taglio: trim ? `${mmss((j.start as number) ?? 0)}-${j.end != null ? mmss(j.end as number) : "fine"}` : "",
  };
  let name = (settings.schema || "{titolo}").replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? "");
  name = name.replace(/([_\-.])\1+/g, "$1").replace(/[_-]{2,}/g, "_").replace(/\s{2,}/g, " ").replace(/^[\s_\-.]+|[\s_\-.]+$/g, "");
  name = safeName(name) || safeName(tokens.titolo) || "video";
  return `${name}${extra}.${ext}`;
}
async function uniquePath(name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const base = name.slice(0, dot), ext = name.slice(dot);
  let p = join(OUT, name), n = 2;
  while (await exists(p)) p = join(OUT, `${base} (${n++})${ext}`);
  return p;
}

// ---------- fasi e percentuale complessiva ----------
const sepMode = (j: AnyJob) => (j.mode === "audio" ? String(j.separate || "none") : "none");
const showFix = (j: AnyJob) => j.mode === "video" && ((j.fps && j.fps !== "orig") || (j.res && j.res !== "orig"));
function needsTmpPost(j: AnyJob) {
  return (j.mode === "video" && ((j.format as string) in PRO || j.format === "mov" || (j.aspect && j.aspect !== "orig") || showFix(j))) ||
    sepMode(j) !== "none";
}
function planPhases(j: AnyJob): Phase[] {
  const list = planPhasesBase(j);
  if (j.loud && j.loud !== "off") list.push({ key: "volume", label: "Volume uniforme", w: 0.12, p: 0, state: "todo" });
  const tot = list.reduce((a, x) => a + x.w, 0);
  for (const x of list) x.w = x.w / tot;
  return list;
}
function planPhasesBase(j: AnyJob): Phase[] {
  const ph = (key: string, label: string, w: number): Phase => ({ key, label, w, p: 0, state: "todo" });
  const sep = sepMode(j);
  if (sep !== "none") {
    return [ph("download", "Download", 0.12), ph("separate", sep === "stems" ? "Separazione strumenti" : "Separazione voce", 0.78), ph("convert", "Salvataggio", 0.1)];
  }
  if (needsTmpPost(j)) {
    const fmt = j.format as string;
    const heavy = fmt in PRO || (j.aspect && j.aspect !== "orig") || showFix(j);
    return [ph("download", "Download", heavy ? 0.35 : 0.85), ph("convert", heavy ? `Conversione ${FORMAT_LABEL[fmt]}${showFix(j) ? ` ${j.res !== "orig" ? (j.res === "2160" ? "4K" : "1080p") : ""} ${j.fps !== "orig" ? j.fps + " fps" : ""}`.replace(/\s+/g, " ").trimEnd() : ""}` : "Preparazione MOV", heavy ? 0.65 : 0.15)];
  }
  return [ph("download", "Download", 0.9), ph("finish", "Finalizzazione", 0.1)];
}
function setPhase(j: AnyJob, key: string, p: number | null, stage?: string) {
  const phases = j.phases || [];
  const idx = phases.findIndex((x) => x.key === key);
  phases.forEach((x, i) => {
    if (i < idx) { x.state = "done"; x.p = 1; }
    else if (i === idx) { x.state = "active"; x.p = p == null ? null : Math.max(0, Math.min(1, p)); }
  });
  let overall = 0;
  for (const x of phases) if (x.state !== "todo") overall += x.w * (x.p ?? 0);
  j.overall = Math.round(Math.min(overall, 0.999) * 1000) / 10;
  j.percent = p == null ? null : Math.round(Math.min(1, p) * 1000) / 10;
  if (stage) j.stage = stage;
  const el = (Date.now() / 1000) - (j.started_at as number || Date.now() / 1000);
  j.elapsed = Math.round(el);
  j.eta_total = (j.overall as number) > 3 && el > 3 ? Math.round(el * (100 - (j.overall as number)) / (j.overall as number)) : null;
}

function pump() {
  if (!queueRunning || active) return;
  const id = order.shift();
  if (!id) {
    queueRunning = false;
    if (doneInRun > 1) notify("Coda completata", `${doneInRun} download pronti`);
    doneInRun = 0;
    return;
  }
  const j = jobs.get(id);
  if (!j) return pump();
  active = id;
  runJob(j).finally(() => { active = null; pump(); });
}

function ytdlpArgs(j: AnyJob): string[] {
  const mode = j.mode as string, fmt = j.format as string, q = j.quality as string, br = j.bitrate as string;
  const post = needsTmpPost(j);
  const a = [
    "--no-playlist", "--newline", "--progress", "--quiet", "--no-warnings", "--windows-filenames", "--no-simulate",
    "--ffmpeg-location", FFMPEG_DIR,
    "-o", join(TMP, `${j.id}.%(ext)s`),
    "--progress-template",
    "download:SCARICA %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s|%(info.acodec)s",
    "--print", "pre_process:SCARICAMETA:%(.{title,thumbnail,duration,id,uploader,channel})j",
    "--print", "before_dl:SCARICASIZE:%(filesize,filesize_approx)s",
    "--print", "after_move:SCARICAFILE:%(filepath)s",
    // velocità: 16 frammenti in parallelo, blocchi da 10 MB, nuovo tentativo se il sito rallenta
    "-N", "16", "--http-chunk-size", "10M", "--throttled-rate", "100K", "--retries", "10", "--fragment-retries", "10",
    ...cookieArgs(),
  ];
  if (!post) a.push("--embed-metadata");
  const ch = Number(j.channels) || 2;
  // traccia con il numero di canali scelto (es. 6 = 5.1, 8 = 7.1, 12 = 7.1.4);
  // mono e stereo si ottengono anche riducendo una traccia multicanale
  const A = ch > 2 ? `ba[audio_channels=${ch}]/ba[audio_channels>2]/ba` : "ba[audio_channels<=2]/ba";
  if (mode === "audio") {
    if (post) a.push("-f", `${A}/best`, "-x", "--audio-format", "wav");
    else {
      a.push("-f", `${A}/best`, "-x", "--audio-format", fmt === "ogg" ? "vorbis" : fmt);
      if (!LOSSLESS.has(fmt)) a.push("--audio-quality", `${ch > 2 && Number(br) < 384 && fmt !== "mp3" && fmt !== "ogg" ? Math.max(Number(br), ch * 64) : br}K`);
      if (fmt === "alac") a.push("--postprocessor-args", "ExtractAudio:-c:a alac");
    }
  } else {
    const h = q === "best" ? "" : `[height<=${parseInt(q)}]`;
    a.push("-f", `bv*${h}+${A}/b${h}/bv*+ba/b`);
    if (fmt === "mp4" || fmt === "mov" || post) a.push("-S", "res,fps,vcodec:h264,acodec:aac");
    if (fmt === "webm" && !post) a.push("-S", "res,fps,vcodec:vp9,acodec:opus");
    if (post) a.push("--merge-output-format", "mkv", "--remux-video", "mkv");
    else if (fmt === "webm") a.push("--merge-output-format", "webm/mkv", "--recode-video", "webm");
    else if (fmt === "avi") a.push("--merge-output-format", "mkv", "--recode-video", "avi");
    else a.push("--merge-output-format", fmt, "--remux-video", fmt);
  }
  if (!post && j.thumbnail && THUMB_OK.has(fmt)) a.push("--embed-thumbnail");
  // il taglio si fa dopo, sul computer (cutLocal): le richieste parziali a YouTube si interrompono
  const cached = infoCache.get(j.url as string);
  if (cached && Date.now() - cached.at < 20 * 60 * 1000) a.push("--load-info-json", cached.path);   // niente seconda analisi del sito
  else a.push("--", j.url as string);
  return a;
}

async function runProc(j: AnyJob, cmd: string, args: string[], onLine: (l: string) => void, env = ENV): Promise<[boolean, string]> {
  if (j._cancel) return [false, ""];
  const proc = new Deno.Command(cmd, { args, env, stdout: "piped", stderr: "piped" }).spawn();
  j._proc = proc;
  let err = "";
  const a = readLines(proc.stdout, onLine);
  const b = readLines(proc.stderr, (l) => { err += l + "\n"; if (err.length > 20000) err = err.slice(-10000); });
  const st = await proc.status;
  await Promise.all([a, b]);
  delete j._proc;
  return [st.success, err];
}

function ffmpegProgress(j: AnyJob, phase: string, duration: number) {
  const started = Date.now();
  return (l: string) => {
    const [k, v] = l.split("=");
    if ((k === "out_time_us" || k === "out_time_ms") && duration) {
      const t = Number(v) / 1e6;
      if (Number.isFinite(t) && t > 0) {
        const p = Math.min(0.999, t / duration);
        const el = (Date.now() - started) / 1000;
        setPhase(j, phase, p);
        j.eta = p > 0.01 ? Math.round(el * (1 - p) / p) : null;
      }
    }
  };
}

// canali richiesti: mono e stereo riducono le tracce multicanale; l'MP3 e l'AVI arrivano al massimo allo stereo
// canali da produrre: riduzione (es. 7.1 -> stereo) oppure, se il video ha solo lo stereo,
// 5.1 / 7.1 creati dallo stereo (upmix) quando li scegli
function targetChannels(j: AnyJob, have: number): number | null {
  const want = Math.min(Number(j.channels) || 2, ["mp3", "avi"].includes(j.format as string) ? 2 : 99);
  if (have > want) return want;
  if (have <= 2 && (want === 6 || want === 8)) return want;
  if (have === 1 && want === 2) return 2;   // stereo scelto, sorgente mono: due canali uguali
  return null;
}
function chanArgs(have: number, to: number | null): string[] {
  if (!to) return [];
  if (to === 2 && have === 1) return ["-ac", "2"];
  if (to > have) return ["-af", `aformat=channel_layouts=stereo,surround=chl_out=${to === 8 ? "7.1" : "5.1"}`];
  return ["-ac", String(to)];
}
const ENC_AUDIO: Record<string, string[]> = {
  mp3: ["-c:a", "libmp3lame"], m4a: ["-c:a", "aac"], alac: ["-c:a", "alac"], flac: ["-c:a", "flac"], wav: ["-c:a", "pcm_s16le"],
  opus: ["-c:a", "libopus"], ogg: ["-c:a", "libvorbis"], mp4: ["-c:a", "aac"], mov: ["-c:a", "aac"], mkv: ["-c:a", "aac"],
  webm: ["-c:a", "libopus"], avi: ["-c:a", "libmp3lame"],
};
async function fixChannels(j: AnyJob, src: string): Promise<boolean> {
  const info = await probe(src);
  const to = targetChannels(j, info.channels);
  if (!to) return true;
  const fmt = j.format as string;
  const lossless = LOSSLESS.has(fmt) || fmt === "wav";
  const br = to > 2 ? `${Math.max(Number(j.bitrate) || 0, to * 64)}k` : j.mode === "audio" ? `${j.bitrate}k` : "192k";
  const out = src.replace(/(\.[^.]+)$/, ".canali$1");
  setPhase(j, "finish", null, "process");
  const nm: Record<number, string> = { 1: "mono", 2: "stereo", 6: "5.1", 8: "7.1" };
  j.note = to > info.channels ? (to === 2 ? "Porto l'audio mono a stereo…" : `Creo l'audio ${nm[to]} dallo stereo…`) : `Riduco l'audio a ${nm[to] || to + " canali"}…`;
  const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-i", src, "-map", "0", "-c", "copy",
    ...(ENC_AUDIO[fmt] || ["-c:a", "aac"]), ...(lossless ? [] : ["-b:a", br]), ...chanArgs(info.channels, to), out], () => {});
  j.note = null;
  if (!ok) { await rm(out); return fail(j, `Conversione dei canali audio non riuscita. ${err.trim().split("\n").pop()?.slice(0, 160) || ""}`); }
  await Deno.rename(out, src);
  return true;
}

// MP4 deve aprirsi ovunque (QuickTime, Premiere, telefono): se il sito dà VP9/AV1 (es. 4K di YouTube)
// lo converto in H.264. Se la sorgente è più grande della qualità scelta, la riduco.
async function fixVideo(j: AnyJob, src: string): Promise<boolean> {
  const fmt = j.format as string;
  const info = await probe(src);
  const want = j.quality === "best" ? 0 : parseInt(j.quality as string) || 0;
  const short = Math.min(info.width || info.height, info.height);   // "1080p" = lato corto, vale anche per i video verticali
  const tooBig = want > 0 && short > want * 1.05;
  const badCodec = fmt === "mp4" && !!info.vcodec && !["h264", "hevc"].includes(info.vcodec);
  if (!tooBig && !badCodec) return true;
  const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
  const out = src.replace(/(\.[^.]+)$/, ".h264$1");
  const vf = tooBig ? ["-vf", info.width >= info.height ? `scale=-2:${want}` : `scale=${want}:-2`] : [];
  const audio = ext === "webm" ? ["-c:a", "copy"] : ext === "avi" ? ["-c:a", "copy"]
    : ["aac", "mp3", "alac"].includes(info.acodec) ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", info.channels > 2 ? `${info.channels * 64}k` : "192k"];
  const vcodec = (hw: boolean) => ext === "webm" ? ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4"]
    : ext === "avi" ? ["-c:v", "mpeg4", "-q:v", "3"]
    : hw ? ["-c:v", "h264_videotoolbox", "-q:v", "65", "-pix_fmt", "yuv420p", "-tag:v", "avc1"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"];
  setPhase(j, "finish", null, "process");
  j.note = badCodec ? "Converto in H.264 per renderlo compatibile…" : `Riduco a ${want}p…`;
  const run = (hw: boolean) => runProc(j, FFMPEG, ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-i", src,
    "-map", "0:v:0", "-map", "0:a?", ...vf, ...vcodec(hw), ...audio, "-map_metadata", "0",
    ...(ext === "mp4" || ext === "mov" ? ["-movflags", "+faststart"] : []), out], ffmpegProgress(j, "finish", info.duration));
  let [ok, err] = await run(hwH264);
  if (!ok && hwH264 && !j._cancel) { log("videotoolbox non riuscito, uso libx264"); [ok, err] = await run(false); }
  j.note = null;
  if (!ok || j._cancel) { await rm(out); return j._cancel ? false : fail(j, `Conversione non riuscita. ${err.trim().split("\n").pop()?.slice(0, 160) || ""}`); }
  await rm(src);
  await Deno.rename(out, src);
  return true;
}

// Porta il file al volume scelto (−14 LUFS streaming, −16 podcast, −23 broadcast EBU R128) in due passaggi
async function normalizeLoudness(j: AnyJob, f: string): Promise<boolean> {
  const target = Number(j.loud);
  const info = await probe(f);
  if (!info.acodec) return true;   // niente audio
  setPhase(j, "volume", 0, "process");
  j.note = `Uniformo il volume a ${target} LUFS…`;
  const base = `loudnorm=I=${target}:TP=${target <= -20 ? -2 : -1}:LRA=${target <= -20 ? 15 : 11}`;
  const [ok1, err1] = await runProc(j, FFMPEG, ["-hide_banner", "-nostats", "-i", f, "-map", "0:a:0", "-af", `${base}:print_format=json`, "-f", "null", "-"], () => {});
  const mm = err1.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!ok1 || !mm || j._cancel) { j.note = null; if (j._cancel) return false; log("misura volume non riuscita:", err1.slice(-300)); return fail(j, "Non riesco a misurare il volume di questo file."); }
  const ms = JSON.parse(mm[0]);
  const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase();
  const ch = info.channels || 2;
  const lossyBr = `${Math.max(Number(j.mode === "audio" ? j.bitrate : 256) || 256, ch > 2 ? ch * 64 : 0)}k`;
  let enc: string[];
  if (/^pcm_/.test(info.acodec)) enc = ["-c:a", info.acodec === "pcm_s24le" ? "pcm_s24le" : "pcm_s16le"];
  else if (info.acodec === "flac") enc = ["-c:a", "flac"];
  else if (info.acodec === "alac") enc = ["-c:a", "alac"];
  else if (ext === "mp3" || ext === "avi") enc = ["-c:a", "libmp3lame", "-b:a", ext === "avi" ? "192k" : lossyBr];
  else if (ext === "opus" || ext === "webm") enc = ["-c:a", "libopus", "-b:a", ch > 2 ? `${ch * 64}k` : "192k"];
  else if (ext === "ogg") enc = ["-c:a", "libvorbis", "-b:a", lossyBr];
  else enc = ["-c:a", "aac", "-b:a", lossyBr];
  const sr = await sampleRate(f);
  const out = f.replace(/(\.[^.]+)$/, ".volume$1");
  const af = `${base}:measured_I=${ms.input_i}:measured_TP=${ms.input_tp}:measured_LRA=${ms.input_lra}:measured_thresh=${ms.input_thresh}:offset=${ms.target_offset}:linear=true`;
  const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-i", f, "-map", "0", "-c", "copy", ...enc,
    "-af", af, "-ar", String(sr), "-map_metadata", "0", ...(["mp4", "mov", "m4a"].includes(ext) ? ["-movflags", "+faststart"] : []), out],
    ffmpegProgress(j, "volume", info.duration));
  j.note = null;
  if (!ok || j._cancel) { await rm(out); if (j._cancel) return false; log("volume non riuscito:", err.slice(-300)); return fail(j, `Uniformare il volume non è riuscito. ${err.trim().split("\n").pop()?.slice(0, 160) || ""}`); }
  await rm(f);
  await Deno.rename(out, f);
  return true;
}
async function sampleRate(f: string): Promise<number> {
  try {
    const r = await new Deno.Command(FFPROBE, { args: ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", f], stdout: "piped", stderr: "null" }).output();
    const n = parseInt(new TextDecoder().decode(r.stdout));
    return n > 0 ? n : 48000;
  } catch { return 48000; }
}

function videoArgs(j: AnyJob, info: Probe): string[] {
  const fmt = j.format as string;
  const pro = PRO[fmt];
  const k = j.res === "2160" ? 2 : 1;   // 4K: proporzioni social al doppio (es. 9:16 = 2160x3840)
  const aspect = j.aspect && j.aspect !== "orig" ? ASPECTS[j.aspect as string].map((n) => n * k) as [number, number] : null;
  const forced = !aspect && j.res && j.res !== "orig" ? RES[j.res as string] : null;
  const fpsF = j.fps && j.fps !== "orig" ? `fps=${j.fps}` : "";
  const extra = [fpsF, pro?.mult4 ? "scale=trunc(iw/4)*4:trunc(ih/4)*4" : ""].filter(Boolean).join(",");
  const args: string[] = [];
  if (forced) {
    const [W, H] = forced;
    // risoluzione esatta per lo show: adatta senza deformare, bande nere se le proporzioni sono diverse
    let chain = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    if (extra) chain += `,${extra}`;
    args.push("-filter_complex", `${chain}[v]`, "-map", "[v]", "-map", "0:a?");
  } else if (aspect) {
    const [W, H] = aspect;
    let chain = j.fit === "blur"
      ? `[0:v]split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.06[b];` +
        `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1`
      : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    if (extra) chain += `,${extra}`;
    args.push("-filter_complex", `${chain}[v]`, "-map", "[v]", "-map", "0:a?");
  } else {
    if (extra) args.push("-vf", extra);
    args.push("-map", "0:v:0", "-map", "0:a?");
  }
  const to = targetChannels(j, info.channels);
  args.push(...chanArgs(info.channels, to));
  const oc = to || info.channels;
  if (pro) { args.push(...pro.args); return args; }
  if (fmt === "mov" && !aspect && !forced && !fpsF) {
    // MOV: copia senza perdita se il codec è compatibile, altrimenti H.264 (es. VP9/AV1 in 4K)
    if (["h264", "hevc", "prores"].includes(info.vcodec)) args.push("-c:v", "copy", ...(info.vcodec === "hevc" ? ["-tag:v", "hvc1"] : []));
    else args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p");
    if (["aac", "pcm_s16le", "alac", "mp3"].includes(info.acodec) && !to) args.push("-c:a", "copy");
    else args.push("-c:a", "aac", "-b:a", oc > 2 ? `${oc * 64}k` : "256k");
    args.push("-movflags", "+faststart");
    return args;
  }
  if (fmt === "webm") args.push("-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "160k");
  else if (fmt === "avi") args.push("-c:v", "mpeg4", "-q:v", "3", "-c:a", "libmp3lame", "-ac", "2", "-b:a", "192k");
  else {
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", oc > 2 ? `${oc * 64}k` : "192k");
    if (fmt !== "mkv") args.push("-movflags", "+faststart");
  }
  return args;
}

function audioArgs(fmt: string, br: string): string[] {
  switch (fmt) {
    case "mp3": return ["-c:a", "libmp3lame", "-b:a", `${br}k`];
    case "m4a": return ["-c:a", "aac", "-b:a", `${br}k`];
    case "alac": return ["-c:a", "alac"];
    case "flac": return ["-c:a", "flac"];
    case "wav": return ["-c:a", "pcm_s16le"];
    case "opus": return ["-c:a", "libopus", "-b:a", `${br}k`];
    case "ogg": return ["-c:a", "libvorbis", "-b:a", `${br}k`];
  }
  return [];
}

// ---------- motore di separazione (Python portatile via uv, tutto in bin/separa) ----------
let uvReady: Promise<string> | null = null;
let modelReady: Promise<void> | null = null;
async function findFile(dir: string, name: string): Promise<string | null> {
  try {
    for await (const e of Deno.readDir(dir)) {
      const p = join(dir, e.name);
      if (e.isFile && e.name === name) return p;
      if (e.isDirectory && !["cache", "python", "hf", "torch"].includes(e.name)) { const r = await findFile(p, name); if (r) return r; }
    }
  } catch { /* cartella assente */ }
  return null;
}
async function fetchTo(j: AnyJob, url: string, dest: string, onProgress?: (done: number, total: number) => void) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download non riuscito (${r.status})`);
  const total = Number(r.headers.get("content-length")) || 0;
  const f = await Deno.open(dest + ".part", { write: true, create: true, truncate: true });
  let done = 0;
  try {
    for await (const chunk of r.body) {
      if (j._cancel) throw new Error("Annullato");
      await f.write(chunk); done += chunk.length; onProgress?.(done, total);
    }
  } finally { f.close(); }
  await Deno.rename(dest + ".part", dest);
}
function ensureUv(j: AnyJob): Promise<string> {
  if (uvReady) return uvReady;
  uvReady = (async () => {
    await Deno.mkdir(SEP_DIR, { recursive: true });
    let uv = Deno.env.get("SCARICA_UV") || await findFile(SEP_DIR, "uv" + EXE);
    if (uv) return uv;
    j.note = "Preparo il motore di separazione…";
    const target = MAC ? `${Deno.build.arch}-apple-darwin` : WIN ? "x86_64-pc-windows-msvc" : `${Deno.build.arch}-unknown-linux-gnu`;
    const archive = join(SEP_DIR, WIN ? "uv.zip" : "uv.tar.gz");
    await fetchTo(j, `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.${WIN ? "zip" : "tar.gz"}`, archive);
    const t = await new Deno.Command("tar", { args: ["-xf", archive, "-C", SEP_DIR] }).output();
    await rm(archive);
    if (!t.success) throw new Error("estrazione del motore non riuscita");
    uv = await findFile(SEP_DIR, "uv" + EXE);
    if (!uv) throw new Error("motore di separazione non trovato");
    if (!WIN) await Deno.chmod(uv, 0o755);
    return uv;
  })();
  uvReady.catch(() => { uvReady = null; });
  return uvReady;
}
function ensureVocalModel(j: AnyJob): Promise<void> {
  if (modelReady) return modelReady;
  modelReady = (async () => {
    if (await exists(MODEL)) return;
    await fetchTo(j, MODEL_URL, MODEL, (d, t) => {
      j.note = `Scarico il modello voce${t ? ` · ${Math.round(d / 1048576)} di ${Math.round(t / 1048576)} MB` : "…"}`;
      if (t) setPhase(j, "separate", d / t * 0.3);
    });
  })();
  modelReady.catch(() => { modelReady = null; });
  return modelReady;
}
const UV_ENV = () => ({
  ...ENV, UV_CACHE_DIR: join(SEP_DIR, "cache"), UV_PYTHON_INSTALL_DIR: join(SEP_DIR, "python"),
  UV_PYTHON_PREFERENCE: "only-managed", UV_NO_PROGRESS: "1",
  HF_HOME: join(SEP_DIR, "hf"), TORCH_HOME: join(SEP_DIR, "torch"), HF_HUB_DISABLE_TELEMETRY: "1",
});
// su Linux PyTorch dall'indice CPU (evita 2 GB di driver video); su Mac e Windows il pacchetto standard è già CPU
const TORCH_INDEX = LINUX ? ["--index", "https://download.pytorch.org/whl/cpu", "--index-strategy", "unsafe-best-match"] : [];

async function prepWav(j: AnyJob, src: string): Promise<string | null> {
  const wav = join(TMP, `${j.id}-in.wav`);
  (j._tmp ||= []).push(wav);
  const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-i", src, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", wav], () => {});
  if (!ok) { fail(j, `Preparazione audio non riuscita. ${err.trim().split("\n").pop() || ""}`); return null; }
  return wav;
}

async function encodeStems(j: AnyJob, stems: [string, string][]): Promise<boolean> {
  const fmt = j.format as string, ext = AUDIO_EXT[fmt] || fmt;
  j._files = [];
  let k = 0;
  for (const [file, label] of stems) {
    setPhase(j, "convert", k / stems.length, "convert");
    j.note = `Salvo ${label}`;
    const dest = await uniquePath(fileName(j, ext, ` (${label})`));
    const [ok] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-i", file, ...audioArgs(fmt, j.bitrate as string), dest], () => {});
    if (!ok || j._cancel) { for (const f of j._files) await rm(f); await rm(dest); return fail(j, "Salvataggio delle tracce non riuscito."); }
    j._files.push(dest);
    k++;
  }
  j.note = null;
  return true;
}

async function separateVocals(j: AnyJob, src: string): Promise<boolean> {
  setPhase(j, "separate", null, "separate");
  const uv = await ensureUv(j);
  await ensureVocalModel(j);
  const wav = await prepWav(j, src);
  if (!wav || j._cancel) return false;
  const voc = join(TMP, `${j.id}-voce.wav`), inst = join(TMP, `${j.id}-base.wav`);
  j._tmp!.push(voc, inst);
  j.note = "Avvio il motore (la prima volta installa i componenti)…";
  const started = Date.now();
  const [ok, err] = await runProc(j, uv, ["run", "-q", "--no-project", "--python", PY, "--with", "numpy", "--with", "onnxruntime",
    "python", join(ROOT, "separa.py"), wav, voc, inst, MODEL], (l) => {
    const m = l.match(/^PROGRESS (\d+)\/(\d+)/);
    if (m) {
      const p = +m[1] / +m[2], el = (Date.now() - started) / 1000;
      j.note = null;
      setPhase(j, "separate", 0.3 + p * 0.7);
      j.eta = p > 0 ? Math.round(el * (1 - p) / p) : null;
    }
  }, UV_ENV());
  if (j._cancel) return false;
  if (!ok) return fail(j, `Separazione non riuscita. ${err.trim().split("\n").pop() || ""}`.slice(0, 260));
  return encodeStems(j, [[voc, "voce"], [inst, "base"]]);
}

async function separateStems(j: AnyJob, src: string): Promise<boolean> {
  setPhase(j, "separate", null, "separate");
  const uv = await ensureUv(j);
  const wav = await prepWav(j, src);
  if (!wav || j._cancel) return false;
  const outDir = join(TMP, `${j.id}-tracce`);
  (j._tmp ||= []).push(outDir);
  const wanted = (j.stems as string[]).filter((s) => s in STEMS_IT);
  const first = !await exists(STEMS_READY);
  j.note = first ? "Installo il motore strumenti (solo la prima volta, qualche minuto)…" : "Avvio il motore strumenti…";
  const started = Date.now();
  const written: string[] = [];
  const [ok, err] = await runProc(j, uv, ["run", "-q", "--no-project", "--python", PY, ...TORCH_INDEX,
    "--with", "torch", "--with", "torchaudio", "--with", "demucs", "--with", "numpy",
    "python", join(ROOT, "separa_strumenti.py"), wav, outDir, ...wanted], (l) => {
    if (l.startsWith("STAGE modello")) { j.note = first ? "Scarico il modello strumenti (solo la prima volta)…" : "Carico il modello…"; setPhase(j, "separate", 0.05); }
    else if (l.startsWith("STAGE separazione")) { j.note = null; setPhase(j, "separate", 0.08); }
    else if (l.startsWith("PROGRESS ")) {
      const p = Math.min(1, +l.slice(9) / 100), el = (Date.now() - started) / 1000;
      setPhase(j, "separate", 0.08 + p * 0.92);
      j.eta = p > 0 ? Math.round(el * (1 - p) / p) : null;
    } else if (l.startsWith("STEM ")) written.push(l.slice(5).trim());
  }, UV_ENV());
  if (j._cancel) return false;
  if (!ok) return fail(j, `Separazione strumenti non riuscita. ${err.trim().split("\n").filter((x) => x.trim()).pop() || ""}`.slice(0, 260));
  if (first) await Deno.writeTextFile(STEMS_READY, new Date().toISOString()).catch(() => {});
  const ordered = wanted.filter((s) => written.includes(s)).map((s) => [join(outDir, `${s}.wav`), STEMS_IT[s]] as [string, string]);
  if (!ordered.length) return fail(j, "Nessuna traccia prodotta.");
  return encodeStems(j, ordered);
}

// Taglia il file scaricato tra inizio e fine, ricodificando così il taglio è preciso
async function cutLocal(j: AnyJob, src: string): Promise<boolean> {
  if (j.start == null && j.end == null) return true;
  const st = Number(j.start) || 0;
  const info = await probe(src);
  const end = j.end != null ? Math.min(Number(j.end), info.duration || Number(j.end)) : (info.duration || 0);
  const len = Math.max(0.5, end - st);
  const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
  const out = src.replace(/(\.[^.]+)$/, ".taglio$1");
  const fmt = j.format as string;
  const multi = info.channels > 2 ? `${info.channels * 64}k` : "256k";
  let codec: string[];
  if (ext === "wav") codec = ["-map", "0:a", "-c:a", "pcm_s16le"];
  else if (["mp3", "m4a", "flac"].includes(ext)) codec = ["-map", "0:a", "-map", "0:v?", "-c:v", "copy", ...audioArgs(fmt, String(j.bitrate || "320"))];
  else if (["opus", "ogg"].includes(ext)) codec = ["-map", "0:a", ...audioArgs(fmt, String(j.bitrate || "320"))];
  else if (ext === "webm") codec = ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-c:a", "libopus", "-b:a", "160k"];
  else if (ext === "avi") codec = ["-map", "0:v:0", "-map", "0:a?", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "libmp3lame", "-b:a", "192k"];
  else codec = ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", multi,
    ...(ext === "mkv" ? [] : ["-movflags", "+faststart"])];
  j.note = "Taglio il pezzo scelto…";
  const prev = j.stage as string;
  const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-ss", String(st), "-i", src,
    "-t", String(len), ...codec, "-map_metadata", "0", out], ffmpegProgress(j, (j.phases || []).some((x) => x.key === "finish") ? "finish" : "download", len));
  j.note = null; j.stage = prev;
  if (!ok || j._cancel) {
    await rm(out);
    log("taglio non riuscito:", err.trim().split("\n").slice(-3).join(" | "));
    return fail(j, `Taglio non riuscito. ${err.trim().split("\n").pop()?.slice(0, 160) || ""}`);
  }
  await rm(src);
  await Deno.rename(out, src);
  return true;
}

function fail(j: AnyJob, msg: string): false {
  if (!j._cancel) { Object.assign(j, { stage: "error", error: msg, note: null }); log("lavoro", j.id, "fallito:", msg); }
  return false;
}

async function runJob(j: AnyJob) {
  j.started_at = Date.now() / 1000;
  j.phases = planPhases(j);
  j._dl = { expected: null, doneParts: 0, lastTotal: 0 };
  Object.assign(j, { error: null, note: null, speed: null, eta: null, downloaded: 0, total: 0 });
  setPhase(j, "download", null, "download");
  try {
    // multicanale da YouTube: serve l'analisi con le tracce 5.1 (se è vecchia la rifaccio)
    const c = infoCache.get(j.url as string);
    if ((Number(j.channels) || 2) > 2 && /youtu\.?be/i.test(j.url as string) && (!c || Date.now() - c.at > 20 * 60 * 1000)) {
      j.note = "Cerco le tracce audio multicanale…";
      try { await fetch(`http://127.0.0.1:${PORT}/api/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: j.url }) }).then((r) => r.body?.cancel()); } catch { /* */ }
      j.note = null;
    }
    const [ok, err] = await runProc(j, YTDLP, ytdlpArgs(j), (l) => {
      if (l.startsWith("SCARICAFILE:")) { j._file = l.slice(12).trim(); return; }
      if (l.startsWith("SCARICASIZE:")) { const n = num(l.slice(12).trim()); if (n) j._dl!.expected = n; return; }
      if (l.startsWith("SCARICAMETA:")) {
        try {
          const meta = JSON.parse(l.slice(12));
          j._meta = meta;
          if (meta.title) j.title = meta.title;
          if (meta.thumbnail && !j.thumb) j.thumb = meta.thumbnail;
          if (meta.duration) j.duration = meta.duration;
        } catch { /* ignora */ }
        return;
      }
      if (!l.startsWith("SCARICA ")) return;
      const [st, done, tot, est, speed, eta, vc, ac] = l.slice(8).split("|");
      const total = num(tot) || num(est) || 0, d = num(done) || 0;
      const part = vc && vc !== "none" && vc !== "NA" && ac === "none" ? "video" : vc === "none" ? "audio" : "file";
      const dl = j._dl!;
      if (st === "downloading") {
        dl.lastTotal = total;
        // percentuale su tutti i pezzi (video + audio), non per singolo pezzo
        const expected = dl.expected && dl.expected >= dl.doneParts + total * 0.5 ? dl.expected : null;
        const p = expected ? (dl.doneParts + d) / expected : total ? d / total : null;
        setPhase(j, "download", p == null ? null : Math.min(0.995, p), "download");
        Object.assign(j, { part, speed: num(speed), eta: num(eta), downloaded: dl.doneParts + d, total: expected || (dl.doneParts + total) });
      } else if (st === "finished") {
        dl.doneParts += dl.lastTotal || d;
      }
    });
    if (j._cancel) return;
    if (!ok || !j._file) { log("download non riuscito:", err.trim().split("\n").slice(-4).join(" | ")); fail(j, cleanError(err)); return; }
    j.speed = null; j.eta = null;
    if (!await cutLocal(j, j._file)) return;

    const src = j._file;
    const fmt = j.format as string;
    const sep = sepMode(j);
    if (sep !== "none") {
      const done = sep === "stems" ? await separateStems(j, src) : await separateVocals(j, src);
      await rm(src);
      if (!done) return;
    } else if (needsTmpPost(j)) {
      const info = await probe(src);
      const ext = fmt in PRO || fmt === "mov" ? "mov" : fmt;
      const aspect = j.aspect && j.aspect !== "orig" ? ASPECTS[j.aspect as string] : null;
      const kk = j.res === "2160" ? 2 : 1;
      j._res = aspect ? `${aspect[0] * kk}x${aspect[1] * kk}` : j.res && j.res !== "orig" ? `${j.res}p` : info.height ? `${Math.min(info.width || info.height, info.height)}p` : "";
      if (j.fps && j.fps !== "orig") j._res += aspect ? `@${j.fps}` : `${j.fps}`;
      const dest = await uniquePath(fileName(j, ext));
      setPhase(j, "convert", 0, "convert");
      const meta = (j._meta || {}) as Record<string, string>;
      const [cok, cerr] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-i", src,
        ...videoArgs(j, info), "-metadata", `title=${meta.title || j.title}`, dest], ffmpegProgress(j, "convert", info.duration));
      await rm(src);
      if (j._cancel || !cok) {
        await rm(dest);
        if (!j._cancel) fail(j, `Conversione ${FORMAT_LABEL[fmt]} non riuscita. ${cerr.trim().split("\n").pop()?.slice(0, 200) || ""}`);
        return;
      }
      j._files = [dest];
    } else {
      setPhase(j, "finish", null, "process");
      if (!await fixChannels(j, src)) return;
      if (j.mode === "video" && !await fixVideo(j, src)) return;
      if (j.mode === "video") {
        const info = await probe(src);
        j._res = info.height ? `${Math.min(info.width || info.height, info.height)}p` : "";
      }
      const ext = src.slice(src.lastIndexOf(".") + 1);
      const dest = await uniquePath(fileName(j, ext));
      await Deno.rename(src, dest);
      j._files = [dest];
    }
    if (j.loud && j.loud !== "off") {
      for (const f of j._files || []) if (!await normalizeLoudness(j, f)) return;
    }
    const files = [];
    for (const f of j._files || []) files.push({ name: f.split(/[\\/]/).pop(), size: (await Deno.stat(f)).size });
    // cosa è uscito davvero (si vede nei Completati): risoluzione, fps e canali del primo file
    try {
      const pr = await new Deno.Command(FFPROBE, { args: ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,channels", "-of", "json", (j._files || [])[0]], stdout: "piped", stderr: "null" }).output();
      // deno-lint-ignore no-explicit-any
      const st = (JSON.parse(new TextDecoder().decode(pr.stdout)).streams || []) as any[];
      const v = st.find((x) => x.codec_type === "video" && !["mjpeg", "png"].includes(x.codec_name));
      const a = st.find((x) => x.codec_type === "audio");
      const [fn, fd] = String(v?.avg_frame_rate || "0/1").split("/").map(Number);
      j.out = { w: v?.width || null, h: v?.height || null, fps: fd ? Math.round(fn / fd * 100) / 100 : null, ch: a?.channels || null };
    } catch { /* */ }
    for (const x of j.phases) { x.state = "done"; x.p = 1; }
    Object.assign(j, { stage: "done", percent: 100, overall: 100, eta: null, eta_total: null, files, filename: files[0]?.name,
      size: files.reduce((a, f) => a + f.size, 0), note: null });
    doneInRun++;
    notify("Download completato", files.length > 1 ? `${j.title} · ${files.length} file` : String(j.filename || j.title));
  } catch (e) {
    fail(j, cleanError(String(e instanceof Error ? e.message : e)));
  } finally {
    if (j._cancel) Object.assign(j, { stage: "cancelled", note: null });
    if (j.stage !== "done") {
      try { for await (const e of Deno.readDir(TMP)) if (e.name.startsWith(j.id)) await rm(join(TMP, e.name)); } catch { /* */ }
      if (j.stage === "error") notify("Download non riuscito", String(j.title));
    }
    for (const t of j._tmp || []) await rm(t);
    j._tmp = [];
    j.finished_at = Date.now() / 1000;
    j.elapsed = Math.round((j.finished_at as number) - (j.started_at as number));
  }
}

function stop(j: { _proc?: Deno.ChildProcess }) {
  const p = j._proc;
  if (!p) return;
  try {
    if (WIN) new Deno.Command("taskkill", { args: ["/PID", String(p.pid), "/T", "/F"], stdout: "null", stderr: "null" }).spawn();
    else p.kill("SIGTERM");
  } catch { /* già terminato */ }
}

const publicJob = (j: Record<string, unknown>) => Object.fromEntries(Object.entries(j).filter(([k]) => !k.startsWith("_")));

function reveal(path: string, isFile: boolean) {
  const cmd = MAC ? ["open", ...(isFile ? ["-R", path] : [path])]
    : WIN ? ["explorer", ...(isFile ? [`/select,${path}`] : [path])]
    : ["xdg-open", isFile ? path.split(SEP).slice(0, -1).join(SEP) : path];
  new Deno.Command(cmd[0], { args: cmd.slice(1) }).spawn();
}

// ---------- uso dal telefono (rete locale) ----------
let lanServer: Deno.HttpServer | null = null;
function lanIp(): string | null {
  try {
    for (const n of Deno.networkInterfaces()) {
      if (n.family === "IPv4" && !n.address.startsWith("127.") && !n.address.startsWith("169.254.")) return n.address;
    }
  } catch { /* nessuna rete */ }
  return null;
}
const lanUrl = () => { const ip = lanIp(); return ip ? `http://${ip}:${LAN_PORT}/?k=${settings.token}` : null; };
function setLan(on: boolean) {
  if (on && !lanServer) {
    try { lanServer = Deno.serve({ hostname: "0.0.0.0", port: LAN_PORT, onListen: () => {} }, (req) => handle(req, true)); }
    catch (e) { console.error("Rete locale non disponibile:", e); lanServer = null; }
  } else if (!on && lanServer) { lanServer.shutdown(); lanServer = null; }
}

// ---------- HTTP ----------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };
function queueState() {
  return { running: queueRunning, active, order: [...order],
    jobs: [...jobs.values()].sort((a, b) => b.created_at - a.created_at).map(publicJob) };
}

const PAGE = (title: string, msg: string, status = 200) => new Response(
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Brsket</title>
  <body style="font:17px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;background:#eef1f6;color:#0b0b0f">
  <div><h1 style="font-size:28px;margin-bottom:10px">${title}</h1><p style="color:#6b6b76;max-width:420px;line-height:1.5">${msg}</p></div>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

async function handle(req: Request, remote = false): Promise<Response> {
  try { return await route(req, remote); }
  catch (e) {
    log("errore nella richiesta", e);
    if (new URL(req.url).pathname.startsWith("/api/")) return json({ error: `Errore interno: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` }, 500);
    return PAGE("Qualcosa non va", "Chiudi questa pagina e riapri Brsket.", 500);
  }
}

async function route(req: Request, remote = false): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/jobs" && url.pathname !== "/api/status") log("richiesta", req.method, url.pathname);
  // l'app è stata spostata mentre era aperta: questo processo non trova più i suoi file
  if (!await exists(join(ROOT, "static", "index.html"))) {
    setTimeout(() => Deno.exit(0), 500);
    return PAGE("Brsket è stato spostato", "Nessun problema: chiudi questa pagina e riapri Brsket dalla nuova posizione.");
  }
  const p = url.pathname, m = req.method;

  if (remote) {
    const cookieOk = (req.headers.get("cookie") || "").includes(`scarica=${settings.token}`);
    if (url.searchParams.get("k") === settings.token) {
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `scarica=${settings.token}; Path=/; Max-Age=31536000; SameSite=Lax` } });
    }
    if (!cookieOk) {
      return new Response("<meta name=viewport content='width=device-width'><body style='font:17px -apple-system,sans-serif;padding:40px;text-align:center'>Apri Brsket inquadrando il codice QR nelle impostazioni sul computer.</body>",
        { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (p === "/api/reveal" || (p === "/api/settings" && m === "POST")) return json({ error: "Disponibile solo sul computer." }, 403);
  }

  if (p === "/" && m === "GET") {
    return new Response(await Deno.readFile(join(ROOT, "static", "index.html")),
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (p === "/icon.png") {
    try { return new Response(await Deno.readFile(join(ROOT, "static", "icon.png")), { headers: { "content-type": "image/png" } }); }
    catch { return new Response(null, { status: 404 }); }
  }
  if (p === "/api/quit" && m === "POST" && !remote) {
    log("Esci premuto: chiudo");
    for (const j of jobs.values()) { j._cancel = true; stop(j); }
    // avviato da launchd: togli il servizio, altrimenti launchd lo riaccenderebbe
    const label = Deno.env.get("SCARICA_LAUNCHD");
    if (label && MAC) setTimeout(() => { try { new Deno.Command("/bin/launchctl", { args: ["remove", label], stdout: "null", stderr: "null" }).spawn(); } catch { /* */ } }, 200);
    setTimeout(() => Deno.exit(0), 300);
    return json({ ok: true });
  }
  if (p === "/api/status") {
    const t = await toolsReady();
    let setup = "", setupBytes = 0, setupTotal = 0;
    try { setup = (await Deno.readTextFile(join(BIN, ".setup-in-corso"))).trim(); } catch { /* nessuna preparazione */ }
    if (setup) {
      // avanzamento dei download in parallelo: file in arrivo + pezzi già completati
      try { setupTotal = Number((await Deno.readTextFile(join(BIN, ".setup-total"))).trim()) || 0; } catch { /* */ }
      try {
        for await (const e of Deno.readDir(join(BIN, "dl"))) {
          const f = join(BIN, "dl", e.name);
          if (e.name.endsWith(".done")) setupBytes += Number((await Deno.readTextFile(f)).trim()) || 0;
          else if (/\.(zip|gz|part)$/.test(e.name)) setupBytes += (await Deno.stat(f)).size;
        }
      } catch { /* */ }
    }
    if (setupTotal && setupBytes > setupTotal * 0.97) setupTotal = Math.round(setupBytes * 1.08);   // stima del server troppo bassa
    return json({ root: ROOT, build: BUILD, managed: !!(Deno.env.get("SCARICA_HOSTED") || Deno.env.get("SCARICA_LAUNCHD")), ffmpeg: t.ff, ready: t.ff && t.yt, setup, setupBytes, setupTotal, ytdlp: ytdlpVersion, folder: OUT, pro: proAvailable, os: Deno.build.os,
      remote, separator: await exists(MODEL), stemsReady: await exists(STEMS_READY) });
  }
  if (p === "/api/settings") {
    if (m === "POST") {
      const b = await body(req);
      if (typeof b.schema === "string") settings.schema = b.schema.slice(0, 200);
      if (typeof b.notify === "boolean") settings.notify = b.notify;
      if (typeof b.lan === "boolean") { settings.lan = b.lan; setLan(b.lan); }
      if (typeof b.cookies === "string") settings.cookies = COOKIE_BROWSERS.includes(b.cookies) ? b.cookies : "";
      if (b.newToken) settings.token = String(Math.floor(100000 + Math.random() * 900000));
      await saveSettings();
    }
    return json({ schema: settings.schema, notify: settings.notify, lan: settings.lan, clients: settings.clients, cookies: settings.cookies,
      lanUrl: settings.lan && !remote ? lanUrl() : null, lanActive: !!lanServer, today: today() });
  }
  if (p === "/api/playlist" && m === "POST") {
    if (!(await toolsReady()).yt) return json({ error: "Brsket si sta ancora preparando: aspetta qualche secondo." }, 400);
    const u = String((await body(req)).url || "").trim();
    if (!/^https?:\/\//i.test(u)) return json({ error: "Link non valido." }, 400);
    log("leggo la playlist", u);
    const r = await new Deno.Command(YTDLP, { args: ["-J", "--flat-playlist", "--yes-playlist", "--playlist-end", "500", "--no-warnings", ...cookieArgs(), "--", u],
      env: ENV, stdout: "piped", stderr: "piped" }).output();
    if (r.code !== 0) return json({ error: cleanError(new TextDecoder().decode(r.stderr)) }, 400);
    let pl;
    try { pl = JSON.parse(new TextDecoder().decode(r.stdout)); } catch { return json({ error: "Risposta non valida dal sito." }, 400); }
    // deno-lint-ignore no-explicit-any
    const entries = ((pl.entries || []) as any[]).filter((e) => e && (e.url || e.id)).map((e) => {
      let url = String(e.url || "");
      if (!/^https?:/.test(url)) url = e.ie_key === "Youtube" || /youtube/i.test(pl.extractor_key || "") ? `https://www.youtube.com/watch?v=${e.id}` : (e.webpage_url || url);
      return { url, title: e.title || null, duration: e.duration || null, thumb: e.thumbnails?.at?.(-1)?.url || null };
    }).filter((e) => /^https?:/.test(e.url) && !/\[(Private|Deleted) video\]/i.test(e.title || ""));
    if (!entries.length) return json({ error: "La playlist è vuota o privata." }, 400);
    return json({ title: pl.title || "Playlist", uploader: pl.uploader || pl.channel || "", count: entries.length, entries });
  }
  if (p === "/api/info" && m === "POST") {
    if (!(await toolsReady()).yt) return json({ error: "Brsket si sta ancora preparando: aspetta qualche secondo." }, 400);
    const u = String((await body(req)).url || "").trim();
    if (!u) return json({ error: "Incolla un link." }, 400);
    log("analizzo il link con", YTDLP);
    const t0 = Date.now();
    // YouTube mostra le tracce 5.1 (AC-3 / E-AC-3) solo al lettore "incorporato": lo chiedo in parallelo
    const isYT = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test((() => { try { return new URL(u).hostname; } catch { return ""; } })());
    const surroundQ = isYT ? new Deno.Command(YTDLP, { args: ["-J", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=web_embedded", ...cookieArgs(), "--", u],
      env: ENV, stdout: "piped", stderr: "null" }).output().catch(() => null) : Promise.resolve(null);
    const r = await new Deno.Command(YTDLP, { args: ["-J", "--no-playlist", "--no-warnings", ...cookieArgs(), "--", u], env: ENV, stdout: "piped", stderr: "piped" }).output();
    log(`yt-dlp ha risposto in ${Date.now() - t0} ms, codice ${r.code}${r.signal ? `, segnale ${r.signal}` : ""}`);
    if (r.code !== 0) { log("errore yt-dlp:", new TextDecoder().decode(r.stderr).slice(-600)); return json({ error: cleanError(new TextDecoder().decode(r.stderr)) }, 400); }
    let i;
    try { i = JSON.parse(new TextDecoder().decode(r.stdout)); } catch { return json({ error: "Risposta non valida dal sito." }, 400); }
    const inPlaylist = /[?&]list=[\w-]+/.test(u) || (i._type === "playlist" && (i.entries?.length || 0) > 1);
    if (i._type === "playlist" && i.entries?.length) i = i.entries[0];
    try {
      const sr = await surroundQ;
      if (sr && sr.code === 0) {
        const e = JSON.parse(new TextDecoder().decode(sr.stdout));
        // deno-lint-ignore no-explicit-any
        const extra = ((e.formats || []) as any[]).filter((f) => (Number(f.audio_channels) || 0) > 2 && (!f.vcodec || f.vcodec === "none"));
        // deno-lint-ignore no-explicit-any
        const have = new Set(((i.formats || []) as any[]).map((f) => f.format_id));
        const add = extra.filter((f) => !have.has(f.format_id));
        if (add.length) { i.formats = [...(i.formats || []), ...add]; log(`tracce multicanale trovate: ${add.map((f) => `${f.format_id} ${f.acodec} ${f.audio_channels}ch`).join(", ")}`); }
      }
    } catch { /* niente tracce in più */ }
    cacheInfo(u, i).catch(() => {});
    // deno-lint-ignore no-explicit-any
    const fmts: Record<string, any>[] = i.formats || [i];
    let dur = i.duration || 0;
    // link diretti a un file (es. .mp4 su un sito): il sito non dice la durata, la leggo dal file
    if (!dur && (i.url || fmts[0]?.url)) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
        const pr = await new Deno.Command(FFPROBE, { args: ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,channels", "-of", "json", i.url || fmts[0].url],
          stdout: "piped", stderr: "null", signal: ctl.signal }).output();
        clearTimeout(t);
        const pj = JSON.parse(new TextDecoder().decode(pr.stdout));
        dur = parseFloat(pj.format?.duration) || 0;
        for (const st of pj.streams || []) {
          if (st.codec_type === "video" && st.height && !fmts.some((f) => f.height)) Object.assign(fmts[0], { height: st.height, width: st.width, vcodec: fmts[0].vcodec && fmts[0].vcodec !== "none" ? fmts[0].vcodec : st.codec_name });
          if (st.codec_type === "audio" && st.channels && fmts.length === 1) Object.assign(fmts[0], { audio_channels: st.channels, acodec: fmts[0].acodec && fmts[0].acodec !== "none" ? fmts[0].acodec : st.codec_name });
        }
        if (dur) i.duration = dur;
      } catch { /* pazienza: niente durata */ }
    }
    // deno-lint-ignore no-explicit-any
    const sz = (f: Record<string, any>) => f.filesize || f.filesize_approx || (f.tbr && dur ? f.tbr * 125 * dur : 0);
    // deno-lint-ignore no-explicit-any
    const isV = (f: Record<string, any>) => f.vcodec && f.vcodec !== "none";
    // deno-lint-ignore no-explicit-any
    const isA = (f: Record<string, any>) => f.acodec && f.acodec !== "none";
    const heights = [...new Set(fmts.filter((f) => f.height && isV(f)).map((f) => f.height as number))].sort((a, b) => b - a).slice(0, 9);
    const bestAudio = Math.max(0, ...fmts.filter((f) => isA(f) && !isV(f)).map(sz));
    const est: Record<number, { any: number; h264: number }> = {};
    for (const h of heights) {
      const at = fmts.filter((f) => f.height === h && isV(f));
      // deno-lint-ignore no-explicit-any
      const pick = (list: Record<string, any>[]) => {
        const vo = list.filter((f) => !isA(f)).map(sz).filter(Boolean);
        const co = list.filter(isA).map(sz).filter(Boolean);
        return vo.length ? Math.max(...vo) + bestAudio : co.length ? Math.max(...co) : 0;
      };
      est[h] = { any: pick(at), h264: pick(at.filter((f) => /^(avc|h264)/.test(f.vcodec))) };
    }
    const top = fmts.filter((f) => isV(f) && f.height).sort((a, b) => b.height - a.height)[0] || {};
    return json({
      title: i.title || "Senza titolo", uploader: i.uploader || i.channel || i.extractor_key || "",
      site: i.extractor_key || "", duration: dur || null, thumbnail: i.thumbnail ?? null,
      heights, has_video: heights.length > 0 || fmts.some((f) => f.vcodec !== "none"),
      tracks: Object.values(fmts.filter(isA).reduce((acc: Record<number, { channels: number; codecs: string[] }>, f) => {
        const c = Number(f.audio_channels) || 0;
        if (!c) return acc;
        const codec = String(f.acodec || "").split(".")[0].replace(/^mp4a$/, "aac").replace(/^ec-3$/, "eac3").replace(/^ac-3$/, "ac3");
        acc[c] ||= { channels: c, codecs: [] };
        if (codec && !acc[c].codecs.includes(codec)) acc[c].codecs.push(codec);
        return acc;
      }, {})).sort((a, b) => a.channels - b.channels),
      est, audio_bytes: bestAudio, fps: top.fps || 30, in_playlist: inPlaylist, ratio: top.width && top.height ? top.width / top.height : 16 / 9,
    });
  }
  if (p === "/api/download" && m === "POST") {
    const b = await body(req);
    const u = String(b.url || "").trim(), mode = b.mode === "audio" ? "audio" : "video", fmt = String(b.format || "mp4");
    if (!/^https?:\/\//i.test(u)) return json({ error: "Link non valido: deve iniziare con http:// o https://" }, 400);
    if (!(await toolsReady()).yt || !(await toolsReady()).ff) return json({ error: "Brsket si sta ancora preparando: aspetta qualche secondo." }, 400);
    if ((mode === "video" && !VIDEO.has(fmt)) || (mode === "audio" && !AUDIO.has(fmt))) return json({ error: "Formato non valido." }, 400);
    if (fmt in PRO && !proAvailable.includes(fmt)) return json({ error: `${FORMAT_LABEL[fmt]} non è disponibile in questo FFmpeg.` }, 400);
    const start = toSec(b.start), end = toSec(b.end);
    if ((b.start && start == null) || (b.end && end == null)) return json({ error: "Orario del taglio non valido: usa ad esempio 1:20." }, 400);
    if (start != null && end != null && end <= start) return json({ error: "La fine del taglio deve venire dopo l'inizio." }, 400);
    const separate = mode !== "audio" ? "none" : b.separate === true || b.separate === "vocals" ? "vocals" : b.separate === "stems" ? "stems" : "none";
    const stems = separate === "stems"
      ? (Array.isArray(b.stems) ? b.stems : Object.keys(STEMS_IT)).filter((s: string) => s in STEMS_IT)
      : [];
    if (separate === "stems" && !stems.length) return json({ error: "Scegli almeno una traccia da separare." }, 400);
    const aspect = mode === "video" && b.aspect in ASPECTS ? b.aspect : "orig";
    const client = String(b.client || "").trim().slice(0, 60);
    if (client) { settings.clients = [client, ...settings.clients.filter((c) => c !== client)].slice(0, 12); saveSettings(); }
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const j: AnyJob = {
      id, url: u, mode, format: fmt, quality: String(b.quality ?? "best"), bitrate: String(b.bitrate ?? "320"),
      thumbnail: b.thumbnail !== false, title: b.title || u, thumb: b.thumb || null, duration: b.duration || null,
      start: start && start > 0 ? start : (end != null ? 0 : null), end,
      aspect, fit: b.fit === "blur" ? "blur" : "crop", separate, stems, client,
      loud: LOUD.has(String(b.loud)) && separate === "none" ? String(b.loud) : "off",
      fps: mode === "video" && FPS.has(String(b.fps)) ? String(b.fps) : "orig",
      res: mode === "video" && String(b.res) in RES ? String(b.res) : "orig",
      channels: Number.isInteger(Number(b.channels)) && Number(b.channels) >= 1 && Number(b.channels) <= 24 && separate === "none" ? Number(b.channels) : 2,
      stage: "waiting", percent: 0, overall: 0, created_at: Date.now() / 1000 + Math.random() / 1e4,
    };
    if (j.start === 0 && j.end == null) j.start = null;
    j.phases = planPhases(j);
    jobs.set(id, j);
    if (b.when === "now") { order.unshift(id); queueRunning = true; } else order.push(id);
    pump();
    return json({ id, position: order.indexOf(id), busy: !!active && active !== id });
  }
  if (p === "/api/jobs" && m === "GET") return json(queueState());
  if (p === "/api/queue" && m === "POST") {
    const b = await body(req);
    if (b.action === "start") { queueRunning = true; pump(); }
    if (b.action === "pause") queueRunning = false;
    if (b.action === "clear") { for (const id of order.splice(0)) jobs.delete(id); }
    if (Array.isArray(b.order)) {
      const want = b.order.filter((id: string) => order.includes(id));
      const rest = order.filter((id) => !want.includes(id));
      order.splice(0, order.length, ...want, ...rest);
    }
    return json(queueState());
  }
  const jm = p.match(/^\/api\/jobs\/(\w+)(\/cancel|\/file|\/retry)?$/);
  if (jm) {
    const j = jobs.get(jm[1]);
    if (!j) return json({ error: "Non trovato." }, 404);
    if (jm[2] === "/cancel" && m === "POST") {
      j._cancel = true;
      const idx = order.indexOf(j.id);
      if (idx >= 0) { order.splice(idx, 1); j.stage = "cancelled"; j.finished_at = Date.now() / 1000; } else stop(j);
      return json({ ok: true });
    }
    if (jm[2] === "/retry" && m === "POST") {
      if (["error", "cancelled"].includes(j.stage) && !order.includes(j.id) && active !== j.id) {
        Object.assign(j, { stage: "waiting", _cancel: false, error: null, percent: 0, overall: 0, files: null, filename: null, note: null });
        j.phases = planPhases(j);
        order.unshift(j.id); queueRunning = true; pump();   // "Riprova" = rifallo adesso, davanti agli altri
      }
      return json({ ok: true });
    }
    if (!jm[2] && m === "DELETE") {
      const idx = order.indexOf(j.id);
      if (idx >= 0) order.splice(idx, 1);
      if (active === j.id) { j._cancel = true; stop(j); }
      jobs.delete(j.id);
      return json({ ok: true });
    }
    if (jm[2] === "/file") {
      const f = (j._files || [])[Number(url.searchParams.get("i") || 0)];
      if (f && await exists(f)) {
        const fh = await Deno.open(f);
        const name = f.split(/[\\/]/).pop()!;
        return new Response(fh.readable, { headers: {
          "content-type": "application/octet-stream", "content-length": String((await Deno.stat(f)).size),
          "content-disposition": `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(name)}`,
        } });
      }
      return json({ error: "File non disponibile: forse è stato spostato o eliminato." }, 404);
    }
  }
  if (p === "/api/open-privacy" && m === "POST" && !remote) {
    if (MAC) new Deno.Command("open", { args: ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"] }).spawn();
    return json({ ok: true });
  }
  if (p === "/api/reveal" && m === "POST") {
    const rb = await body(req);
    const id = rb.id;
    const j = id ? jobs.get(id) : undefined;
    const f = j?._files?.[Number(rb.i) || 0];
    if (f && !await exists(f)) return json({ error: "Il file non c'è più: forse è stato spostato o eliminato." }, 404);
    try { reveal(f || OUT, !!f); } catch (e) { return json({ error: String(e) }, 500); }
    return json({ ok: true });
  }
  return json({ error: "Non trovato." }, 404);
}

const address = `http://127.0.0.1:${PORT}`;
try {
  Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen: () => {
    log(`motore acceso (pid ${Deno.pid}) su ${address}, yt-dlp: ${YTDLP}`);
    console.log(`\n  Brsket è in esecuzione su ${address}`);
    console.log(`  I file vanno in: ${OUT}`);
    console.log("  Per chiudere: chiudi questa finestra\n");
    if (settings.lan) setLan(true);
    if (!Deno.env.get("SCARICA_NO_BROWSER")) {
      const cmd = MAC ? ["open", address] : WIN ? ["cmd", "/c", "start", "", address] : ["xdg-open", address];
      try { new Deno.Command(cmd[0], { args: cmd.slice(1) }).spawn(); } catch { /* apri a mano */ }
    }
  } }, (req) => handle(req, false));
} catch (e) {
  // già in esecuzione: apri solo la pagina
  if (e instanceof Deno.errors.AddrInUse) {
    console.log(`  Brsket è già aperto: ${address}`);
    const cmd = MAC ? ["open", address] : WIN ? ["cmd", "/c", "start", "", address] : ["xdg-open", address];
    try { await new Deno.Command(cmd[0], { args: cmd.slice(1) }).output(); } catch { /* */ }
    Deno.exit(0);
  }
  throw e;
}
