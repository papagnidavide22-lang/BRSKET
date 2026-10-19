// Brsket — server locale portatile (Deno + yt-dlp + FFmpeg, tutto nella cartella bin/)
// Avvio: ./bin/deno run --allow-all server.ts
import { XF, xfAvailable, xfVideoArgs } from "./formati.ts";

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
// copie temporanee di file caricati rimaste da una sessione precedente
try { for await (const e of Deno.readDir(TMP)) if (e.name.startsWith("up-")) await Deno.remove(join(TMP, e.name)).catch(() => {}); } catch { /* */ }

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
type Preset = { name: string; opts: Record<string, unknown> };
type Settings = { schema: string; notify: boolean; lan: boolean; token: string; clients: string[]; cookies: string; presets?: Preset[] };
const DEFAULTS: Settings = { schema: "{titolo}_{taglio}", notify: true, lan: false, token: "", clients: [], cookies: "" };
// preset di partenza (si possono cancellare: dopo restano quelli scelti)
const DEFAULT_PRESETS: Preset[] = [
  { name: "Ledwall fiera", opts: { mode: "video", format: "hap", aspect: "orig", fps: "50", res: "1080", loud: "off", channels: 2 } },
  { name: "Reel Instagram", opts: { mode: "video", format: "mp4", aspect: "9:16", fit: "crop", fps: "orig", res: "orig", loud: "-14", channels: 2 } },
];
// browser da cui yt-dlp può prendere l'accesso già fatto (Instagram, Facebook, YouTube con limite d'età…)
const COOKIE_BROWSERS = ["safari", "chrome", "firefox", "brave", "edge", "arc", "opera", "vivaldi", "chromium"];
const cookieArgs = (): string[] => settings.cookies && COOKIE_BROWSERS.includes(settings.cookies) ? ["--cookies-from-browser", settings.cookies] : [];
const LOUD = new Set(["-14", "-16", "-23"]);
const FPS = new Set(["24", "25", "30", "50", "60"]);
const RES: Record<string, [number, number]> = { "1080": [1920, 1080], "2160": [3840, 2160] };
let settings: Settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(await Deno.readTextFile(SETTINGS_FILE)) }; } catch { /* prima volta */ }
if (!settings.token) settings.token = String(Math.floor(100000 + Math.random() * 900000));
if (!Array.isArray(settings.presets)) settings.presets = DEFAULT_PRESETS;
const saveSettings = () => Deno.writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(() => {});
await saveSettings();

