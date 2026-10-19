# Sorgente di Brsket

- `main.swift`, `Updater.swift`: l'app per Mac (finestra, menu, notifiche, aggiornamenti automatici).
- `app/server.ts`: il motore (Deno) che usa yt-dlp e FFmpeg.
- `app/static/index.html`: l'interfaccia.
- `app/separa*.py`: separazione di voce e strumenti.
- `brsket.sh`: avvio e prima preparazione (scarica Deno, yt-dlp e FFmpeg).
- `build.command`: compila l'app e crea il pacchetto per gli aggiornamenti; `dmg.command` crea il DMG.
- `collega-apple.command`: collega l'account sviluppatore Apple per firma e notarizzazione.

## Ogni nuova versione (regola fissa)

1. Alza `CFBundleShortVersionString` in `Info.plist` e scrivi la sezione "Novità X" nel README.
2. Compila con `build.command` sul Mac.
3. Copia `release/Brsket.zip` e il DMG in `aggiornamenti/`, porta `aggiornamenti/latest.json` alla nuova versione e fai il push su `main`.
4. Il push crea da solo la release `vX` su GitHub (DMG + zip, note dal README) tramite `.github/workflows/release.yml`: controlla che compaia in Releases.
5. Tutte le copie di Brsket dalla 6.2 in poi trovano l'aggiornamento da sole (all'avvio e ogni 6 ore) e lo installano alla chiusura o con "Riavvia e aggiorna".
