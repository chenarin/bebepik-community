import {createClient} from 'npm:@supabase/supabase-js@2.49.10';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

// Public website authenticates each registered device with a 256-bit bearer token.
const allowedOrigin = 'https://bebepik.narin.day';
const cors = {
  'Access-Control-Allow-Origin':allowedOrigin,
  'Access-Control-Allow-Headers':'content-type,apikey,authorization',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Vary':'Origin',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'
};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
const admin=()=>{
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL');
  if(!key||!url)throw Error('Backend credentials are not configured');
  return {key,db:createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})};
};
function validUUID(s){return typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)}
function validToken(s){return typeof s==='string'&&/^[A-Za-z0-9_-]{43,90}$/.test(s)}
function validNickname(s){return typeof s==='string'&&s.trim().length>=1&&s.trim().length<=30&&!/[\x00-\x1f\x7f]/.test(s)}
function validEndpoint(s){
  if(typeof s!=='string'||s.length<20||s.length>2000)return false;
  try{const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
    const h=u.hostname.toLowerCase();return h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h==='web.push.apple.com'||h==='push.services.mozilla.com'||h.endsWith('.push.apple.com');
  }catch{return false}
}
function validPushSub(s){return s&&validEndpoint(s.endpoint)&&s.keys&&typeof s.keys==='object'&&typeof s.keys.p256dh==='string'&&/^[A-Za-z0-9_-]{65,120}$/.test(s.keys.p256dh)&&typeof s.keys.auth==='string'&&/^[A-Za-z0-9_-]{16,50}$/.test(s.keys.auth)}
async function hash(token){const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(a)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function queueIdentityHash(secret,nickname){
  const normalized=String(nickname||'').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,'').trim();
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,'0')).join('');
}
function fixedEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function webpushConfig(db){const r=await db.rpc('community_webpush_credentials');if(r.error||!r.data?.publicKey||!r.data?.privateKey)throw Error('VAPID is not configured');return r.data}
function b64bytes(value){const b64=value.replace(/-/g,'+').replace(/_/g,'/');const bin=atob(b64+'='.repeat((4-b64.length%4)%4));return Uint8Array.from(bin,c=>c.charCodeAt(0))}
function b64url(value){let bin='';for(const x of value)bin+=String.fromCharCode(x);return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}
let serverPromise;
async function appServer(db){
  if(!serverPromise)serverPromise=(async()=>{
    const keys=await webpushConfig(db),raw=b64bytes(keys.publicKey),priv=b64bytes(keys.privateKey);
    if(raw.length!==65||raw[0]!==4||priv.length!==32)throw Error('Invalid VAPID key length');
    const x=b64url(raw.slice(1,33)),y=b64url(raw.slice(33,65)),d=b64url(priv);
    const pair=await webpush.importVapidKeys({
      publicKey:{kty:'EC',crv:'P-256',alg:'ES256',x,y,key_ops:['verify'],ext:true},
      privateKey:{kty:'EC',crv:'P-256',alg:'ES256',x,y,d,key_ops:['sign'],ext:true}
    });
    return await webpush.ApplicationServer.new({contactInformation:allowedOrigin,vapidKeys:pair});
  })().catch(e=>{serverPromise=undefined;throw e});
  return serverPromise;
}
async function send(db,row,message){
  const server=await appServer(db);
  return await server.subscribe({endpoint:row.push_endpoint,keys:{p256dh:row.p256dh,auth:row.auth_key}})
    .pushTextMessage(JSON.stringify({...message,url:'/',icon:'/icon.svg'}),{urgency:webpush.Urgency.High,ttl:3600});
}
async function ownedDevice(db,input){
  if(!validUUID(input?.deviceId)||!validToken(input?.token))return {error:'기기 인증 정보가 올바르지 않아요.',status:400};
  const r=await db.from('community_queue_devices').select('*').eq('device_id',input.deviceId).maybeSingle();
  if(r.error)return {error:'등록 상태 확인에 실패했어요.',status:503};
  if(!r.data||!fixedEq(r.data.credential_hash,await hash(input.token)))return {error:'기기 연결 정보가 달라요. 기존 기기 정보를 확인해 주세요.',status:403};
  return {device:r.data};
}
const oneOf=(v,name)=>v?.[name]!==false;
async function register(db,input){
  if(!validUUID(input?.deviceId)||!validToken(input?.token)||!validNickname(input?.nickname)||!validPushSub(input?.subscription))return json({error:'닉네임 또는 알림 등록 정보를 확인해 주세요.'},400);
  const prefs={nickname:input.nickname.trim(),watch_live:oneOf(input,'live'),watch_plus:oneOf(input,'plus'),notify_broadcast:oneOf(input,'broadcast'),notify_three:oneOf(input,'three'),notify_one:oneOf(input,'one'),notify_turn:oneOf(input,'turn')};
  const hashValue=await hash(input.token),endpoint=input.subscription.endpoint;
  const current=await db.from('community_queue_devices').select('credential_hash').eq('device_id',input.deviceId).maybeSingle();
  if(current.error)return json({error:'기기 등록 확인 실패'},503);
  if(current.data&&!fixedEq(current.data.credential_hash,hashValue))return json({error:'이미 사용 중인 기기 ID예요.'},403);
  const record={device_id:input.deviceId,credential_hash:hashValue,...prefs,push_endpoint:endpoint,p256dh:input.subscription.keys.p256dh,auth_key:input.subscription.keys.auth,updated_at:new Date().toISOString()};
  const result=await db.from('community_queue_devices').upsert(record,{onConflict:'device_id'});
  if(result.error){return json({error:result.error.code==='23505'?'이미 등록된 브라우저 알림 주소예요. 이전 등록 정보가 필요해요.':'기기 등록에 실패했어요.'},result.error.code==='23505'?409:503)}
  return json({ok:true,registered:true});
}
async function test(db,input){
  const own=await ownedDevice(db,input);if(own.error)return json({error:own.error},own.status);
  const row=own.device;
  const mark=await db.rpc('community_queue_claim_test',{p_device:row.device_id,p_hash:row.credential_hash});
  if(mark.error)return json({error:'시험 알림 준비 실패'},503);
  if(!mark.data)return json({error:'시험 알림은 30초 뒤 다시 보낼 수 있어요.'},429);
  try{await send(db,row,{title:'🧸 베베픽 순번 알리미',body:'화면을 꺼도 받는 푸시 알림이 연결됐어요! 💗',tag:'bebepik-test'});return json({ok:true,sent:true})}
  catch(e){console.error('push-test-failed',e?.response?.status||String(e).slice(0,120));return json({error:'푸시 발송에 실패했어요. 휴대폰 알림 권한을 확인해 주세요.'},502)}
}
async function unregister(db,input){const own=await ownedDevice(db,input);if(own.error)return json({error:own.error},own.status);const r=await db.from('community_queue_devices').delete().eq('device_id',own.device.device_id).eq('credential_hash',own.device.credential_hash);if(r.error)return json({error:'등록 해제 실패'},503);return json({ok:true})}
const canonical=s=>String(s||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,'').trim();
async function dispatch(db,input){
  const site=input?.site,broadcastId=input?.broadcastId;
  if(!['live','plus'].includes(site)||typeof broadcastId!=='string'||broadcastId.length>100)return json({error:'invalid dispatch'},400);
  const r=await db.from('community_queue_snapshots').select('*').eq('site',site).maybeSingle();
  const state=r.data;
  if(r.error||!state||!state.verified||state.status!=='active'||state.broadcast_id!==broadcastId||Math.abs(Date.now()-new Date(state.updated_at).getTime())>120000)return json({ok:true,skipped:'unverified-or-stale-state'});
  const br=await db.from('community_queue_broadcasts').select('first_seen_at').eq('site',site).eq('broadcast_id',broadcastId).maybeSingle();
  const firstSeen=br.data?.first_seen_at;const canBroadcast=!!firstSeen&&Date.now()-new Date(firstSeen).getTime()<180000;
  const entries=await db.from('community_queue_entries').select('nickname,position').eq('site',site).eq('broadcast_id',broadcastId).limit(10000);
  if(entries.error)return json({error:'queue entries unavailable'},503);
  // Customer names are stored as keyed HMAC pseudonyms, never in plaintext.
  const keyResult=await db.rpc('community_queue_relay_key');
  if(keyResult.error||!keyResult.data)return json({error:'relay HMAC unavailable'},503);
  const secret=keyResult.data;
  const positions=new Map();for(const row of entries.data||[])if(!positions.has(row.nickname))positions.set(row.nickname,row.position);
  const key=site==='live'?'watch_live':'watch_plus';let count=0,sent=0,skipped=0,failed=0;const siteLabel=site==='live'?'베베픽':'베베픽 플러스';
  for(let offset=0;offset<10000;offset+=100){
    const page=await db.from('community_queue_devices').select('device_id,nickname,notify_broadcast,notify_three,notify_one,notify_turn,push_endpoint,p256dh,auth_key,created_at').eq(key,true).order('device_id').range(offset,offset+99);
    if(page.error)return json({error:'subscribers unavailable'},503);
    if(!page.data?.length)break;
    for(const row of page.data){
      count++;
      const actions=[];
      if(canBroadcast&&row.notify_broadcast&&new Date(row.created_at).getTime()<=new Date(firstSeen).getTime())actions.push(['broadcast',{title:'🔴 '+siteLabel+' 방송 시작!',body:'방송이 시작됐어요. 순번표를 확인해 주세요.',tag:'bebepik-'+site+'-'+broadcastId+'-broadcast'}]);
      const pos=positions.get(await queueIdentityHash(secret,row.nickname));if(Number.isInteger(pos)){
        const remaining=pos-state.current_position;
        if(remaining<=0&&remaining>=-4&&row.notify_turn)actions.push(['turn',{title:'🎉 '+siteLabel+' 내 차례!',body:'순번표에서 바로 내 차례를 확인해 주세요.',tag:'bebepik-'+site+'-'+broadcastId+'-turn'}]);
        else if(remaining===1&&row.notify_one)actions.push(['one',{title:'⏰ '+siteLabel+' 바로 전 차례!',body:'앞에 1명 남았어요. 준비해 주세요!',tag:'bebepik-'+site+'-'+broadcastId+'-one'}]);
        else if(remaining>=2&&remaining<=3&&row.notify_three)actions.push(['three',{title:'🔔 '+siteLabel+' 3명 전!',body:'내 차례까지 '+remaining+'명 남았어요!',tag:'bebepik-'+site+'-'+broadcastId+'-three'}]);
      }
      for(const [kind,message] of actions){
        const filter={device_id:row.device_id,site,broadcast_id:broadcastId,kind};
        const claim=await db.from('community_queue_push_receipts').insert(filter).select('created_at').maybeSingle();
        if(claim.error){if(claim.error.code==='23505'){skipped++;continue}failed++;console.error('receipt error',claim.error.code);continue}
        try{await send(db,row,message);const done=await db.from('community_queue_push_receipts').update({sent_at:new Date().toISOString()}).match(filter);if(done.error)console.error('receipt confirm',done.error.code);sent++}
        catch(e){failed++;console.error('push deliver error',e?.response?.status||String(e).slice(0,120));await db.from('community_queue_push_receipts').delete().match(filter);if(e?.response?.status===410||e?.response?.status===404)await db.from('community_queue_devices').delete().eq('device_id',row.device_id)}
      }
    }
    if(page.data.length<100)break;
  }
  return json({ok:true,devices:count,sent,skipped,failed});
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method==='POST'&&req.headers.get('Origin')&&req.headers.get('Origin')!==allowedOrigin)return json({error:'origin not allowed'},403);
  try{
    const {key,db}=admin();
    if(req.method==='GET'){
      const cfg=await webpushConfig(db);
      await appServer(db); // Verify that the VAPID keys are usable before declaring readiness.
      return json({ready:true,vapidReady:true,publicKey:cfg.publicKey,iosHomeScreenRequired:true});
    }
    if(req.method!=='POST')return json({error:'method not allowed'},405);
    const body=await req.json().catch(()=>null);if(!body||typeof body!=='object')return json({error:'invalid body'},400);
    if(body.action==='dispatch'){
      const auth=req.headers.get('authorization')||'';
      if(!fixedEq(auth,'Bearer '+key))return json({error:'unauthorized'},401);
      return await dispatch(db,body);
    }
    if(body.action==='register')return await register(db,body);
    if(body.action==='test')return await test(db,body);
    if(body.action==='unregister')return await unregister(db,body);
    return json({error:'unknown action'},400);
  }catch(e){console.error('community-queue-push service error',String(e).slice(0,160));return json({error:'알림 서버 연결에 실패했어요.'},503)}
});