// ---------- formati ----------
const VIDEO_STD = new Set(["mp4", "mov", "mkv", "webm", "avi"]);
const AUDIO = new Set(["mp3", "m4a", "alac", "flac", "wav", "opus", "ogg"]);
const LOSSLESS = new Set(["flac", "wav", "alac"]);
const THUMB_OK = new Set(["mp3", "m4a", "alac", "flac", "opus", "mp4", "mkv"]);
const AUDIO_EXT: Record<string, string> = { alac: "m4a" };
const FRAME = new Set(["jpg", "png"]);
const FORMAT_LABEL: Record<string, string> = {
  mp4: "MP4", mov: "MOV", mkv: "MKV", webm: "WebM", avi: "AVI", mp3: "MP3", m4a: "M4A", alac: "ALAC",
  flac: "FLAC", wav: "WAV", opus: "Opus", ogg: "OGG",
  prores: "ProRes", prores4444: "ProRes 4444", hap: "HAP", hapq: "HAP Q", jpg: "JPG", png: "PNG",
};
const PRO: Record<string, { encoder: string; args: string[]; mult4?: boolean }> = {
  prores: { encoder: "prores_ks", args: ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0", "-c:a", "pcm_s16le"] },
  prores4444: { encoder: "prores_ks", args: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-c:a", "pcm_s16le"] },
  hap: { encoder: "hap", args: ["-c:v", "hap", "-format", "hap", "-c:a", "pcm_s16le"], mult4: true },
  hapq: { encoder: "hap", args: ["-c:v", "hap", "-format", "hap_q", "-c:a", "pcm_s16le"], mult4: true },
};
// formati in più (catalogo in formati.ts)
for (const [k, f] of Object.entries(XF)) FORMAT_LABEL[k] = f.label;
const VIDEO = new Set([...VIDEO_STD, ...Object.keys(PRO), ...Object.keys(XF).filter((k) => XF[k].mode === "video")]);
for (const k of Object.keys(XF)) { if (XF[k].mode === "audio") AUDIO.add(k); if (XF[k].mode === "frame") FRAME.add(k); }
const xfOf = (fmt: unknown) => XF[String(fmt)] as (typeof XF)[string] | undefined;
const extOf = (fmt: string) => xfOf(fmt)?.ext || (fmt in PRO || fmt === "mov" ? "mov" : AUDIO_EXT[fmt] || fmt);
let xfOk: string[] = [];
let ENCODERS = "";
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
    const mx = await new Deno.Command(FFMPEG, { args: ["-hide_banner", "-muxers"], stdout: "piped", stderr: "null" }).output();
    ENCODERS = list;
    xfOk = xfAvailable(list, new TextDecoder().decode(mx.stdout));
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
      args: ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,channels:stream_disposition=attached_pic:format=duration", "-of", "json", file],
      stdout: "piped", stderr: "null",
    }).output();
    const j = JSON.parse(new TextDecoder().decode(r.stdout));
    res.duration = parseFloat(j.format?.duration) || 0;
    for (const s of j.streams || []) {
      // la copertina incorporata (attached_pic) non è il video; un video Motion JPEG invece sì
      if (s.codec_type === "video" && !res.vcodec && !s.disposition?.attached_pic) {
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
async function uniquePath(name: string, dir = OUT): Promise<string> {
  const dot = name.lastIndexOf(".");
  const base = name.slice(0, dot), ext = name.slice(dot);
  let p = join(dir, name), n = 2;
  while (await exists(p)) p = join(dir, `${base} (${n++})${ext}`);
  return p;
}

// ---------- fasi e percentuale complessiva ----------
const sepMode = (j: AnyJob) => (j.mode === "audio" ? String(j.separate || "none") : "none");
const showFix = (j: AnyJob) => j.mode === "video" && ((j.fps && j.fps !== "orig") || (j.res && j.res !== "orig"));
function needsTmpPost(j: AnyJob) {
  return (!!xfOf(j.format) && j.mode !== "frame") || (j.mode === "video" && ((j.format as string) in PRO || j.format === "mov" || (j.aspect && j.aspect !== "orig") || showFix(j))) ||
    sepMode(j) !== "none";
}
function planPhases(j: AnyJob): Phase[] {
  const list = planPhasesBase(j);
  if (j.loud && j.loud !== "off") list.push({ key: "volume", label: "Volume uniforme", w: 0.12, p: 0, state: "todo" });
  const tot = list.reduce((a, x) => a + x.w, 0);
  for (const x of list) x.w = x.w / tot;
  return list;
}
// misura finale scelta per lo show: 1080p, 4K o su misura (es. 1152x576 per un ledwall)
const customRes = (j: AnyJob): [number, number] | null => j.res === "custom" ? [Number(j.resW), Number(j.resH)] : null;
const resLabel = (j: AnyJob) => j.res === "custom" ? `${j.resW}×${j.resH}` : j.res === "2160" ? "4K" : j.res === "1080" ? "1080p" : "";
function resToken(j: AnyJob, info: Probe): string {
  const fx = xfOf(j.format)?.fixed;
  if (fx) return fx.split(" a ")[0].replace(/ × /, "x");
  const cr = customRes(j);
  const aspect = !cr && j.aspect && j.aspect !== "orig" ? ASPECTS[j.aspect as string] : null;
  const kk = j.res === "2160" ? 2 : 1;
  let r = cr ? `${cr[0]}x${cr[1]}` : aspect ? `${aspect[0] * kk}x${aspect[1] * kk}` : j.res && j.res !== "orig" ? `${j.res}p`
    : info.height ? `${Math.min(info.width || info.height, info.height)}p` : "";
  if (j.fps && j.fps !== "orig") r += cr || aspect ? `@${j.fps}` : `${j.fps}`;
  return r;
}
function planPhasesBase(j: AnyJob): Phase[] {
  const ph = (key: string, label: string, w: number): Phase => ({ key, label, w, p: 0, state: "todo" });
  if (j.mode === "frame") return [ph("frame", j.frameKind === "cover" ? "Copertina" : "Fotogramma", 1)];
  const sep = sepMode(j);
  if (j.local) {
    if (sep !== "none") return [ph("separate", sep === "stems" ? "Separazione strumenti" : "Separazione voce", 0.88), ph("convert", "Salvataggio", 0.12)];
    const fmt = j.format as string;
    const extra = [resLabel(j), j.fps && j.fps !== "orig" ? `${j.fps} fps` : "", j.aspect && j.aspect !== "orig" && !customRes(j) ? String(j.aspect) : ""].filter(Boolean).join(" ");
    return [ph("convert", `Conversione ${FORMAT_LABEL[fmt]}${extra ? " " + extra : ""}`, 1)];
  }
  if (sep !== "none") {
    return [ph("download", "Download", 0.12), ph("separate", sep === "stems" ? "Separazione strumenti" : "Separazione voce", 0.78), ph("convert", "Salvataggio", 0.1)];
  }
  if (needsTmpPost(j)) {
    const fmt = j.format as string;
    const heavy = fmt in PRO || (j.aspect && j.aspect !== "orig") || showFix(j);
    return [ph("download", "Download", heavy ? 0.35 : 0.85), ph("convert", heavy ? `Conversione ${FORMAT_LABEL[fmt]}${showFix(j) ? ` ${resLabel(j)} ${j.fps !== "orig" ? j.fps + " fps" : ""}`.replace(/\s+/g, " ").trimEnd() : ""}` : "Preparazione MOV", heavy ? 0.65 : 0.15)];
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
  const xf = xfOf(j.format);
  const want = xf?.ac ? xf.ac : Math.min(Number(j.channels) || 2, xf?.maxCh || (["mp3", "avi"].includes(j.format as string) ? 2 : 99));
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
  const xf = xfOf(j.format);
  if (xf && xf.a) enc = xfAudio(xf, String(j.bitrate || 256), ch).filter((x, i, arr) => !(x === "-ar" || arr[i - 1] === "-ar"));
  else if (/^pcm_/.test(info.acodec)) enc = ["-c:a", info.acodec === "pcm_s24le" ? "pcm_s24le" : "pcm_s16le"];
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
  const xf = xfOf(fmt);
  const std = !!xf?.fixed;   // DVD, DV, VCD: misura e frame rate sono quelli dello standard
  const cr = std ? null : customRes(j);   // misura su misura: vince sulle proporzioni
  const aspect = !std && !cr && j.aspect && j.aspect !== "orig" ? ASPECTS[j.aspect as string].map((n) => n * k) as [number, number] : null;
  // misura obbligata del formato (es. XDCAM 1920x1080) quando la risoluzione resta "Originale"
  const forced = std ? null : cr || (!aspect && j.res && j.res !== "orig" ? RES[j.res as string] : null) || (!aspect && xf?.size ? xf.size : null);
  const fpsV = std ? "" : j.fps && j.fps !== "orig" ? String(j.fps) : xf?.fps || "";
  const fpsF = fpsV ? `fps=${fpsV}` : "";
  const mult = pro?.mult4 ? 4 : xf?.mult || 0;
  const extra = [!forced && !aspect && xf?.maxW ? `scale='min(iw,${xf.maxW})':-2:flags=lanczos` : "", fpsF,
    mult ? `scale=trunc(iw/${mult})*${mult}:trunc(ih/${mult})*${mult}` : "", xf?.vf || ""].filter(Boolean).join(",");
  const noAudio = xf?.a === null;
  // porzione scelta trascinando il riquadro nell'anteprima (sinistra, alto, larghezza, altezza in frazioni del video)
  const cp = j.crop as { x: number; y: number; w: number; h: number } | null;
  const cropF = cp ? `crop=trunc(iw*${cp.w}/2)*2:trunc(ih*${cp.h}/2)*2:trunc(iw*${cp.x}):trunc(ih*${cp.y})` : "";
  const args: string[] = [];
  if (forced) {
    const [W, H] = forced;
    // risoluzione esatta per lo show: adatta senza deformare, bande nere se le proporzioni sono diverse
    // (oppure, su misura con "Ritaglio", riempie tutta la misura tagliando i bordi)
    let chain = cr && j.resFit === "crop" && cropF
      ? `[0:v]${cropF},scale=${W}:${H}:flags=lanczos,setsar=1`
      : cr && j.resFit === "crop"
      ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1`
      : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    if (extra) chain += `,${extra}`;
    args.push("-filter_complex", `${chain}[v]`, "-map", "[v]", ...(noAudio ? [] : ["-map", "0:a?"]));
  } else if (aspect) {
    const [W, H] = aspect;
    let chain = j.fit === "blur"
      ? `[0:v]split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.06[b];` +
        `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1`
      : cropF ? `[0:v]${cropF},scale=${W}:${H}:flags=lanczos,setsar=1`
      : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    if (extra) chain += `,${extra}`;
    args.push("-filter_complex", `${chain}[v]`, "-map", "[v]", ...(noAudio ? [] : ["-map", "0:a?"]));
  } else {
    if (extra) args.push("-vf", extra);
    args.push("-map", "0:v:0", ...(noAudio ? [] : ["-map", "0:a?"]));
  }
  const to = targetChannels(j, info.channels);
  if (xf) {
    // formato del catalogo: video come previsto, audio adattato (canali e frequenza del formato)
    if (!noAudio) args.push(...chanArgs(info.channels, to));
    args.push(...xfVideoArgs(xf, ENCODERS), ...(noAudio || !info.acodec ? ["-an"] : xfAudio(xf, "256", to || info.channels)));
    return args;
  }
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
  // file dal computer senza modifiche all'immagine: copio il video così com'è (veloce e senza perdita)
  if (j.local && !aspect && !forced && !extra && j.start == null && j.end == null) {
    const vOk = fmt === "mkv" ? !!info.vcodec : fmt === "webm" ? ["vp8", "vp9", "av1"].includes(info.vcodec) : fmt === "mp4" && ["h264", "hevc"].includes(info.vcodec);
    if (vOk) {
      args.push("-c:v", "copy", ...(fmt === "mp4" && info.vcodec === "hevc" ? ["-tag:v", "hvc1"] : []));
      const aOk = !to && (fmt === "mkv" ? true : fmt === "webm" ? ["opus", "vorbis"].includes(info.acodec) : ["aac", "alac", "mp3", "ac3", "eac3"].includes(info.acodec));
      if (aOk) args.push("-c:a", "copy");
      else if (fmt === "webm") args.push("-c:a", "libopus", "-b:a", oc > 2 ? `${oc * 64}k` : "160k");
      else args.push("-c:a", "aac", "-b:a", oc > 2 ? `${oc * 64}k` : "256k");
      if (fmt === "mp4") args.push("-movflags", "+faststart");
      return args;
    }
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
  const xf = xfOf(fmt);
  if (xf && xf.mode !== "frame") return xfAudio(xf, br);
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

// audio di un formato del catalogo: codec, bitrate scelto (se previsto), frequenza obbligata
function xfAudio(xf: NonNullable<ReturnType<typeof xfOf>>, br?: string, ch = 2): string[] {
  if (xf.a === null) return ["-an"];
  const a = [...(xf.a || [])];
  if (xf.aBr) {
    const kb = Math.max(Number(br) || 0, xf.kbps || 0, ch > 2 ? ch * 80 : 0);
    a.push("-b:a", `${Math.min(kb, xf.maxCh && xf.maxCh > 2 ? 640 : 384)}k`);
  }
  if (xf.ar) a.push("-ar", String(xf.ar));
  return a;
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
  const [pre, post] = j.local ? trimArgs(j, (await probe(src)).duration) : [[], []];
  const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", ...pre, "-i", src, ...post, "-map", "0:a:0", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", wav], () => {});
  if (!ok) { fail(j, `Preparazione audio non riuscita. ${err.trim().split("\n").pop() || ""}`); return null; }
  return wav;
}

async function encodeStems(j: AnyJob, stems: [string, string][]): Promise<boolean> {
  const fmt = j.format as string, ext = extOf(fmt);
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


// ---------- file dal computer (trascinati o scelti) ----------
// "local:<id>": un file già sul Mac (percorso vero, non viene mai toccato) o caricato dalla pagina (copia temporanea)
type Source = { path: string; name: string; title: string; temp: boolean; at: number };
const sources = new Map<string, Source>();
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|mxf|mts|m2ts|ts|mpg|mpeg|wmv|flv|3gp|dv|mp3|m4a|aac|wav|aif|aiff|flac|ogg|opus|wma|caf|ac3|eac3)$/i;
function addSource(path: string, name: string, temp: boolean): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  sources.set(id, { path, name, title: name.replace(/\.[^.]+$/, ""), temp, at: Date.now() });
  return id;
}
const srcOf = (u: unknown) => { const m = String(u || "").match(/^local:(\w+)$/); return m ? sources.get(m[1]) : undefined; };
// le copie caricate dalla pagina restano finché servono (puoi convertire lo stesso file più volte):
// si cancellano dopo 12 ore senza usarle, all'uscita e al prossimo avvio
async function sweepUploads(all = false) {
  for (const [id, s] of sources) {
    if (!s.temp) continue;
    const busy = [...jobs.values()].some((x) => x.url === `local:${id}` && !["done", "error", "cancelled"].includes(x.stage));
    if (!busy && (all || Date.now() - s.at > 12 * 3600 * 1000)) { await rm(s.path); sources.delete(id); }
  }
}
setInterval(() => sweepUploads().catch(() => {}), 3600 * 1000);
async function localInfo(id: string) {
  const s = sources.get(id)!;
  const r = await new Deno.Command(FFPROBE, { args: ["-v", "error", "-show_entries",
    "format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,channels:stream_disposition=attached_pic", "-of", "json", s.path],
    stdout: "piped", stderr: "null" }).output();
  // deno-lint-ignore no-explicit-any
  let pj: any = {};
  try { pj = JSON.parse(new TextDecoder().decode(r.stdout)); } catch { /* */ }
  // deno-lint-ignore no-explicit-any
  const st = (pj.streams || []) as any[];
  const vid = st.find((x) => x.codec_type === "video" && !x.disposition?.attached_pic);
  const cover = st.find((x) => x.codec_type === "video" && x.disposition?.attached_pic);
  const auds = st.filter((x) => x.codec_type === "audio");
  if (!vid && !auds.length) return null;
  const dur = parseFloat(pj.format?.duration) || 0;
  const [fn, fd] = String(vid?.avg_frame_rate || "0/1").split("/").map(Number);
  const tracks: { channels: number; codecs: string[] }[] = [];
  for (const a of auds) {
    const c = Number(a.channels) || 0; if (!c) continue;
    let t = tracks.find((x) => x.channels === c);
    if (!t) tracks.push(t = { channels: c, codecs: [] });
    const name = String(a.codec_name || "").replace(/^pcm_.*/, "pcm");
    if (name && !t.codecs.includes(name)) t.codecs.push(name);
  }
  tracks.sort((a, b) => a.channels - b.channels);
  return {
    title: s.title, uploader: "File dal computer", site: s.name.split(".").pop()?.toUpperCase() || "", duration: dur || null,
    thumbnail: vid ? `/api/frame?src=local:${id}&t=${Math.round(dur * 0.1 * 10) / 10}&w=640` : cover ? `/api/frame?src=local:${id}&cover=1&w=640` : null,
    heights: vid?.height ? [vid.height] : [], has_video: !!vid, tracks, est: {}, audio_bytes: 0,
    fps: fd ? Math.round(fn / fd * 1000) / 1000 : 25, ratio: vid?.width && vid?.height ? vid.width / vid.height : 16 / 9, in_playlist: false,
    local: true, src: `local:${id}`, cover: !!cover, size: Number(pj.format?.size) || 0,
    width: vid?.width || 0, height: vid?.height || 0, vcodec: vid?.codec_name || "", acodec: auds[0]?.codec_name || "",
  };
}
// taglio sul file dal computer: dentro la stessa conversione (un passaggio solo, preciso al fotogramma)
function trimArgs(j: AnyJob, dur: number): [string[], string[], number] {
  if (j.start == null && j.end == null) return [[], [], dur];
  const st = Number(j.start) || 0;
  const end = j.end != null ? Math.min(Number(j.end), dur || Number(j.end)) : dur;
  const len = Math.max(0.1, end - st);
  return [st > 0 ? ["-ss", String(st)] : [], ["-t", String(len)], len];
}
// conversione con FFmpeg di un file sul computer (o già scaricato: allora il taglio è già fatto, trim = false)
async function convertLocal(j: AnyJob, src: string, trim = true): Promise<boolean> {
  const info = await probe(src);
  const sep = sepMode(j);
  if (sep !== "none") {
    if (!info.acodec) return fail(j, "Questo file non ha audio.");
    return sep === "stems" ? await separateStems(j, src) : await separateVocals(j, src);
  }
  const fmt = j.format as string, video = j.mode === "video";
  if (!video && !info.acodec) return fail(j, "Questo file non ha audio.");
  if (video && !info.vcodec) return fail(j, "Questo file non ha video: scegli Solo audio.");
  const xf = xfOf(fmt);
  const ext = extOf(fmt);
  const [pre, post, len] = trim ? trimArgs(j, info.duration) : [[], [], info.duration];
  let args: string[];
  if (video) {
    j._res = resToken(j, info);
    args = videoArgs(j, info);
  } else {
    const to = targetChannels(j, info.channels), oc = to || info.channels;
    const br = !LOSSLESS.has(fmt) && oc > 2 && !["mp3", "ogg"].includes(fmt) ? String(Math.max(Number(j.bitrate) || 0, oc * 64)) : String(j.bitrate);
    args = ["-map", "0:a:0", "-vn", ...chanArgs(info.channels, to), ...(xf ? xfAudio(xf, String(j.bitrate), oc) : audioArgs(fmt, br))];
    // WAV e FLAC da un file a 24 bit restano a 24 bit
    if (fmt === "wav" && /^pcm_s(24|32)/.test(info.acodec)) args.push("-c:a", "pcm_s24le");
    if (fmt === "m4a" || fmt === "alac") args.push("-movflags", "+faststart");
  }
  // sequenza di immagini: una cartella con un file per fotogramma (nome_000001.png, …)
  let dest: string, target: string;
  if (xf?.seq) {
    const base = fileName(j, "x").replace(/\.x$/, "");
    const dir = (j._outDir as string) || OUT;
    dest = join(dir, base); let n = 2;
    while (await exists(dest)) dest = join(dir, `${base} (${n++})`);
    await Deno.mkdir(dest, { recursive: true });
    target = join(dest, `${base}_%06d.${ext}`);
  } else target = dest = await uniquePath(fileName(j, ext), (j._outDir as string) || OUT);
  setPhase(j, "convert", 0, "convert");
  const meta = xf?.seq ? [] : ["-map_metadata", "0", "-metadata", `title=${(j._meta as Record<string, string>)?.title || j.title}`];
  const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", ...pre, "-i", src, ...post,
    ...args, ...meta, target], ffmpegProgress(j, "convert", len));
  if (j._cancel || !ok) {
    await rm(dest);
    if (!j._cancel) { log("conversione file locale non riuscita:", err.slice(-400)); fail(j, `Conversione ${FORMAT_LABEL[fmt]} non riuscita. ${err.trim().split("\n").pop()?.slice(0, 200) || ""}`); }
    return false;
  }
  j._files = [dest];
  return true;
}

// ---------- fotogrammi e copertine ----------
// indirizzo diretto del video sul sito: ffmpeg legge solo il pezzo che serve (niente download intero)
type Stream = { at: number; url: string; headers: Record<string, string>; title: string; duration: number; thumbs: string[] };
const streamCache = new Map<string, Stream>();
async function streamUrl(u: string, preview: boolean): Promise<Stream> {
  const key = u + (preview ? "#anteprima" : "");
  const c = streamCache.get(key);
  if (c && Date.now() - c.at < 50 * 60 * 1000) return c;
  const f = preview ? "bv*[height<=720][vcodec!^=av01]/bv*[height<=720]/b[height<=720]/bv*/b" : "bv*[vcodec!^=av01]/bv*/b";
  const ic = infoCache.get(u);
  const src = ic && Date.now() - ic.at < 20 * 60 * 1000 ? ["--load-info-json", ic.path] : ["--no-playlist", "--", u];
  const r = await new Deno.Command(YTDLP, { args: ["-j", "--no-warnings", "-f", f, ...cookieArgs(), ...src], env: ENV, stdout: "piped", stderr: "piped" }).output();
  if (r.code !== 0) throw new Error(cleanError(new TextDecoder().decode(r.stderr)));
  const d = JSON.parse(new TextDecoder().decode(r.stdout));
  const pick = d.url ? d : (d.requested_formats || [])[0] || {};
  if (!pick.url) throw new Error("Il sito non dà un indirizzo diretto del video.");
  // copertine dalla migliore alla peggiore (la prima a volte non esiste: es. maxresdefault sui video vecchi)
  // deno-lint-ignore no-explicit-any
  const thumbs = [d.thumbnail, ...((d.thumbnails || []) as any[]).slice().sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0) || (b.preference ?? 0) - (a.preference ?? 0)).map((x) => x.url)]
    .filter((x, i, a) => typeof x === "string" && /^https?:/.test(x) && a.indexOf(x) === i).slice(0, 6);
  const out: Stream = { at: Date.now(), url: String(pick.url), headers: (pick.http_headers || d.http_headers || {}) as Record<string, string>,
    title: String(d.title || ""), duration: Number(d.duration) || 0, thumbs };
  streamCache.set(key, out);
  return out;
}
function headerArgs(h: Record<string, string>): string[] {
  const ua = h["User-Agent"];
  const rest = Object.entries(h).filter(([k]) => k !== "User-Agent").map(([k, v]) => `${k}: ${v}\r\n`).join("");
  return [...(ua ? ["-user_agent", ua] : []), ...(rest ? ["-headers", rest] : [])];
}
// argomenti d'ingresso per ffmpeg: fotogramma all'istante t, oppure la copertina
async function frameInput(src: string, t: number, cover: boolean, preview: boolean, thumb?: string): Promise<string[]> {
  const loc = srcOf(src);
  if (loc) {
    if (cover) {
      const r = await new Deno.Command(FFPROBE, { args: ["-v", "error", "-select_streams", "v", "-show_entries", "stream=index:stream_disposition=attached_pic", "-of", "json", loc.path], stdout: "piped", stderr: "null" }).output();
      // deno-lint-ignore no-explicit-any
      const pic = ((JSON.parse(new TextDecoder().decode(r.stdout)).streams || []) as any[]).find((x) => x.disposition?.attached_pic);
      if (!pic) throw new Error("Questo file non ha una copertina.");
      return ["-i", loc.path, "-map", `0:${pic.index}`];
    }
    return [...(t > 0 ? ["-ss", String(t)] : []), "-i", loc.path, "-map", "0:v:0"];
  }
  if (cover) {
    if (!thumb || !/^https?:\/\//.test(thumb)) throw new Error("Questo link non ha una copertina.");
    return ["-i", thumb];
  }
  const s = await streamUrl(src, preview);
  return [...headerArgs(s.headers), ...(t > 0 ? ["-ss", String(t)] : []), "-i", s.url, "-map", "0:v:0"];
}
async function runFrame(j: AnyJob): Promise<boolean> {
  const cover = j.frameKind === "cover";
  const xfi = xfOf(j.format);
  const ext = xfi ? xfi.ext : j.format === "png" ? "png" : "jpg";
  let t = Math.max(0, Number(j.frameT) || 0);
  if (j.duration && t > Number(j.duration)) t = Math.max(0, Number(j.duration) - 0.1);
  setPhase(j, "frame", null, "process");
  j.note = cover ? "Prendo la copertina…" : `Prendo il fotogramma a ${t.toFixed(2).replace(".", ",")} s…`;
  const loc = srcOf(j.url);
  j._meta = loc ? { title: loc.title } : j._meta || { title: j.title };
  // link senza titolo (es. più link incollati insieme): titolo e durata dal sito, così il nome del file è giusto
  let st: Stream | null = null;
  if (!loc && (!j.title || /^https?:/.test(String(j.title)) || !j.duration)) {
    try { st = await streamUrl(String(j.url), true); } catch { /* proverò comunque */ }
    if (st?.title && (!j.title || /^https?:/.test(String(j.title)))) { j.title = st.title; j._meta = { title: st.title }; }
    if (st?.duration && !j.duration) { j.duration = st.duration; if (t > st.duration) t = Math.max(0, st.duration - 0.1); }
  }
  const dest = await uniquePath(fileName(j, ext, cover ? " (copertina)" : ` (fotogramma ${mmss(t)}${t % 1 ? "." + String(Math.round((t % 1) * 100)).padStart(2, "0") : ""})`), (j._outDir as string) || OUT);
  const enc = xfi ? [...(xfi.vf ? ["-vf", xfi.vf] : []), ...xfVideoArgs(xfi, ENCODERS)]
    : ext === "png" ? ["-c:v", "png", "-pix_fmt", "rgb24"] : ["-c:v", "mjpeg", "-q:v", "2", "-pix_fmt", "yuvj444p"];
  const imgMux = !xfi?.mux;   // AVIF ha il suo contenitore: "-update" vale solo per le immagini semplici
  // FFmpeg a volte finisce "bene" senza scrivere niente (istante oltre l'ultima immagine): conta solo un file vero
  const run = async (input: string[]): Promise<[boolean, string]> => {
    await rm(dest);
    const [ok, err] = await runProc(j, FFMPEG, ["-hide_banner", "-y", "-nostats", ...input, "-frames:v", "1", ...(imgMux ? ["-update", "1"] : []), ...enc, dest], () => {});
    const size = (await Deno.stat(dest).catch(() => null))?.size || 0;
    return [ok && size > 0, ok && !size ? `${err}\nOutput file is empty` : err];
  };
  let ok = false, err = "";
  try { [ok, err] = await run(await frameInput(String(j.url), t, cover, false, j.thumb as string | undefined)); }
  catch (e) { err = String(e instanceof Error ? e.message : e); }
  // istante troppo vicino alla fine (l'immagine finisce un po' prima dell'audio): torno indietro un poco
  for (const back of [0.5, 1.5, 4]) {
    if (ok || cover || j._cancel || !/empty|nothing was encoded|no frames/i.test(err) || t <= 0) break;
    t = Math.max(0, t - back);
    try { [ok, err] = await run(await frameInput(String(j.url), t, false, false)); } catch (e) { err = String(e instanceof Error ? e.message : e); }
  }
  // copertina del link non trovata: provo le altre copertine che il sito offre
  if (!ok && cover && !loc && !j._cancel) {
    try { st ||= await streamUrl(String(j.url), true); } catch { /* */ }
    for (const u of (st?.thumbs || []).filter((x) => x !== j.thumb)) {
      [ok, err] = await run(["-i", u]);
      if (ok || j._cancel) break;
    }
  }
  // il sito non lascia leggere a pezzi: scarico il video (solo immagine) e prendo il fotogramma dal file
  if (!ok && !cover && !loc && !j._cancel) {
    log("fotogramma diretto non riuscito, scarico il video:", err.slice(-300));
    j.note = "Scarico il video per prendere il fotogramma…";
    const tmp = join(TMP, `${j.id}-frame.%(ext)s`);
    let file = "";
    const [dok, derr] = await runProc(j, YTDLP, ["--no-playlist", "--quiet", "--no-warnings", "-f", "bv*[vcodec!^=av01]/bv*/b", "-o", tmp, "--print", "after_move:%(filepath)s", "--no-simulate", ...cookieArgs(), "--", String(j.url)],
      (l) => { if (l.trim()) file = l.trim(); });
    if (dok && file) { (j._tmp ||= []).push(file); [ok, err] = await run([...(t > 0 ? ["-ss", String(t)] : []), "-i", file, "-map", "0:v:0"]); }
    else err = cleanError(derr);
  }
  j.note = null;
  if (j._cancel) { await rm(dest); return false; }
  if (!ok || !await exists(dest)) { await rm(dest); return fail(j, /^[A-Z]/.test(err) && err.length < 200 ? err : `Non riesco a prendere ${cover ? "la copertina" : "il fotogramma"}. ${err.trim().split("\n").pop()?.slice(0, 160) || ""}`); }
  j._files = [dest];
  return true;
}


// ---------- autodiagnosi: prova ogni formato con l'FFmpeg di questo computer ----------
// Crea un breve video di prova (1080p, 25 fps, audio 5.1) e un audio stereo, li converte in tutti i formati
// con lo stesso percorso delle conversioni vere, poi controlla che ogni file si apra e si legga fino in fondo.
type TestRes = { k: string; label: string; mode: string; group: string; ok: boolean; err?: string; ms: number };
const selftest = { running: false, done: 0, total: 0, results: [] as TestRes[], missing: [] as { k: string; label: string; mode: string }[], at: 0 };
const BASE_FORMATS: [string, string][] = [["mp4", "video"], ["mov", "video"], ["mkv", "video"], ["webm", "video"], ["avi", "video"],
  ["prores", "video"], ["prores4444", "video"], ["hap", "video"], ["hapq", "video"],
  ["mp3", "audio"], ["m4a", "audio"], ["alac", "audio"], ["flac", "audio"], ["wav", "audio"], ["opus", "audio"], ["ogg", "audio"],
  ["jpg", "frame"], ["png", "frame"]];
async function decodeOk(path: string, k = ""): Promise<string | null> {
  let input = ["-i", path];
  const st = await Deno.stat(path).catch(() => null);
  if (!st) return "file mancante";
  // FFmpeg non sa leggere i WebP animati (li scrive soltanto): controllo l'intestazione del file
  if (k === "webp_anim") {
    const h = new TextDecoder("latin1").decode((await Deno.readFile(path)).slice(0, 64));
    return h.startsWith("RIFF") && h.includes("WEBP") && h.includes("ANIM") ? null : "WebP animato non valido";
  }
  if (st.isDirectory) {
    const names: string[] = []; for await (const e of Deno.readDir(path)) if (e.isFile) names.push(e.name);
    names.sort(); if (!names.length) return "cartella vuota";
    const first = names[0], dot = first.lastIndexOf("."), us = first.lastIndexOf("_");
    input = ["-f", "image2", "-i", join(path, `${first.slice(0, us)}_%06d${first.slice(dot)}`)];
  } else if (!st.size) return "file vuoto";
  const r = await new Deno.Command(FFMPEG, { args: ["-v", "error", "-xerror", ...input, "-f", "null", "-"], stdout: "null", stderr: "piped" }).output();
  const e = new TextDecoder().decode(r.stderr).trim();
  return r.success && !e ? null : (e.split("\n").pop() || "non si legge").slice(0, 160);
}
async function runSelftest() {
  if (selftest.running) return;
  Object.assign(selftest, { running: true, done: 0, results: [], at: Date.now() });
  const dir = join(TMP, `prova-formati-${Date.now()}`);
  try {
    await Deno.mkdir(dir, { recursive: true });
    const vsrc = join(dir, "sorgente.mov"), asrc = join(dir, "sorgente.wav");
    await new Deno.Command(FFMPEG, { args: ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=25:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=48000",
      "-filter_complex", "[1]pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0[a]", "-map", "0", "-map", "[a]", "-c:v", "mjpeg", "-q:v", "3", "-c:a", "pcm_s16le", vsrc], stdout: "null", stderr: "null" }).output();
    await new Deno.Command(FFMPEG, { args: ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=f=330:d=2:sample_rate=44100", "-ac", "2", "-c:a", "pcm_s16le", asrc], stdout: "null", stderr: "null" }).output();
    const vid = addSource(vsrc, "Prova.mov", true), aud = addSource(asrc, "Prova.wav", true);
    const list = [...BASE_FORMATS.filter(([k]) => !(k in PRO) || proAvailable.includes(k)), ...xfOk.map((k) => [k, XF[k].mode] as [string, string])];
    selftest.missing = Object.keys(XF).filter((k) => !xfOk.includes(k)).map((k) => ({ k, label: XF[k].label, mode: XF[k].mode }));
    selftest.total = list.length;
    for (const [k, mode] of list) {
      const t0 = Date.now();
      const j: AnyJob = { id: `prova${selftest.done}`, url: `local:${mode === "audio" ? aud : vid}`, mode, format: k, quality: "best", bitrate: "256", local: true,
        thumbnail: false, title: "Prova", aspect: "orig", fit: "crop", separate: "none", stems: [], client: "", loud: "off", fps: "orig", res: "orig",
        channels: mode === "audio" ? 2 : 6, frameKind: "frame", frameT: 1, start: null, end: null, stage: "waiting", created_at: Date.now() / 1000, _outDir: dir };
      j.phases = planPhases(j);
      const res: TestRes = { k, label: FORMAT_LABEL[k] || k, mode, group: XF[k]?.group || "Di base", ok: false, ms: 0 };
      try {
        const okRun = mode === "frame" ? await runFrame(j) : await convertLocal(j, srcOf(j.url)!.path);
        const out = (j._files || [])[0];
        if (!okRun || !out) res.err = String(j.error || "conversione non riuscita").slice(0, 200);
        else { const e = await decodeOk(out, k); if (e) res.err = `il file non si legge bene: ${e}`; else res.ok = true; }
        for (const f of j._files || []) await rm(f);
      } catch (e) { res.err = String(e instanceof Error ? e.message : e).slice(0, 200); }
      res.ms = Date.now() - t0;
      selftest.results.push(res); selftest.done++;
      if (!res.ok) log(`autodiagnosi: ${k} non funziona: ${res.err}`);
    }
    sources.delete(vid); sources.delete(aud);
    log(`autodiagnosi finita: ${selftest.results.filter((r) => r.ok).length} di ${selftest.total} formati funzionano`);
  } catch (e) { log("autodiagnosi interrotta", e); }
  finally { await rm(dir); selftest.running = false; }
}


// ---------- scheda tecnica: tutto quello che si può sapere di un file o di un link ----------
type Row = [string, string];
type Section = { title: string; rows?: Row[]; table?: { cols: string[]; rows: string[][] }; text?: string; list?: string[] };
const human = {
  size: (b: number) => { if (!b) return ""; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${b.toFixed(i > 1 ? 2 : 0).replace(".", ",")} ${u[i]}`; },
  dur: (s: number) => { if (!s && s !== 0) return ""; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${x.toFixed(x % 1 ? 3 : 0).padStart(x % 1 ? 6 : 2, "0").replace(".", ",")}`; },
  br: (b: number) => !b ? "" : b >= 1e6 ? `${(b / 1e6).toFixed(2).replace(".", ",")} Mbit/s` : `${Math.round(b / 1000)} kbit/s`,
  fps: (f: string) => { const [n, d] = String(f || "0/1").split("/").map(Number); if (!d || !n) return ""; const v = n / d; return `${Number.isInteger(v) ? v : v.toFixed(3).replace(".", ",")} fps${d !== 1 ? ` (${n}/${d})` : ""}`; },
  num: (n: number) => n == null ? "" : Number(n).toLocaleString("it-IT"),
  date: (d: string) => { const m = String(d || "").match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2}):(\d{2}))?/); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}` : String(d || ""); },
};
const CH_NAME: Record<number, string> = { 1: "Mono", 2: "Stereo", 3: "2.1", 4: "4.0", 5: "5.0", 6: "5.1", 7: "6.1", 8: "7.1", 10: "7.1.2", 12: "7.1.4", 16: "9.1.6", 24: "22.2" };
const clean = (v: unknown) => String(v).replace(/[\x00-\x1f\x7f]/g, "").trim();
const rowsOf = (pairs: [string, unknown][]): Row[] => pairs.map(([k, v]) => [k, v == null ? "" : clean(v)] as Row).filter(([, v]) => v !== "" && v !== "N/A" && v !== "unknown");
function pixInfo(p: string) {
  const bits = (p.match(/p(\d{2})(le|be)?$/) || [])[1] || (/^(rgb48|bgr48|rgba64|gray16)/.test(p) ? "16" : /f32/.test(p) ? "32 (float)" : p ? "8" : "");
  const sub = /444|gbr|rgb|bgr|argb|abgr/.test(p) ? "4:4:4" : /422/.test(p) ? "4:2:2" : /420|nv12|p010/.test(p) ? "4:2:0" : /411/.test(p) ? "4:1:1" : "";
  const alpha = /a(444|422|420)|rgba|bgra|argb|abgr|yuva|gbrap|ya/.test(p);
  return { bits, sub, alpha };
}
// ----- analisi del flusso (come MediaInfo): SPS/PPS H.264, GOP, HDR, timecode -----
function hexOf(dump: string): Uint8Array {
  const hex = String(dump || "").split("\n").map((l) => (l.match(/^[0-9a-f]{8}:\s+((?:[0-9a-f]{2,4}\s)+)/i) || [])[1] || "").join("").replace(/\s+/g, "");
  return new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)));
}
class Bits {
  i = 0; constructor(public b: Uint8Array) {}
  bit() { const v = (this.b[this.i >> 3] >> (7 - (this.i & 7))) & 1; this.i++; return v; }
  n(k: number) { let v = 0; for (let x = 0; x < k; x++) v = v * 2 + this.bit(); return v; }
  ue() { let z = 0; while (this.bit() === 0 && z < 32) z++; return (2 ** z - 1) + this.n(z); }
  se() { const k = this.ue(); return k % 2 ? (k + 1) / 2 : -k / 2; }
}
const unescape = (nal: Uint8Array) => { const o: number[] = []; for (let i = 0; i < nal.length; i++) { if (i > 1 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue; o.push(nal[i]); } return new Uint8Array(o); };
// avcC (H.264 nel contenitore): numero di fotogrammi di riferimento e CABAC
function avcConfig(x: Uint8Array): { refs?: number; cabac?: boolean; interlaced?: boolean } {
  try {
    if (x[0] !== 1) return {};
    let p = 5; const nSps = x[p++] & 31; const out: { refs?: number; cabac?: boolean; interlaced?: boolean } = {};
    for (let k = 0; k < nSps; k++) {
      const len = (x[p] << 8) | x[p + 1]; p += 2; const sps = unescape(x.slice(p + 1, p + len)); p += len;
      if (k) continue;
      const b = new Bits(sps); const prof = b.n(8); b.n(16); b.ue();
      if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(prof)) {
        const cf = b.ue(); if (cf === 3) b.bit(); b.ue(); b.ue(); b.bit();
        if (b.bit()) for (let l = 0; l < (cf !== 3 ? 8 : 12); l++) if (b.bit()) { let last = 8, next = 8; for (let j = 0; j < (l < 6 ? 16 : 64); j++) { if (next) next = (last + b.se() + 256) % 256; last = next || last; } }
      }
      b.ue(); const poc = b.ue();
      if (poc === 0) b.ue(); else if (poc === 1) { b.bit(); b.se(); b.se(); const c = b.ue(); for (let j = 0; j < c; j++) b.se(); }
      out.refs = b.ue(); b.bit(); b.ue(); b.ue(); out.interlaced = b.bit() === 0;
    }
    const nPps = x[p++];
    if (nPps) { p += 2; const b = new Bits(unescape(x.slice(p + 1))); b.ue(); b.ue(); out.cabac = b.bit() === 1; }
    return out;
  } catch { return {}; }
}
// i primi 300 fotogrammi: struttura del GOP (M = distanza tra fotogrammi I/P, N = distanza tra fotogrammi chiave) e metadati HDR
async function frameScan(path: string, pre: string[]) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await new Deno.Command(FFPROBE, { args: ["-v", "error", ...pre, "-read_intervals", "%+#300", "-select_streams", "v:0", "-show_entries", "frame=pict_type,key_frame,interlaced_frame,top_field_first:frame_side_data", "-of", "json", path],
      stdout: "piped", stderr: "null", signal: ctl.signal }).output();
    // deno-lint-ignore no-explicit-any
    const fr = (JSON.parse(new TextDecoder().decode(r.stdout) || "{}").frames || []) as any[];
    if (!fr.length) return null;
    const keys = fr.map((f, i) => f.key_frame ? i : -1).filter((i) => i >= 0);
    const N = keys.length > 1 ? keys[1] - keys[0] : null;
    const anchors = fr.map((f, i) => f.pict_type !== "B" ? i : -1).filter((i) => i >= 0);
    const gaps = anchors.slice(1).map((v, i) => v - anchors[i]);
    const M = gaps.length ? Math.max(...gaps) : 1;
    const allI = fr.every((f) => f.pict_type === "I");
    // deno-lint-ignore no-explicit-any
    const side = (fr[0].side_data_list || []) as any[];
    return { N, M, allI, count: fr.length, interlaced: fr.some((f) => f.interlaced_frame), tff: fr.find((f) => f.interlaced_frame)?.top_field_first,
      mastering: side.find((x) => /Mastering display/i.test(x.side_data_type)), light: side.find((x) => /Content light/i.test(x.side_data_type)),
      dovi: side.some((x) => /DOVI|Dolby Vision/i.test(x.side_data_type)), hdr10plus: side.some((x) => /HDR10\+|HDR Dynamic Metadata SMPTE2094-40/i.test(x.side_data_type)) };
  } catch { return null; } finally { clearTimeout(tm); }
}
const frac = (s: string) => { const [a, b] = String(s || "0/1").split("/").map(Number); return b ? a / b : a; };
function primariesName(m: Record<string, string>) {
  const R = [frac(m.red_x), frac(m.red_y)], G = [frac(m.green_x), frac(m.green_y)];
  const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  if (near(R, [0.708, 0.292]) && near(G, [0.17, 0.797])) return "BT.2020";
  if (near(R, [0.68, 0.32]) && near(G, [0.265, 0.69])) return "Display P3";
  if (near(R, [0.64, 0.33]) && near(G, [0.3, 0.6])) return "BT.709";
  return `R ${R.map((n) => n.toFixed(3)).join(",")} · G ${G.map((n) => n.toFixed(3)).join(",")}`;
}
const LANGS: Record<string, string> = { ita: "Italiano", it: "Italiano", eng: "Inglese", en: "Inglese", fra: "Francese", fre: "Francese", fr: "Francese", deu: "Tedesco", ger: "Tedesco", de: "Tedesco", spa: "Spagnolo", es: "Spagnolo",
  por: "Portoghese", pt: "Portoghese", jpn: "Giapponese", ja: "Giapponese", zho: "Cinese", chi: "Cinese", zh: "Cinese", rus: "Russo", ru: "Russo", ara: "Arabo", ar: "Arabo", kor: "Coreano", ko: "Coreano", nld: "Olandese", dut: "Olandese", nl: "Olandese" };
