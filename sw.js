const CACHE='bebepik-queue-v6',FILES=['/','/index.html','/icon.svg','/manifest.webmanifest','/icons/icon-192.png','/icons/apple-touch-icon-180.png','/icons/notification-bear-v2.png'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>caches.match(e.request)))});

self.addEventListener('push',event=>{let data={};try{data=event.data?event.data.json():{}}catch{data={body:event.data?event.data.text():''}}const title=String(data.title||'베베픽 알리미 ♡');const options={body:String(data.body||'새 순번 알림이에요.'),icon:'/icons/icon-192.png',badge:'/icons/notification-bear-v2.png?v=2',tag:String(data.tag||'bebepik-queue'),renotify:true,data:{url:typeof data.url==='string'&&data.url.startsWith('/')?data.url:'/?panel=queue'}};event.waitUntil(self.registration.showNotification(title,options))});
// Prefer the installed Galaxy PWA instead of focusing an unrelated Chrome tab.
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const fallback=new URL('/?panel=queue',self.location.origin);
    let target=fallback;
    try {
      const requested=new URL(event.notification.data?.url||fallback.href,self.location.origin);
      if(requested.origin===self.location.origin){
        target=requested.pathname==='/' && !requested.search ? fallback : requested;
      }
    }catch{}
    // On Chrome Android, openWindow can route directly into an installed standalone PWA.
    try {
      const opened=await self.clients.openWindow(target.href);
      if(opened){if(typeof opened.focus==='function')await opened.focus();return;}
    }catch{}
    // Safe fallback if opening a new PWA window is unsupported.
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if(new URL(client.url).origin!==self.location.origin)continue;
      if(typeof client.navigate==='function')await client.navigate(target.href);
      if(typeof client.focus==='function')await client.focus();
      return;
    }
  })());
});