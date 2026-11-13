/* ShopPOS — แอพเว็บของร้านในเครื่อง: หน้าจอ ↔ ตัวคิดเบื้องหลัง (worker) ↔ ตัวโปรแกรม (/api/lapp/*)
   แทน google.script.run ของหน้าเว็บ (หน้าเดียวกับเว็บ ไม่ต้องแก้โค้ดหน้าจอ):
     อ่าน           = คิดในเครื่องทันที (ชีตชุดล่าสุดจากเว็บ + คำสั่งที่ยังไม่ขึ้นเว็บ)
     แก้ (writes)   = คิดในเครื่องทันที แล้วฝากตัวโปรแกรมส่งขึ้นเว็บเบื้องหลัง (เน็ตหลุดก็กดได้ ส่งทีหลังเอง)
     ต้องใช้เน็ต    = ตัวโปรแกรมถามเว็บให้ (อ่านรูปด้วย AI · เปิดไฟล์บน Drive) — เน็ตหลุด = บอกว่าต้องต่อเน็ต
   ตั้งค่าในหน้าแอพก่อนโหลดไฟล์นี้: LAPP_CFG = { app, worker, writes:[...], online:[...], isWrite(fn, args)?, label(fn, args)?, ctx(), onRebase(), badge }
   ตัวโปรแกรมได้ชีตชุดใหม่ (มีคนแก้บนเว็บ / คำสั่งขึ้นเว็บแล้ว) = คิดใหม่แล้วให้หน้าจอวาดใหม่ (onRebase) */
