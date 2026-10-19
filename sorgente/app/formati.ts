// Catalogo dei formati in più (oltre a quelli di base): video professionali e broadcast, formati rari,
// sequenze di immagini, audio da studio e da cinema, immagini. Ogni voce dice a FFmpeg come scrivere il file.
// Disponibile solo se FFmpeg ha i codificatori (need) e il contenitore (mux) richiesti.

export type XF = {
  mode: "video" | "audio" | "frame";
  label: string;            // nome sul pulsante
  sub: string;              // per cosa serve
  group: string;            // sezione in "Tutti i formati"
  ext: string;              // estensione del file
  need: string[];           // codificatori richiesti ("a|b" = uno dei due)
  mux?: string;             // contenitore richiesto (nome di ffmpeg -muxers)
  v?: string[];             // argomenti video (o immagine)
  a?: string[] | null;      // argomenti audio; null = niente audio
  aBr?: boolean;            // l'audio usa il bitrate scelto
  maxCh?: number;           // canali massimi
  ar?: number;              // frequenza di campionamento obbligata
  ac?: number;              // canali obbligati (es. 1 = mono)
  mult?: number;            // larghezza e altezza multiple di (es. 4 per HAP, 16 per alcuni codec)
  vf?: string;              // filtri da aggiungere in fondo (es. tavolozza della GIF)
  fps?: string;             // frame rate predefinito se resta "Originale"
  maxW?: number;            // larghezza massima predefinita se la risoluzione resta "Originale"
  size?: [number, number];  // misura obbligata se resta "Originale" (es. XDCAM 1920x1080)
  seq?: boolean;            // sequenza di immagini: una cartella con un file per fotogramma
  lossless?: boolean;
  kbps?: number;            // peso stimato (audio) in kbit/s
  mbps?: number;            // peso stimato (video 1080p) in Mbit/s
  heavy?: boolean;          // conversione lunga o file molto pesanti
  fixed?: string;           // standard rigido (DVD, DV, VCD): misura e frame rate decisi dal formato
};

const PCM24 = ["-c:a", "pcm_s24le"];
const PCM16 = ["-c:a", "pcm_s16le"];
const AAC = ["-c:a", "aac", "-b:a", "256k"];

