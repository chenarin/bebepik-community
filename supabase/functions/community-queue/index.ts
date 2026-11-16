import {createClient} from 'npm:@supabase/supabase-js@2.49.10';
const cors={'Access-Control-Allow-Origin':'https://bebepik.narin.day','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,apikey,Authorization','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
const validSite=s=>s==='live'||s==='plus';
const hashPattern=/^[a-f0-9]{64}$/i;
async function relaySecret(db){const r=await db.rpc('community_queue_relay_key');if(r.error||typeof r.data!=='string'||r.data.length<32)throw Error('queue relay not configured');return r.data;}
async function identityHash(secret,nickname){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canon(nickname)));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('');}
const canon=s=>String(s||'').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,'').trim();
const safeName=n=>typeof n==='string'&&n.trim().length>=1&&n.trim().length<=30&&!/[\x00-\x1f\x7f]/.test(n);
const admin=()=>{const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw Error('server not configured');return {key,db:createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})};};
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0};
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  // PC browser extension relay uses a separate server-validated secret; its Origin may be chrome-extension://.
  try{
    const {key,db}=admin();
    if(req.method==='GET'){
      const url=new URL(req.url),site=url.searchParams.get('site'),nickname=url.searchParams.get('nickname')||'';
      if(!validSite(site)||!safeName(nickname))return response({error:'site and nickname required'},400);
      const s=await db.from('community_queue_snapshots').select('site,broadcast_id,current_position,status,verified,updated_at').eq('site',site).maybeSingle();
      if(s.error)return response({error:'queue storage unavailable'},503);
      const state=s.data;
      if(!state||!state.verified||Math.abs(Date.now()-new Date(state.updated_at).getTime())>65000)return response({site,status:'waiting',reason:'검증된 최근 순번 데이터 연결 대기',checkedAt:new Date().toISOString()});
      if(state.status==='ended')return response({site,status:'ended',broadcastId:state.broadcast_id,checkedAt:state.updated_at});
      if(state.status!=='active')return response({site,status:'waiting',checkedAt:state.updated_at});
      const hashedName=await identityHash(await relaySecret(db),nickname);
      const e=await db.from('community_queue_entries').select('nickname,position').eq('site',site).eq('broadcast_id',state.broadcast_id).eq('nickname',hashedName).limit(1);
      if(e.error)return response({error:'queue entry unavailable'},503);
      const mine=e.data?.[0];
      if(!mine)return response({site,status:'not_found',broadcastId:state.broadcast_id,checkedAt:state.updated_at});
      return response({site,status:'active',broadcastId:state.broadcast_id,mine:mine.position,current:state.current_position,remaining:mine.position-state.current_position,checkedAt:state.updated_at});
    }
    if(req.method==='POST'){
      const relay=await relaySecret(db);
      const isService=same(req.headers.get('apikey')||'',key);
      const isRelay=same(req.headers.get('x-community-relay-token')||'',relay);
      if(!isService&&!isRelay)return response({error:'unauthorized'},401);
      const body=await req.json().catch(()=>null),site=body?.site,broadcastId=body?.broadcastId;
      if(!body||!validSite(site)||typeof broadcastId!=='string'||broadcastId.length<1||broadcastId.length>100||!['active','waiting','ended'].includes(body.status)||!Number.isInteger(body.current)||body.current<0||body.current>100000||!Array.isArray(body.entries)||body.entries.length>3000)return response({error:'invalid snapshot'},400);
      if(body.entries.some(e=>!e||(!isRelay&&!safeName(e.nickname))||(isRelay&&!hashPattern.test(e.nicknameHash||''))||!Number.isInteger(e.position)||e.position<1||e.position>100000))return response({error:'invalid queue entry'},400);
      // Relay sends HMAC pseudonyms, not raw customer nicknames. Service-role imports are HMACed here.
      const hashedEntries=await Promise.all(body.entries.map(async e=>({nickname:isRelay?e.nicknameHash.toLowerCase():await identityHash(relay,e.nickname),position:e.position})));
      if(new Set(hashedEntries.map(e=>e.nickname)).size!==hashedEntries.length)return response({error:'duplicate pseudonymous nickname'},400);
      // Only a service-role client or explicitly configured private extension relay can publish verified snapshots.
      const at=new Date().toISOString();
      // Never announce a live stream merely because the bridge was installed mid-broadcast.
      // Only an observed waiting -> active transition or a newer broadcast ID is a start.
      const prevSnapshot=await db.from('community_queue_snapshots')
        .select('broadcast_id,status,updated_at').eq('site',site).maybeSingle();
      if(prevSnapshot.error)return response({error:'previous state unavailable'},503);
      const prior=prevSnapshot.data;
      const announceStart=body.status==='active' && !!prior &&
        (prior.status==='waiting' || (prior.broadcast_id!==broadcastId && prior.status==='active'));
      if(announceStart){
        const broadcast=await db.from('community_queue_broadcasts').upsert(
          {site,broadcast_id:broadcastId,first_seen_at:at},
          {onConflict:'site,broadcast_id',ignoreDuplicates:true});
        if(broadcast.error)return response({error:'broadcast registration failed'},503);
      }
      const clean=hashedEntries.map(e=>({site,broadcast_id:broadcastId,nickname:e.nickname,position:e.position,updated_at:at}));
      // Ingest a full snapshot. Remove old entries for the same broadcast before inserting replacements.
      const del=await db.from('community_queue_entries').delete().eq('site',site).eq('broadcast_id',broadcastId);
      if(del.error)return response({error:'queue update failed'},503);
      if(clean.length){const up=await db.from('community_queue_entries').upsert(clean,{onConflict:'site,broadcast_id,nickname'});if(up.error)return response({error:'queue ingest failed'},503)}
      const up=await db.from('community_queue_snapshots').upsert({site,broadcast_id:broadcastId,current_position:body.current,status:body.status,verified:true,updated_at:at},{onConflict:'site'});
      if(up.error)return response({error:'queue snapshot write failed'},503);
      // A private Edge Function performs idempotent, device-specific Web Push delivery.
      // Any non-2xx error is recorded; no success is claimed unless dispatch responded successfully.
      let pushDispatched=false;
      if(body.status==='active'){
        try{
          const u=new URL('/functions/v1/community-queue-push',Deno.env.get('SUPABASE_URL'));
          const result=await fetch(u,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({action:'dispatch',site,broadcastId}),signal:AbortSignal.timeout(25000)});
          pushDispatched=result.ok;
          if(!result.ok)console.error('push-dispatch-failed',result.status);
        }catch(e){console.error('push-dispatch-timeout',String(e).slice(0,100))}
      }
      return response({accepted:true,site,updatedAt:at,entries:clean.length,pushDispatched},202);
    }
    return response({error:'method not allowed'},405);
  }catch(e){console.error('community-queue error',String(e).slice(0,130));return response({error:'queue service temporarily unavailable'},503)}
});