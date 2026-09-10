-- Disposable PostgreSQL test DB. Roll back all synthetic report operations.
BEGIN;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set role authenticated;
DO $$DECLARE a jsonb;b jsonb;n bigint;site uuid:='aaaaaaaa-0000-4000-8000-000000000001';
BEGIN
 a:=public.journal_report_api('create',jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'chantier_id',site,'document',jsonb_build_object('schema',1,'reportSerial',1,'meta',jsonb_build_object('reportNo','AINM-RJ-000001-LOCAL','operation','TEST','date','2026-09-10'),'tasks','[]'::jsonb)));
 n:=(a->'document'->>'reportSerial')::bigint;
 a:=public.journal_report_api('save',jsonb_build_object('id',a->>'id','version',a->'version','request_id',gen_random_uuid(),'document',jsonb_set(a->'document','{reportSerial}','1')));
 if (a->'document'->>'reportSerial')::bigint<>n then raise exception 'La sauvegarde a changé le numéro';end if;
 b:=public.journal_report_api('create',jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'chantier_id',site,'document',a->'document'));
 if (b->'document'->>'reportSerial')::bigint<>n+1 then raise exception 'Les rapports ne se suivent pas';end if;
 if a->'document'->>'reportUid'=b->'document'->>'reportUid' then raise exception 'Identité réutilisée';end if;
END$$;
RESET ROLE;
DO $$BEGIN
 if has_table_privilege('authenticated','journal_report_private.numbers','SELECT,UPDATE,DELETE') then raise exception 'Compteur exposé';end if;
 if has_function_privilege('anon','public.journal_reserve_numbered_pdf(uuid,text,text,bigint,uuid,boolean)','EXECUTE') then raise exception 'Archives exposées';end if;
END$$;
ROLLBACK;
