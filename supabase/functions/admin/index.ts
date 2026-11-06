/**
 * Edge Function: operações de organizador (apagar voto, mudar config).
 * Secrets: ADMIN_KEY (mesmo valor do segredo no link ?admin=)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminKey = Deno.env.get("ADMIN_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!adminKey || !supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const clientKey = req.headers.get("x-admin-key");
  if (clientKey !== adminKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { action?: string; id?: string; key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  if (body.action === "vote-totals") {
    const { data, error } = await supabase.from("votos").select("casa_id, gostei").eq("gostei", true);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    /** @type {Record<string, number>} */
    const agg = {};
    for (const row of data || []) {
      const id = String(row.casa_id);
      agg[id] = (agg[id] || 0) + 1;
    }
    const totals = Object.entries(agg).map(([casa_id, total]) => ({ casa_id, total }));
    return new Response(JSON.stringify({ totals }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "list-votes") {
    const { data, error } = await supabase
      .from("votos")
      .select("id, nome_norm, nome_display, casa_id, gostei, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ votes: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "delete-vote") {
    if (!body.id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error } = await supabase.from("votos").delete().eq("id", body.id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "clear-votes") {
    const { error } = await supabase.from("votos").delete().not("id", "is", null);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Devices compare this value to know their saved stamps belong to an old round.
    const { error: erroRodada } = await supabase.from("config").upsert(
      { key: "votes_reset_at", value: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (erroRodada) {
      return new Response(JSON.stringify({ error: erroRodada.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "set-config") {
    if (!body.key || body.value === undefined) {
      return new Response(JSON.stringify({ error: "Missing key or value" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error } = await supabase.from("config").upsert(
      { key: body.key, value: String(body.value) },
      { onConflict: "key" },
    );
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
