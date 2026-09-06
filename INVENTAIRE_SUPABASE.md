# INVENTAIRE SUPABASE APPELÉ PAR LE FRONTEND

## Tables / relations
- `action_items`
- `chantier_attachments`
- `chantier_daily_logs`
- `chantier_document_folders`
- `chantier_documents`
- `chantier_message_reactions`
- `chantier_messages`
- `chantier_read_states`
- `chantier_risks`
- `chantiers`
- `journal_access_requests`
- `journal_portal_apps`
- `profiles`

## Fonctions RPC
- `approve_journal_access_request`
- `can_manage_chantier_documents`
- `create_chantier_document_folder`
- `create_chantier_document_metadata`
- `create_chantier_document_root_folder`
- `delete_chantier_document`
- `delete_chantier_document_folder`
- `delete_journal_portal_app`
- `get_journal_administration_dashboard`
- `get_my_journal_access_context`
- `list_journal_chantier_storage_paths`
- `refuse_journal_access_request`
- `rename_chantier_document_folder`
- `revoke_journal_user_access`
- `set_journal_user_access`
- `update_chantier_document_metadata`

## Buckets / expressions de bucket
- `CONFIG.STORAGE_BUCKET || "chantier-files"`
- `COVER_IMAGES_BUCKET`
- `DOCUMENTS_BUCKET`

## Fichiers SQL historiques référencés mais absents du ZIP
- `supabase-administration-v11.sql`
- `supabase-schema.sql`
- `supabase-v12.1-owner-maintenance.sql`
- `supabase-v12.2-photo-previews.sql`
- `supabase-v13-pilotage.sql`


> Ces absences signifient que le dépôt fourni ne suffit pas, à lui seul, à recréer une base Supabase vierge identique à la production.

## Ajouts V14.2
- Table serveur de blocage : `journal_user_access_blocks`.
- `action_items.assignee_user_id`, `action_items.due_mode`, `chantier_messages.action_id`.
- RPC : `list_journal_user_directory`, `journal_v142_administration_dashboard`, `journal_v142_set_user_access`, `journal_v142_revoke_user_access`, `journal_v142_can_write`.
- Fonctions internes de préparation et de finalisation de suppression : réservées au rôle serveur.
- Edge Function : `journal-delete-user`, déployée par GitHub Actions et réservée au propriétaire principal après validation Auth.
- Migration active : `20260906000300_v14_2_contraintes_reelles.sql` (`journal_access_requests.requester_id` vérifié sur le projet réel).
