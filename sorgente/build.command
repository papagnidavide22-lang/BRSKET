#!/bin/bash
# Crea Brsket.app (app per Mac), il pacchetto per gli aggiornamenti automatici e il DMG.
# Se sul Mac c'è un certificato "Developer ID Application" la firma è Apple, e con il profilo
# "brsket" (vedi collega-apple.command) anche la notarizzazione: così macOS non chiede conferme.
cd "$(dirname "$0")" || exit 1
B="$PWD"; LOG="$B/build.log"; exec > >(tee "$LOG") 2>&1
set -e
VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" Info.plist)
NEW="$B/Brsket.app"; OUT="$HOME/Applications/Brsket.app"; REL="$B/release"
rm -rf "$NEW" build "$REL"; mkdir -p "$NEW/Contents/MacOS" "$NEW/Contents/Resources" build "$REL"
echo "Compilo Brsket $VER"
SRC="main.swift Updater.swift"
swiftc -O -target arm64-apple-macos13.0 -o build/Brsket-arm64 $SRC -framework Cocoa -framework WebKit -framework UserNotifications
if swiftc -O -target x86_64-apple-macos13.0 -o build/Brsket-x86_64 $SRC -framework Cocoa -framework WebKit -framework UserNotifications 2>/dev/null; then
  lipo -create build/Brsket-arm64 build/Brsket-x86_64 -output "$NEW/Contents/MacOS/Brsket"; echo "Apple Silicon + Intel"
else cp build/Brsket-arm64 "$NEW/Contents/MacOS/Brsket"; echo "solo Apple Silicon"; fi
cp Info.plist "$NEW/Contents/Info.plist"
cp AppIcon.icns "$NEW/Contents/Resources/AppIcon.icns"
cp -R app "$NEW/Contents/Resources/app"
cp brsket.sh "$NEW/Contents/Resources/brsket.sh"; chmod 755 "$NEW/Contents/Resources/brsket.sh"
xattr -cr "$NEW"

# ---- firma ----
ID=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/{print $2; exit}')
NOTARY=0
if [ -n "$ID" ]; then
  echo "Firma Apple: $ID"
  codesign --force --deep --options runtime --timestamp --sign "$ID" "$NEW"
  xcrun notarytool history --keychain-profile brsket >/dev/null 2>&1 && NOTARY=1
else
  echo "Firma locale (nessun certificato Developer ID su questo Mac)"
  codesign --force --deep -s - "$NEW"
fi
codesign --verify --deep --strict "$NEW" && echo "firma ok"

# ---- notarizzazione (solo con account sviluppatore collegato) ----
if [ $NOTARY = 1 ]; then
  echo "Notarizzazione Apple in corso (qualche minuto)…"
  ditto -c -k --keepParent "$NEW" build/notar.zip
  xcrun notarytool submit build/notar.zip --keychain-profile brsket --wait
  xcrun stapler staple "$NEW" && echo "notarizzata"
fi

# ---- pacchetto per gli aggiornamenti automatici ----
ditto -c -k --sequesterRsrc --keepParent "$NEW" "$REL/Brsket.zip"
echo "$VER" > "$REL/versione.txt"

# ---- installa sul Mac (salvo se c'è il file .non-installare: serve per provare gli aggiornamenti) ----
if [ ! -f "$B/.non-installare" ]; then
curl -s -m 2 -X POST http://127.0.0.1:8765/api/quit >/dev/null 2>&1 || true
sleep 4
pkill -x Brsket 2>/dev/null || true; sleep 1
rm -rf "$OUT"; ditto "$NEW" "$OUT"; touch "$OUT"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$OUT" >/dev/null 2>&1 || true
fi
rm -rf build
echo; echo "FATTO: Brsket $VER installata."

# ---- DMG ----
ID="$ID" NOTARY=$NOTARY VER="$VER" "$B/dmg.command"