export const XF: Record<string, XF> = {
  // ---------- video: professionale ----------
  prores_proxy: { mode: "video", group: "Professionale", label: "ProRes 422 Proxy", sub: "Montaggio leggero", ext: "mov", need: ["prores_ks"],
    v: ["-c:v", "prores_ks", "-profile:v", "0", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"], a: PCM24, mbps: 45, heavy: true },
  prores_lt: { mode: "video", group: "Professionale", label: "ProRes 422 LT", sub: "Offline, proxy di qualità", ext: "mov", need: ["prores_ks"],
    v: ["-c:v", "prores_ks", "-profile:v", "1", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"], a: PCM24, mbps: 102, heavy: true },
  prores_std: { mode: "video", group: "Professionale", label: "ProRes 422", sub: "Standard broadcast", ext: "mov", need: ["prores_ks"],
    v: ["-c:v", "prores_ks", "-profile:v", "2", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"], a: PCM24, mbps: 147, heavy: true },
  prores_xq: { mode: "video", group: "Professionale", label: "ProRes 4444 XQ", sub: "Massima, con trasparenza", ext: "mov", need: ["prores_ks"],
    v: ["-c:v", "prores_ks", "-profile:v", "5", "-vendor", "apl0", "-pix_fmt", "yuva444p10le"], a: PCM24, mbps: 500, heavy: true },
  dnxhr_lb: { mode: "video", group: "Professionale", label: "DNxHR LB", sub: "Avid, proxy", ext: "mov", need: ["dnxhd"],
    v: ["-c:v", "dnxhd", "-profile:v", "dnxhr_lb", "-pix_fmt", "yuv422p"], a: PCM24, mbps: 45, heavy: true },
  dnxhr_sq: { mode: "video", group: "Professionale", label: "DNxHR SQ", sub: "Avid, montaggio", ext: "mov", need: ["dnxhd"],
    v: ["-c:v", "dnxhd", "-profile:v", "dnxhr_sq", "-pix_fmt", "yuv422p"], a: PCM24, mbps: 145, heavy: true },
  dnxhr_hq: { mode: "video", group: "Professionale", label: "DNxHR HQ", sub: "Avid, alta qualità", ext: "mov", need: ["dnxhd"],
    v: ["-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p"], a: PCM24, mbps: 220, heavy: true },
  dnxhr_hqx: { mode: "video", group: "Professionale", label: "DNxHR HQX", sub: "Avid, 10 bit", ext: "mov", need: ["dnxhd"],
    v: ["-c:v", "dnxhd", "-profile:v", "dnxhr_hqx", "-pix_fmt", "yuv422p10le"], a: PCM24, mbps: 220, heavy: true },
  dnxhr_444: { mode: "video", group: "Professionale", label: "DNxHR 444", sub: "Avid, colore pieno", ext: "mov", need: ["dnxhd"],
    v: ["-c:v", "dnxhd", "-profile:v", "dnxhr_444", "-pix_fmt", "yuv444p10le"], a: PCM24, mbps: 440, heavy: true },
  dnxhr_mxf: { mode: "video", group: "Professionale", label: "DNxHR HQ in MXF", sub: "Avid Media Composer", ext: "mxf", need: ["dnxhd"], mux: "mxf",
    v: ["-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p"], a: PCM24, ar: 48000, mbps: 220, heavy: true },
  cineform: { mode: "video", group: "Professionale", label: "GoPro CineForm", sub: "Montaggio, 10 bit", ext: "mov", need: ["cfhd"],
    v: ["-c:v", "cfhd", "-quality", "film1", "-pix_fmt", "yuv422p10le"], a: PCM24, mult: 16, mbps: 160, heavy: true },
  hap_alpha: { mode: "video", group: "Professionale", label: "HAP Alpha", sub: "Resolume, con trasparenza", ext: "mov", need: ["hap"],
    v: ["-c:v", "hap", "-format", "hap_alpha", "-pix_fmt", "rgba"], a: PCM16, mult: 4, mbps: 400, heavy: true },
  qtrle: { mode: "video", group: "Professionale", label: "QuickTime Animation", sub: "Grafica, con trasparenza", ext: "mov", need: ["qtrle"],
    v: ["-c:v", "qtrle", "-pix_fmt", "argb"], a: PCM16, mbps: 600, heavy: true },
  v210: { mode: "video", group: "Professionale", label: "Non compresso 10 bit", sub: "v210, qualità piena", ext: "mov", need: ["v210"],
    v: ["-c:v", "v210"], a: PCM24, lossless: true, mbps: 1300, heavy: true },
  ffv1: { mode: "video", group: "Professionale", label: "FFV1", sub: "Archivio senza perdita", ext: "mkv", need: ["ffv1", "flac"],
    v: ["-c:v", "ffv1", "-level", "3", "-g", "1", "-slicecrc", "1", "-slices", "16"], a: ["-c:a", "flac"], lossless: true, mbps: 500, heavy: true },
  utvideo: { mode: "video", group: "Professionale", label: "Ut Video", sub: "Senza perdita, veloce", ext: "avi", need: ["utvideo"],
    v: ["-c:v", "utvideo", "-pix_fmt", "yuv422p"], a: PCM16, lossless: true, mbps: 600, heavy: true },
  mjpeg: { mode: "video", group: "Professionale", label: "Motion JPEG", sub: "Ogni fotogramma un JPG", ext: "mov", need: ["mjpeg"],
    v: ["-c:v", "mjpeg", "-q:v", "2", "-pix_fmt", "yuvj422p"], a: PCM16, mbps: 120, heavy: true },

  // ---------- video: broadcast ----------
  xdcam: { mode: "video", group: "Broadcast", label: "XDCAM HD422 (MXF)", sub: "MPEG-2 50 Mbit, tv", ext: "mxf", need: ["mpeg2video"], mux: "mxf",
    v: ["-c:v", "mpeg2video", "-pix_fmt", "yuv422p", "-b:v", "50M", "-minrate", "50M", "-maxrate", "50M", "-bufsize", "17M", "-g", "12", "-bf", "2",
      "-intra_vlc", "1", "-non_linear_quant", "1", "-dc", "10", "-qmin", "1", "-qmax", "12", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"],
    a: PCM24, ar: 48000, size: [1920, 1080], fps: "25", mbps: 52, heavy: true },
  mpegts: { mode: "video", group: "Broadcast", label: "MPEG-TS", sub: "Trasmissione, IPTV", ext: "ts", need: ["libx264"], mux: "mpegts",
    v: ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-f", "mpegts"], a: ["-c:a", "aac", "-b:a", "256k"], mbps: 9 },
  m2ts: { mode: "video", group: "Broadcast", label: "M2TS", sub: "Blu-ray, AVCHD", ext: "m2ts", need: ["libx264", "ac3"], mux: "mpegts",
    v: ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-f", "mpegts", "-mpegts_m2ts_mode", "1"],
    a: ["-c:a", "ac3", "-b:a", "448k"], ar: 48000, maxCh: 6, mbps: 9 },
  mpeg2: { mode: "video", group: "Broadcast", label: "MPEG-2", sub: "Lettori e regie datate", ext: "mpg", need: ["mpeg2video", "mp2"], mux: "mpeg",
    v: ["-c:v", "mpeg2video", "-b:v", "12M", "-maxrate", "15M", "-bufsize", "4M", "-g", "15", "-bf", "2", "-pix_fmt", "yuv420p", "-f", "mpeg"],
    a: ["-c:a", "mp2", "-b:a", "384k"], ar: 48000, maxCh: 2, mbps: 12 },
  dvd: { mode: "video", group: "Broadcast", label: "DVD PAL", sub: "Masterizzare un DVD", ext: "mpg", need: ["mpeg2video", "ac3"], mux: "dvd",
    fixed: "720 × 576 a 25 fps", v: ["-target", "pal-dvd", "-aspect", "16:9"], a: ["-c:a", "ac3", "-b:a", "448k"], ar: 48000, maxCh: 6, mbps: 6 },
  dv: { mode: "video", group: "Broadcast", label: "DV PAL", sub: "MiniDV, vecchie regie", ext: "dv", need: ["dvvideo"], mux: "dv",
    fixed: "720 × 576 a 25 fps", v: ["-target", "pal-dv"], a: PCM16, ar: 48000, ac: 2, mbps: 29 },

  // ---------- video: web e moderni ----------
  hevc: { mode: "video", group: "Web e moderni", label: "HEVC / H.265", sub: "Metà peso dell'H.264", ext: "mp4", need: ["libx265"],
    v: ["-c:v", "libx265", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-movflags", "+faststart"], a: AAC, mbps: 4 },
  hevc10: { mode: "video", group: "Web e moderni", label: "HEVC 10 bit", sub: "HDR, sfumature pulite", ext: "mp4", need: ["libx265"],
    v: ["-c:v", "libx265", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-movflags", "+faststart"], a: AAC, mbps: 5 },
  av1: { mode: "video", group: "Web e moderni", label: "AV1 (MP4)", sub: "Il più efficiente", ext: "mp4", need: ["libsvtav1|libaom-av1"],
    v: ["-c:v", "libsvtav1", "-preset", "8", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart"], a: AAC, mbps: 3, heavy: true },
  av1_webm: { mode: "video", group: "Web e moderni", label: "WebM AV1", sub: "Web moderno", ext: "webm", need: ["libsvtav1|libaom-av1", "libopus"],
    v: ["-c:v", "libsvtav1", "-preset", "8", "-crf", "32", "-pix_fmt", "yuv420p"], a: ["-c:a", "libopus", "-b:a", "160k"], mbps: 3, heavy: true },
  vp8: { mode: "video", group: "Web e moderni", label: "WebM VP8", sub: "Browser datati", ext: "webm", need: ["libvpx", "libvorbis"],
    v: ["-c:v", "libvpx", "-crf", "10", "-b:v", "8M", "-deadline", "good", "-cpu-used", "4"], a: ["-c:a", "libvorbis", "-q:a", "6"], maxCh: 2, mbps: 8 },
  ogv: { mode: "video", group: "Web e moderni", label: "OGV (Theora)", sub: "Formato libero", ext: "ogv", need: ["libtheora", "libvorbis"],
    v: ["-c:v", "libtheora", "-q:v", "8"], a: ["-c:a", "libvorbis", "-q:a", "6"], mbps: 10 },
  gif: { mode: "video", group: "Web e moderni", label: "GIF animata", sub: "Chat, slide, siti", ext: "gif", need: ["gif"],
    v: ["-c:v", "gif", "-loop", "0"], a: null, fps: "15", maxW: 800,
    vf: "split[gs1][gs2];[gs1]palettegen=stats_mode=diff[gp];[gs2][gp]paletteuse=dither=sierra2_4a", mbps: 20 },
  apng: { mode: "video", group: "Web e moderni", label: "PNG animato (APNG)", sub: "Come GIF, a colori pieni", ext: "png", need: ["apng"], mux: "apng",
    v: ["-c:v", "apng", "-plays", "0", "-pix_fmt", "rgba", "-f", "apng"], a: null, fps: "15", maxW: 800, mbps: 60 },
  webp_anim: { mode: "video", group: "Web e moderni", label: "WebP animato", sub: "Sticker, siti leggeri", ext: "webp", need: ["libwebp_anim|libwebp"], mux: "webp",
    v: ["-c:v", "libwebp_anim", "-quality", "80", "-loop", "0", "-pix_fmt", "yuva420p"], a: null, fps: "20", maxW: 1080, mbps: 6 },
  flv: { mode: "video", group: "Web e moderni", label: "FLV", sub: "Vecchi player Flash, RTMP", ext: "flv", need: ["libx264"], mux: "flv",
    v: ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"], a: ["-c:a", "aac", "-b:a", "192k"], maxCh: 2, mbps: 6 },

  // ---------- video: vecchi formati ----------
  wmv: { mode: "video", group: "Vecchi formati", label: "WMV", sub: "Windows Media", ext: "wmv", need: ["wmv2", "wmav2"], mux: "asf",
    v: ["-c:v", "wmv2", "-b:v", "8M"], a: ["-c:a", "wmav2", "-b:a", "192k"], maxCh: 2, mbps: 8 },
  xvid: { mode: "video", group: "Vecchi formati", label: "AVI DivX / Xvid", sub: "Lettori DVD da salotto", ext: "avi", need: ["mpeg4|libxvid", "libmp3lame"],
    v: ["-c:v", "mpeg4", "-vtag", "XVID", "-q:v", "3", "-pix_fmt", "yuv420p"], a: ["-c:a", "libmp3lame", "-b:a", "192k"], maxCh: 2, mbps: 5 },
  mpeg1: { mode: "video", group: "Vecchi formati", label: "MPEG-1 (VCD)", sub: "Video CD, anni '90", ext: "mpg", need: ["mpeg1video", "mp2"], mux: "vcd",
    fixed: "352 × 288 a 25 fps", v: ["-target", "pal-vcd"], a: ["-c:a", "mp2", "-b:a", "224k"], ar: 44100, ac: 2, mbps: 1.4 },
  "3gp": { mode: "video", group: "Vecchi formati", label: "3GP", sub: "Vecchi cellulari", ext: "3gp", need: ["libx264"], mux: "3gp",
    v: ["-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0", "-crf", "24", "-pix_fmt", "yuv420p"], a: ["-c:a", "aac", "-b:a", "96k"], ac: 2, maxW: 640, mbps: 1 },
  rm: { mode: "video", group: "Vecchi formati", label: "RealMedia", sub: "RealPlayer, anni 2000", ext: "rm", need: ["rv20", "ac3"], mux: "rm",
    v: ["-c:v", "rv20", "-b:v", "3M"], a: ["-c:a", "ac3", "-b:a", "192k"], ac: 2, ar: 44100, mult: 16, maxW: 1280, mbps: 3 },

  // ---------- video: sequenze di immagini ----------
  seq_png: { mode: "video", group: "Sequenze di immagini", label: "Sequenza PNG", sub: "Un file per fotogramma", ext: "png", need: ["png"], seq: true,
    v: ["-c:v", "png", "-pix_fmt", "rgba"], a: null, lossless: true, mbps: 400, heavy: true },
  seq_tiff: { mode: "video", group: "Sequenze di immagini", label: "Sequenza TIFF", sub: "Stampa, grafica 16 bit", ext: "tif", need: ["tiff"], seq: true,
    v: ["-c:v", "tiff", "-compression_algo", "deflate", "-pix_fmt", "rgb48le"], a: null, lossless: true, mbps: 900, heavy: true },
  seq_dpx: { mode: "video", group: "Sequenze di immagini", label: "Sequenza DPX", sub: "Cinema, color grading", ext: "dpx", need: ["dpx"], seq: true,
    v: ["-c:v", "dpx", "-pix_fmt", "gbrp10le"], a: null, lossless: true, mbps: 1600, heavy: true },
  seq_exr: { mode: "video", group: "Sequenze di immagini", label: "Sequenza OpenEXR", sub: "VFX, compositing", ext: "exr", need: ["exr"], seq: true,
    v: ["-c:v", "exr", "-compression", "zip16", "-format", "half", "-pix_fmt", "gbrpf32le"], a: null, lossless: true, mbps: 1500, heavy: true },
  seq_jpg: { mode: "video", group: "Sequenze di immagini", label: "Sequenza JPG", sub: "Anteprime, storyboard", ext: "jpg", need: ["mjpeg"], seq: true,
    v: ["-c:v", "mjpeg", "-q:v", "2", "-pix_fmt", "yuvj444p"], a: null, mbps: 80 },
  seq_tga: { mode: "video", group: "Sequenze di immagini", label: "Sequenza TGA", sub: "Giochi, motion graphics", ext: "tga", need: ["targa"], seq: true,
    v: ["-c:v", "targa", "-pix_fmt", "bgra"], a: null, lossless: true, mbps: 900, heavy: true },

  // ---------- audio: studio ----------
  wav24: { mode: "audio", group: "Studio", label: "WAV 24 bit", sub: "Mix e mastering", ext: "wav", need: ["pcm_s24le"], a: ["-c:a", "pcm_s24le"], lossless: true, kbps: 2304 },
  wav32f: { mode: "audio", group: "Studio", label: "WAV 32 bit float", sub: "Senza clipping", ext: "wav", need: ["pcm_f32le"], a: ["-c:a", "pcm_f32le"], lossless: true, kbps: 3072 },
  bwf: { mode: "audio", group: "Studio", label: "BWF Broadcast Wave", sub: "Tv e radio, 48 kHz", ext: "wav", need: ["pcm_s24le"], a: ["-c:a", "pcm_s24le", "-write_bext", "1", "-rf64", "auto"], ar: 48000, lossless: true, kbps: 2304 },
  aiff: { mode: "audio", group: "Studio", label: "AIFF", sub: "Apple, Logic, Pro Tools", ext: "aiff", need: ["pcm_s16be"], a: ["-c:a", "pcm_s16be"], lossless: true, kbps: 1411 },
  aiff24: { mode: "audio", group: "Studio", label: "AIFF 24 bit", sub: "Apple, alta risoluzione", ext: "aiff", need: ["pcm_s24be"], a: ["-c:a", "pcm_s24be"], lossless: true, kbps: 2117 },
  caf: { mode: "audio", group: "Studio", label: "CAF", sub: "Apple Core Audio", ext: "caf", need: ["pcm_s24le"], mux: "caf", a: ["-c:a", "pcm_s24le"], lossless: true, kbps: 2117 },
  w64: { mode: "audio", group: "Studio", label: "Wave64", sub: "Sony, file oltre 4 GB", ext: "w64", need: ["pcm_s24le"], mux: "w64", a: ["-c:a", "pcm_s24le"], lossless: true, kbps: 2117 },
  wavpack: { mode: "audio", group: "Studio", label: "WavPack", sub: "Senza perdita, compatto", ext: "wv", need: ["wavpack"], mux: "wv", a: ["-c:a", "wavpack"], lossless: true, kbps: 800 },
  tta: { mode: "audio", group: "Studio", label: "TTA True Audio", sub: "Senza perdita", ext: "tta", need: ["tta"], mux: "tta", a: ["-c:a", "tta"], lossless: true, kbps: 850 },
  mka: { mode: "audio", group: "Studio", label: "MKA (FLAC)", sub: "Matroska audio", ext: "mka", need: ["flac"], mux: "matroska", a: ["-c:a", "flac", "-f", "matroska"], lossless: true, kbps: 900 },
  oga: { mode: "audio", group: "Studio", label: "OGA (FLAC in Ogg)", sub: "Senza perdita, libero", ext: "oga", need: ["flac"], mux: "oga", a: ["-c:a", "flac", "-f", "oga"], lossless: true, kbps: 900 },

  // ---------- audio: cinema e broadcast ----------
  ac3: { mode: "audio", group: "Cinema e broadcast", label: "AC-3 Dolby Digital", sub: "DVD, tv, fino a 5.1", ext: "ac3", need: ["ac3"], mux: "ac3",
    a: ["-c:a", "ac3"], aBr: true, maxCh: 6, ar: 48000, kbps: 448 },
  eac3: { mode: "audio", group: "Cinema e broadcast", label: "E-AC-3 Dolby Digital Plus", sub: "Streaming, fino a 5.1", ext: "eac3", need: ["eac3"], mux: "eac3",
    a: ["-c:a", "eac3"], aBr: true, maxCh: 6, ar: 48000, kbps: 384 },
  dts: { mode: "audio", group: "Cinema e broadcast", label: "DTS", sub: "Home theater, fino a 5.1", ext: "dts", need: ["dca"], mux: "dts",
    a: ["-c:a", "dca", "-strict", "-2", "-b:a", "1509k"], maxCh: 6, ar: 48000, kbps: 1509 },
  truehd: { mode: "audio", group: "Cinema e broadcast", label: "Dolby TrueHD", sub: "Blu-ray, senza perdita", ext: "thd", need: ["truehd"], mux: "truehd",
    a: ["-c:a", "truehd", "-strict", "-2"], maxCh: 6, ar: 48000, lossless: true, kbps: 1800 },
  mp2: { mode: "audio", group: "Cinema e broadcast", label: "MP2", sub: "Radio DAB, broadcast", ext: "mp2", need: ["mp2"], mux: "mp2",
    a: ["-c:a", "mp2"], aBr: true, maxCh: 2, ar: 48000, kbps: 384 },
  pcm_mov: { mode: "audio", group: "Cinema e broadcast", label: "MOV solo audio (PCM)", sub: "Per Final Cut e Premiere", ext: "mov", need: ["pcm_s24le"], a: ["-c:a", "pcm_s24le"], ar: 48000, lossless: true, kbps: 2304 },

  // ---------- audio: altri ----------
  aac: { mode: "audio", group: "Altri formati", label: "AAC (.aac)", sub: "AAC senza contenitore", ext: "aac", need: ["aac"], mux: "adts", a: ["-c:a", "aac"], aBr: true, kbps: 256 },
  wma: { mode: "audio", group: "Altri formati", label: "WMA", sub: "Windows Media Audio", ext: "wma", need: ["wmav2"], mux: "asf", a: ["-c:a", "wmav2"], aBr: true, maxCh: 2, kbps: 192 },
  au: { mode: "audio", group: "Altri formati", label: "AU", sub: "Sun, NeXT, Unix", ext: "au", need: ["pcm_s16be"], mux: "au", a: ["-c:a", "pcm_s16be"], lossless: true, kbps: 1411 },
  speex: { mode: "audio", group: "Altri formati", label: "Speex", sub: "Voce, podcast datati", ext: "spx", need: ["libspeex"], mux: "spx", a: ["-c:a", "libspeex", "-q:a", "10"], ar: 32000, maxCh: 2, kbps: 44 },
  adpcm: { mode: "audio", group: "Altri formati", label: "ADPCM WAV", sub: "WAV compresso, giochi", ext: "wav", need: ["adpcm_ima_wav"], a: ["-c:a", "adpcm_ima_wav"], maxCh: 2, kbps: 360 },
  wav8: { mode: "audio", group: "Altri formati", label: "WAV 8 bit", sub: "Suono retrò", ext: "wav", need: ["pcm_u8"], a: ["-c:a", "pcm_u8"], ar: 22050, kbps: 352 },
  ulaw: { mode: "audio", group: "Altri formati", label: "μ-law", sub: "Telefonia, centralini", ext: "wav", need: ["pcm_mulaw"], a: ["-c:a", "pcm_mulaw"], ar: 8000, ac: 1, kbps: 64 },
  gsm: { mode: "audio", group: "Altri formati", label: "GSM", sub: "Telefonia mobile", ext: "gsm", need: ["libgsm"], mux: "gsm", a: ["-c:a", "libgsm"], ar: 8000, ac: 1, kbps: 13 },
  voc: { mode: "audio", group: "Altri formati", label: "VOC", sub: "Creative, giochi DOS", ext: "voc", need: ["pcm_u8"], mux: "voc", a: ["-c:a", "pcm_u8"], ar: 22050, ac: 1, kbps: 176 },
  mmf: { mode: "audio", group: "Altri formati", label: "MMF", sub: "Suonerie dei vecchi cellulari", ext: "mmf", need: ["adpcm_yamaha"], mux: "mmf", a: ["-c:a", "adpcm_yamaha"], ar: 22050, ac: 1, kbps: 88 },
  sbc: { mode: "audio", group: "Altri formati", label: "SBC", sub: "Bluetooth", ext: "sbc", need: ["sbc"], mux: "sbc", a: ["-c:a", "sbc"], ar: 48000, ac: 2, kbps: 328 },
  aptx: { mode: "audio", group: "Altri formati", label: "aptX", sub: "Bluetooth di qualità", ext: "aptx", need: ["aptx"], mux: "aptx", a: ["-c:a", "aptx"], ar: 48000, ac: 2, kbps: 384 },
  codec2: { mode: "audio", group: "Altri formati", label: "Codec 2", sub: "Radio amatoriale", ext: "c2", need: ["libcodec2"], mux: "codec2", a: ["-c:a", "libcodec2"], ar: 8000, ac: 1, kbps: 3 },
  dfpwm: { mode: "audio", group: "Altri formati", label: "DFPWM", sub: "Minecraft, ComputerCraft", ext: "dfpwm", need: ["dfpwm"], mux: "dfpwm", a: ["-c:a", "dfpwm"], ar: 48000, ac: 1, kbps: 48 },

  // ---------- immagini (fotogramma) ----------
  webp: { mode: "frame", group: "Immagini", label: "WebP", sub: "Siti, leggero", ext: "webp", need: ["libwebp"], v: ["-c:v", "libwebp", "-quality", "92"] },
  tiff: { mode: "frame", group: "Immagini", label: "TIFF", sub: "Stampa, 16 bit", ext: "tif", need: ["tiff"], v: ["-c:v", "tiff", "-compression_algo", "deflate", "-pix_fmt", "rgb48le"] },
  heic_avif: { mode: "frame", group: "Immagini", label: "AVIF", sub: "Moderno, leggerissimo", ext: "avif", need: ["libaom-av1|libsvtav1"], mux: "avif", v: ["-c:v", "libaom-av1", "-still-picture", "1", "-crf", "18", "-pix_fmt", "yuv444p"] },
  jxl: { mode: "frame", group: "Immagini", label: "JPEG XL", sub: "Il nuovo JPEG", ext: "jxl", need: ["libjxl"], v: ["-c:v", "libjxl", "-distance", "0.5"] },
  jp2: { mode: "frame", group: "Immagini", label: "JPEG 2000", sub: "Cinema digitale, archivi", ext: "jp2", need: ["jpeg2000|libopenjpeg"], v: ["-c:v", "jpeg2000", "-pix_fmt", "rgb24"] },
  bmp: { mode: "frame", group: "Immagini", label: "BMP", sub: "Windows", ext: "bmp", need: ["bmp"], v: ["-c:v", "bmp", "-pix_fmt", "bgr24"] },
  tga: { mode: "frame", group: "Immagini", label: "TGA", sub: "Giochi, grafica", ext: "tga", need: ["targa"], v: ["-c:v", "targa", "-pix_fmt", "bgr24"] },
  dpx: { mode: "frame", group: "Immagini", label: "DPX", sub: "Cinema, 10 bit", ext: "dpx", need: ["dpx"], v: ["-c:v", "dpx", "-pix_fmt", "gbrp10le"] },
  exr: { mode: "frame", group: "Immagini", label: "OpenEXR", sub: "VFX, HDR", ext: "exr", need: ["exr"], v: ["-c:v", "exr", "-compression", "zip16", "-format", "half", "-pix_fmt", "gbrpf32le"] },
  qoi: { mode: "frame", group: "Immagini", label: "QOI", sub: "Senza perdita, velocissimo", ext: "qoi", need: ["qoi"], v: ["-c:v", "qoi", "-pix_fmt", "rgb24"] },
  gif_still: { mode: "frame", group: "Immagini", label: "GIF", sub: "256 colori", ext: "gif", need: ["gif"], v: ["-c:v", "gif"],
    vf: "split[gs1][gs2];[gs1]palettegen[gp];[gs2][gp]paletteuse" },
  ppm: { mode: "frame", group: "Immagini", label: "PPM", sub: "Netpbm, grezzo", ext: "ppm", need: ["ppm"], v: ["-c:v", "ppm", "-pix_fmt", "rgb24"] },
  pcx: { mode: "frame", group: "Immagini", label: "PCX", sub: "Paintbrush, DOS", ext: "pcx", need: ["pcx"], v: ["-c:v", "pcx", "-pix_fmt", "rgb24"] },
  sgi: { mode: "frame", group: "Immagini", label: "SGI", sub: "Silicon Graphics", ext: "sgi", need: ["sgi"], v: ["-c:v", "sgi", "-pix_fmt", "rgb24"] },
  sun: { mode: "frame", group: "Immagini", label: "Sun Raster", sub: "Workstation Sun", ext: "ras", need: ["sunrast"], v: ["-c:v", "sunrast", "-pix_fmt", "rgb24"] },
};

// quali voci funzionano con questo FFmpeg (codificatori e contenitori presenti)
export function xfAvailable(encoders: string, muxers: string): string[] {
  const has = (list: string, n: string) => new RegExp(`\\s${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`).test(list);
  return Object.entries(XF).filter(([, f]) =>
    f.need.every((n) => n.split("|").some((alt) => has(encoders, alt))) && (!f.mux || has(muxers, f.mux))).map(([k]) => k);
}

// se c'è solo il codificatore alternativo (es. libaom-av1 al posto di libsvtav1) adatto gli argomenti
export function xfVideoArgs(f: XF, encoders: string): string[] {
  const v = [...(f.v || [])];
  const i = v.indexOf("-c:v");
  if (i < 0) return v;
  const enc = v[i + 1];
  const has = (n: string) => new RegExp(`\\s${n}\\s`).test(encoders);
  if (has(enc)) return v;
  if (enc === "libsvtav1" && has("libaom-av1")) {
    const p = v.indexOf("-preset"); if (p >= 0) v.splice(p, 2, "-cpu-used", "6", "-row-mt", "1");
    v[i + 1] = "libaom-av1";
  } else if (enc === "libaom-av1" && has("libsvtav1")) {
    v[i + 1] = "libsvtav1"; const s = v.indexOf("-still-picture"); if (s >= 0) v.splice(s, 2);
  } else if (enc === "libwebp_anim" && has("libwebp")) v[i + 1] = "libwebp";
  else if (enc === "mpeg4" && has("libxvid")) v[i + 1] = "libxvid";
  else if (enc === "jpeg2000" && has("libopenjpeg")) v[i + 1] = "libopenjpeg";
  return v;
}
