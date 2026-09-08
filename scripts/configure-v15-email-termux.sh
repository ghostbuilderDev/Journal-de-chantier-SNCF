#!/usr/bin/env bash
# Optional, once a verified Resend sender is available. Keys are read silently by gh.
set -Eeuo pipefail
REPO='ghostbuilderdev/Journal-de-chantier-SNCF'
command -v gh >/dev/null || { echo 'Installer gh : pkg install gh'; exit 1; }
gh auth status --hostname github.com >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
echo 'Adresse expeditrice deja verifiee dans Resend (ex. Journal <journal@votre-domaine.fr>) :'
IFS= read -r journal_cr_sender
[[ "$journal_cr_sender" == *@* ]] || { echo 'Adresse invalide.'; exit 1; }
echo 'Coller la cle API Resend lorsque gh demande la valeur (saisie masquee).'
gh secret set RESEND_API_KEY --repo "$REPO"
printf '%s' "$journal_cr_sender" | gh secret set JOURNAL_CR_FROM --repo "$REPO"
gh workflow run deploy-v15.yml --repo "$REPO" --ref main
echo 'Configuration demandee. Attendre le succes du workflow V15 dans GitHub Actions avant le premier envoi.'
echo "https://github.com/$REPO/actions"
