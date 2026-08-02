import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateToken04 } from './token04.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or expired user token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      // Empty body
    }

    const roomId = (body.roomId || body.room_id || 'default_room').toString().trim();
    if (!roomId) {
      return new Response(
        JSON.stringify({ error: 'Invalid roomId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const appIdRaw = Deno.env.get('ZEGO_APP_ID') || Deno.env.get('ZEGOCLOUD_APP_ID');
    const serverSecret = Deno.env.get('ZEGO_SERVER_SECRET') || Deno.env.get('ZEGOCLOUD_SERVER_SECRET');

    if (!appIdRaw || !serverSecret) {
      return new Response(
        JSON.stringify({
          error: 'ZEGO credentials missing in environment variables (ZEGO_APP_ID or ZEGO_SERVER_SECRET)'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const appId = Number(appIdRaw);
    if (isNaN(appId)) {
      return new Response(
        JSON.stringify({ error: 'ZEGO_APP_ID must be a valid number' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveTimeInSeconds = 3600;

    // For ZIM Call Invitation and ZegoUIKitPrebuilt initialization, Token04 is user-identity bound
    // and payload must be empty string '' (not room bound in token generation)
    const token = generateToken04(
      appId,
      userId,
      serverSecret,
      effectiveTimeInSeconds,
      ''
    );

    const expiresAt = Math.floor(Date.now() / 1000) + effectiveTimeInSeconds;

    return new Response(
      JSON.stringify({
        token,
        appId,
        userId,
        roomId: roomId || undefined,
        expiresAt
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
