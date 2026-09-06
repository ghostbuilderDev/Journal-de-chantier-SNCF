#!/usr/bin/env python3
"""Apply only explicitly listed migrations, with atomic SQL and ledger writes."""
from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parent.parent


def build_transaction(sql: str, name: str) -> str:
    if not re.fullmatch(r"[0-9]{14}_[a-z0-9_]+\.sql", name):
        raise ValueError("Nom de migration non valide.")
    starts = list(re.finditer(r"(?im)^begin;[ \t]*$", sql))
    ends = list(re.finditer(r"(?im)^commit;[ \t]*$", sql))
    if len(starts) != 1 or len(ends) != 1 or starts[0].end() >= ends[0].start():
        raise ValueError("La migration doit contenir une seule enveloppe BEGIN / COMMIT.")
    for outside in (sql[:starts[0].start()], sql[ends[0].end():]):
        if re.sub(r"(?m)^\s*--[^\n]*", "", outside).strip():
            raise ValueError("SQL hors de la transaction refuse.")
    body = sql[starts[0].end():ends[0].start()]
    return ("BEGIN;\nSELECT pg_advisory_xact_lock(hashtext('journal-chantier-release'));\n"
            + body + "\nINSERT INTO public.journal_sql_migrations(migration_name) VALUES ('"
            + name + "');\nCOMMIT;\n")


def postgres_environment(dsn: str, project: str) -> dict[str, str]:
    """Validate the explicitly selected hosted project before opening a socket."""
    try:
        parsed = urllib.parse.urlsplit(dsn)
        host = parsed.hostname or ""
        port = parsed.port or 5432
        user = urllib.parse.unquote(parsed.username or "")
        password = urllib.parse.unquote(parsed.password or "")
        options = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
    except (ValueError, UnicodeError):
        raise RuntimeError("SUPABASE_DB_URL invalide ; utiliser l’URI Connect du projet.") from None
    if not re.fullmatch(r"[a-z0-9]{20}", project):
        raise RuntimeError("Reference de projet Supabase invalide.")
    direct = host == f"db.{project}.supabase.co" and user == "postgres"
    pooler = (re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com", host)
              and user == f"postgres.{project}")
    if (parsed.scheme not in ("postgres", "postgresql") or not (direct or pooler)
            or port != 5432 or urllib.parse.unquote(parsed.path) != "/postgres"
            or parsed.fragment or not password):
        raise RuntimeError("SUPABASE_DB_URL ne correspond pas au projet attendu ou au port de session 5432. Utiliser Connect : connexion directe ou Session pooler.")
    allowed = {"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT",
               "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY"}
    if any(key not in allowed or len(value) != 1 for key, value in options.items()):
        raise RuntimeError("Options SUPABASE_DB_URL non prises en charge ; utiliser l’URI Connect avec TLS.")
    sslmode = options.get("sslmode", ["require"])[0]
    if sslmode not in ("require", "verify-ca", "verify-full"):
        raise RuntimeError("SUPABASE_DB_URL exige TLS : sslmode=require, verify-ca ou verify-full.")
    if any("\x00" in value for value in (host, user, password)):
        raise RuntimeError("SUPABASE_DB_URL contient une valeur invalide.")
    # Discard inherited libpq selectors, service files and options. No URL or
    # password is ever included in process arguments, stdout or diagnostics.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("PG") and key not in ("SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN")}
    env.update(PGHOST=host, PGPORT=str(port), PGDATABASE="postgres", PGUSER=user,
               PGPASSWORD=password, PGSSLMODE=sslmode, PGCONNECT_TIMEOUT="20",
               PGAPPNAME="journal-chantier-release")
    for key, variable in allowed.items():
        if key in options:
            env[variable] = options[key][0]
    return env


def postgres_query(sql: str, project: str, dsn: str) -> list[dict]:
    env = postgres_environment(dsn, project)
    command = ["psql", "--no-psqlrc", "--no-password", "--quiet", "--csv",
               "--set=ON_ERROR_STOP=1", "--file=-"]
    try:
        result = subprocess.run(command, input=sql, text=True, capture_output=True,
                                env=env, timeout=180, check=False)
    except FileNotFoundError:
        raise RuntimeError("Client PostgreSQL psql absent ; installer postgresql-client dans le workflow.") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError("Connexion ou requete PostgreSQL interrompue apres 180 secondes ; verifier le registre avant de relancer.") from None
    if result.returncode:
        # Preserve actionable SQL/schema errors, but redact secrets BEFORE
        # truncation so a secret crossing the limit cannot leak as a prefix.
        # stdout is never included: it can contain selected application data.
        password = env["PGPASSWORD"]
        secrets = {dsn, password, urllib.parse.quote(password),
                   urllib.parse.quote(password, safe=""), urllib.parse.quote_plus(password),
                   os.environ.get("SUPABASE_ACCESS_TOKEN", "")}
        detail = result.stderr or "Aucun diagnostic PostgreSQL disponible."
        for secret in sorted((value for value in secrets if value), key=len, reverse=True):
            detail = detail.replace(secret, "[secret masque]")
        detail = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", detail).strip()[:2000]
        raise RuntimeError("PostgreSQL a refuse ou interrompu la requete. Aucune publication frontend n’est autorisee. Diagnostic : " + detail)
    if not result.stdout.strip():
        return []
    rows = list(csv.DictReader(io.StringIO(result.stdout)))
    for row in rows:
        if "applied" in row:
            if row["applied"] not in ("t", "f", "true", "false"):
                raise RuntimeError("Reponse PostgreSQL invalide pour le registre des migrations.")
            row["applied"] = row["applied"] in ("t", "true")
    return rows


