import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { create } from 'https://deno.land/x/djwt@v2.8/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, roomId, effectiveTimeInSeconds = 3600 } = await req.json();

    if (!userId || !roomId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId or roomId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const appId = Deno.env.get('ZEGOCLOUD_APP_ID');
    const serverSecret = Deno.env.get('ZEGOCLOUD_SERVER_SECRET');

    if (!appId || !serverSecret) {
      return new Response(
        JSON.stringify({ error: 'Server secret configuration missing in Supabase' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate ZEGOCLOUD Token (or HMAC SHA-256 signature payload)
    const now = Math.floor(Date.now() / 1000);
    const expire = now + effectiveTimeInSeconds;

    const payload = {
      app_id: Number(appId),
      user_id: userId,
      room_id: roomId,
      privilege: {
        1: 1, // Login Room
        2: 1  // Publish Stream
      },
      create_time: now,
      expire_time: expire,
      nonce: Math.floor(Math.random() * 2147483647)
    };

    return new Response(
      JSON.stringify({
        status: 'success',
        appId: Number(appId),
        userId,
        roomId,
        tokenPayload: payload,
        expireTime: expire
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
