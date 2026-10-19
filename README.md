# Brsket

Scarica video e audio da YouTube, Vimeo, Instagram e altri siti, nel formato che ti serve. App per Mac (macOS 13 o successivo, Apple Silicon e Intel).

## Installare
1. Scarica **[Brsket.dmg](https://github.com/papagnidavide22-lang/BRSKET/releases/latest/download/Brsket.dmg)**.
2. Aprilo e trascina Brsket in Applicazioni.
3. La prima volta: clic destro su Brsket → Apri → Apri.

Poi Brsket si aggiorna da sola.

## Novità della 7.1
- **Verifica dei formati** (Impostazioni): Brsket converte un video di prova in tutti i formati con il tuo Mac e controlla che ogni file si apra fino in fondo. Sul Mac di prova: 104 formati su 104 funzionano.
- I video Motion JPEG (alcune fotocamere e vecchie regie) ora vengono riconosciuti come video e si convertono.
- DVD, DV e Video CD seguono sempre il loro standard (720 × 576 o 352 × 288, 25 fps): le opzioni che non possono valere si nascondono.
- Misure su misura arrotondate da sole quando il formato le vuole multiple di 4 o di 16 (HAP Alpha, CineForm).
- Fotogrammi dai link: nome del file con il titolo vero anche incollando più link insieme, istante oltre la fine corretto da solo, copertina presa dalla migliore disponibile se quella indicata non esiste.

## Novità della 7.0
- **90 formati in più** nel nuovo riquadro "Tutti i formati", con la ricerca:
  - **Professionale**: ProRes 422 Proxy, LT, 422 e 4444 XQ; DNxHR LB, SQ, HQ, HQX, 444 e DNxHR in MXF per Avid; GoPro CineForm; HAP Alpha; QuickTime Animation; non compresso 10 bit; FFV1; Ut Video; Motion JPEG.
  - **Broadcast**: XDCAM HD422 in MXF, MPEG-TS, M2TS, MPEG-2, DVD PAL, DV PAL.
  - **Web e moderni**: HEVC (anche 10 bit), AV1, WebM AV1 e VP8, OGV, GIF animata, PNG animato, WebP animato, FLV.
  - **Vecchi formati**: WMV, AVI DivX/Xvid, MPEG-1 VCD, 3GP, RealMedia.
  - **Sequenze di immagini**: PNG, TIFF 16 bit, DPX 10 bit, OpenEXR, JPG, TGA (una cartella, un file per fotogramma).
  - **Audio da studio**: WAV 24 bit e 32 bit float, BWF, AIFF, CAF, Wave64, WavPack, TTA, MKA, OGA.
  - **Cinema e broadcast**: AC-3, E-AC-3, DTS, Dolby TrueHD, MP2, MOV solo audio.
  - **Altri audio**: AAC, WMA, AU, Speex, ADPCM, WAV 8 bit, μ-law, GSM, VOC, MMF, SBC, aptX, Codec 2, DFPWM.
  - **Immagini** (fotogramma): WebP, TIFF, AVIF, JPEG XL, JPEG 2000, BMP, TGA, DPX, OpenEXR, QOI, GIF, PPM, PCX, SGI, Sun Raster.
- Ogni formato sa i suoi limiti: canali massimi (es. AC-3 fino a 5.1), mono obbligato, misure fisse (XDCAM 1920 × 1080, DVD 720 × 576) e lo dice prima di convertire.
- I formati che l'FFmpeg del Mac non ha vengono mostrati come "Non disponibile".

## Novità della 6.9
- **Converti i file che hai già**: trascina un file video o audio nella finestra (o sull'icona nel Dock, o scegli "Converti un file dal computer") e usa le stesse opzioni dei link: HAP, ProRes, 9:16, volume uniforme, taglio, canali. Il file originale non viene toccato.
- **Fotogramma e copertina**: salva un fotogramma a un istante preciso (con anteprima e avanti/indietro di un fotogramma) o la copertina originale, in JPG o PNG. Funziona con i link e con i file.
- **Risoluzione su misura**: scrivi la misura esatta, per esempio 1152 × 576 o 3840 × 768 per un ledwall, e scegli bande nere o ritaglio.
- **Preset**: salvi una combinazione di impostazioni e la riusi con un clic. Già pronti "Ledwall fiera" (HAP, 50 fps, 1080p) e "Reel Instagram" (9:16, MP4, −14 LUFS).

## Novità della 6.8
- Nuovo logo: la U nera su sfondo panna.
- Opzioni raggruppate in sezioni che si aprono e si chiudono (Formato e qualità, Immagine, Audio, Taglio, Nome e copertina). Da chiuse mostrano un riassunto delle scelte; Brsket ricorda quali tieni aperte.

## Novità della 6.7
- Se Brsket è aperta da Download o dal DMG (fuori da Applicazioni) e non può aggiornarsi, ora lo dice con una notifica e si sposta da sola in Applicazioni con un clic (menu Brsket → Sposta in Applicazioni).

## Novità della 6.6
- Le tracce 5.1 di YouTube (AC-3 / E-AC-3) ora vengono trovate e scaricate vere, non ricreate dallo stereo.
- Con "Stereo" scelto, i video mono escono in stereo.
- Nei Completati si vede cosa è uscito davvero: risoluzione, fps e canali.

## Novità della 6.5
- **Volume uniforme**: porta ogni file a −14 LUFS (streaming), −16 (podcast) o −23 (broadcast EBU R128).
- **Frame rate e risoluzione per lo show**: 24, 25, 30, 50 o 60 fps e 1080p o 4K esatti, anche con ProRes e HAP.
- **Playlist intere**: incolli il link di una playlist e tutti i video vanno in coda.
- **Video protetti da login**: Brsket può usare l'accesso già fatto nel browser (Impostazioni → Accesso ai siti).

## Aggiornamenti
La cartella `aggiornamenti/` contiene l'ultima versione: `latest.json` dice quale è, `Brsket.zip` è il pacchetto che l'app scarica da sola, `Brsket.dmg` è per le nuove installazioni.

## Codice
Il codice sorgente completo è nella cartella `sorgente/`.
