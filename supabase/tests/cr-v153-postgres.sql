\set ON_ERROR_STOP on
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare r jsonb;s jsonb;v jsonb;
begin
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date));
 select x into s from jsonb_array_elements(public.journal_cr_api('detail',r)->'sections') x where x->>'key'='itc';
 perform public.journal_cr_api('timing_sheet',r||jsonb_build_object('key','itc','version',s->'version','configure',true,'responsible','00000000-0000-4000-8000-000000000002','rows',jsonb_build_array(jsonb_build_object('label','ZEP test 123','selected',true))));
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 v:=public.journal_cr_api('tasks','{}');
 if jsonb_array_length(v)<>1 then raise exception 'Assignee task missing';end if;
 select x into s from jsonb_array_elements(public.journal_cr_api('detail',r)->'sections') x where x->>'key'='itc';
 perform public.journal_cr_api('timing_sheet',r||jsonb_build_object('key','itc','version',s->'version','rows',jsonb_build_array(jsonb_build_object('id',s->'items'->0->'id','version',s->'items'->0->'version','start',current_date::text||'T21:05Z','end',(current_date+1)::text||'T03:10Z','status','auto'))));
 if jsonb_array_length(public.journal_cr_api('tasks','{}'))<>0 then raise exception 'Completed task should close';end if;
 v:=public.journal_feedback_create_thread('dddddddd-0000-4000-8000-000000000003','Retour de test','Description du problème','bug',null);
 if v->>'title'<>'Retour de test' then raise exception 'Feedback create failed';end if;
 begin perform * from journal_cr_private.week_plans;raise exception 'Private schema exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
