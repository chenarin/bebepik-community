(()=>{'use strict';
const API='https://btstscucvmdzvoefzjwf.supabase.co/functions/v1/community-broadcast';
const $=id=>document.getElementById(id),root=$('broadcastChannelList');
if(!root)return;
const fixed=[
 {channelId:'UCUmet76Q-sAEkTwBwEOn8sg',name:'베베픽'},
 {channelId:'UCaj_w5UAMzh_rgd6ioI83xA',name:'베베픽플러스'},
 {channelId:'UCR7tENabUa8w_yAlGFIgLpw',name:'베베픽 공식채널'},
 {channelId:'UCZQnYjYysHSVufcDsteoihw',name:'베베픽플러스 공식채널'}
];
function make(name,cls,text){const x=document.createElement(name);if(cls)x.className=cls;if(text)x.textContent=text;return x;}
function draw(rows){
 const byId=new Map((rows||[]).map(r=>[r.channelId,r]));
 root.replaceChildren();
 for(const item of fixed){
  const state=byId.get(item.channelId)||{},phase=['active','waiting'].includes(state.phase)?state.phase:'unknown';
  const wrap=make('article','broadcast-channel');
  const heading=make('strong','broadcast-name',item.name);wrap.append(heading);
  const badge=make('span','broadcast-badge '+phase,phase==='active'?'🔴 방송중':phase==='waiting'?'♡ 방송대기중':'연결 확인 중');
  wrap.append(badge);
  const link=document.createElement('a');
  const base='https://www.youtube.com/channel/'+item.channelId+'/live';
  const raw=typeof state.url==='string'?state.url:base;
  let safe=base;
  try{const u=new URL(raw);if(u.protocol==='https:'&&u.hostname==='www.youtube.com'&&
    (u.pathname==='/watch'&&/^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get('v')||'')||u.href===base))safe=u.href}catch{}
  link.href=safe;link.target='_blank';link.rel='noopener noreferrer';
  link.textContent=phase==='active'?'방송 보러 가기':'채널 바로가기';
  wrap.append(link);root.append(wrap);
 }
}
async function refresh(){
 const ctrl=new AbortController(),tid=setTimeout(()=>ctrl.abort(),10000);
 try{
  const r=await fetch(API,{cache:'no-store',signal:ctrl.signal});
  if(!r.ok)throw Error('서버 '+r.status);
  const data=await r.json();
  if(!data.ok||!Array.isArray(data.channels))throw Error('상태 정보 없음');
  draw(data.channels);
  $('broadcastStatusAt').textContent='방송 상태를 자동으로 확인하고 있어요 · 30초마다 새로 확인';
 }catch{
  draw([]);
  $('broadcastStatusAt').textContent='방송 상태 연결을 확인하고 있어요. 잠시 후 다시 확인할게요.';
 }finally{clearTimeout(tid)}
}
draw([]);void refresh();
setInterval(()=>{if(!document.hidden)void refresh()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()});
if(new URLSearchParams(location.search).get('panel')==='broadcast'){
 requestAnimationFrame(()=>setTimeout(()=>$('broadcast-panel')?.scrollIntoView({block:'start',behavior:'auto'}),150));
}
})();