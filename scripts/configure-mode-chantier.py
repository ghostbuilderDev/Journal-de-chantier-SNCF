#!/usr/bin/env python3
"""Configure push once on the GitHub runner; no mobile SQL or secret copying."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('journal_transport', ROOT / 'scripts/deploy-supabase-release.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
PROJECT = 'eqfwdcttvnnrakyaacjm'
URL = f'https://{PROJECT}.supabase.co/functions/v1/journal-mode-push'
SUBJECT = 'https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/'


def query(sql):
    project, dsn = os.environ.get('SUPABASE_PROJECT_ID'), os.environ.get('SUPABASE_DB_URL')
    if project != PROJECT or not dsn:
        raise RuntimeError('Projet attendu et connexion PostgreSQL TLS requis.')
    try:
        # SQL text can contain private literals. Never relay database diagnostics
        # or subprocess output from this helper, even on permission/parse errors.
        return transport.postgres_query(sql, project, dsn)
    except Exception:
        raise RuntimeError('Configuration privee refusee ou interrompue par PostgreSQL ; aucune cle affichee. Verifier les droits postgres et relancer la meme livraison.') from None


def quote(text):
    if not isinstance(text, str) or '\x00' in text:
        raise RuntimeError('Valeur privee non valide.')
    return "'" + text.replace("'", "''") + "'"


def generate_keys():
    script = "const c=require('node:crypto');const e=c.createECDH('prime256v1');e.generateKeys();process.stdout.write(JSON.stringify({public:e.getPublicKey().toString('base64url'),private:e.getPrivateKey().toString('base64url')}));"
    try:
        result = subprocess.run(['node', '-e', script], text=True, capture_output=True, check=True, timeout=20)
        return json.loads(result.stdout)
    except Exception:
        raise RuntimeError('Generation cryptographique VAPID impossible ; verifier Node.js.') from None


def load_configuration():
    rows = query('SELECT vapid_public_key, vapid_private_key, dispatch_secret FROM journal_mode_private.config WHERE singleton;')
    if len(rows) != 1:
        raise RuntimeError('Configuration privee V14.4 absente.')
    return rows[0]


def validate(config):
    limits = {'vapid_public_key': (87, 65), 'vapid_private_key': (43, 32), 'dispatch_secret': (43, 32)}
    for key, (length, size) in limits.items():
        value = config.get(key, '')
        if not isinstance(value, str) or len(value) != length or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
            raise RuntimeError('Configuration privee incomplete ou invalide ; aucune cle existante remplacee.')
        if len(base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))) != size:
            raise RuntimeError('Format de cle privee invalide.')
    if base64.urlsafe_b64decode(config['vapid_public_key'] + '=')[0] != 4:
        raise RuntimeError('Format de cle VAPID invalide.')
    return config


def ensure_queue_private():
    # pg_net temporarily stores the dispatch header in its technical queue.
    # Keep the existing request functions and write privileges; only client
    # SELECT is removed. A hosted extension owner can refuse REVOKE, so verify
    # the effective table/column rights afterwards before any secret is sent.
    query("DO $privacy$ BEGIN BEGIN "
          "REVOKE SELECT ON TABLE net.http_request_queue, net._http_response FROM PUBLIC, anon, authenticated; "
          "EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $privacy$;")
    rows = query("SELECT NOT ("
                 "has_any_column_privilege('anon','net.http_request_queue','SELECT') OR "
                 "has_any_column_privilege('authenticated','net.http_request_queue','SELECT') OR "
                 "has_any_column_privilege('anon','net._http_response','SELECT') OR "
                 "has_any_column_privilege('authenticated','net._http_response','SELECT')) AS applied;")
    if len(rows) != 1 or rows[0].get('applied') is not True:
        raise RuntimeError('La file technique pg_net reste lisible par les comptes clients ; activation refusee pour proteger les secrets de notification.')


def provision():
    current = load_configuration()
    found = [bool(current.get(key)) for key in ('vapid_public_key', 'vapid_private_key', 'dispatch_secret')]
    if any(found) and not all(found):
        raise RuntimeError('Configuration partielle inattendue ; cles existantes conservees.')
    if not any(found):
        pair = generate_keys()
        candidate = {'vapid_public_key': pair['public'], 'vapid_private_key': pair['private'], 'dispatch_secret': secrets.token_urlsafe(32)}
        validate(candidate)
        # A persistent atomic write precedes the external secrets transfer. Retry
        # reuses the same keypair after any CLI/network interruption. Concurrent
        # setup is serialized and never rotates a key already installed.
        query('BEGIN; SELECT pg_advisory_xact_lock(hashtext(\'journal-mode-configuration\')); '
              'DO $setup$ BEGIN IF NOT EXISTS(SELECT 1 FROM journal_mode_private.config WHERE vapid_public_key IS NOT NULL OR vapid_private_key IS NOT NULL OR dispatch_secret IS NOT NULL) THEN '
              'PERFORM journal_mode_private.configure(' + quote(candidate['vapid_public_key']) + ',' + quote(URL) + ',' + quote(candidate['dispatch_secret']) + ',false,' + quote(candidate['vapid_private_key']) + '); END IF; END $setup$; COMMIT;')
        current = load_configuration()
    validate(current)
    query('BEGIN; UPDATE journal_mode_private.config SET enabled=false WHERE singleton; '
          'CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net; COMMIT;')
    ensure_queue_private()
    values = {'JOURNAL_VAPID_PUBLIC_KEY': current['vapid_public_key'], 'JOURNAL_VAPID_PRIVATE_KEY': current['vapid_private_key'],
              'JOURNAL_MODE_DISPATCH_SECRET': current['dispatch_secret'], 'JOURNAL_VAPID_SUBJECT': SUBJECT}
    # Only the CLI sees this mode-0600 file; automatic deletion on all normal
    # exception paths. stdout/stderr captured and never included in failures.
    with tempfile.TemporaryDirectory(prefix='journal-mode-secrets-') as directory:
        path = Path(directory) / 'edge.env'
        descriptor = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            handle.write(''.join(f'{name}={value}\n' for name, value in values.items()))
        try:
            result = subprocess.run(['supabase', 'secrets', 'set', '--env-file', str(path), '--project-ref', PROJECT], capture_output=True, text=True, timeout=120)
        except Exception:
            raise RuntimeError('Transfert des secrets interrompu ; la meme commande reutilisera les cles conservees.') from None
        if result.returncode:
            raise RuntimeError('Supabase a refuse le transfert des secrets. Cles conservees ; relancer apres verification du jeton GitHub.')
    print('Cles push persistantes configurees ; aucun secret dans le depot ou les journaux.')


def health():
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(URL, method='GET'), timeout=15) as response:
                data = json.load(response)
                if response.status == 200 and data == {'ready': True, 'version': '14.4'}:
                    return
        except (OSError, ValueError):
            pass
        if attempt < 7: time.sleep(3)
    raise RuntimeError('La fonction push ne confirme pas sa disponibilite ; notifications conservees inactives.')


def activate():
    health()
    # Verify the endpoint refuses anonymous dispatch before activating anything.
    request = urllib.request.Request(URL, data=b'{"dispatch":true}', headers={'Content-Type':'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
    if code not in (401, 403):
        raise RuntimeError('Le refus des appels push anonymes est absent ; activation interrompue.')
    validate(load_configuration())
    ensure_queue_private()
    query("BEGIN; SELECT pg_advisory_xact_lock(hashtext('journal-mode-configuration')); "
          "SELECT cron.schedule('journal-mode-dispatch-v14-4','30 seconds','SELECT journal_mode_private.kick();'); "
          "UPDATE journal_mode_private.config SET enabled=true WHERE singleton; COMMIT;")
    print('Mode chantier pret : diffusion controlee cote serveur et verification toutes les 30 secondes.')


def main():
    if sys.argv[1:] == ['prepare']: provision()
    elif sys.argv[1:] == ['activate']: activate()
    else: raise RuntimeError('Utilisation interne GitHub : configure-mode-chantier.py prepare|activate')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        sys.exit(1)