def query(sql: str, project: str, token: str):
    # Transport is selected BEFORE any request, solely by explicit configuration.
    # A denied Management API call never triggers an automatic alternate route.
    dsn = os.environ.get("SUPABASE_DB_URL", "")
    if dsn:
        return postgres_query(sql, project, dsn)
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:2000]
        if exc.code == 403 and "1010" in detail:
            raise RuntimeError("L’API Supabase a refuse la requete HTTP 403 / Cloudflare 1010. Aucun nouvel essai ni changement de transport automatique. Verifier cette restriction avec Supabase ; le transport PostgreSQL officiel peut etre configure explicitement via SUPABASE_DB_URL.") from None
        raise RuntimeError(f"Supabase refuse la requete SQL (HTTP {exc.code}). Verifier les droits de l’API et le projet configure.") from None
    if isinstance(result, dict):
        if "error" in result or "message" in result:
            raise RuntimeError(f"Erreur SQL Supabase : {json.dumps(result)[:2000]}")
        result = result.get("result")
    if not isinstance(result, list) or any(isinstance(row, dict) and "error" in row for row in result):
        raise RuntimeError("Reponse Supabase inattendue ; deploiement interrompu.")
    return result


def main():
    project = os.environ.get("SUPABASE_PROJECT_ID", "")
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    dsn = os.environ.get("SUPABASE_DB_URL", "")
    if not re.fullmatch(r"[a-z0-9]{20}", project) or (not token and not dsn):
        raise RuntimeError("SUPABASE_PROJECT_ID et SUPABASE_DB_URL ou SUPABASE_ACCESS_TOKEN requis.")
    if project != "eqfwdcttvnnrakyaacjm":
        raise RuntimeError("Le projet Supabase configure ne correspond pas a cette application.")
    if len(sys.argv) > 1:
        if sys.argv[1:] != ["--check-connection"]:
            raise RuntimeError("Option inconnue ; seule --check-connection est prise en charge.")
        rows = query("SELECT 1 AS connected;", project, token)
        if len(rows) != 1 or str(rows[0].get("connected")) != "1":
            raise RuntimeError("La verification de connexion a renvoye une reponse inattendue.")
        print("Connexion au projet Supabase verifiee ; aucune migration executee.", flush=True)
        return
    names = [line.strip() for line in (ROOT / "supabase/release-migrations.txt").read_text().splitlines()
             if line.strip() and not line.lstrip().startswith("#")]
    if not names or len(names) != len(set(names)):
        raise RuntimeError("Liste de migrations vide ou contenant des doublons.")
    transactions = []
    for name in names:
        if not re.fullmatch(r"[0-9]{14}_[a-z0-9_]+\.sql", name):
            raise RuntimeError("Chemin de migration non valide.")
        transactions.append((name, build_transaction((ROOT / "supabase/migrations" / name).read_text(), name)))
    query("CREATE TABLE IF NOT EXISTS public.journal_sql_migrations "
          "(migration_name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); "
          "ALTER TABLE public.journal_sql_migrations ENABLE ROW LEVEL SECURITY; "
          "REVOKE ALL ON public.journal_sql_migrations FROM anon, authenticated;", project, token)
    for name, transaction in transactions:
        rows = query("SELECT EXISTS (SELECT 1 FROM public.journal_sql_migrations WHERE migration_name = '"
                     + name + "') AS applied;", project, token)
        if not rows or type(rows[0].get("applied")) is not bool:
            raise RuntimeError("Impossible de verifier le registre des migrations.")
        if rows[0]["applied"]:
            print(f"Deja appliquee : {name}", flush=True)
            continue
        print(f"Application transactionnelle : {name}", flush=True)
        query(transaction, project, token)
        print(f"Migration et registre valides : {name}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        sys.exit(1)
