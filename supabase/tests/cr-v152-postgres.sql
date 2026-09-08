\set ON_ERROR_STOP on
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare r jsonb;s jsonb;v jsonb;
begin
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date));
 v:=public.journal_cr_api('detail',r);
 if jsonb_array_length(v->'sections')<>5 then raise exception 'Five visible rubrics required';end if;
 select x into s from jsonb_array_elements(v->'sections') x where x->>'key'='itc';
 perform public.journal_cr_api('timing_table',r||jsonb_build_object('key','itc','version',s->'version','responsible','00000000-0000-4000-8000-000000000002','remember_week',true,'rows',jsonb_build_array(jsonb_build_object('label','ZEP test 123','selected',true))));
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 v:=public.journal_cr_api('tasks','{}');
 if jsonb_array_length(v)<>1 or v->0->>'section_key'<>'itc' then raise exception 'Assignee task missing';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
 if jsonb_array_length(public.journal_cr_api('tasks','{}'))<>0 then raise exception 'Task disclosed to another agent';end if;
 begin perform * from journal_cr_private.week_plans;raise exception 'Private schema exposed';exception when insufficient_privilege then null;end;
end;
$$;
reset role;
