\set ON_ERROR_STOP on
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare r jsonb; d jsonb;
begin
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date));
 d:=public.journal_cr_api('detail',r);
 if jsonb_array_length(d->'sections')<>6 then raise exception 'Six rubriques requises'; end if;
 perform public.journal_cr_api('assign',r||jsonb_build_object('key','arf','version',1,'responsible','00000000-0000-4000-8000-000000000002'));
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 d:=public.journal_cr_api('detail',r);
 if jsonb_array_length(d->'sections')<>1 or d#>>'{sections,0,key}'<>'arf' then raise exception 'Cloisonnement invalide'; end if;
 begin
  perform public.journal_cr_api('save',r||jsonb_build_object('key','synthese','version',1,'status','non_concerne'));
  raise exception 'Accès excessif';
 exception when others then if sqlerrm='Accès excessif' then raise; end if; end;
 if has_function_privilege('authenticated','public.journal_cr_delivery_finish(uuid,text,text)','EXECUTE') then raise exception 'Envoi falsifiable'; end if;
 if has_schema_privilege('authenticated','journal_cr_private','USAGE') then raise exception 'Schéma privé exposé'; end if;
end $$;
reset role;
