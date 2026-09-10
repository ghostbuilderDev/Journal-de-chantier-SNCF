#!/usr/bin/env bash
# Interface-only hotfix for the verified V15.10.2. No database or secret changes.
set -Eeuo pipefail
RELEASE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPOSITORY='ghostbuilderdev/Journal-de-chantier-SNCF'
BACKUP_DIR=''
PHASE='verification'
fail() { echo "ERREUR : $*" >&2; [[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde : $BACKUP_DIR" >&2; exit 1; }
on_error() {
  local status=$?
  (( BASH_SUBSHELL == 0 )) || exit "$status"
  echo "Mise a jour interrompue pendant : $PHASE." >&2
  [[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde : $BACKUP_DIR" >&2
  echo 'Relancez la meme commande pour reprendre ; les donnees existantes sont conservees.' >&2
  exit "$status"
}
trap on_error ERR
for command in git gh python; do
  command -v "$command" >/dev/null || fail 'Outils requis : pkg install git gh python unzip'
done
python -c 'import tomllib' || fail 'Python 3.11 minimum requis.'
REPO_DIR="${1:-$HOME/Journal-de-chantier-SNCF}"
if [[ ! -e "$REPO_DIR" ]]; then
  git clone "https://github.com/${REPOSITORY}.git" "$REPO_DIR"
fi
[[ -d "$REPO_DIR/.git" ]] || fail "Depot Git introuvable : $REPO_DIR"
REPO_DIR="$(cd -- "$REPO_DIR" && pwd -P)"
[[ "$REPO_DIR" != "$RELEASE_ROOT" ]] || fail 'Extraire la livraison dans un dossier distinct du depot Git.'
cd -- "$REPO_DIR"
origin="$(git remote get-url origin)"
case "${origin,,}" in
  "https://github.com/${REPOSITORY,,}"|"https://github.com/${REPOSITORY,,}.git"|"git@github.com:${REPOSITORY,,}.git"|"ssh://git@github.com/${REPOSITORY,,}.git") ;;
  *) fail "Le depot origin ne correspond pas a $REPOSITORY." ;;
esac
[[ "$(git branch --show-current)" == main ]] || fail 'Le depot doit etre sur main.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'Des modifications locales existent ; elles sont conservees.'
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web --scopes repo
fi
git_remote() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
prepare() { python "$RELEASE_ROOT/scripts/prepare-v15103-update.py" "$1" "$REPO_DIR"; }
git_remote fetch origin main
read -r ahead behind < <(git rev-list --left-right --count HEAD...origin/main)
if (( ahead > 0 )); then
  resumed_phase="$(prepare pending)"
  echo "Reprise du commit $resumed_phase verifie apres interruption du push."
  git_remote push origin main
elif (( behind > 0 )); then
  git merge --ff-only origin/main
fi
prepare check
if [[ -z "$(git config user.name || true)" || -z "$(git config user.email || true)" ]]; then
  identity="$(gh api user)"
  git config user.name "$(python -c 'import json,sys;x=json.load(sys.stdin);print(x.get("name") or x["login"])' <<<"$identity")"
  git config user.email "$(python -c 'import json,sys;x=json.load(sys.stdin);print(str(x["id"])+"+"+x["login"]+"@users.noreply.github.com")' <<<"$identity")"
fi
if [[ "$(prepare changed)" == yes ]]; then
  BACKUP_DIR="$(mktemp -d "${JOURNAL_BACKUP_BASE:-$HOME}/Journal-Chantier-V15.10.3-sauvegarde-XXXXXXXX")"
  git rev-parse HEAD > "$BACKUP_DIR/commit-avant.txt"
  git archive --format=tar HEAD > "$BACKUP_DIR/code-avant.tar"
  cp -- config.js "$BACKUP_DIR/config.js"
fi
mapfile -t frontend_files < <(prepare list-frontend)
PHASE='publication de l interface'
git_remote fetch origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail 'Le depot distant a change ; relancez pour reverifier.'
prepare frontend
git add -- "${frontend_files[@]}"
if ! git diff --cached --quiet; then
  git commit -m 'Journal Chantier V15.10.3 - signatures automatiques'
  git_remote push origin main
fi
PHASE='terminee'
echo 'Les donnees et les notifications existantes sont conservees.'
echo 'V15.10.3 envoyee : signatures automatiques, nouvelle signature prioritaire et suppression de la verification manuelle.'
echo "Attendez la coche verte de GitHub Pages : https://github.com/${REPOSITORY,,}/actions"
echo 'Fermez puis rouvrez : https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/'
[[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde du code precedent : $BACKUP_DIR"
