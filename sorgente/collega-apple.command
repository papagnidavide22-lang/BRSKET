#!/bin/bash
# Da usare UNA VOLTA dopo l'iscrizione all'Apple Developer Program.
# Prima installa il certificato "Developer ID Application" (Xcode → Impostazioni → Account → Gestisci certificati,
# oppure developer.apple.com → Certificates). Poi apri questo file: ti chiede i dati e li salva nel Portachiavi.
echo "Collegamento di Brsket al tuo account sviluppatore Apple"
echo
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "✓ Certificato Developer ID trovato:"; security find-identity -v -p codesigning | grep "Developer ID Application"
else
  echo "✗ Manca il certificato \"Developer ID Application\". Installalo e riapri questo file."; read -n1 -p "Premi un tasto per chiudere"; exit 1
fi
echo
echo "Ora servono: la tua Apple ID, il Team ID (10 caratteri, su developer.apple.com → Membership)"
echo "e una password per app (appleid.apple.com → Accesso e sicurezza → Password per app)."
echo
xcrun notarytool store-credentials brsket
echo
echo "Fatto. Dalla prossima versione Brsket sarà firmata e notarizzata da Apple."
read -n1 -p "Premi un tasto per chiudere"
