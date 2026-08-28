import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type AuthenticatedSupabase = { client: SupabaseClient; user: User };

export type PresenterAuthResult =
  | { auth: AuthenticatedSupabase; error: null }
  | { auth: null; error: string };

export async function getAuthenticatedSupabase(request: Request): Promise<AuthenticatedSupabase | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { client, user: data.user };
}

export async function requireOwnedSession(request: Request, code: string): Promise<PresenterAuthResult> {
  const auth = await getAuthenticatedSupabase(request);
  if (!auth) return { auth: null, error: "Presenter sign-in is required for this action." };

  const { data, error } = await auth.client
    .from("presenter_sessions")
    .select("code")
    .eq("code", code)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (error) {
    console.error("[polls] presenter session ownership lookup failed", error);
    return { auth: null, error: "Presenter session ownership is not configured yet." };
  }
  if (!data) return { auth: null, error: "This session belongs to another presenter account." };
  return { auth, error: null };
}