(function () {
  var CFG = window.LAPP_CFG || {};
  var SHOP = window.parent && window.parent !== window ? window.parent : null;
  var W = null, SEQ = 0, WAIT = {}, READY = null, BASE_REV = "", ST = null, CHAIN = Promise.resolve(), INFLIGHT = {}, SEEN_FAIL = {};
  var MUTEX = Promise.resolve();   // ตัวคิดเบื้องหลังทำทีละเรื่อง (โหลดชีตชุดใหม่ไม่ตัดคำสั่งที่กำลังคิดอยู่)
  function exclusive(fn) { var p = MUTEX.then(fn, fn); MUTEX = p.then(function () {}, function () {}); return p; }
  var writes = {}, online = {};
  (CFG.writes || []).forEach(function (f) { writes[f] = 1; });
  (CFG.online || []).forEach(function (f) { online[f] = 1; });

  function api(path, body) {
    if (!SHOP || typeof SHOP.api !== "function") return Promise.reject(new Error("เปิดหน้านี้จากโปรแกรม ShopPOS (เมนู หลังบ้าน)"));
    return SHOP.api(path, body);
  }
  var q = function (p) { return "lapp/" + p + (p.indexOf("?") >= 0 ? "&" : "?") + "app=" + encodeURIComponent(CFG.app); };
  function worker(msg) {
    return new Promise(function (res) { var id = ++SEQ; WAIT[id] = res; msg.id = id; W.postMessage(msg); });
  }
  async function newWorker() {   /* แอพมือถือ: สร้างตัวคิดเองได้ (Blob) */
    if (W) W.terminate();
    W = null;
    W = CFG.makeWorker ? await CFG.makeWorker() : new Worker(CFG.worker);
    W.onmessage = function (e) { var m = e.data || {}, f = WAIT[m.id]; if (f) { delete WAIT[m.id]; f(m); } };
  }
  // คำสั่งที่ต้องคิดซ้ำ = ที่ตัวโปรแกรมยังไม่ได้ชีตฉบับที่รวมคำสั่งนั้น + ที่เพิ่งกดแต่ยังส่งให้ตัวโปรแกรมไม่เสร็จ
  function pendingQ(b, snap) {
    var list = (b.q || []).slice(), have = {};
    list.forEach(function (c) { have[c.lid] = 1; });
    [snap || {}, INFLIGHT].forEach(function (m) { Object.keys(m).forEach(function (k) { if (!have[k]) { have[k] = 1; list.push(m[k]); } }); });
    return list;
  }
  // ชีตชุดล่าสุด + คำสั่งที่ค้าง (ตัวโปรแกรมส่งมาพร้อมกัน) → ตัวคิดเบื้องหลังตัวใหม่
  function load() {
    return exclusive(async function () {
      var snap = {}; Object.keys(INFLIGHT).forEach(function (k) { snap[k] = INFLIGHT[k]; });
      var b = await api(q("base"));
      await newWorker();
      var r = await worker({ t: "init", base: b.base, q: pendingQ(b, snap), ctx: CFG.ctx ? CFG.ctx(b) : {} });
      if (r.err) throw new Error(r.err);
      BASE_REV = b.baseRev;
      LAPP.build = r.build; LAPP.webBuild = (b.base && b.base.build) || "";
      LAPP.bad = r.bad || [];
    });
  }
  async function start() {
    for (var i = 0; ; i++) {
      var st = await api(q("state" + (i ? "" : "?fresh=1")));
      ST = st;
      if (st.ready) { await load(); paint(st); return; }
      paint(st);
      await new Promise(function (r) { setTimeout(r, 3000); });
    }
  }
  READY = start();
  READY.catch(function (e) { paint({ err: (e && e.message) || String(e) }); });

  // สถานะส่ง/ดึงกับเว็บ (ป้ายบนหน้า)
  function badge() {
    var el = document.getElementById(CFG.badge);
    if (el || !document.body) return el;
    el = document.createElement("div");   // หน้าเว็บไม่มีที่วางป้าย = ป้ายลอยมุมซ้ายล่าง
    el.id = CFG.badge;
    el.style.cssText = "position:fixed;left:8px;" + (window.innerWidth < 760 ? "top:6px" : "bottom:8px") + ";z-index:2147483000;max-width:70vw;padding:4px 11px;border-radius:999px;"
      + "font:600 12px/1.5 sans-serif;color:#dfe5ea;background:rgba(21,25,29,.88);border:1px solid #3a424c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    document.body.appendChild(el);
    var ps = document.createElement("style");   // ไม่ติดไปในกระดาษตอนพิมพ์ (ใบเวลาทำงานเคยมีป้ายนี้ทับแถวรวม · 31 ต.ค.)
    ps.textContent = "@media print{#" + CFG.badge + "{display:none!important}}";
    document.head.appendChild(ps);
    return el;
  }
  function paint(st) {
    var el = CFG.badge && badge();
    if (!el || !st) return;
    var n = (st.q || []).filter(function (c) { return c.state === "pending"; }).length + Object.keys(INFLIGHT).length;
    var bad = st.failed || [];
    el.className = "lappSt" + (bad.length ? " bad" : n ? " wait" : st.err ? " off" : "");
    el.textContent = bad.length ? "⚠ ส่งไม่ผ่าน " + bad.length + " รายการ (แตะดู)"
      : n ? "⏳ รอส่งขึ้นเว็บ " + n
      : !st.ready ? "⏳ กำลังดึงข้อมูลจากเว็บครั้งแรก…" + (st.err ? " (" + st.err + ")" : "")
      : st.err ? "☁ ✗ " + st.err + " (บันทึกในเครื่องได้ ส่งทีหลังเอง)" : "☁ ✓ ตรงกับเว็บแล้ว";
    el.title = bad.map(function (c) { return (c.fn || "") + ": " + (c.err || ""); }).join("\n");
    el.onclick = bad.length ? function () { if (CFG.onFail) CFG.onFail(bad, true); else showFails(bad); } : null;
    el.style.borderColor = bad.length ? "#e0674f" : n ? "#d89449" : st.err ? "#6c747e" : "#3a424c";
    el.style.cursor = bad.length ? "pointer" : "default";
  }
  function showFails(bad) {
    var t = "คำสั่งเหล่านี้ส่งขึ้นเว็บไม่ผ่าน (ในเครื่องกลับเป็นแบบบนเว็บแล้ว):\n\n" + bad.map(function (c) {
      return "• " + (c.label || c.fn) + " — " + (c.err || "") + (c.at ? " (" + new Date(c.at).toLocaleString("th-TH") + ")" : "");
    }).join("\n") + "\n\nกด ตกลง = รับทราบ (ลบออกจากรายการ)";
    if (confirm(t)) api(q("dismiss"), { app: CFG.app, lids: bad.map(function (c) { return c.lid; }) }).then(poll, function () {});
  }
  // ถามตัวโปรแกรมทุก 3 วิ: ได้ชีตชุดใหม่ = คิดใหม่ + วาดใหม่ · ส่งไม่ผ่านใหม่ = บอก
  var POLLING = false;
  function poll() { if (POLLING) return Promise.resolve(); POLLING = true;
    return poll0().then(function () { POLLING = false; }, function () { POLLING = false; }); }
  async function poll0() {
    var st;
    try { st = await api(q("state")); } catch (e) { return; }
    ST = st;
    var fresh = (st.failed || []).filter(function (c) { return !SEEN_FAIL[c.lid]; });
    fresh.forEach(function (c) { SEEN_FAIL[c.lid] = 1; });
    // ได้ชีตชุดใหม่ / มีคำสั่งไม่ผ่าน (ไม่คิดซ้ำแล้ว — ในเครื่องกลับเป็นแบบเว็บ) = คิดใหม่ + ให้หน้าจอวาดใหม่
    if (st.ready && (st.baseRev !== BASE_REV || fresh.length)) {
      try { await load(); if (CFG.onRebase) CFG.onRebase(); } catch (e) {}
    }
    paint(st);
    if (fresh.length) { if (CFG.onFail) CFG.onFail(fresh); else showFails(fresh); }
  }
  setInterval(function () { if (READY) READY.then(poll, function () {}); }, 3000);

  var lid = function () { return "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  // เรียกฟังก์ชันของโค้ดเว็บ (แทน google.script.run)
  async function run(fn, args) {
    args = JSON.parse(JSON.stringify(args || []));   // เหมือน google.script.run: ส่งได้เฉพาะข้อมูลธรรมดา
    if (online[fn]) {
      var r0 = await api(q("live"), { app: CFG.app, fn: fn, args: args });
      if (!r0.ok) throw new Error(r0.error || "ไม่สำเร็จ");
      return r0.ret;
    }
    await READY;
    var isWrite = CFG.isWrite ? CFG.isWrite(fn, args) : !!writes[fn];   // แอพที่มีทางเข้าเดียว (api(คำสั่ง, …)) บอกเองว่าคำสั่งไหนแก้ข้อมูล
    var cmd = isWrite ? { lid: lid(), at: Date.now(), fn: fn, args: args, label: CFG.label ? CFG.label(fn, args) : fn } : null;
    var m = await exclusive(function () { return worker({ t: "call", fn: fn, args: args, cmd: cmd }); });
    if (!m.ok) {
      if (m.online) {   // คิดในเครื่องไม่ได้ (ต้องใช้เน็ต) → ตัวโปรแกรมถามเว็บ
        var r1 = await api(q("live"), { app: CFG.app, fn: fn, args: args });
        if (!r1.ok) throw new Error(r1.error || "ไม่สำเร็จ");
        return r1.ret;
      }
      throw new Error(m.err);
    }
    if (cmd && m.queued) {
      INFLIGHT[cmd.lid] = cmd;
      // ฝากตัวโปรแกรมตามลำดับที่กด (ทีละคำสั่ง)
      CHAIN = CHAIN.then(function () { return api(q("cmd"), { app: CFG.app, cmd: cmd }); })
        .then(function (st) { delete INFLIGHT[cmd.lid]; if (st && st.ok) { ST = st; paint(st); } },
              function (e) { delete INFLIGHT[cmd.lid]; alert("เก็บคำสั่งไว้ส่งขึ้นเว็บไม่ได้: " + ((e && e.message) || e) + "\nกดโหลดใหม่ก่อนทำต่อ"); });
    }
    return m.ret;
  }
  window.LAPP = { run: run, ready: function () { return READY; }, sync: function () { return api(q("sync"), { app: CFG.app }); }, state: function () { return ST; }, poll: poll };

  // google.script.run แบบหน้าเว็บ (withSuccessHandler / withFailureHandler / withUserObject)
  function runner(ok, fail, user) {
    return new Proxy({}, {
      get: function (t, name) {
        if (name === "withSuccessHandler") return function (f) { return runner(f, fail, user); };
        if (name === "withFailureHandler") return function (f) { return runner(ok, f, user); };
        if (name === "withUserObject") return function (u) { return runner(ok, fail, u); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          run(String(name), args).then(function (r) { if (ok) ok(r, user); }, function (e) { if (fail) fail(e instanceof Error ? e : new Error(String(e)), user); });
        };
      }
    });
  }
  window.google = { script: {
    run: runner(null, null, undefined),
    host: { close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} } },
    url: { getLocation: function (cb) { cb({ parameter: {}, parameters: {}, hash: "" }); } },
    history: { push: function () {}, replace: function () {}, setChangeHandler: function () {} }
  } };
})();
