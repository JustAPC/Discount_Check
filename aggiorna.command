#!/bin/bash
# Aggiorna Discount Check all'ultima release, in place.
#
# In place è il punto: l'ID di un'estensione non pacchettizzata dipende dal percorso
# della cartella. Stessa cartella = stesso ID = credenziali, catalogo e pin nella barra
# intatti. Spostarla o reinstallarla altrove equivale a partire da zero.
#
# Doppio clic dal Finder. macOS: su Windows c'è aggiorna.bat.
set -euo pipefail

REPO="JustAPC/Discount_Check"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# La version sta nel manifest: niente jq, che non c'è di serie su macOS.
ver() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }

echo "Discount Check - aggiornamento"
echo "Cartella: $DIR"

[ -f "$DIR/manifest.json" ] || {
  echo
  echo "ERRORE: qui dentro non c'è manifest.json."
  echo "Questo script va tenuto nella cartella dell'estensione, quella che hai"
  echo "selezionato con 'Carica estensione non pacchettizzata'."
  read -r -p "Premi Invio per chiudere. "
  exit 1
}

LOCAL="$(ver "$DIR/manifest.json")"
echo "Versione installata: $LOCAL"
echo
echo "Cerco l'ultima release..."

API="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" || {
  echo "ERRORE: non riesco a contattare GitHub. Controlla la connessione e riprova."
  read -r -p "Premi Invio per chiudere. "
  exit 1
}
LATEST="$(printf '%s' "$API" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)"
URL="$(printf '%s' "$API" | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*discount-check\.zip\)".*/\1/p' | head -1)"

[ -n "$LATEST" ] && [ -n "$URL" ] || {
  echo "ERRORE: la release non contiene discount-check.zip."
  read -r -p "Premi Invio per chiudere. "
  exit 1
}

echo "Ultima disponibile: $LATEST"
if [ "$LATEST" = "$LOCAL" ]; then
  echo
  echo "Sei già aggiornato. Non c'è niente da fare."
  read -r -p "Premi Invio per chiudere. "
  exit 0
fi

echo
echo "Scarico $LATEST..."
curl -fsSL -o "$TMP/new.zip" "$URL"

# Backup prima di toccare qualsiasi cosa: se lo zip è rotto si torna indietro.
echo "Backup della cartella attuale..."
cp -R "$DIR" "$TMP/backup"

echo "Installo..."
unzip -oq "$TMP/new.zip" -d "$DIR"

# Se questo zip fosse stato scaricato dal browser, macOS marcherebbe i file come
# provenienti da internet e al prossimo giro Gatekeeper bloccherebbe di nuovo il
# doppio clic. Qui i file arrivano da curl, ma la cartella può portarsi dietro il
# flag da un'installazione manuale precedente: si toglie una volta per tutte.
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null || true

NOW="$(ver "$DIR/manifest.json")"
if [ "$NOW" != "$LATEST" ]; then
  echo "ERRORE: dopo l'aggiornamento la version è $NOW invece di $LATEST. Ripristino."
  rm -rf "${DIR:?}/"*
  cp -R "$TMP/backup/." "$DIR/"
  read -r -p "Premi Invio per chiudere. "
  exit 1
fi

echo
echo "Fatto: ora è la $NOW."
echo

# Non è detto che il browser sia Chrome: Brave, Edge e Chromium caricano la stessa
# estensione. Si riavvia quello che sta girando davvero, non quello che immaginiamo noi.
BROWSER=""
for b in "Brave Browser" "Google Chrome" "Microsoft Edge" "Chromium" "Vivaldi" "Opera"; do
  if pgrep -x "$b" >/dev/null 2>&1; then
    BROWSER="$b"
    break
  fi
done

if [ -z "$BROWSER" ]; then
  echo "Nessun browser aperto: alla prossima apertura l'estensione sarà già aggiornata."
  echo
  read -r -p "Premi Invio per chiudere. "
  exit 0
fi

echo "Perché $BROWSER la carichi davvero va riavviato."
echo "L'estensione NON viene rimossa: credenziali, catalogo e pin restano."
read -r -p "Riavvio $BROWSER adesso? [S/n] " ANS

case "${ANS:-S}" in
  [nN]*)
    echo
    echo "Ok. Quando vuoi: chiudi e riapri $BROWSER, oppure apri la pagina delle"
    echo "estensioni e premi Aggiorna sulla scheda di Discount Check."
    ;;
  *)
    echo "Riavvio $BROWSER..."
    # 'quit' e non kill: il browser salva la sessione e la riapre se è impostato su
    # "Continua da dove avevi interrotto".
    osascript -e "tell application \"$BROWSER\" to quit" 2>/dev/null || true
    for _ in $(seq 1 20); do
      pgrep -x "$BROWSER" >/dev/null || break
      sleep 0.5
    done
    open -a "$BROWSER"
    echo "Riaperto."
    ;;
esac

echo
read -r -p "Premi Invio per chiudere. "
