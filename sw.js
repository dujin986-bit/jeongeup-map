const CACHE="jeongeup-v85";
const SHELL=["./","index.html","admin.html","style.css","data.js","app.js","manifest.json","admin-manifest.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",e=>{
  const r=e.request;
  if(r.method!=="GET"||new URL(r.url).origin!==location.origin)return;   // 지도타일·API는 건드리지 않음
  e.respondWith(fetch(r,{cache:"no-store"}).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));return res;}).catch(()=>caches.match(r)));
});
self.addEventListener("push",e=>{
  let d={};try{d=e.data.json();}catch(_){d={title:"정읍 지금",body:e.data?e.data.text():""};}
  e.waitUntil(self.registration.showNotification(d.title||"정읍 지금",{body:d.body||"",icon:"icons/user-192.png",badge:"icons/user-192.png",tag:d.tag||undefined,data:{url:d.url||"./"}}));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const u=new URL((e.notification.data&&e.notification.data.url)||"./",self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if(c.url===u&&"focus"in c)return c.focus();}return clients.openWindow(u);}));
});
