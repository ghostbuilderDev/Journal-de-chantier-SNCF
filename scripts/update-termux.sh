#!/usr/bin/env bash
# Run from the extracted release; never copies config.js or deletes repository files.
set -Eeuo pipefail
RELEASE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPOSITORY='ghostbuilderdev/Journal-de-chantier-SNCF'
WORKFLOW='deploy-supabase-migrations.yml'
PHASE='verification'
BACKUP_DIR=''
fail() {
  echo "ERREUR : $*" >&2
  if [[ -n "$BACKUP_DIR" ]]; then echo "Sauvegarde du code : $BACKUP_DIR" >&2; fi
  exit 1
}
on_error() {
  local status=$?
  echo "Mise a jour interrompue pendant : $PHASE. Aucune suppression de donnees n'a ete demandee." >&2
  if [[ -n "$BACKUP_DIR" ]]; then echo "Sauvegarde du code avant mise a jour : $BACKUP_DIR" >&2; fi
  echo 'Conservez ce message et la sortie precedente pour identifier le blocage.' >&2
  exit "$status"
}
trap on_error ERR

for command in git gh python; do
  command -v "$command" >/dev/null || fail "Installez les outils : pkg install git gh python unzip"
done
python -c 'import tomllib' || fail 'Python 3.11 ou plus recent est requis : pkg upgrade python'

REPO_DIR="${1:-}"
if [[ -z "$REPO_DIR" ]]; then
  for candidate in "$PWD" "$HOME/Journal-de-chantier-SNCF" "$HOME/Journal-de-chantier-SNCF-main" "$HOME/journal-chantier"; do
    if [[ -d "$candidate/.git" ]]; then
      origin="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
      case "${origin,,}" in
        "https://github.com/${REPOSITORY,,}"|"https://github.com/${REPOSITORY,,}.git"|"git@github.com:${REPOSITORY,,}.git"|"ssh://git@github.com/${REPOSITORY,,}.git") REPO_DIR="$candidate"; break ;;
      esac
    fi
  done
fi
if [[ -z "$REPO_DIR" ]]; then
  echo 'Indiquez le chemin du dossier Git de votre application dans Termux :'
  IFS= read -r REPO_DIR </dev/tty
  REPO_DIR="${REPO_DIR/#\~/$HOME}"
fi
[[ -d "$REPO_DIR/.git" ]] || fail "Le dossier indique ne contient pas le depot Git."
REPO_DIR="$(cd -- "$REPO_DIR" && pwd -P)"
[[ "$REPO_DIR" != "$RELEASE_ROOT" ]] || fail 'Lancez le script depuis le ZIP extrait, distinct du depot Git.'
cd -- "$REPO_DIR"
origin="$(git remote get-url origin)"
case "${origin,,}" in
  "https://github.com/${REPOSITORY,,}"|"https://github.com/${REPOSITORY,,}.git"|"git@github.com:${REPOSITORY,,}.git"|"ssh://git@github.com/${REPOSITORY,,}.git") ;;
  *) fail "Le depot origin ne correspond pas a ${REPOSITORY,,}." ;;
esac
[[ "$(git branch --show-current)" == 'main' ]] || fail 'Placez le depot sur sa branche main avant cette mise a jour.'
[[ -z "$(git status --porcelain)" ]] || fail 'Des modifications locales existent. Enregistrez-les avant de relancer ; elles sont conservees.'
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo 'Connexion GitHub necessaire pour publier le code et suivre le resultat Supabase.'
  gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