const langName = (l: string) => l ? `${LANGS[l.toLowerCase()] || l}${LANGS[l.toLowerCase()] ? ` (${l})` : ""}` : "";
const BRANDS: Record<string, string> = { isom: "ISO Base Media", iso2: "ISO Base Media v2", mp41: "MP4 v1", mp42: "MP4 v2", avc1: "AVC", "qt  ": "QuickTime", M4V: "Apple M4V", M4A: "Apple M4A", "3gp4": "3GPP", "3gp5": "3GPP", "3g2a": "3GPP2", dash: "MPEG-DASH", XAVC: "Sony XAVC", MSNV: "Sony PSP", iso4: "ISO Base Media v4", iso5: "ISO Base Media v5", iso6: "ISO Base Media v6", hvc1: "HEVC", av01: "AV1" };
const SHORT_FMT: Record<string, string> = { h264: "AVC (H.264)", hevc: "HEVC (H.265)", prores: "ProRes", dnxhd: "DNxHD / DNxHR", av1: "AV1", vp9: "VP9", vp8: "VP8", mpeg2video: "MPEG-2 Video", mpeg4: "MPEG-4 Visual", mjpeg: "Motion JPEG", hap: "HAP", cfhd: "CineForm", ffv1: "FFV1", v210: "Non compresso 10 bit", qtrle: "QuickTime Animation",
  aac: "AAC", mp3: "MP3", ac3: "AC-3", eac3: "E-AC-3", dts: "DTS", truehd: "TrueHD", flac: "FLAC", alac: "ALAC", opus: "Opus", vorbis: "Vorbis" };
