#!/usr/bin/env bash
# Frontend-only update: preserve the already verified V15.10.5 backend.
set -Eeuo pipefail
RELEASE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPOSITORY='ghostbuilderdev/Journal-de-chantier-SNCF'
BACKUP_DIR=''
fail() { echo "ERREUR : $*" >&2; exit 1; }
on_error() {
  local result=$?
  (( BASH_SUBSHELL == 0 )) || exit "$result"
  echo 'Installation interrompue. Les données sont conservées ; relancez la même commande.' >&2
  [[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde du code : $BACKUP_DIR" >&2
  exit "$result"
}
trap on_error ERR
for tool in git gh python; do
  command -v "$tool" >/dev/null || fail 'Outils requis : pkg install git gh python unzip'
done
REPO_DIR="${1:-$HOME/Journal-de-chantier-SNCF}"
if [[ ! -e "$REPO_DIR" ]]; then git clone "https://github.com/${REPOSITORY}.git" "$REPO_DIR"; fi
[[ -d "$REPO_DIR/.git" ]] || fail "Dépôt Git introuvable : $REPO_DIR"
REPO_DIR="$(cd -- "$REPO_DIR" && pwd -P)"
[[ "$REPO_DIR" != "$RELEASE_ROOT" ]] || fail 'Extraire la livraison dans un dossier distinct du dépôt.'
cd -- "$REPO_DIR"
prepare() { python "$RELEASE_ROOT/scripts/prepare-v15106-update.py" "$1" "$REPO_DIR"; }
origin="$(git remote get-url origin)"
case "${origin,,}" in
  "https://github.com/${REPOSITORY,,}"|"https://github.com/${REPOSITORY,,}.git"|"git@github.com:${REPOSITORY,,}.git"|"ssh://git@github.com/${REPOSITORY,,}.git") ;;
  *) fail 'Le dépôt origin ne correspond pas au Journal de chantier.' ;;
esac
[[ "$(git branch --show-current)" == main ]] || fail 'Le dépôt doit être sur main.'
dirty="$(git status --porcelain --untracked-files=all)"
if [[ -n "$dirty" ]]; then prepare worktree; fi
if ! gh auth status --hostname github.com >/dev/null 2>&1; then gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow; fi
git_remote() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
git_remote fetch origin main
read -r ahead behind < <(git rev-list --left-right --count HEAD...origin/main)
if (( ahead > 0 )); then
  [[ -z "$dirty" ]] || fail 'Un commit local et une copie non terminée coexistent ; ils sont conservés.'
  prepare pending
  git_remote push origin main
elif (( behind > 0 )); then
  [[ -z "$dirty" ]] || fail 'Le dépôt distant a changé pendant une copie interrompue ; les fichiers sont conservés.'
  git merge --ff-only origin/main
fi
prepare check
if [[ "$(prepare changed)" == yes ]]; then
  [[ -n "$(git config user.name || true)" && -n "$(git config user.email || true)" ]] || fail 'Identité Git manquante. Reprendre celle utilisée pour la V15.10.5.'
  BACKUP_DIR="$(mktemp -d "${JOURNAL_BACKUP_BASE:-$HOME}/Journal-Chantier-V15.10.6-sauvegarde-XXXXXXXX")"
  git rev-parse HEAD > "$BACKUP_DIR/commit-avant.txt"
  git archive --format=tar HEAD > "$BACKUP_DIR/code-avant.tar"
  cp -- config.js "$BACKUP_DIR/config.js"
  mapfile -t release_files < <(prepare files)
  prepare apply
  git add -- "${release_files[@]}"
  git commit -m 'Journal Chantier V15.10.6 - albums photos'
  git_remote push origin main
fi
echo 'V15.10.6 envoyée : plusieurs photos dans un album, navigation et originaux conservés.'
echo 'Aucune migration Supabase et aucun paramétrage supplémentaire requis.'
echo 'Attendez la coche verte de GitHub Pages : https://github.com/ghostbuilderdev/Journal-de-chantier-SNCF/actions'
echo 'Fermez toutes les fenêtres du Journal puis rouvrez : https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/'
echo 'Ne pas désinstaller l’application ni effacer les données du navigateur.'
[[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde du code précédent : $BACKUP_DIR"
