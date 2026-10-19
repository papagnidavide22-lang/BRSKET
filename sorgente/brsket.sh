#!/bin/bash
# Brsket.app — avviato dall'app (AppleScript che resta aperta), doppio clic e basta.
# L'app resta in sola lettura; strumenti e impostazioni stanno in ~/Library/Application Support/Brsket.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"
D="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$D/app" ]; then APP="$D/app"; else APP="$(cd "$D/../Resources/app" && pwd)"; fi
DATA="$HOME/Library/Application Support/Brsket"
OLD="$HOME/Library/Application Support/Scarica"
[ -d "$OLD" ] && [ ! -d "$DATA" ] && mv "$OLD" "$DATA" 2>/dev/null     # recupera quanto già scaricato dalla versione "Scarica"
BIN="$DATA/bin"; DL="$BIN/dl"; URL="http://127.0.0.1:8765"; LOAD="$DATA/avvio.html"
mkdir -p "$BIN" "$DL" || exit 1
exec 2>>"$DATA/avvio.log"
export SCARICA_DATA="$DATA" SCARICA_NO_BROWSER=1

# nell'app per Mac la finestra è dell'app stessa: niente browser
show() { [ -n "$BRSKET_NATIVE" ] || open "$1"; }

# pagina di attesa: si apre subito e passa da sola all'app appena è pronta (nessuna finestra di sistema)
page() {  # titolo testo [errore]
  local spin='<div class="ring"></div>' go='setInterval(()=>{const i=new Image();i.onload=()=>location.replace("'"$URL"'/");i.src="'"$URL"'/icon.png?"+Date.now()},700);setTimeout(()=>location.reload(),4000);'
  [ -n "$3" ] && { spin='<div class="err">!</div>'; go=''; }
  cat > "$LOAD" <<HTML
<!doctype html><html lang="it"><meta charset="utf-8"><title>Brsket</title><meta name="viewport" content="width=device-width">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;font:19px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;background:#f2f2ef;color:#0c0c0c;padding:0 8vw;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#0c0c0c;color:#f2f2ef}.ring{border-color:#262624!important;border-top-color:#f2f2ef!important}}
.card{max-width:34em}
h1{font-size:clamp(40px,6vw,84px);font-weight:500;letter-spacing:-.05em;line-height:.95;margin:28px 0 18px}p{line-height:1.45;margin:0;max-width:34ch}
.ring{width:34px;height:34px;border-radius:50%;border:3px solid #d9d9d4;border-top-color:#0c0c0c;animation:r .9s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
.err{width:40px;height:40px;background:#c8141c;color:#fff;font-size:24px;display:grid;place-items:center;border-radius:0 0 20px 20px}</style>
<div class="card">$spin<h1>$1</h1><p>$2</p></div><script>$go</script></html>
HTML
}

# preparazioni rimaste appese da un avvio precedente: fermale (verranno riprese da qui)
for p in $(pgrep -f "Resources/brsket.sh" 2>/dev/null); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null; done
pkill -f "curl .*(martin-riedl|yt-dlp/releases|ffmpeg-static|denoland/deno)" 2>/dev/null

# già aperto? se è questa stessa app mostra la pagina (e completa la preparazione se era rimasta a metà);
# altrimenti chiudi la versione vecchia e riparti da qui
SERVER_UP=0
ST="$(curl -s -m 1 "$URL/api/status" 2>/dev/null)"
if [ -n "$ST" ]; then
  # stessa app e motore già tenuto acceso da Brsket: basta aprire la pagina
  BUILD=$(/usr/bin/stat -f %m "$APP/server.ts" 2>/dev/null)
  if printf '%s' "$ST" | grep -qF "\"root\":\"$APP\"" && printf '%s' "$ST" | grep -qF '"managed":true' && printf '%s' "$ST" | grep -qF "\"build\":$BUILD,"; then
    show "$URL"
    [ -f "$BIN/.setup-in-corso" ] || exit 0
    SERVER_UP=1
  else
    curl -s -m 2 -X POST "$URL/api/quit" >/dev/null 2>&1
    for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 1 "$URL/api/status" >/dev/null 2>&1 || break; sleep 0.5; done
  fi
fi

if [ $SERVER_UP = 0 ]; then page "Avvio Brsket…" "Un attimo."; show "$LOAD"; fi

if [ "$(uname -m)" = "arm64" ]; then D=aarch64; F=arm64; E=arm64; else D=x86_64; F=amd64; E=x64; fi

# download robusto: se la velocità scende sotto 30 KB/s per 15 secondi riprova, riprendendo da dove era rimasto
fetch() {  # url destinazione
  local rc=0 try
  for try in 1 2 3 4 5; do
    curl -fL -sS --connect-timeout 15 --speed-limit 30000 --speed-time 15 -C - "$1" -o "$2"
    rc=$?
    [ $rc = 0 ] && return 0
    [ $rc = 33 ] && rm -f "$2"          # il server non riprende: ricomincia da capo
    [ $rc = 22 ] && break               # file non trovato su questo server: passa alla riserva
    sleep 1
  done
  return $rc
}
why() {
  case $1 in
    6|7|35|52|56) echo "Non riesco a raggiungere internet (errore $1). Controlla la connessione, la VPN o il firewall, poi riapri Brsket." ;;
    28) echo "La connessione è troppo lenta o si interrompe (errore 28). Riapri Brsket per riprendere da dove si è fermato." ;;
    23) echo "Non riesco a salvare i file sul disco (errore 23). Controlla lo spazio libero e riapri Brsket." ;;
    51|58|60|77) echo "La connessione sicura è stata bloccata (errore $1): succede con reti aziendali o antivirus che filtrano HTTPS." ;;
    *) echo "Download non riuscito (errore $1). Riapri Brsket: riprende da dove si è fermato." ;;
  esac
}
size_of() { curl -sIL --connect-timeout 8 -m 12 "$1" | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n+0}'; }
step() { echo "$1" > "$BIN/.setup-in-corso"; }
done_mark() { echo "${2:-0}" > "$DL/$1.done"; }   # byte già completati (per la percentuale)

