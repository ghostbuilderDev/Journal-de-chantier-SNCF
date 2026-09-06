#!/usr/bin/env python3
"""Apply only explicitly listed migrations, with atomic SQL and ledger writes."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

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


def query(sql: str, project: str, token: str):
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
        raise RuntimeError(f"Supabase refuse la requete SQL ({exc.code}) : {detail}") from None
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
    if not re.fullmatch(r"[a-z0-9]{20}", project) or not token:
        raise RuntimeError("Secrets SUPABASE_PROJECT_ID / SUPABASE_ACCESS_TOKEN manquants ou invalides.")
    if project != "eqfwdcttvnnrakyaacjm":
        raise RuntimeError("Le projet Supabase configure ne correspond pas a cette application.")
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