// nomi leggibili per i metadati delle telecamere e di Final Cut
function tagLabel(k: string): string {
  const m: Record<string, string> = { "com.apple.proapps.reel": "Bobina (reel)", "com.apple.proapps.scene": "Scena", "com.apple.proapps.shot": "Ripresa (take)", "com.apple.proapps.cameraName": "Nome camera", "com.apple.proapps.cameraAngle": "Angolo camera",
    "com.apple.proapps.clipID": "ID clip", "com.apple.proapps.image.{TIFF}.Make": "Marca", "com.apple.proapps.image.{TIFF}.Model": "Modello", "com.blackmagic-design.camera.environment": "Ambiente", "com.blackmagic-design.camera.dayNight": "Giorno / notte",
    "com.blackmagic-design.camera.dateRecorded": "Data di registrazione", "com.blackmagic-design.camera.lensType": "Obiettivo", "com.blackmagic-design.camera.iso": "ISO", "com.blackmagic-design.camera.whiteBalanceKelvin": "Bilanciamento del bianco",
    "com.blackmagic-design.camera.shutterAngle": "Angolo otturatore", "com.blackmagic-design.camera.shutterSpeed": "Tempo otturatore", "com.blackmagic-design.camera.focalLength": "Lunghezza focale", "com.blackmagic-design.camera.aperture": "Diaframma",
    "com.blackmagic-design.camera.cameraId": "ID camera", "com.blackmagic-design.camera.cameraType": "Modello camera", "com.blackmagic-design.camera.goodTake": "Ripresa buona", "com.blackmagic-design.camera.tint": "Tinta",
    "com.apple.quicktime.author": "Autore", "com.apple.quicktime.keywords": "Parole chiave", "minor_version": "Versione minore", "compatible_brands": "Brand compatibili", "timecode": "Timecode" };
  return m[k] || k.replace(/^com\.(apple\.proapps|blackmagic-design\.camera|apple\.quicktime)\./, (_, g) => g.startsWith("apple.proapps") ? "Final Cut · " : g.startsWith("blackmagic") ? "Blackmagic · " : "QuickTime · ");
}
function tcAdd(tc: string, frames: number, fps: number): string {
  const m = tc.match(/^(\d+):(\d+):(\d+)[:;.](\d+)$/); if (!m || !fps) return "";
  const r = Math.round(fps); let tot = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * r + +m[4] + frames;
  const ff = tot % r; tot = Math.floor(tot / r);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(tot / 3600) % 24)}:${p(Math.floor(tot / 60) % 60)}:${p(tot % 60)}${tc.includes(";") ? ";" : ":"}${p(ff)}`;
}
async function fileDetails(path: string, name: string, temp = false, pre: string[] = []): Promise<Section[]> {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
  const r = await new Deno.Command(FFPROBE, { args: ["-v", "error", ...pre, "-show_format", "-show_streams", "-show_chapters", "-show_data", "-of", "json", path], stdout: "piped", stderr: "null", signal: ctl.signal }).output();
  clearTimeout(tm);
  // deno-lint-ignore no-explicit-any
  const d: any = JSON.parse(new TextDecoder().decode(r.stdout) || "{}");
  const f = d.format || {}, tags = f.tags || {};
  const st = pre.length ? null : await Deno.stat(path).catch(() => null);
  const T = (k: string) => Object.entries(tags).find(([x]) => x.toLowerCase() === k.toLowerCase())?.[1] as string | undefined;
  const fileSize = Number(f.size) || st?.size || 0, fileDur = Number(f.duration) || 0;
  // deno-lint-ignore no-explicit-any
  const streams = (d.streams || []) as any[];
  const mainV = streams.find((x) => x.codec_type === "video" && !x.disposition?.attached_pic);
  const scan = mainV ? await frameScan(path, pre) : null;
  const brand = String(T("major_brand") || "");
  const compat = String(T("compatible_brands") || "").match(/.{1,4}/g) || [];
  const out: Section[] = [];
  out.push({ title: "Generale", rows: rowsOf([["Nome", name], ["Cartella", temp || pre.length ? "" : path.split(/[\\/]/).slice(0, -1).join("/")],
    ["Contenitore", `${f.format_long_name || f.format_name}${f.format_name ? ` (${f.format_name})` : ""}`], ["Profilo formato", BRANDS[brand] || BRANDS[brand.trim()] || ""],
    ["ID codec", brand ? `${brand.trim()}${compat.length ? ` (${compat.map((x) => x.trim()).join("/")})` : ""}` : ""],
    ["Dimensione", fileSize ? `${human.size(fileSize)} (${human.num(fileSize)} byte)` : ""], ["Durata", human.dur(fileDur)], ["Bitrate totale", human.br(Number(f.bit_rate))],
    ["Modalità bitrate", mainV && /prores|dnxhd|v210|hap|qtrle|ffv1|rawvideo/.test(mainV.codec_name) ? "costante (intra-frame)" : ""],
    ["Frequenza fotogrammi", mainV ? human.fps(mainV.avg_frame_rate) : ""], ["Tracce", `${streams.length}`],
    ["Data codifica", T("creation_time") ? `${String(T("creation_time")).replace("T", " ").replace(/\.\d+Z$|Z$/, "")} UTC` : ""], ["Creato (QuickTime)", T("com.apple.quicktime.creationdate")],
    ["Modificato", st?.mtime ? human.date(st.mtime.toISOString()) : ""], ["Marca", T("com.apple.quicktime.make") || T("make")], ["Modello", T("com.apple.quicktime.model") || T("model")],
    ["Software", T("com.apple.quicktime.software") || T("software")], ["Codificato con", T("encoder") || T("encoded_by")], ["Timecode", T("timecode")],
    ["Posizione", T("com.apple.quicktime.location.ISO6709") || T("location")], ["Titolo", T("title")], ["Artista", T("artist")],
    ["Album", T("album")], ["Anno", T("date") || T("year")], ["Genere", T("genre")], ["Commento", T("comment") || T("description")], ["Copyright", T("copyright")]]) });
  const trackSize = (s: { bit_rate?: string; duration?: string }) => {
    const b = Number(s.bit_rate) * (Number(s.duration) || fileDur) / 8;
    return b > 0 ? `${human.size(b)}${fileSize ? ` (${Math.round(b / fileSize * 100)}%)` : ""}` : "";
  };
  let vi = 0, ai = 0, si = 0;
  for (const s of streams) {
    const t = s.tags || {}, disp = s.disposition || {};
    const lang = langName(t.language && t.language !== "und" ? t.language : "");
    if (s.codec_type === "video" && disp.attached_pic) {
      out.push({ title: "Copertina incorporata", rows: rowsOf([["Formato", s.codec_long_name || s.codec_name], ["Misura", `${s.width} × ${s.height}`]]) });
      continue;
    }
    if (s.codec_type === "video") {
      const main = s === mainV;
      const px = pixInfo(String(s.pix_fmt || ""));
      const sideRot = (s.side_data_list || []).find((x: { rotation?: number }) => x.rotation != null)?.rotation;
      const md = main ? scan?.mastering || (s.side_data_list || []).find((x: { side_data_type?: string }) => /Mastering display/i.test(x.side_data_type || "")) : null;
      const cl = main ? scan?.light || (s.side_data_list || []).find((x: { side_data_type?: string }) => /Content light/i.test(x.side_data_type || "")) : null;
      const dovi = (s.side_data_list || []).some((x: { side_data_type?: string }) => /DOVI|Dolby Vision/i.test(x.side_data_type || "")) || (main && scan?.dovi);
      const hdrFmt = [dovi ? "Dolby Vision" : "", main && scan?.hdr10plus ? "HDR10+ (SMPTE ST 2094-40)" : "", md ? "SMPTE ST 2086" : "",
        s.color_transfer === "smpte2084" ? "PQ (SMPTE ST 2084)" : s.color_transfer === "arib-std-b67" ? "HLG" : ""].filter(Boolean).join(", ");
      const range = s.color_transfer === "smpte2084" || s.color_transfer === "arib-std-b67" || dovi ? "HDR" : "SDR";
      const avc = s.codec_name === "h264" ? avcConfig(hexOf(s.extradata)) : {};
      const lvl = s.level > 0 ? (s.codec_name === "h264" ? (s.level / 10).toString().replace(".", ",") : s.codec_name === "hevc" ? (s.level / 30).toString().replace(".", ",") : String(s.level)) : "";
      const fps = frac(s.avg_frame_rate) || frac(s.r_frame_rate);
      const bpf = Number(s.bit_rate) && s.width && fps ? (Number(s.bit_rate) / (s.width * s.height * fps)).toFixed(3).replace(".", ",") : "";
      const gop = main && scan ? (scan.allI ? "solo fotogrammi chiave (intra)" : scan.N ? `M=${scan.M}, N=${scan.N}` : `M=${scan.M}, N>${scan.count} (un solo fotogramma chiave nei primi ${scan.count})`) : "";
      const scanType = main && scan?.interlaced ? `interlacciata (${scan.tff ? "campo superiore primo" : "campo inferiore primo"})`
        : s.field_order === "progressive" ? "progressiva" : s.field_order && s.field_order !== "unknown" ? `interlacciata (${s.field_order === "tt" || s.field_order === "tb" ? "campo superiore primo" : "campo inferiore primo"})` : main && scan ? "progressiva" : "";
      const confBox = s.codec_name === "h264" ? "avcC" : s.codec_name === "hevc" ? "hvcC" : s.codec_name === "av1" ? "av1C" : "";
      out.push({ title: `Video${streams.filter((x) => x.codec_type === "video" && !x.disposition?.attached_pic).length > 1 ? ` ${++vi}` : ""}`, rows: rowsOf([
        ["ID traccia", s.id ? parseInt(s.id) : s.index + 1], ["Formato", SHORT_FMT[s.codec_name] || s.codec_name], ["Codec", s.codec_long_name],
        ["Profilo formato", s.profile ? `${s.profile}${lvl ? `@L${lvl}` : ""}` : ""], ["Formato HDR", hdrFmt],
        ["Impostazioni formato", s.codec_name === "h264" ? [avc.cabac != null ? (avc.cabac ? "CABAC" : "CAVLC") : "", avc.refs != null ? `${avc.refs} Ref Frame${avc.refs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" / ") : s.codec_name === "hevc" ? "CABAC" : ""],
        ["CABAC", avc.cabac != null ? (avc.cabac ? "sì" : "no") : s.codec_name === "hevc" ? "sì" : ""], ["Fotogrammi di riferimento", avc.refs != null ? `${avc.refs}` : ""],
        ["GOP", gop], ["B-frame", s.has_b_frames != null ? (s.has_b_frames ? `sì (${s.has_b_frames})` : "no") : ""],
        ["ID codec", s.codec_tag_string && !/^\[/.test(s.codec_tag_string) ? s.codec_tag_string : ""], ["Durata", human.dur(Number(s.duration) || fileDur)], ["Bitrate", human.br(Number(s.bit_rate))],
        ["Larghezza", s.width ? `${human.num(s.width)} pixel` : ""], ["Altezza", s.height ? `${human.num(s.height)} pixel` : ""], ["Risoluzione codificata", s.coded_width && (s.coded_width !== s.width || s.coded_height !== s.height) ? `${s.coded_width} × ${s.coded_height}` : ""],
        ["Rapporto d'aspetto", s.display_aspect_ratio && s.display_aspect_ratio !== "0:1" ? s.display_aspect_ratio : ""], ["Pixel (SAR)", s.sample_aspect_ratio && s.sample_aspect_ratio !== "1:1" && s.sample_aspect_ratio !== "0:1" ? s.sample_aspect_ratio : s.width ? "quadrati (1:1)" : ""],
        ["Modalità frame rate", s.avg_frame_rate && s.r_frame_rate && Math.abs(frac(s.avg_frame_rate) - frac(s.r_frame_rate)) > 0.01 ? "variabile (VFR)" : "costante"],
        ["Frequenza fotogrammi", human.fps(s.avg_frame_rate) || human.fps(s.r_frame_rate)], ["Fotogrammi", s.nb_frames ? human.num(Number(s.nb_frames)) : fps && (Number(s.duration) || fileDur) ? `circa ${human.num(Math.round(fps * (Number(s.duration) || fileDur)))}` : ""],
        ["Spazio colore", /rgb|gbr|bgr|argb/.test(String(s.pix_fmt)) ? "RGB" : s.pix_fmt ? "YUV" : ""], ["Sottocampionamento croma", px.sub], ["Profondità bit", px.bits ? `${s.bits_per_raw_sample || px.bits} bit` : ""], ["Trasparenza (alfa)", px.alpha ? "sì" : ""],
        ["Formato pixel", s.pix_fmt], ["Tipo scansione", scanType], ["Bit/(pixel×fotogramma)", bpf], ["Dimensione traccia", trackSize(s)],
        ["Gamma dinamica", range], ["Intervallo colore", s.color_range === "pc" ? "Full (0-255)" : s.color_range === "tv" ? "Limited (16-235)" : ""],
        ["Colori primari", (s.color_primaries || "").replace(/^bt/, "BT.").replace("BT.2020", "BT.2020")], ["Caratteristiche trasferimento", (s.color_transfer || "").replace(/^bt/, "BT.").replace("smpte2084", "PQ (SMPTE ST 2084)").replace("arib-std-b67", "HLG")],
        ["Coefficienti matrice", (s.color_space || "").replace(/^bt/, "BT.").replace("BT.2020nc", "BT.2020 non costante")],
        ["Colori primari display mastering", md ? primariesName(md) : ""],
        ["Luminanza display mastering", md ? `min: ${frac(md.min_luminance).toFixed(4)} cd/m², max: ${Math.round(frac(md.max_luminance))} cd/m²` : ""],
        ["Luminanza massima contenuto (MaxCLL)", cl?.max_content ? `${cl.max_content} cd/m²` : ""], ["Luminanza media massima (MaxFALL)", cl?.max_average ? `${cl.max_average} cd/m²` : ""],
        ["Rotazione", sideRot ? `${sideRot}°` : t.rotate ? `${t.rotate}°` : ""], ["Timecode", t.timecode], ["Lingua", lang], ["Nome traccia", t.title || t.handler_name],
        ["Compressore / codificatore", t.encoder], ["Fornitore", t.vendor_id && !/^\[/.test(t.vendor_id) ? t.vendor_id : ""], ["Data codifica", t.creation_time ? `${String(t.creation_time).replace("T", " ").replace(/\.\d+Z$|Z$/, "")} UTC` : ""],
        ["Casella configurazione codec", confBox]]) });
    } else if (s.codec_type === "audio") {
      const cn = String(s.codec_name || "");
      const pcm = cn.match(/^pcm_([suf])(\d+)(le|be)?/);
      out.push({ title: `Audio${streams.filter((x) => x.codec_type === "audio").length > 1 ? ` ${++ai}` : ""}`, rows: rowsOf([
        ["ID traccia", s.id ? parseInt(s.id) : s.index + 1], ["Formato", pcm ? "PCM" : SHORT_FMT[cn] || cn], ["Codec", s.codec_long_name], ["Profilo", s.profile],
        ["Impostazioni formato", pcm ? `${pcm[3] === "be" ? "Big" : "Little"} / ${pcm[1] === "u" ? "Unsigned" : pcm[1] === "f" ? "Float" : "Signed"}` : ""],
        ["ID codec", s.codec_tag_string && !/^\[/.test(s.codec_tag_string) ? s.codec_tag_string : ""], ["Durata", human.dur(Number(s.duration) || fileDur)],
        ["Modalità bitrate", pcm || /flac|alac|truehd|wavpack|tta/.test(cn) ? (pcm ? "costante" : "variabile (senza perdita)") : ""], ["Bitrate", human.br(Number(s.bit_rate))],
        ["Canali", `${s.channels}${CH_NAME[s.channels] ? ` (${CH_NAME[s.channels]})` : ""}`], ["Disposizione canali", s.channel_layout],
        ["Frequenza campionamento", s.sample_rate ? `${(Number(s.sample_rate) / 1000).toString().replace(".", ",")} kHz` : ""], ["Formato campioni", s.sample_fmt],
        ["Profondità bit", s.bits_per_raw_sample ? `${s.bits_per_raw_sample} bit` : pcm ? `${pcm[2]} bit` : s.bits_per_sample ? `${s.bits_per_sample} bit` : ""],
        ["Dimensione traccia", trackSize(s)], ["Lingua", lang], ["Nome traccia", t.title || t.handler_name], ["Predefinita", disp.default ? "sì" : ""],
        ["Data codifica", t.creation_time ? `${String(t.creation_time).replace("T", " ").replace(/\.\d+Z$|Z$/, "")} UTC` : ""]]) });
    } else if (s.codec_type === "subtitle") {
      out.push({ title: `Sottotitoli${streams.filter((x) => x.codec_type === "subtitle").length > 1 ? ` ${++si}` : ""}`, rows: rowsOf([["Formato", s.codec_long_name || s.codec_name], ["ID codec", s.codec_tag_string && !/^\[/.test(s.codec_tag_string) ? s.codec_tag_string : ""], ["Lingua", lang], ["Nome", t.title], ["Forzati", disp.forced ? "sì" : ""]]) });
    } else if (s.codec_type === "data" && (s.codec_tag_string === "tmcd" || t.timecode)) {
      // traccia timecode (QuickTime TC): primo e ultimo fotogramma
      const vfps = mainV ? frac(mainV.avg_frame_rate) || frac(mainV.r_frame_rate) : 0;
      const dur = Number(s.duration) || fileDur;
      const last = t.timecode && vfps ? tcAdd(String(t.timecode), Math.max(0, Math.round(dur * vfps) - 1), vfps) : "";
      out.push({ title: "Timecode", rows: rowsOf([["ID traccia", s.id ? parseInt(s.id) : s.index + 1], ["Tipo", "Time code"], ["Formato", s.codec_tag_string === "tmcd" ? "QuickTime TC" : s.codec_name || "timecode"],
        ["Durata", human.dur(dur)], ["Frequenza fotogrammi", vfps ? `${vfps.toFixed(3).replace(".", ",")} fps` : ""], ["Timecode primo fotogramma", t.timecode], ["Timecode ultimo fotogramma", last],
        ["Drop frame", t.timecode ? (String(t.timecode).includes(";") ? "sì" : "no") : ""], ["Lingua", lang], ["Data codifica", t.creation_time ? `${String(t.creation_time).replace("T", " ").replace(/\.\d+Z$|Z$/, "")} UTC` : ""]]) });
    } else if (s.codec_type === "data" || s.codec_type === "attachment") {
      out.push({ title: s.codec_type === "data" ? "Traccia dati" : "Allegato", rows: rowsOf([["Tipo", s.codec_long_name || s.codec_name || s.codec_tag_string], ["ID codec", s.codec_tag_string], ["Nome", t.handler_name || t.filename]]) });
    }
  }
  // deno-lint-ignore no-explicit-any
  const ch = (d.chapters || []) as any[];
  if (ch.length) out.push({ title: `Capitoli (${ch.length})`, list: ch.map((c) => `${human.dur(Math.floor(Number(c.start_time)))}  ${c.tags?.title || ""}`) });
  const shown = new Set(["creation_time", "encoder", "major_brand", "title", "artist", "album", "date", "genre", "comment", "copyright", "description", "timecode", "compatible_brands"]);
  const rest = Object.entries(tags).filter(([k]) => !shown.has(k.toLowerCase()) && !/com\.apple\.quicktime\.(make|model|software|location|creationdate)/.test(k));
  const cam = rest.filter(([k]) => /^com\.(apple\.proapps|blackmagic-design)/.test(k)), other = rest.filter(([k]) => !/^com\.(apple\.proapps|blackmagic-design)/.test(k));
  const nice = (v: unknown) => { const x = clean(v); const m = x.match(/^(\d{4})(\d{2})(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : x; };
  if (cam.length) out.push({ title: "Dati di ripresa (camera e Final Cut)", rows: cam.map(([k, v]) => [tagLabel(k), nice(v)] as Row) });
  if (other.length) out.push({ title: "Altri metadati", rows: other.map(([k, v]) => [tagLabel(k), clean(v)] as Row) });
  return out;
}
// deno-lint-ignore no-explicit-any
function linkDetails(i: any): Section[] {
  const out: Section[] = [];
  const up = i.upload_date || (i.timestamp ? new Date(i.timestamp * 1000).toISOString() : "");
  out.push({ title: "Video online", rows: rowsOf([["Titolo", i.title], ["Canale", i.channel || i.uploader], ["Iscritti", i.channel_follower_count ? human.num(i.channel_follower_count) : ""],
    ["Pubblicato", up ? human.date(up) : ""], ["Durata", human.dur(Number(i.duration))], ["Visualizzazioni", i.view_count != null ? human.num(i.view_count) : ""],
    ["Mi piace", i.like_count != null ? human.num(i.like_count) : ""], ["Commenti", i.comment_count != null ? human.num(i.comment_count) : ""],
    ["Categoria", (i.categories || []).join(", ")], ["Lingua", i.language], ["Età minima", i.age_limit ? `${i.age_limit} anni` : ""],
    ["Stato", i.live_status === "is_live" ? "in diretta" : i.live_status === "was_live" ? "era una diretta" : i.live_status === "is_upcoming" ? "in arrivo" : ""],
    ["Disponibilità", i.availability === "public" ? "pubblico" : i.availability === "unlisted" ? "non in elenco" : i.availability], ["Licenza", i.license],
    ["Sito", i.extractor_key], ["ID", i.id], ["Link", i.webpage_url || i.original_url], ["Canale (link)", i.channel_url || i.uploader_url],
    ["Formato migliore", i.format ? String(i.format).replace(/\s*-\s*/g, " · ") : ""], ["Risoluzione massima", i.width && i.height ? `${i.width} × ${i.height}` : ""],
    ["Frame rate", i.fps ? `${i.fps} fps` : ""], ["Gamma dinamica", i.dynamic_range], ["Proporzioni", i.aspect_ratio ? String(i.aspect_ratio).replace(".", ",") : ""]]) });
  if (i.tags?.length) out.push({ title: `Tag (${i.tags.length})`, text: i.tags.join(", ") });
  if (i.description) out.push({ title: "Descrizione", text: String(i.description).slice(0, 6000) });
  // deno-lint-ignore no-explicit-any
  const ch = (i.chapters || []) as any[];
  if (ch.length) out.push({ title: `Capitoli (${ch.length})`, list: ch.map((c) => `${human.dur(Math.floor(c.start_time))}  ${c.title || ""}`) });
  // deno-lint-ignore no-explicit-any
  const fm = ((i.formats || []) as any[]).filter((f) => f.format_id && !/storyboard|mhtml/i.test(`${f.format_note} ${f.ext}`));
  const isV = (f: { vcodec?: string }) => f.vcodec && f.vcodec !== "none", isA = (f: { acodec?: string }) => f.acodec && f.acodec !== "none";
  const cc = (c: string) => String(c || "").replace(/^avc1\..*/, "H.264").replace(/^(hev1|hvc1)\..*/, "HEVC").replace(/^vp0?9.*/, "VP9").replace(/^av01\..*/, "AV1").replace(/^mp4a\..*/, "AAC").replace(/^opus$/, "Opus").replace(/^ac-3$/, "AC-3").replace(/^ec-3$/, "E-AC-3");
  const sz = (f: { filesize?: number; filesize_approx?: number }) => human.size(f.filesize || f.filesize_approx || 0);
  const vids = fm.filter(isV).sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
  if (vids.length) out.push({ title: `Qualità video disponibili (${vids.length})`, table: { cols: ["Risoluzione", "fps", "Codec", "Gamma", "Bitrate", "Peso", "Audio", "ID"],
    rows: vids.map((f) => [f.width && f.height ? `${f.width}×${f.height}` : f.resolution || f.format_note || "", f.fps ? String(f.fps) : "", cc(f.vcodec), f.dynamic_range || "",
      f.vbr || f.tbr ? `${Math.round(f.vbr || f.tbr)} kbit/s` : "", sz(f), isA(f) ? cc(f.acodec) : "separato", String(f.format_id)]) } });
  const auds = fm.filter((f) => isA(f) && !isV(f)).sort((a, b) => (b.audio_channels || 0) - (a.audio_channels || 0) || (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  if (auds.length) out.push({ title: `Tracce audio disponibili (${auds.length})`, table: { cols: ["Codec", "Canali", "Frequenza", "Bitrate", "Lingua", "Peso", "ID"],
    rows: auds.map((f) => [cc(f.acodec), f.audio_channels ? `${f.audio_channels}${CH_NAME[f.audio_channels] ? ` (${CH_NAME[f.audio_channels]})` : ""}` : "", f.asr ? `${f.asr / 1000} kHz`.replace(".", ",") : "",
      f.abr || f.tbr ? `${Math.round(f.abr || f.tbr)} kbit/s` : "", f.language || "", sz(f), String(f.format_id)]) } });
  const subs = Object.keys(i.subtitles || {}).filter((k) => k !== "live_chat"), auto = Object.keys(i.automatic_captions || {});
  if (subs.length || auto.length) out.push({ title: "Sottotitoli", rows: rowsOf([["Scritti dall'autore", subs.join(", ") || "nessuno"], ["Automatici", auto.length ? `${auto.length} lingue${auto.includes("it") ? " (italiano compreso)" : ""}` : "nessuno"]]) });
  // deno-lint-ignore no-explicit-any
  const th = ((i.thumbnails || []) as any[]).filter((t) => t.width).sort((a, b) => b.width - a.width)[0];
  if (th || i.thumbnail) out.push({ title: "Copertina", rows: rowsOf([["Misura", th ? `${th.width} × ${th.height}` : ""], ["Link", th?.url || i.thumbnail]]) });
  return out;
}
async function measureLoudness(path: string): Promise<Row[]> {
  const r = await new Deno.Command(FFMPEG, { args: ["-hide_banner", "-nostats", "-i", path, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], stdout: "null", stderr: "piped" }).output();
  const e = new TextDecoder().decode(r.stderr);
  const sum = e.slice(e.lastIndexOf("Summary:"));
  const g = (re: RegExp) => (sum.match(re) || [])[1];
  const I = g(/I:\s+(-?[\d.]+) LUFS/), LRA = g(/LRA:\s+(-?[\d.]+) LU/), TP = g(/Peak:\s+(-?[\d.]+) dBFS/);
  return rowsOf([["Volume integrato", I ? `${I.replace(".", ",")} LUFS` : "non misurabile"], ["Dinamica (LRA)", LRA ? `${LRA.replace(".", ",")} LU` : ""], ["Picco vero", TP ? `${TP.replace(".", ",")} dBTP` : ""],
    ["Per i social (−14)", I ? (Math.abs(Number(I) + 14) < 1 ? "già a posto" : `${Number(I) > -14 ? "più forte" : "più basso"} di ${Math.abs(Number(I) + 14).toFixed(1).replace(".", ",")} LU`) : ""],
    ["Per la tv (−23)", I ? (Math.abs(Number(I) + 23) < 1 ? "già a posto" : `${Number(I) > -23 ? "più forte" : "più basso"} di ${Math.abs(Number(I) + 23).toFixed(1).replace(".", ",")} LU`) : ""]]);
}

// riquadro di ritaglio inviato dalla pagina: valido solo se sta dentro al video
function cropOf(c: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const [x, y, w, h] = ["x", "y", "w", "h"].map((k) => Number(o[k]));
  if (![x, y, w, h].every(Number.isFinite) || w < 0.02 || h < 0.02 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null;
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(x), y: r(y), w: r(Math.min(w, 1 - x)), h: r(Math.min(h, 1 - y)) };
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
  setPhase(j, j.phases[0].key, null, j.mode === "frame" || j.local ? "process" : "download");
  try {
    if (j.mode === "frame") {
      if (!await runFrame(j)) return;
    } else if (j.local) {
      const s = srcOf(j.url);
      if (!s || !await exists(s.path)) { fail(j, "Il file non c'è più: trascinalo di nuovo in Brsket."); return; }
      j._meta = { title: s.title };
      if (!await convertLocal(j, s.path)) return;
    } else {
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
    } else if (xfOf(fmt)) {
      const done = await convertLocal(j, src, false);
      await rm(src);
      if (!done) return;
    } else if (needsTmpPost(j)) {
      const info = await probe(src);
      const ext = fmt in PRO || fmt === "mov" ? "mov" : fmt;
      j._res = resToken(j, info);
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
    }
    if (j.loud && j.loud !== "off") {
      for (const f of j._files || []) if (!await normalizeLoudness(j, f)) return;
    }
    const files = [];
    let firstFile = (j._files || [])[0], frames = 0;
    for (const f of j._files || []) {
      const st = await Deno.stat(f);
      if (st.isDirectory) {
        // sequenza: peso totale e numero di fotogrammi
        let size = 0; const names: string[] = [];
        for await (const e of Deno.readDir(f)) if (e.isFile) { names.push(e.name); size += (await Deno.stat(join(f, e.name))).size; }
        names.sort(); frames = names.length;
        if (f === firstFile && names.length) firstFile = join(f, names[0]);
        files.push({ name: f.split(/[\\/]/).pop(), size, folder: true, frames });
      } else files.push({ name: f.split(/[\\/]/).pop(), size: st.size });
    }
    // cosa è uscito davvero (si vede nei Completati): risoluzione, fps e canali del primo file
    try {
      const pr = await new Deno.Command(FFPROBE, { args: ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,channels", "-of", "json", firstFile], stdout: "piped", stderr: "null" }).output();
      // deno-lint-ignore no-explicit-any
      const st = (JSON.parse(new TextDecoder().decode(pr.stdout)).streams || []) as any[];
      const v = st.find((x) => x.codec_type === "video" && (j.mode === "frame" || !!xfOf(j.format) || !["mjpeg", "png"].includes(x.codec_name)));
      const a = st.find((x) => x.codec_type === "audio");
      const [fn, fd] = String(v?.avg_frame_rate || "0/1").split("/").map(Number);
      j.out = { w: v?.width || null, h: v?.height || null, fps: frames ? null : fd ? Math.round(fn / fd * 100) / 100 : null, ch: a?.channels || null, frames: frames || null };
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
    await sweepUploads(true).catch(() => {});
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
      remote, separator: await exists(MODEL), stemsReady: await exists(STEMS_READY),
      xf: Object.entries(XF).map(([k, f]) => ({ k, mode: f.mode, label: f.label, sub: f.sub, group: f.group, ext: f.ext, ok: xfOk.includes(k),
        maxCh: f.ac || f.maxCh || null, lossless: !!f.lossless, aBr: !!f.aBr, kbps: f.kbps || null, mbps: f.mbps || null, seq: !!f.seq,
        noAudio: f.a === null, heavy: !!f.heavy, size: f.size || null, fps: f.fps || null, maxW: f.maxW || null, mult: f.mult || null, fixed: f.fixed || null })) });
  }
  if (p === "/api/settings") {
    if (m === "POST") {
      const b = await body(req);
      if (typeof b.schema === "string") settings.schema = b.schema.slice(0, 200);
      if (typeof b.notify === "boolean") settings.notify = b.notify;
      if (typeof b.lan === "boolean") { settings.lan = b.lan; setLan(b.lan); }
      if (typeof b.cookies === "string") settings.cookies = COOKIE_BROWSERS.includes(b.cookies) ? b.cookies : "";
      if (b.newToken) settings.token = String(Math.floor(100000 + Math.random() * 900000));
      if (Array.isArray(b.presets)) {
        settings.presets = b.presets.slice(0, 40).filter((x: Preset) => x && typeof x.name === "string" && x.name.trim() && x.opts && typeof x.opts === "object")
          .map((x: Preset) => ({ name: x.name.trim().slice(0, 40), opts: JSON.parse(JSON.stringify(x.opts).slice(0, 4000)) }));
      }
      await saveSettings();
    }
    return json({ schema: settings.schema, notify: settings.notify, lan: settings.lan, clients: settings.clients, cookies: settings.cookies, presets: settings.presets,
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
  // file dal computer: percorsi veri (dall'app per Mac: trascinati, scelti o "Apri con") …
  if (p === "/api/local" && m === "POST" && !remote) {
    if (!(await toolsReady()).ff) return json({ error: "Brsket si sta ancora preparando: aspetta qualche secondo." }, 400);
    const paths = ((await body(req)).paths || []) as string[];
    const items = [], skipped: string[] = [];
    for (const raw of paths.slice(0, 200)) {
      const path = String(raw).replace(/^file:\/\//, "");
      let st: Deno.FileInfo | null = null;
      try { st = await Deno.stat(path); } catch { /* */ }
      const name = path.split(/[\\/]/).pop() || "file";
      if (!st?.isFile) { skipped.push(name); continue; }
      const id = addSource(path, name, false);
      const info = await localInfo(id);
      if (info) items.push(info); else { sources.delete(id); skipped.push(name); }
    }
    log(`file dal computer: ${items.length} pronti${skipped.length ? `, scartati ${skipped.join(", ")}` : ""}`);
    if (!items.length) return json({ error: skipped.length ? `Brsket non riesce a leggere ${skipped.length > 1 ? "questi file" : `«${skipped[0]}»`}: servono file video o audio.` : "Nessun file." }, 400);
    return json({ items, skipped });
  }
  // … oppure caricati dalla pagina (browser o telefono): copia temporanea, cancellata a lavoro finito
  if (p === "/api/upload" && (m === "PUT" || m === "POST")) {
    if (!(await toolsReady()).ff) return json({ error: "Brsket si sta ancora preparando: aspetta qualche secondo." }, 400);
    const name = safeName(url.searchParams.get("name") || "file") || "file";
    if (!req.body) return json({ error: "File vuoto." }, 400);
    const ext = (name.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0];
    const path = join(TMP, `up-${crypto.randomUUID().slice(0, 8)}${ext}`);
    try { await Deno.writeFile(path, req.body); } catch (e) { await rm(path); return json({ error: `Caricamento non riuscito: ${String(e).slice(0, 120)}` }, 500); }
    const id = addSource(path, name, true);
    const info = await localInfo(id);
    if (!info) { await rm(path); sources.delete(id); return json({ error: `Brsket non riesce a leggere «${name}»: servono file video o audio.` }, 400); }
    log("file caricato dalla pagina:", name, (await Deno.stat(path)).size, "byte");
    return json({ items: [info], skipped: [] });
  }
  // anteprima di un fotogramma (per scegliere l'istante giusto)
  if (p === "/api/frame" && m === "GET") {
    const src = url.searchParams.get("src") || "";
    const t = Math.max(0, Number(url.searchParams.get("t")) || 0);
    const w = Math.min(1280, Math.max(120, Number(url.searchParams.get("w")) || 640));
    const cover = url.searchParams.get("cover") === "1";
    if (!srcOf(src) && !/^https?:\/\//i.test(src)) return json({ error: "Sorgente non valida." }, 400);
    try {
      const input = await frameInput(src, t, cover, true);
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
      const r = await new Deno.Command(FFMPEG, { args: ["-hide_banner", "-loglevel", "error", ...input, "-frames:v", "1", "-vf", `scale=${w}:-2:flags=bicubic`,
        "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"], stdout: "piped", stderr: "piped", signal: ctl.signal }).output();
      clearTimeout(tm);
      if (!r.success || !r.stdout.length) return json({ error: "Anteprima non disponibile." }, 422);
      return new Response(r.stdout, { headers: { "content-type": "image/jpeg", "cache-control": "max-age=600" } });
    } catch (e) { return json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, 422); }
  }
  // scheda tecnica di un file dal computer o di un link
  if (p === "/api/details" && m === "GET") {
    const src = url.searchParams.get("src") || "";
    const loc = srcOf(src);
    try {
      if (loc) {
        if (url.searchParams.get("loud") === "1") return json({ rows: await measureLoudness(loc.path) });
        return json({ title: loc.name, sections: await fileDetails(loc.path, loc.name, loc.temp) });
      }
      if (!/^https?:\/\//i.test(src)) return json({ error: "Sorgente non valida." }, 400);
      let c = infoCache.get(src);
      if (!c || !await exists(c.path)) {
        await fetch(`http://127.0.0.1:${PORT}/api/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: src }) }).then((r) => r.body?.cancel());
        for (let k = 0; k < 30 && !(c = infoCache.get(src)); k++) await new Promise((r) => setTimeout(r, 100));
      }
      if (!c) return json({ error: "Non riesco a leggere le informazioni di questo link." }, 400);
      const i = JSON.parse(await Deno.readTextFile(c.path));
      const secs = linkDetails(i);
      // analisi del flusso video migliore: profondità colore, spazio colore, HDR, profilo… (quello che il sito non dice)
      try {
        const sv = await streamUrl(src, false);
        const deep = (await fileDetails(sv.url, "", true, headerArgs(sv.headers))).filter((x) => /^(Video|Audio)/.test(x.title));
        for (const x of deep) x.title = `${x.title} (analisi del flusso migliore)`;
        secs.splice(1, 0, ...deep);
      } catch { /* analisi non possibile: resta la scheda del sito */ }
      return json({ title: i.title || src, sections: secs });
    } catch (e) { return json({ error: `Scheda non disponibile: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` }, 500); }
  }
  if (p === "/api/download" && m === "POST") {
    const b = await body(req);
    const u = String(b.url || "").trim(), mode = b.mode === "audio" ? "audio" : b.mode === "frame" ? "frame" : "video", fmt = String(b.format || "mp4");
    const local = !!srcOf(u);
    if (local) srcOf(u)!.at = Date.now();
    if (/^local:/.test(u) && !local) return json({ error: "Il file non c'è più: trascinalo di nuovo in Brsket." }, 400);
    if (!local && !/^https?:\/\//i.test(u)) return json({ error: "Link non valido: deve iniziare con http:// o https://" }, 400);
    const tr = await toolsReady();
    if (!tr.ff || (!local && !tr.yt)) return json({ error: "Brsket si sta ancora preparando: aspetta qualche secondo." }, 400);
    if ((mode === "video" && !VIDEO.has(fmt)) || (mode === "audio" && !AUDIO.has(fmt)) || (mode === "frame" && !FRAME.has(fmt))) return json({ error: "Formato non valido." }, 400);
    // misura su misura (es. ledwall 1152x576): numeri pari, multipli di 4 per HAP
    let resW = 0, resH = 0;
    if (mode === "video" && b.res === "custom") {
      resW = Math.round(Number(b.resW)); resH = Math.round(Number(b.resH));
      if (!(resW >= 16 && resW <= 8192 && resH >= 16 && resH <= 8192)) return json({ error: "Misura non valida: scrivi larghezza e altezza tra 16 e 8192 pixel." }, 400);
      const q = fmt === "hap" || fmt === "hapq" ? 4 : Math.max(2, xfOf(fmt)?.mult || 2);
      resW = Math.round(resW / q) * q; resH = Math.round(resH / q) * q;
    }
    if (fmt in PRO && !proAvailable.includes(fmt)) return json({ error: `${FORMAT_LABEL[fmt]} non è disponibile in questo FFmpeg.` }, 400);
    if (xfOf(fmt) && !xfOk.includes(fmt)) return json({ error: `${FORMAT_LABEL[fmt]} non è disponibile in questo FFmpeg.` }, 400);
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
      aspect, fit: b.fit === "blur" ? "blur" : "crop", separate, stems, client, crop: cropOf(b.crop),
      loud: LOUD.has(String(b.loud)) && separate === "none" && mode !== "frame" ? String(b.loud) : "off",
      fps: mode === "video" && FPS.has(String(b.fps)) ? String(b.fps) : "orig",
      res: mode === "video" && (String(b.res) in RES || resW) ? (resW ? "custom" : String(b.res)) : "orig",
      resW: resW || null, resH: resH || null, resFit: b.resFit === "crop" ? "crop" : "pad", local,
      frameKind: mode === "frame" && b.frameKind === "cover" ? "cover" : "frame", frameT: mode === "frame" ? Math.max(0, Number(b.frameT) || 0) : null,
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
      if (f && (await Deno.stat(f).catch(() => null))?.isDirectory) return json({ error: "Le sequenze di immagini sono una cartella: aprila dal computer con «Mostra nella cartella»." }, 400);
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
  if (p === "/api/selftest") {
    if (m === "POST" && !remote) { if (!(await toolsReady()).ff) return json({ error: "Brsket si sta ancora preparando." }, 400); runSelftest(); }
    return json(selftest);
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
