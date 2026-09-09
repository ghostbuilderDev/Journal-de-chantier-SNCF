\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ declare r jsonb;s jsonb;t jsonb;x jsonb;begin
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date));
 select a into s from jsonb_array_elements(public.journal_cr_api('detail',r)->'sections') a where a->>'key'='arf';
 perform public.journal_cr_api('field_configure',r||jsonb_build_object('key','arf','version',s->'version','responsible','00000000-0000-4000-8000-000000000002','data','{}'::jsonb,'dispatch',true));
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 if public.journal_cr_api('list')<>'[]'::jsonb then raise exception 'CR complet visible au contributeur';end if;
 t:=public.journal_cr_api('tasks')->0;
 x:=jsonb_build_object('start',current_date+time '23:00','end',current_date+1+time '05:00');
 s:=public.journal_cr_api('task_save',jsonb_build_object('task_id',t->'id','version',t->'version','data',x));
 if jsonb_array_length(public.journal_cr_api('tasks'))<>1 then raise exception 'Enregistrer ne doit pas fermer';end if;
 perform public.journal_cr_api('task_submit',jsonb_build_object('task_id',t->'id','version',s#>'{task,version}','data',x,'confirmed',true));
 if jsonb_array_length(public.journal_cr_api('tasks'))<>0 then raise exception 'Demande non clôturée';end if;
 if has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE') or has_schema_privilege('authenticated','journal_cr_private','USAGE') then raise exception 'Droits trop larges';end if;
end $$;
reset role;
