// Only this server-side function uses the service role. Never expose it in config.js.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply(405, { error: "Méthode non autorisée." });
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return reply(401, { error: "Connexion requise." });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return reply(503, { error: "Service de suppression non configuré." });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Online validation: do not trust a decoded JWT or a client-supplied actor id.
    const { data: session, error: sessionError } = await admin.auth.getUser(token);
    if (sessionError || !session?.user) return reply(401, { error: "Session expirée. Reconnecte-toi." });
    const body = await request.json().catch(() => null);
    if (!body || typeof body.user_id !== "string" || !uuid.test(body.user_id) || body.confirmation !== "SUPPRIMER") {
      return reply(400, { error: "Compte et confirmation SUPPRIMER requis." });
    }
    if (body.user_id === session.user.id) return reply(403, { error: "Le propriétaire principal ne peut pas se supprimer." });
    const args = { p_actor_id: session.user.id, p_user_id: body.user_id };
    const { error: prepareError } = await admin.rpc("journal_v142_prepare_user_deletion", args);
    if (prepareError) {
      return reply(prepareError.code === "42501" ? 403 : 409, {
        error: prepareError.message || "Suppression non autorisée ou schéma incompatible.",
      });
    }
    // Hard delete invalidates refresh sessions; the SQL block already rejects
    // the target's existing access tokens and preserves their work records.
    const { error: deletionError } = await admin.auth.admin.deleteUser(body.user_id, false);
    if (deletionError) {
      console.error("journal-delete-user: Auth deletion failed", deletionError.code || deletionError.status);
      return reply(409, {
        error: "Les accès sont bloqués, mais Supabase Auth n’a pas terminé la suppression. Le compte reste visible dans Administration : réessaie Supprimer le compte. Si l’erreur persiste, vérifie les dépendances du compte dans Supabase.",
      });
    }
    const { error: finishError } = await admin.rpc("journal_v142_finish_user_deletion", args);
    if (finishError) {
      console.error("journal-delete-user: final audit mark failed", finishError.code);
      // Auth and profile have already been removed, stale JWT stays blocked.
      return reply(200, { success: true, warning: "Compte supprimé ; le marqueur technique reste en état de suppression en cours." });
    }
    return reply(200, { success: true });
  } catch (error) {
    console.error("journal-delete-user: unexpected failure", error instanceof Error ? error.name : "unknown");
    return reply(500, { error: "Suppression interrompue. Actualise Administration avant de réessayer." });
  }
});
