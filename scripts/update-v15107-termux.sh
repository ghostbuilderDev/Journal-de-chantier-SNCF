#!/usr/bin/env bash
# V15.10.7 frontend-only installer. It never writes Supabase or config.js.
set -Eeuo pipefail
RELEASE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPOSITORY='ghostbuilderdev/Journal-de-chantier-SNCF'
REPO_DIR="${1:-$HOME/Journal-de-chantier-SNCF}"
fail() { echo "ERREUR : $*" >&2; exit 1; }
command -v git >/dev/null || fail 'Git est requis : pkg install git python'
command -v python >/dev/null || fail 'Python est requis : pkg install python'
[[ -d "$REPO_DIR/.git" ]] || fail "Dépôt Git introuvable : $REPO_DIR"
REPO_DIR="$(cd -- "$REPO_DIR" && pwd -P)"
[[ "$REPO_DIR" != "$RELEASE_ROOT" ]] || fail 'Extraire la livraison dans un dossier distinct du dépôt.'
cd -- "$REPO_DIR"
origin="$(git remote get-url origin)"
case "${origin,,}" in
  "https://github.com/${REPOSITORY,,}"|"https://github.com/${REPOSITORY,,}.git"|"git@github.com:${REPOSITORY,,}.git") ;;
  *) fail 'Le dépôt origin ne correspond pas au Journal de chantier.' ;;
esac
[[ "$(git branch --show-current)" == main ]] || fail 'Le dépôt doit être sur la branche main.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'Des modifications locales sont présentes : elles sont conservées. Envoie une capture de Termux.'
git pull --ff-only origin main
python "$RELEASE_ROOT/scripts/prepare-v15107-update.py" check "$REPO_DIR"
if [[ "$(python "$RELEASE_ROOT/scripts/prepare-v15107-update.py" changed "$REPO_DIR")" == yes ]]; then
  python "$RELEASE_ROOT/scripts/prepare-v15107-update.py" apply "$REPO_DIR"
  mapfile -t release_files < <(python "$RELEASE_ROOT/scripts/prepare-v15107-update.py" files "$REPO_DIR")
  git add -- "${release_files[@]}"
  git commit -m 'Journal Chantier V15.10.7 - photos rapides'
  git push origin main
fi
echo 'V15.10.7 envoyée : fil plus rapide, originaux et PDF conservés.'
echo 'Aucune migration Supabase, aucun SQL et aucune modification des droits.'
echo 'Attendez la coche verte : https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF/actions'
echo 'Puis fermez et rouvrez : https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/'
