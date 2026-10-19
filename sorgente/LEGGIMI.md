# Sorgente di Brsket

- `main.swift`, `Updater.swift`: l'app per Mac (finestra, menu, notifiche, aggiornamenti automatici).
- `app/server.ts`: il motore (Deno) che usa yt-dlp e FFmpeg.
- `app/static/index.html`: l'interfaccia.
- `app/separa*.py`: separazione di voce e strumenti.
- `brsket.sh`: avvio e prima preparazione (scarica Deno, yt-dlp e FFmpeg).
- `build.command`: compila l'app e crea il pacchetto per gli aggiornamenti; `dmg.command` crea il DMG.
- `collega-apple.command`: collega l'account sviluppatore Apple per firma e notarizzazione.

Per una nuova versione: aggiorna `CFBundleShortVersionString` in `Info.plist`, apri `build.command` su un Mac con gli strumenti da riga di comando di Xcode, poi copia `release/Brsket.zip` e il DMG in `aggiornamenti/` e aggiorna `aggiornamenti/latest.json`.
