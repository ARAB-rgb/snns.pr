import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateToken04 as zegoGenerateToken04 } from 'npm:zego_server_assistant';
import { createCipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fallback native Token04 generator if npm module is unavailable
function nativeGenerateToken04(
  appId: number,
  userId: string,
  secret: string,
  effectiveTimeInSeconds: number,
  payload?: string
): string {
  const createTime = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 2147483647);
  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: nonce,
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || ''
  };

  const plainText = JSON.stringify(tokenInfo);
  const ivStr = '0123456789abcdefghijklmnopqrstuvwxyz';
  let iv = '';
  for (let i = 0; i < 16; i++) {
    iv += ivStr.charAt(Math.floor(Math.random() * ivStr.length));
  }

  const cipherKey = secret.substring(0, 16);
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(cipherKey, 'utf8'), Buffer.from(iv, 'utf8'));
  let encryptBuf = cipher.update(plainText, 'utf8');
  encryptBuf = Buffer.concat([encryptBuf, cipher.final()]);

  const b1 = Buffer.alloc(8);
  b1.writeBigInt64BE(BigInt(tokenInfo.expire));

  const b2 = Buffer.alloc(2);
  b2.writeUInt16BE(iv.length);

  const b3 = Buffer.from(iv, 'utf8');

  const b4 = Buffer.alloc(2);
  b4.writeUInt16BE(encryptBuf.length);

  const binaryBuf = Buffer.concat([b1, b2, b3, b4, encryptBuf]);
  return '04' + binaryBuf.toString('base64');
}

function safeGenerateToken04(
  appId: number,
  userId: string,
  secret: string,
  effectiveTimeInSeconds: number,
  payload: string
): string {
  try {
    if (typeof zegoGenerateToken04 === 'function') {
      const res = zegoGenerateToken04(appId, userId, secret, effectiveTimeInSeconds, payload);
      if (res && typeof res === 'string' && res.startsWith('04')) {
        return res;
      }
    }
  } catch (err) {
    console.warn('npm zego_server_assistant token generation note:', err);
  }
  return nativeGenerateToken04(appId, userId, secret, effectiveTimeInSeconds, payload);
}

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

    const appIdRaw = Deno.env.get('ZEGO_APP_ID') || Deno.env.get('ZEGOCLOUD_APP_ID') || '366567418';
    const serverSecret = Deno.env.get('ZEGO_SERVER_SECRET') || Deno.env.get('ZEGOCLOUD_SERVER_SECRET');

    const appId = Number(appIdRaw);

    if (!appId || isNaN(appId) || !serverSecret) {
      return new Response(
        JSON.stringify({
          error: 'ZEGO credentials missing in environment variables (ZEGO_APP_ID or ZEGO_SERVER_SECRET)'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveTimeInSeconds = 3600;

    const payload = {
      room_id: roomId,
      privilege: {
        1: 1,
        2: 1
      },
      stream_id_list: null
    };

    const token = safeGenerateToken04(
      appId,
      userId,
      serverSecret,
      effectiveTimeInSeconds,
      JSON.stringify(payload)
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + effectiveTimeInSeconds;

    return new Response(
      JSON.stringify({
        token,
        appId,
        userId,
        roomId,
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
