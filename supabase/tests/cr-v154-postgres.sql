\set ON_ERROR_STOP on
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare p jsonb;r jsonb;d jsonb;
begin
 p:=public.journal_production_api('save',jsonb_build_object('id','cccccccc-0000-4000-8000-000000000001','chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date,'items','[{"title":"Support A","progress":50,"additional":false},{"title":"Support B","progress":100,"additional":true}]'::jsonb));
 if p#>>'{items,0,title}'<>'Support A' or p#>>'{items,1,title}'<>'Support B' then raise exception 'Lignes de production altérées';end if;
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date,'test_audience',true));
 d:=public.journal_cr_api('detail',r);
 if not exists(select 1 from jsonb_array_elements(d->'sections') s where s->>'key'='technique' and s->>'status'='complete' and s#>>'{value,production_text}' like '%50 % réalisé%') then raise exception 'Production absente du CR';end if;
 if has_function_privilege('anon','public.journal_production_api(text,jsonb)','EXECUTE') or has_schema_privilege('authenticated','journal_cr_private','USAGE') then raise exception 'Droits trop larges';end if;
end $$;
reset role;
