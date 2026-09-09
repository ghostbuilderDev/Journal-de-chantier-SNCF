#!/usr/bin/env bash
set -Eeuo pipefail
REPOSITORY='ghostbuilderdev/Journal-de-chantier-SNCF'
command -v gh >/dev/null || { echo 'Installer gh : pkg install gh'; exit 1; }
echo 'Copiez une cle Gemini API existante depuis Google AI Studio ou les proprietes du script de briefing.'
echo 'La commande suivante demande la cle de facon masquee. Ne la collez ni dans le code ni dans une conversation.'
gh secret set GEMINI_API_KEY --repo "$REPOSITORY"
gh workflow run deploy-v156.yml --repo "$REPOSITORY" --ref main
echo 'Activation lancee. Attendez la coche verte du workflow V15.6 avant de tester Ameliorer.'
