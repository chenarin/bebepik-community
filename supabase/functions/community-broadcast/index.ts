import {createClient} from 'npm:@supabase/supabase-js@2.49.10';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

// Public broadcast-only bridge. Never receives names, queue entries or ntfy tokens.
const ORIGIN='https://bebepik.narin.day';
const CHANNELS={
  'UCUmet76Q-sAEkTwBwEOn8sg':{site:'live',name:'베베픽'},
  'UCaj_w5UAMzh_rgd6ioI83xA':{site:'plus',name:'베베픽플러스'},
  'UCR7tENabUa8w_yAlGFIgLpw':{site:'live',name:'베베픽 공식채널'},
  'UCZQnYjYysHSVufcDsteoihw':{site:'plus',name:'베베픽플러스 공식채널'}
};
const cors={
 'Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'content-type',
 'Access-Control-Allow-Methods':'GET,OPTIONS',
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}
});
function admin(){
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)throw Error('missing-server-config');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function equal(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
async function hash(s){
 const sum=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
 return [...new Uint8Array(sum)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function b64bytes(s){const a=s.replace(/-/g,'+').replace(/_/g,'/');const v=atob(a+'='.repeat((4-a.length%4)%4));return Uint8Array.from(v,c=>c.charCodeAt(0))}
function b64url(a){let x='';for(const b of a)x+=String.fromCharCode(b);return btoa(x).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}
let serverPromise;
async function pushServer(db){
 if(!serverPromise)serverPromise=(async()=>{
  const cfg=await db.rpc('community_webpush_credentials');
  if(cfg.error||!cfg.data?.publicKey||!cfg.data?.privateKey)throw Error('webpush-config');
  const raw=b64bytes(cfg.data.publicKey),priv=b64bytes(cfg.data.privateKey);
  if(raw.length!==65||raw[0]!==4||priv.length!==32)throw Error('webpush-key-length');
  const pair=await webpush.importVapidKeys({
   publicKey:{kty:'EC',crv:'P-256',alg:'ES256',x:b64url(raw.slice(1,33)),y:b64url(raw.slice(33,65)),key_ops:['verify'],ext:true},
   privateKey:{kty:'EC',crv:'P-256',alg:'ES256',x:b64url(raw.slice(1,33)),y:b64url(raw.slice(33,65)),d:b64url(priv),key_ops:['sign'],ext:true}
  });
  return await webpush.ApplicationServer.new({contactInformation:ORIGIN,vapidKeys:pair});
 })().catch(e=>{serverPromise=null;throw e});
 return serverPromise;
}
async function notifyDevices(db,channelId,videoId,site,startedAt){
 const label=CHANNELS[channelId].name;
 const broadcastId='yt:'+channelId+':'+videoId;
 const siteKey=site==='live'?'watch_live':'watch_plus';
 let sent=0,skipped=0,failed=0;
 for(let offset=0;offset<10000;offset+=100){
  const page=await db.from('community_queue_devices')
    .select('device_id,push_endpoint,p256dh,auth_key,created_at')
    .eq(siteKey,true).eq('notify_broadcast',true)
    .order('device_id').range(offset,offset+99);
  if(page.error)throw Error('push-device-list');
  if(!page.data?.length)break;
  for(const device of page.data){
   if(new Date(device.created_at).getTime()>new Date(startedAt).getTime()){skipped++;continue;}
   const key={device_id:device.device_id,site,broadcast_id:broadcastId,kind:'broadcast'};
   const claim=await db.from('community_queue_push_receipts').insert(key).select('created_at').maybeSingle();
   if(claim.error){if(claim.error.code==='23505'){skipped++;continue}failed++;continue;}
   try{
    const server=await pushServer(db);
    await server.subscribe({endpoint:device.push_endpoint,keys:{p256dh:device.p256dh,auth:device.auth_key}})
      .pushTextMessage(JSON.stringify({
       title:'🔴 '+label+' 생방송 시작!',
       body:'기다리던 방송이 시작됐어요. 베베픽 알리미에서 확인해 주세요 ♡',
       tag:'bebepik-broadcast-'+channelId+'-'+videoId,
       url:'/?panel=broadcast'
      }),{urgency:webpush.Urgency.High,ttl:3600});
    const done=await db.from('community_queue_push_receipts').update({sent_at:new Date().toISOString()}).match(key);
    if(done.error)console.error('broadcast-receipt-confirm',done.error.code);
    sent++;
   }catch(e){
    failed++;console.error('broadcast-webpush-error',String(e).slice(0,130));
    await db.from('community_queue_push_receipts').delete().match(key);
   }
  }
  if(page.data.length<100)break;
 }
 return {sent,skipped,failed};
}
async function currentStatuses(db){
 const rows=await db.from('community_broadcast_channels')
   .select('channel_id,phase,video_id,observed_at');
 if(rows.error)throw Error('broadcast-status');
 const byId=new Map((rows.data||[]).map(x=>[x.channel_id,x]));
 return Object.entries(CHANNELS).map(([channelId,meta])=>{
  const state=byId.get(channelId);
  const age=state?Date.now()-new Date(state.observed_at).getTime():Infinity;
  const fresh=age>=0&&age<180000;
  const phase=fresh?state.phase:'unknown';
  return {channelId,name:meta.name,site:meta.site,phase,
   url:phase==='active'&&state?.video_id
    ?'https://www.youtube.com/watch?v='+state.video_id
    :'https://www.youtube.com/channel/'+channelId+'/live',
   observedAt:fresh?state.observed_at:null};
 });
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 try{
  const db=admin();
  if(req.method==='GET')return json({ok:true,checkedAt:new Date().toISOString(),channels:await currentStatuses(db)});
  if(req.method!=='POST')return json({error:'method-not-allowed'},405);
  const token=req.headers.get('x-narin-relay-key')||'';
  if(!/^[A-Za-z0-9_-]{60,100}$/.test(token))return json({error:'unauthorized'},401);
  const auth=await db.from('community_broadcast_relays').select('token_sha256').eq('relay_id','narin_pc').maybeSingle();
  if(auth.error||!auth.data||!equal(await hash(token),auth.data.token_sha256.trim()))
   return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>null);
  const channelId=body?.channelId,phase=body?.phase,videoId=body?.videoId;
  const observedAt=body?.observedAt;
  const meta=CHANNELS[channelId];
  if(!meta||!['active','waiting'].includes(phase)||
     !Number.isSafeInteger(observedAt)||Math.abs(Date.now()-observedAt)>90000||
     (phase==='active'&&!/^[A-Za-z0-9_-]{11}$/.test(videoId||''))||
     (phase==='waiting'&&videoId!=null))
   return json({error:'invalid-observation'},400);
  const prev=await db.from('community_broadcast_channels')
    .select('phase,video_id,observed_at').eq('channel_id',channelId).maybeSingle();
  if(prev.error)throw Error('previous-status');
  // An initial active sample is a baseline, not a verified start event.
  const wasRecent=!!prev.data&&Date.now()-new Date(prev.data.observed_at).getTime()<180000;
  const start=phase==='active'&&wasRecent&&
    (prev.data.phase==='waiting'||prev.data.phase==='active'&&prev.data.video_id!==videoId);
  const up=await db.from('community_broadcast_channels').upsert({
    channel_id:channelId,site:meta.site,display_name:meta.name,phase,
    video_id:phase==='active'?videoId:null,observed_at:new Date(observedAt).toISOString(),
    updated_at:new Date().toISOString()
  },{onConflict:'channel_id'});
  if(up.error)throw Error('status-write');
  let announced=false;
  if(start){
   const created=await db.from('community_broadcast_events').insert({
      channel_id:channelId,site:meta.site,video_id:videoId
   }).select('started_at').maybeSingle();
   if(created.error&&created.error.code!=='23505')throw Error('broadcast-event-write');
   announced=!created.error;
  }
  // A transient push failure can be retried within 3 minutes. Receipts prevent repeats.
  let delivery=null;
  if(phase==='active'){
    const evt=await db.from('community_broadcast_events').select('started_at')
      .eq('channel_id',channelId).eq('video_id',videoId).maybeSingle();
    const at=evt.data?.started_at;
    if(!evt.error&&at&&Date.now()-new Date(at).getTime()<180000){
      try{delivery=await notifyDevices(db,channelId,videoId,meta.site,at)}
      catch(e){console.error('broadcast-dispatch-failed',String(e).slice(0,100));delivery={error:'delivery-unavailable'}}
    }
  }
  return json({ok:true,channelId,phase,announced,delivery},202);
 }catch(e){console.error('community-broadcast',String(e).slice(0,120));return json({error:'broadcast-service-unavailable'},503)}
});