# 1) Deno, il motore della pagina (da GitHub, di solito pochi secondi)
if [ ! -x "$BIN/deno" ]; then
  page "Preparo Brsket" "Primo avvio: scarico il motore dell'app. Ci vuole meno di un minuto."
  fetch "https://github.com/denoland/deno/releases/latest/download/deno-$D-apple-darwin.zip" "$DL/deno.zip" || { page "Qualcosa non va" "$(why $?)" err; exit 1; }
  unzip -oq "$DL/deno.zip" -d "$BIN" && rm -f "$DL/deno.zip" && chmod +x "$BIN/deno" || { rm -f "$DL/deno.zip" "$BIN/deno"; page "Qualcosa non va" "Il file scaricato è danneggiato. Riapri Brsket per riprovare." err; exit 1; }
fi
xattr -dr com.apple.quarantine "$BIN" 2>/dev/null
"$BIN/deno" --version >/dev/null 2>&1 || { page "Mac non compatibile" "Brsket richiede macOS 13 o successivo. Questo Mac ha macOS $(sw_vers -productVersion)." err; exit 1; }

cd "$APP"
# macOS chiude tutto ciò che un'app ha avviato appena l'app termina (anche i servizi affidati a launchd).
# Quindi Brsket resta accesa finché c'è il motore: lo avvia, lo aspetta, e si chiude con lui (Esci).
KEEP=0
if [ $SERVER_UP = 0 ]; then
  /bin/launchctl remove "it.davide.brsket.motore" >/dev/null 2>&1      # pulizia della versione 5.4
  SCARICA_HOSTED=1 "$BIN/deno" run --allow-all --quiet server.ts >>"$DATA/brsket.log" 2>&1 </dev/null &
  SERVER_PID=$!
  KEEP=1
  trap 'kill -TERM "$SERVER_PID" 2>/dev/null' TERM INT HUP
fi

# 2) yt-dlp e FFmpeg in parallelo, mentre la pagina è già aperta e mostra la percentuale
YT_ZIP="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip"
YT_ONE="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
FF_MAIN="https://ffmpeg.martin-riedl.de/redirect/latest/macos/$F/release"
FF_ALT="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0"

