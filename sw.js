/* เวลาทำงาน 3ส. (เว็บแอพ): เก็บไฟล์หน้าเว็บไว้ในมือถือ — เปิดแอพได้ตอนไม่มีเน็ต
   ไฟล์เปลี่ยน (สร้างใหม่ด้วย tools/build_attend_web.py) = ชื่อชุดเปลี่ยน → มือถือโหลดชุดใหม่ทั้งชุดไว้เบื้องหลัง แล้วรอ
     ไม่เปลี่ยนกลางการใช้งาน (หน้าที่เปิดอยู่ใช้ไฟล์ชุดเดิมจนจบ) — web-core.js สั่ง "skip" ตอนเปิดแอพครั้งถัดไป แล้วโหลดหน้าใหม่
   โหลดชุดใหม่แบบต่อท้าย ?v= (ไม่เอาไฟล์เก่าที่ค้างในตัวกลาง/แคชของเว็บ) · ไม่แตะคำขอไปเว็บ Google (ส่ง/ดึงข้อมูล) */
var V = "att-2026.11.01-231739-13744575d4";
var FILES = ["./", "app.html", "fonts/OFL.txt", "fonts/fonts.css", "fonts/prompt-400-latin.woff2", "fonts/prompt-400-thai.woff2", "fonts/prompt-600-latin.woff2", "fonts/prompt-600-thai.woff2", "fonts/prompt-700-latin.woff2", "fonts/prompt-700-thai.woff2", "icon-180.png", "icon-192.png", "icon-512.png", "index.html", "lapp/attend/engine-boot.js", "lapp/attend/engine.js", "lapp/attend/index.html", "lapp/attend/m.html", "lapp/client.js", "manifest-ios.webmanifest", "manifest.webmanifest", "robots.txt", "setup.html", "web-core.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f + (f.indexOf("?") < 0 ? "?" : "&") + "v=" + V, { cache: "reload" }); }));
  }));
});

self.addEventListener("message", function (e) { if (e.data === "skip") self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("att-") === 0 && k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(V).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); });
  }));
});
