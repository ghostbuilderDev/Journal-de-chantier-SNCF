#!/usr/bin/env bash
set -Eeuo pipefail
set +x
REPO='ghostbuilderdev/Journal-de-chantier-SNCF'
command -v gh >/dev/null || { echo 'Installer gh : pkg install gh'; exit 1; }
gh auth status --hostname github.com >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
echo 'Configuration du premier envoi de CR (aucun email envoye par cette commande).'
echo 'Compte Resend : https://resend.com/signup'
echo 'Cle API : https://resend.com/api-keys (droit Sending access).'
echo 'Adresse de test, identique a celle de votre compte Resend :'
IFS= read -r journal_test_email
[[ "$journal_test_email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo 'Adresse invalide.'; exit 1; }
echo 'Expediteur : Entree pour Journal de chantier <onboarding@resend.dev>.'
echo 'Ou saisir une adresse de votre propre domaine deja verifie dans Resend :'
IFS= read -r journal_cr_sender
journal_cr_sender="${journal_cr_sender:-Journal de chantier <onboarding@resend.dev>}"
[[ "$journal_cr_sender" == *@* && "$journal_cr_sender" != *$'\r'* ]] || { echo 'Expediteur invalide.'; exit 1; }
echo 'Coller la cle API Resend (saisie masquee), puis Entree :'
IFS= read -r -s journal_resend_key
echo
[[ "$journal_resend_key" == re_* && "$journal_resend_key" != *$'\r'* ]] || { echo 'Cle Resend invalide.'; exit 1; }
printf '%s' "$journal_resend_key" | gh secret set RESEND_API_KEY --repo "$REPO"
unset journal_resend_key
printf '%s' "$journal_cr_sender" | gh secret set JOURNAL_CR_FROM --repo "$REPO"
printf '%s' "${journal_test_email,,}" | gh secret set JOURNAL_CR_TEST_TO --repo "$REPO"
gh workflow run configure-email-v154.yml --repo "$REPO" --ref main
echo 'Configuration lancee. Attendre la coche verte Configuration email V15.4 :'
echo "https://github.com/$REPO/actions/workflows/configure-email-v154.yml"
echo 'Puis ouvrir le CR, renseigner votre seule adresse, enregistrer, valider et envoyer.'