fi
# Use the existing GitHub CLI credential for this command only (no global changes).
git_remote() { git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
git_remote fetch origin main
read -r ahead behind < <(git rev-list --left-right --count HEAD...origin/main)
if (( ahead > 0 )); then
  fail 'Des commits locaux ne sont pas publies. Verifiez-les puis faites git push origin main avant de relancer.'
fi
if (( behind > 0 )); then git merge --ff-only origin/main; fi
python "$RELEASE_ROOT/scripts/prepare-update.py" check "$REPO_DIR"

secret_names="$(gh secret list --repo "${REPOSITORY,,}" --json name --jq '.[].name')"
for required in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID; do
  if ! python -c 'import sys; raise SystemExit(sys.argv[1] not in sys.stdin.read().splitlines())' "$required" <<<"$secret_names"; then
    fail "Secret GitHub manquant : $required. Ajoutez-le dans Settings > Secrets and variables > Actions."
  fi
done
if [[ -z "$(git config user.name || true)" || -z "$(git config user.email || true)" ]]; then
  identity="$(gh api user)"
  git config user.name "$(python -c 'import json,sys; x=json.load(sys.stdin); print(x.get("name") or x["login"])' <<<"$identity")"
  git config user.email "$(python -c 'import json,sys; x=json.load(sys.stdin); print(str(x["id"])+"+"+x["login"]+"@users.noreply.github.com")' <<<"$identity")"
fi
BACKUP_DIR="$(mktemp -d "${JOURNAL_BACKUP_BASE:-$HOME}/Journal-Chantier-sauvegarde-V14.2-XXXXXXXX")"
git rev-parse HEAD > "$BACKUP_DIR/commit-avant.txt"
git archive --format=tar HEAD > "$BACKUP_DIR/code-avant.tar"
cp -- config.js "$BACKUP_DIR/config.js"
# A local code backup is not a Supabase database backup.
mapfile -t backend_files < <(python "$RELEASE_ROOT/scripts/prepare-update.py" list-backend "$REPO_DIR")
mapfile -t frontend_files < <(python "$RELEASE_ROOT/scripts/prepare-update.py" list-frontend "$REPO_DIR")

previous_run_id=''
PHASE='publication du backend'
python "$RELEASE_ROOT/scripts/prepare-update.py" backend "$REPO_DIR"
git add -- "${backend_files[@]}"
if ! git diff --cached --quiet; then
  git commit -m 'Journal Chantier V14.2 - backend et droits'
  git_remote push origin main
  backend_sha="$(git rev-parse HEAD)"
else
  backend_sha="$(git rev-parse HEAD)"
  # Ignore any older run until this newly requested run is visible.
  previous_run_id="$(gh run list --repo "${REPOSITORY,,}" --workflow "$WORKFLOW" --commit "$backend_sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  gh workflow run "$WORKFLOW" --repo "${REPOSITORY,,}" --ref main
fi

PHASE='validation Supabase avant interface'
echo 'Attente de GitHub Actions : migration SQL puis fonction de suppression de compte...'
run_id=''
for ((attempt=0; attempt<36; attempt++)); do
  run_id="$(gh run list --repo "${REPOSITORY,,}" --workflow "$WORKFLOW" --commit "$backend_sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  [[ -n "$run_id" && "$run_id" != "$previous_run_id" ]] && break
  run_id=''
  sleep 5
done
[[ -n "$run_id" ]] || fail "Workflow non demarre. Verifiez https://github.com/${REPOSITORY,,}/actions ; l'interface n'a pas ete publiee."
for ((attempt=0; attempt<180; attempt++)); do
  result="$(gh run view "$run_id" --repo "${REPOSITORY,,}" --json status,conclusion --jq '.status + " " + (.conclusion // "")')"
  read -r status conclusion <<<"$result"
  if [[ "$status" == 'completed' ]]; then
    [[ "$conclusion" == 'success' ]] || fail "Supabase : $conclusion. Consultez https://github.com/${REPOSITORY,,}/actions/runs/$run_id ; l'interface n'a pas ete publiee."
    break
  fi
  if (( attempt % 6 == 0 )); then echo "Supabase : $status..."; fi
  sleep 5
done
[[ "${conclusion:-}" == 'success' ]] || fail "Delai depasse. Consultez https://github.com/${REPOSITORY,,}/actions/runs/$run_id puis relancez."

PHASE='publication de l interface'
git_remote fetch origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail 'Le depot distant a change pendant le deploiement. Relancez pour verifier les nouvelles modifications.'
python "$RELEASE_ROOT/scripts/prepare-update.py" frontend "$REPO_DIR"
git add -- "${frontend_files[@]}"
if ! git diff --cached --quiet; then
  git commit -m 'Journal Chantier V14.2 - collaborateurs actions et discussion'
  git_remote push origin main
fi
PHASE='terminee'
echo 'V14.2 envoyee dans GitHub ; migration SQL et fonction Supabase validees.'
echo "Publication de l'interface a suivre : https://github.com/${REPOSITORY,,}/actions"
echo 'Apres publication GitHub Pages, fermez puis rouvrez application et anciens onglets.'
echo "Sauvegarde du code precedent : $BACKUP_DIR"
