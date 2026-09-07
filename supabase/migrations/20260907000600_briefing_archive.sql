-- Briefings : publication atomique dans le fil et les archives du chantier.
-- Prérequis : Journal V14.5 et bibliothèque documentaire installés.
begin;
alter table public.chantier_messages add column if not exists briefing_document_id uuid references public.chantier_documents(id) on delete set null;
create table if not exists public.journal_briefing_receipts (
 id uuid primary key, chantier_id uuid not null references public.chantiers(id) on delete cascade,
 author_id uuid not null, document_id uuid not null, message_id uuid not null,
 created_at timestamptz not null default now()
);
alter table public.journal_briefing_receipts enable row level security;
revoke all on public.journal_briefing_receipts from public, anon, authenticated;

-- Les membres peuvent déposer uniquement leurs PDF de briefing, jamais remplacer un fichier.
drop policy if exists journal_briefing_pdf_insert on storage.objects;
create policy journal_briefing_pdf_insert on storage.objects for insert to authenticated with check (
 bucket_id = 'chantier-documents'
 and public.journal_v142_can_write(public.journal_document_path_chantier_id(name))
 and split_part(name, '/', 4) = 'briefing-' || auth.uid()::text || '.pdf'
);
create or replace function public.journal_archive_briefing(p_id uuid, p_chantier_id uuid, p_filename text, p_bytes bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
 v_path text; v_root uuid; v_folder uuid; v_author text;
 v_receipt public.journal_briefing_receipts%rowtype;
begin
 if auth.uid() is null or not public.journal_v142_can_write(p_chantier_id) then
  raise exception 'Accès au chantier refusé.' using errcode='42501';
 end if;
 if p_id is null or p_chantier_id is null or p_bytes is null or p_bytes < 5 or p_bytes > 50331648
 or p_filename is null or length(trim(p_filename)) not between 5 and 180 or lower(right(p_filename,4)) <> '.pdf' then
  raise exception 'PDF de briefing invalide.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
 select * into v_receipt from public.journal_briefing_receipts where id=p_id;
 if found then
  if v_receipt.author_id <> auth.uid() or v_receipt.chantier_id <> p_chantier_id then
   raise exception 'Identifiant de briefing déjà utilisé.' using errcode='42501';
  end if;
  return jsonb_build_object('document_id',v_receipt.document_id,'message_id',v_receipt.message_id,'archived',true);
 end if;
 v_path := 'documents/' || p_chantier_id || '/' || p_id || '/briefing-' || auth.uid() || '.pdf';
 if not exists(select 1 from storage.objects where bucket_id='chantier-documents' and name=v_path
  and (metadata->>'size')::bigint=p_bytes and metadata->>'mimetype'='application/pdf') then
  raise exception 'Le PDF signé n’a pas été reçu. Réessayez.';
 end if;
 -- Sérialise la création du dossier pour deux premiers briefings simultanés.
 perform pg_advisory_xact_lock(hashtextextended(p_chantier_id::text, 1));
 select id into v_root from public.chantier_document_folders where chantier_id=p_chantier_id and is_root and root_code='securite' limit 1;
 if v_root is null then raise exception 'Le dossier Sécurité du chantier est absent.'; end if;
 select id into v_folder from public.chantier_document_folders where chantier_id=p_chantier_id and parent_id=v_root and name='Briefings' order by created_at limit 1;
 select coalesce(nullif(trim(full_name),''),email,'Intervenant') into v_author from public.profiles where id=auth.uid();
 if v_folder is null then
  insert into public.chantier_document_folders(chantier_id,parent_id,root_code,name,is_root,created_by,created_by_name)
  values(p_chantier_id,v_root,'securite','Briefings',false,auth.uid(),v_author) returning id into v_folder;
 end if;
 insert into public.chantier_documents(id,chantier_id,folder_id,storage_path,file_name,mime_type,bytes,description,created_by,created_by_name)
 values(p_id,p_chantier_id,v_folder,v_path,trim(p_filename),'application/pdf',p_bytes,'Briefing signé — archive du chantier',auth.uid(),v_author);
 insert into public.chantier_messages(id,chantier_id,body,author_id,author_name,message_type,briefing_document_id)
 values(p_id,p_chantier_id,'Briefing signé archivé : ' || trim(p_filename),auth.uid(),v_author,'Document',p_id);
 insert into public.journal_briefing_receipts(id,chantier_id,author_id,document_id,message_id)
 values(p_id,p_chantier_id,auth.uid(),p_id,p_id);
 return jsonb_build_object('document_id',p_id,'message_id',p_id,'archived',true);
end; $$;
revoke all on function public.journal_archive_briefing(uuid,uuid,text,bigint) from public,anon;
grant execute on function public.journal_archive_briefing(uuid,uuid,text,bigint) to authenticated;
commit;
