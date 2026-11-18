const CACHE='bebepik-queue-v10',FILES=['/','/index.html','/icon.svg','/manifest.webmanifest','/broadcast-live.js','/icons/icon-192.png','/icons/apple-touch-icon-180.png','/icons/notification-bear-v4.png','/icons/notification-bear-icon-v4.png'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>caches.match(e.request)))});

self.addEventListener('push',event=>{let data={};try{data=event.data?event.data.json():{}}catch{data={body:event.data?event.data.text():''}}const title=String(data.title||'베베픽 알리미 ♡');const options={body:String(data.body||'새 순번 알림이에요.'),icon:'/icons/notification-bear-icon-v4.png?v=4',badge:'/icons/notification-bear-v4.png?v=4',tag:String(data.tag||'bebepik-queue'),renotify:true,data:{url:typeof data.url==='string'&&data.url.startsWith('/')?data.url:'/?panel=queue'}};event.waitUntil(self.registration.showNotification(title,options))});
// Galaxy: use an existing regular browser tab for the queue when possible.
// Push notifications cannot choose an unrelated OS default browser application.
async function isRegularBrowserTab(client){
  return new Promise(resolve=>{
    let settled=false;
    let timer;
    let channel;
    const finish=value=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      try{channel?.port1.close()}catch{}
      resolve(value);
    };
    try{
      channel=new MessageChannel();
      channel.port1.onmessage=event=>finish(event.data?.mode==='browser');
      timer=setTimeout(()=>finish(false),300);
      client.postMessage({type:'BEBEPIK_QUERY_VIEW_MODE'},[channel.port2]);
    }catch{finish(false)}
  });
}
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const fallback=new URL('/?panel=queue',self.location.origin);
    let target=fallback;
    try{
      const requested=new URL(event.notification.data?.url||fallback.href,self.location.origin);
      if(requested.origin===self.location.origin && requested.pathname==='/'){
        requested.searchParams.set('panel',requested.searchParams.get('panel')==='broadcast'?'broadcast':'queue');
        target=requested;
      }
    }catch{}
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const sameOrigin=list.filter(client=>{
      try{return new URL(client.url).origin===self.location.origin}catch{return false}
    });
    const modes=await Promise.all(sameOrigin.map(isRegularBrowserTab));
    const browserTab=sameOrigin.find((_,index)=>modes[index]);
    if(browserTab){
      try{
        const navigated=await browserTab.navigate(target.href);
        const active=navigated||browserTab;
        if(typeof active.focus==='function')await active.focus();
        return;
      }catch{}
    }
    // No existing regular browser tab: let the browser open the target.
    // Chrome Android may choose an installed PWA; sites cannot override that decision.
    try{
      const opened=await self.clients.openWindow(target.href);
      if(opened){if(typeof opened.focus==='function')await opened.focus();return}
    }catch{}
    // Last resort: reuse the existing same-origin app/tab.
    for(const client of sameOrigin){
      try{
        const navigated=await client.navigate(target.href);
        const active=navigated||client;
        if(typeof active.focus==='function')await active.focus();
        return;
      }catch{}
    }
  })());
});
