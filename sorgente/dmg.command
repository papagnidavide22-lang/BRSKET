#!/bin/bash
# Crea il DMG di Brsket (trascina in Applicazioni). Firmato e notarizzato se possibile.
set -e
B="$(cd "$(dirname "$0")" && pwd)"
VER="${VER:-$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$B/Info.plist")}"
APP="$B/Brsket.app"; [ -d "$APP" ] || APP="$HOME/Applications/Brsket.app"
ST="$(mktemp -d)/Brsket"; mkdir -p "$ST"
ditto "$APP" "$ST/Brsket.app"
ln -s /Applications "$ST/Applicazioni"
cp "$APP/Contents/Resources/AppIcon.icns" "$ST/.VolumeIcon.icns" 2>/dev/null || true
rm -f "$HOME/Applications"/Brsket-*.dmg
OUT="$HOME/Applications/Brsket-$VER.dmg"
hdiutil create -quiet -volname "Brsket" -srcfolder "$ST" -fs HFS+ -format UDRW -ov "$ST.rw.dmg"
MNT=$(hdiutil attach -readwrite -noverify -noautoopen "$ST.rw.dmg" 2>/dev/null | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)
if [ -n "$MNT" ]; then
  xattr -wx com.apple.FinderInfo "0000000000000000040000000000000000000000000000000000000000000000" "$MNT" 2>/dev/null || true
  sync; hdiutil detach -quiet "$MNT" || hdiutil detach -force -quiet "$MNT"
fi
hdiutil convert -quiet "$ST.rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$OUT"
rm -rf "$ST" "$ST.rw.dmg"
if [ -n "$ID" ]; then
  codesign --force --timestamp --sign "$ID" "$OUT"
  if [ "$NOTARY" = 1 ]; then xcrun notarytool submit "$OUT" --keychain-profile brsket --wait && xcrun stapler staple "$OUT"; fi
fi
cp "$OUT" "$B/release/Brsket-$VER.dmg" 2>/dev/null || true
rm -rf "$B/Brsket.app"
hdiutil verify -quiet "$OUT" && echo && echo "FATTO: $(du -h "$OUT" | cut -f1) — $OUT"
