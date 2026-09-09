#!/usr/bin/env bash
# UI-only messaging repair. No SQL, no Supabase credentials, no data deletion.
set -Eeuo pipefail
RELEASE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPOSITORY='ghostbuilderdev/Journal-de-chantier-SNCF'
BACKUP_DIR=''
fail() { echo "ERREUR : $*" >&2; exit 1; }
on_error() {
  local status=$?
  (( BASH_SUBSHELL == 0 )) || exit "$status"
  echo 'Publication interrompue. Les messages et la base de donnees sont conserves.' >&2
  [[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde : $BACKUP_DIR" >&2
  echo 'Relancez la meme commande pour reprendre.' >&2
  exit "$status"
}
trap on_error ERR
for command in git gh python; do
  command -v "$command" >/dev/null || fail 'Outils requis : pkg install git gh python unzip'
done
REPO_DIR="${1:-$HOME/Journal-de-chantier-SNCF}"
if [[ ! -e "$REPO_DIR" ]]; then git clone "https://github.com/${REPOSITORY}.git" "$REPO_DIR"; fi
[[ -d "$REPO_DIR/.git" ]] || fail "Depot Git introuvable : $REPO_DIR"
REPO_DIR="$(cd -- "$REPO_DIR" && pwd -P)"
[[ "$REPO_DIR" != "$RELEASE_ROOT" ]] || fail 'Extraire le correctif dans un dossier distinct du depot Git.'
cd -- "$REPO_DIR"
origin="$(git remote get-url origin)"
case "${origin,,}" in
  "https://github.com/${REPOSITORY,,}"|"https://github.com/${REPOSITORY,,}.git"|"git@github.com:${REPOSITORY,,}.git"|"ssh://git@github.com/${REPOSITORY,,}.git") ;;
  *) fail 'Le depot origin ne correspond pas au Journal de chantier attendu.' ;;
esac
[[ "$(git branch --show-current)" == main ]] || fail 'Le depot doit etre sur main.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'Des modifications locales existent ; elles sont conservees.'
if ! gh auth status --hostname github.com >/dev/null 2>&1; then gh auth login --hostname github.com --git-protocol https --web --scopes repo; fi
git_remote() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
prepare() { python "$RELEASE_ROOT/scripts/prepare-v1571-update.py" "$1" "$REPO_DIR"; }
git_remote fetch origin main
read -r ahead behind < <(git rev-list --left-right --count HEAD...origin/main)
if (( ahead > 0 )); then prepare pending; git_remote push origin main
elif (( behind > 0 )); then git merge --ff-only origin/main; fi
prepare check
if [[ "$(prepare changed)" == yes ]]; then
  if [[ -z "$(git config user.name || true)" || -z "$(git config user.email || true)" ]]; then
    identity="$(gh api user)"
    git config user.name "$(python -c 'import json,sys;x=json.load(sys.stdin);print(x.get("name") or x["login"])' <<<"$identity")"
    git config user.email "$(python -c 'import json,sys;x=json.load(sys.stdin);print(str(x["id"])+"+"+x["login"]+"@users.noreply.github.com")' <<<"$identity")"
  fi
  BACKUP_DIR="$(mktemp -d "${JOURNAL_BACKUP_BASE:-$HOME}/Journal-Chantier-V15.7.1-sauvegarde-XXXXXXXX")"
  git rev-parse HEAD > "$BACKUP_DIR/commit-avant.txt"
  git archive --format=tar HEAD > "$BACKUP_DIR/code-avant.tar"
  cp -- config.js "$BACKUP_DIR/config.js"
  mapfile -t files < <(prepare list)
  prepare apply
  git add -- "${files[@]}"
  git commit -m 'Journal Chantier V15.7.1 - communication retablie pour les contributeurs'
  git_remote push origin main
fi
echo 'Correctif V15.7.1 envoye sur GitHub. Aucune configuration Supabase necessaire.'
echo "Attendez la coche verte GitHub Pages : https://github.com/${REPOSITORY,,}/actions"
echo 'Ensuite, chaque utilisateur doit fermer toutes les fenetres du journal puis rouvrir :'
echo 'https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/?v=15.7.1'
echo 'Ouvrez Message ou photo : la redaction agrandie et le bouton Envoyer sont accessibles aux contributeurs.'
echo 'Ne supprimez pas les donnees du navigateur : les brouillons sont conserves.'
[[ -z "$BACKUP_DIR" ]] || echo "Sauvegarde du code precedent : $BACKUP_DIR"