job_ytdlp() {
  if fetch "$YT_ZIP" "$DL/ytdlp.zip"; then
    local n=$(wc -c < "$DL/ytdlp.zip" 2>/dev/null | tr -d " " || echo 0)
    rm -rf "$BIN/ytdlp.new"; mkdir -p "$BIN/ytdlp.new"
    if unzip -oq "$DL/ytdlp.zip" -d "$BIN/ytdlp.new" && chmod +x "$BIN/ytdlp.new/yt-dlp_macos"; then
      rm -f "$DL/ytdlp.zip"; xattr -dr com.apple.quarantine "$BIN/ytdlp.new" 2>/dev/null
      rm -rf "$BIN/ytdlp"; mv "$BIN/ytdlp.new" "$BIN/ytdlp" && ln -sfn "ytdlp/yt-dlp_macos" "$BIN/yt-dlp"
      date +%s > "$BIN/.ytdlp-aggiornato"; done_mark ytdlp "$n"; return 0
    fi
  fi
  # riserva: versione in un solo file
  fetch "$YT_ONE" "$DL/yt-dlp.part" || { why $? > "$DL/ytdlp.fail"; return 1; }
  local n=$(wc -c < "$DL/yt-dlp.part" 2>/dev/null | tr -d " " || echo 0)
  mv "$DL/yt-dlp.part" "$BIN/yt-dlp.one" && chmod +x "$BIN/yt-dlp.one" && ln -sfn "yt-dlp.one" "$BIN/yt-dlp" && done_mark ytdlp "$n"
}
job_ff() {  # ffmpeg | ffprobe
  local t=$1 n
  if fetch "$FF_MAIN/$t.zip" "$DL/$t.zip" && unzip -oq "$DL/$t.zip" -d "$BIN" && chmod +x "$BIN/$t"; then
    n=$(wc -c < "$DL/$t.zip" 2>/dev/null | tr -d " " || echo 0); rm -f "$DL/$t.zip"; done_mark "$t" "$n"; return 0
  fi
  rm -f "$DL/$t.zip"
  # riserva su GitHub
  fetch "$FF_ALT/$t-darwin-$E.gz" "$DL/$t.gz" || { why $? > "$DL/$t.fail"; return 1; }
  n=$(wc -c < "$DL/$t.gz" 2>/dev/null | tr -d " " || echo 0)
  gunzip -c "$DL/$t.gz" > "$BIN/$t.tmp" && mv "$BIN/$t.tmp" "$BIN/$t" && chmod +x "$BIN/$t" && rm -f "$DL/$t.gz" && done_mark "$t" "$n"
}

FIRST=0
NEED_YT=0; [ -x "$BIN/yt-dlp" ] && "$BIN/yt-dlp" --version >/dev/null 2>&1 || NEED_YT=1
NEED_FF=0; [ -x "$BIN/ffmpeg" ] || NEED_FF=1
NEED_FP=0; [ -x "$BIN/ffprobe" ] || NEED_FP=1
if [ $((NEED_YT + NEED_FF + NEED_FP)) -gt 0 ]; then
  FIRST=1
  rm -f "$DL"/*.done "$DL"/*.fail
  step "Calcolo cosa scaricare…"
  TOTAL=0
  [ $NEED_YT = 1 ] && TOTAL=$((TOTAL + $(size_of "$YT_ZIP")))
  [ $NEED_FF = 1 ] && TOTAL=$((TOTAL + $(size_of "$FF_MAIN/ffmpeg.zip")))
  [ $NEED_FP = 1 ] && TOTAL=$((TOTAL + $(size_of "$FF_MAIN/ffprobe.zip")))
  echo "$TOTAL" > "$BIN/.setup-total"
  step "Scarico gli strumenti, tre alla volta in parallelo…"
  [ $NEED_YT = 1 ] && job_ytdlp &
  [ $NEED_FF = 1 ] && job_ff ffmpeg &
  [ $NEED_FP = 1 ] && job_ff ffprobe &
  wait
  xattr -dr com.apple.quarantine "$BIN" 2>/dev/null
  FAIL="$(cat "$DL"/*.fail 2>/dev/null | head -1)"
  if [ -n "$FAIL" ] || [ ! -x "$BIN/yt-dlp" ] || [ ! -x "$BIN/ffmpeg" ] || [ ! -x "$BIN/ffprobe" ]; then
    step "${FAIL:-Preparazione non completata.} Chiudi e riapri Brsket per riprendere."
    exit 1
  fi
  rm -f "$BIN/.setup-total" "$DL"/*.done
fi
rm -f "$BIN/.setup-in-corso"

# aggiornamento silenzioso di yt-dlp ogni 3 giorni (YouTube cambia spesso)
if [ $FIRST = 0 ] && [ -d "$BIN/ytdlp" ]; then
  last=$(cat "$BIN/.ytdlp-aggiornato" 2>/dev/null || echo 0)
  [ $(( $(date +%s) - last )) -gt 259200 ] && job_ytdlp >/dev/null 2>&1
fi
# resta accesa finché il motore è acceso (si chiude quando premi Esci nella pagina)
if [ "$KEEP" = 1 ] && [ -n "$SERVER_PID" ]; then
  while kill -0 "$SERVER_PID" 2>/dev/null; do sleep 2 & wait $!; done
fi
exit 0
