/* เวลาทำงาน 3ส. แบบเว็บแอพ (iPhone: Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม) — ทำหน้าที่แทนตัวแอพ Android
   หน้าเดิมทุกหน้า (setup.html / app.html / lapp/attend/*) เรียก ShopAndroid.call(รหัส, คำสั่ง, ข้อมูล) → ตอบทาง __apiDone(รหัส, ข้อความ JSON)
   ไฟล์นี้ = Core + AttStore + AttSync ของแอพ Android (app/src/attend/java/app/ngn) แปลงเป็น JS — กติกาเดียวกัน แก้ที่หนึ่งต้องแก้อีกที่ด้วย
     เก็บในเครื่อง = IndexedDB ของเว็บนี้: cfg { url, key (รหัสเจ้าของ), rev, dig, baseRev, build, seq, lastOk, needLink }
                    base (ข้อความชีตชุดล่าสุด) · q:<ลำดับ 8 หลัก>-<รหัสคำสั่ง> (คำสั่ง 1 รายการ แบบ q/*.json ของแอพ Android)
     คุยกับเว็บ = fetch ตรงไป 95_pos.gs (POST แบบข้อความธรรมดา ไม่ต้องขออนุญาตข้ามเว็บก่อน · Google ตอบกลับแบบให้ทุกเว็บอ่านได้)
   iPhone ไม่ให้เว็บทำงานตอนปิดแอพ → ของที่ค้างส่งตอนเปิดแอพ · ส่งไม่ผ่าน = บอกในแอพ (ไม่มีเด้งแจ้งเตือน)
   สร้างหน้าเว็บแอพ: python tools/build_attend_web.py (ใส่เลขรุ่น + ลิงก์เว็บเวลาทำงานของร้านให้ตอนสร้าง) */
(function () {
  "use strict";
  var VERSION = "2026.11.01-231739", ATT_URL = "";
  var DEP_HASH = "a3b813398c2a85100869816cc7f5c9342f407ac7791fe98fc63279dab7e0a7bb";   // SHA-256 ของรหัสเว็บเวลาทำงานของร้าน (ตัวรหัสไม่อยู่ในไฟล์สาธารณะ) — รับเฉพาะลิงก์เจ้าของของเว็บนี้
  var DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // ลองบนคอม (tools/attend_web_dev.py) = รับเว็บจำลองในเครื่อง
  var PAGE = (location.pathname.match(/[^/]*$/) || [""])[0] || "index.html";
  var UA = navigator.userAgent || "";
  var IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var STANDALONE = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  // เปิดอยู่ในแอพอื่น (ที่เก็บของหน้าในแอพนั้นแยกจากเบราว์เซอร์ และอาจหายตอนปิด)
  var IN_APP = /\bLine\/\d/.test(UA) && !/LIFF/.test(UA) ? "LINE" : /\bFB[\w_]+\/|\bFacebook|Messenger/i.test(UA) ? "Facebook" : /\bInstagram/i.test(UA) ? "Instagram" : "";

  /* ไฟล์บอกชื่อ/ไอคอนแอพ (manifest)
     Android/คอม: ไฟล์ปกติ (ไอคอนเปิดหน้าแรก ./ — ใช้ที่เก็บเดียวกับ Chrome อยู่แล้ว · ห้ามใส่ลิงก์ส่วนตัวในหน้าแรก: Chrome ส่งข้อมูลไอคอนไปเก็บที่ Google)
     iPhone/iPad: ไอคอนบนหน้าจอมีที่เก็บแยกจาก Safari (เริ่มว่าง) → ใช้ไฟล์ที่ไม่ระบุหน้าแรก = ไอคอนเปิดหน้าที่กดเพิ่มไว้ รวม #o= (ใส่ลิงก์ให้เอง)
       iPhone อ่านไฟล์นี้ครั้งเดียวต่อหน้า แล้วจำที่อยู่หน้าตอนอ่านเสร็จ → ใส่หลังเติม #o= แล้วเท่านั้น (ดู boot) */
  function addManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    var l = document.createElement("link");
    l.rel = "manifest";
    l.href = IOS ? "manifest-ios.webmanifest" : "manifest.webmanifest";
    document.head.appendChild(l);
  }
  if (!IOS) addManifest();
  // เปิดแอพซ้อนอีกหน้าต่าง (คอม / iPad) — หน้าใหม่สุดใช้ได้หน้าเดียว · หน้าเก่าหยุดส่งและหยุดเขียน (ไม่งั้นเลขลำดับในที่เก็บย้อนได้)
  var STALE = false, STALE_MSG = "แอพนี้เปิดอยู่อีกหน้าต่าง — ใช้หน้าต่างล่าสุด หรือแตะเพื่อใช้หน้านี้แทน";

  // ── ตัวช่วย (แบบ Json.kt: ไม่มีค่า = "" / false / 0) ──
  function s(o, k) { return !o || o[k] === undefined || o[k] === null ? "" : String(o[k]); }
  function b(o, k) { return !!o && (o[k] === true || o[k] === "true"); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function clip(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n) : t; }
  function ok(o) { var r = { ok: true }; for (var k in o || {}) r[k] = o[k]; return r; }
  function fail(m) { return { ok: false, error: m ? String(m) : "เกิดข้อผิดพลาด" }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nowText() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  // ── ที่เก็บในเครื่อง (IndexedDB) · เขียนทีละชุดตามลำดับ — ชุดเดียว = ลงพร้อมกันทั้งหมด หรือไม่ลงเลย ──
  //   iPhone ตัดการเชื่อมที่เก็บได้ตอนแอพพักอยู่เบื้องหลัง → เปิดใหม่เองแล้วทำซ้ำ 1 ครั้ง (ชุดที่ล้ม = ไม่ลงเลย ทำซ้ำได้ไม่เบิ้ล)
  var DBP = null, WQ = Promise.resolve();
  function db() {
    if (!DBP) DBP = new Promise(function (res, rej) {
      var r = indexedDB.open("att3s", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () {
        var d = r.result;
        d.onclose = function () { DBP = null; };
        d.onversionchange = function () { d.close(); DBP = null; };
        res(d);
      };
      r.onerror = function () { rej(r.error || new Error("เปิดที่เก็บในมือถือไม่ได้")); };
    }).catch(function (e) { DBP = null; throw e; });
    return DBP;
  }
  function dbErr(e, what) {
    return new Error(e && e.name === "QuotaExceededError" ? "ที่เก็บในมือถือเต็ม — ลบรูป/แอพที่ไม่ใช้ แล้วลองใหม่"
      : what + " — ปิดแอพแล้วเปิดใหม่" + (e && e.name ? " (" + e.name + ")" : ""));
  }
  // ทำงานกับที่เก็บ 1 ชุด: body(st) สั่งอ่าน/เขียน แล้วคืนตัวรับผล · ล้มเพราะการเชื่อมหลุด = เปิดใหม่แล้วทำอีกครั้ง
  function withTx(mode, body, what) {
    function go(left) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t;
          try { t = d.transaction("kv", mode); } catch (e) { rej(e); return; }
          var out = body(t.objectStore("kv"));
          t.oncomplete = function () { res(out ? out() : undefined); };
          t.onabort = function () { rej(t.error || new Error("AbortError")); };
        });
      }).catch(function (e) {
        if (left > 0 && !(e && e.name === "QuotaExceededError")) { DBP = null; return go(left - 1); }
        throw dbErr(e, what);
      });
    }
    return go(1);
  }
  // puts = { คีย์: ค่า (ถ่ายสำเนาแล้ว) } · dels = [คีย์] · มีหน้าต่างใหม่เปิดแอพแล้ว (STALE) = ห้ามเขียนทับของหน้าใหม่
  function save(puts, dels) {
    var p = WQ.then(function () {
      if (STALE) throw new Error(STALE_MSG);
      return withTx("readwrite", function (st) {
        (dels || []).forEach(function (k) { st.delete(k); });
        Object.keys(puts || {}).forEach(function (k) { st.put(puts[k], k); });
      }, "บันทึกในมือถือไม่ได้");
    });
    WQ = p.catch(function () {});
    return p;
  }

  var S = { cfg: {}, base: null, q: [] }, READY = null, ADDING = {};   // ADDING = รหัสคำสั่งที่กำลังลงที่เก็บ (กันกดซ้ำระหว่างรอ)
  var LAST_ADD_FAIL = 0;   // เวลาที่บันทึกคำสั่งลงที่เก็บไม่ได้ครั้งล่าสุด (ดู lapp/dismiss)
  function init() {
    if (!READY) READY = withTx("readonly", function (st) {
      var got = {}, r = st.openCursor();
      r.onsuccess = function () { var c = r.result; if (c) { got[c.key] = c.value; c.continue(); } };
      return function () { return got; };
    }, "อ่านที่เก็บในมือถือไม่ได้").then(function (got) {
      S.cfg = obj(got.cfg) || {};
      S.base = typeof got.base === "string" && got.base.charAt(0) === "{" ? got.base : null;
      var seen = {};
      S.q = Object.keys(got).filter(function (k) { return k.indexOf("q:") === 0; }).sort().map(function (k) { return got[k]; })
        .filter(function (c) { var l = s(c, "lid"); if (!l || seen[l]) return false; seen[l] = 1; return true; });
    }, function (e) { READY = null; throw e; });
    return READY;
  }
  function qKey(c) { return "q:" + ("0000000" + num(c.seq)).slice(-8) + "-" + s(c, "lid"); }
  function saveCfg() { return save({ cfg: clone(S.cfg) }); }
  function byState(st) { return S.q.filter(function (c) { return s(c, "state") === st; }); }

  // ── AttStore ──
  var St = {
    link: function () { return s(S.cfg, "url") && s(S.cfg, "key") ? { url: s(S.cfg, "url"), key: s(S.cfg, "key") } : null; },
    /* เว็บตัวใหม่ (ไม่ใช่แค่เปลี่ยนรหัส) = ชีตชุดเดิมใช้ไม่ได้ ดึงใหม่ทั้งชุด · ยังมีของรอส่ง/ไม่ผ่านของเว็บเดิม = ไม่ยอม (กันส่งผิดเว็บ) */
    setLink: function (url, key) {
      var old = s(S.cfg, "url"), dels = [];
      if (old && old !== url) {
        var left = S.q.filter(function (c) { return s(c, "state") !== "sent"; }).length;
        if (left > 0) throw new Error("ยังมีรายการของเว็บเดิมค้างอยู่ " + left + " รายการ — ส่งให้หมด/ทิ้งก่อน แล้วค่อยเปลี่ยนเว็บ");
        S.q.forEach(function (c) { dels.push(qKey(c)); });
        S.q = [];
        dels.push("base");
        S.base = null;
        delete S.cfg.rev; delete S.cfg.dig; delete S.cfg.baseRev;
      }
      S.cfg.url = url; S.cfg.key = key; delete S.cfg.needLink;
      return save({ cfg: clone(S.cfg) }, dels);
    },
    needLink: function () { return s(S.cfg, "needLink"); },
    setNeedLink: function (m) { if (s(S.cfg, "needLink") !== m) { S.cfg.needLink = m; saveCfg().catch(function () {}); } },
    cfgVal: function (k) { return s(S.cfg, k); },
    dig: function () { return obj(S.cfg.dig) ? clone(S.cfg.dig) : {}; },
    setLastOk: function () { S.cfg.lastOk = nowText(); return saveCfg(); },
    hasBase: function () { return S.base !== null; },
    baseRev: function () { return s(S.cfg, "baseRev"); },

    /* ได้ชีตจากเว็บ (เฉพาะชีตที่เปลี่ยน) → รวมกับชุดเดิม · ชีตที่ไม่ได้ส่งมาและไม่มีในชุดเดิม = ดึงใหม่ทั้งชุดรอบหน้า
       pullSeq = เลขคำสั่งล่าสุด ณ ตอนเริ่มดึง — คำสั่งที่ส่งสำเร็จก่อนนั้นอยู่ในชีตชุดนี้แล้ว (เลิกคิดซ้ำ) */
    putBase: function (r, pullSeq) {
      var old = {};
      if (S.base) { try { old = obj(JSON.parse(S.base).sheets) || {}; } catch (e) {} }
      var got = obj(r.sheets) || {}, order = Array.isArray(r.order) ? r.order : [], sheets = {};
      for (var i = 0; i < order.length; i++) {
        var name = order[i] === null || order[i] === undefined ? "" : String(order[i]);
        var rows = Array.isArray(got[name]) ? got[name] : Array.isArray(old[name]) ? old[name] : null;
        if (!rows) {
          delete S.cfg.dig;
          saveCfg().catch(function () {});
          throw new Error("ข้อมูลชีต \"" + name + "\" ไม่ครบ — ดึงใหม่ทั้งชุด");
        }
        sheets[name] = rows;
      }
      St.stripSecrets(sheets);
      var text = JSON.stringify({ rev: s(r, "rev"), build: s(r, "build"), order: order, sheets: sheets, ctx: obj(r.ctx) || { props: { OWNER_KEY: "local" } } });
      // ลงที่เก็บก่อน แล้วค่อยเปลี่ยนในหน่วยความจำ (แบบ Kotlin เขียน base.json ก่อน) — ลงไม่ได้ (ที่เก็บเต็ม) = ทุกอย่างยังเป็นชุดเดิม ดึงใหม่รอบหน้า
      //   ระหว่างรอลง คำสั่งอื่นอาจบันทึก cfg ที่ยังเป็นลายนิ้วมือชุดเดิม = รอบหน้าเว็บส่งชีตมามากกว่าที่ต้องใช้ (ไม่ขาด)
      var nc = clone(S.cfg);
      nc.rev = s(r, "rev"); nc.build = s(r, "build"); nc.dig = obj(r.dig) || {};
      nc.baseRev = "B" + Date.now().toString(36) + (num(S.cfg.seq) + 1).toString(36);
      var drop = {}, dels = [];
      S.q.forEach(function (c) { if (s(c, "state") === "sent" && num(c.sentSeq) <= pullSeq) { drop[s(c, "lid")] = 1; dels.push(qKey(c)); } });
      return save({ base: text, cfg: nc }, dels).then(function () {
        S.base = text;
        S.cfg.rev = nc.rev; S.cfg.build = nc.build; S.cfg.dig = nc.dig; S.cfg.baseRev = nc.baseRev;
        S.q = S.q.filter(function (c) { return !drop[s(c, "lid")]; });
      });
    },
    // ชีตรายชื่อพนักงาน: คอลัมน์ "รหัสผ่าน" (ใช้ล็อกอินที่อื่น ตัวคิดเวลาทำงานไม่ได้อ่าน) → ไม่เก็บในมือถือ
    stripSecrets: function (sheets) {
      var emp = sheets["รายชื่อพนักงาน"], head = emp && emp[0];
      if (!Array.isArray(head)) return;
      var cols = [];
      head.forEach(function (h, i) { if (/รหัสผ่าน|password|pass/i.test(h === null || h === undefined ? "" : String(h))) cols.push(i); });
      for (var i = 1; i < emp.length; i++) {
        if (!Array.isArray(emp[i])) continue;
        cols.forEach(function (c) { if (c < emp[i].length) emp[i][c] = ""; });
      }
    },

    // ── คิวคำสั่ง ──
    nextSeq: function () { var n = num(S.cfg.seq) + 1; S.cfg.seq = n; return saveCfg().then(function () { return n; }); },
    lastSeq: function () { return num(S.cfg.seq); },
    /* รับคำสั่งจากหน้าแอพ (รหัสเดิมซ้ำ = ไม่ทำซ้ำ) · ตอบหลังลงที่เก็บแล้วเท่านั้น (เบิกเงินต้องไม่หายถ้าปิดแอพทันที)
       เข้าคิวส่ง (S.q) หลังลงที่เก็บสำเร็จ — ลงไม่ได้ = ไม่เคยส่งขึ้นเว็บ (หน้าแอพบอกว่าบันทึกไม่ได้ ไม่เบิ้ลถ้ากดใหม่) */
    addCmd: function (cmd) {
      var lid = s(cmd, "lid");
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(lid)) throw new Error("รหัสคำสั่งไม่ถูกต้อง");
      if (!/^[A-Za-z][A-Za-z0-9_.]{0,60}$/.test(s(cmd, "fn"))) throw new Error("ชื่อคำสั่งไม่ถูกต้อง");
      if (ADDING[lid] || S.q.some(function (c) { return s(c, "lid") === lid; })) return Promise.resolve(false);
      var n = num(S.cfg.seq) + 1;
      S.cfg.seq = n;
      var at = cmd.at === undefined || cmd.at === null || cmd.at === "" || !isFinite(Number(cmd.at)) ? Date.now() : Number(cmd.at);
      var c = { lid: lid, at: at, fn: s(cmd, "fn"), args: Array.isArray(cmd.args) ? clone(cmd.args) : [], label: clip(s(cmd, "label"), 120),
        state: "pending", tries: 0, seq: n };
      var puts = { cfg: clone(S.cfg) };
      puts[qKey(c)] = clone(c);
      ADDING[lid] = 1;
      return save(puts).then(function () { delete ADDING[lid]; S.q.push(c); return true; },
        function (e) { delete ADDING[lid]; LAST_ADD_FAIL = Date.now(); throw e; });
    },
    pending: function () { return byState("pending").map(clone); },
    pendingCount: function () { return byState("pending").length; },
    failedCount: function () { return byState("failed").length; },
    oldestPending: function () { var a = byState("pending").map(function (c) { return num(c.at); }); return a.length ? Math.min.apply(null, a) : 0; },
    // แก้สถานะคำสั่ง — หาตามรหัส ไม่เจอ (ถูกลบไประหว่างส่ง) = ไม่ทำอะไร
    update: function (lid, f) {
      var c = S.q.filter(function (x) { return s(x, "lid") === lid; })[0];
      if (!c) return Promise.resolve();
      f(c);
      var puts = {};
      puts[qKey(c)] = clone(c);
      return save(puts);
    },
    markSent: function (lid, sentSeq) { return St.update(lid, function (c) { c.state = "sent"; c.sentSeq = sentSeq; delete c.err; }); },
    markFailed: function (lid, err) { return St.update(lid, function (c) { c.state = "failed"; c.err = clip(err, 300); c.failAt = Date.now(); }); },
    // คำสั่งที่ชีตชุดล่าสุดยังไม่รวม (รอส่ง + ส่งแล้วรอดึง) — หน้าแอพคิดซ้ำทับชีต
    unmerged: function () {
      return S.q.filter(function (c) { var st = s(c, "state"); return st === "pending" || st === "sent"; })
        .map(function (c) { return { lid: s(c, "lid"), at: num(c.at), fn: s(c, "fn"), args: c.args || [], label: s(c, "label") }; });
    },
    // สรุปสั้น (ไม่มีข้อมูลคำสั่ง/รูป — หน้าแอพถามทุก 3 วิ) · rows = แถว (วันที่|รหัส) ที่คำสั่งแตะ — หน้าแอพห้ามแก้/ลบเบิกของแถวนั้นจนเว็บยืนยัน
    qBrief: function () {
      return S.q.filter(function (c) { return s(c, "state") !== "failed"; })
        .map(function (c) { return { lid: s(c, "lid"), fn: s(c, "fn"), state: s(c, "state"), label: s(c, "label"), rows: rowsOf(c) }; });
    },
    // ตอบหน้าแอพ (lapp/base): ชีต + เลขชุด + คำสั่งที่ยังไม่รวม พร้อมกัน (ต่อข้อความ ไม่แปลงชีตก้อนใหญ่ซ้ำ)
    baseResponse: function () {
      if (S.base === null) return null;
      return "{\"ok\":true,\"baseRev\":" + JSON.stringify(s(S.cfg, "baseRev")) + ",\"q\":" + JSON.stringify(St.unmerged()) + ",\"base\":" + S.base + "}";
    },
    failedBrief: function () {
      return byState("failed").map(function (c) { return { lid: s(c, "lid"), fn: s(c, "fn"), label: s(c, "label"), err: s(c, "err"), at: num(c.failAt) }; });
    },
    // รายการไม่ผ่านพร้อมข้อมูลเต็ม (รวมรูป) — ให้หน้าแอพเปิดฟอร์มเดิมให้กดทำใหม่
    failedFull: function () { return byState("failed").map(clone); },
    dismiss: function (lids) {
      var dels = [];
      S.q = S.q.filter(function (c) {
        if (s(c, "state") === "failed" && lids.indexOf(s(c, "lid")) >= 0) { dels.push(qKey(c)); return false; }
        return true;
      });
      return dels.length ? save({}, dels) : Promise.resolve();
    }
  };
  function rowsOf(c) {
    var p = obj(Array.isArray(c.args) ? c.args[1] : null);
    if (!p) return [];
    var list = Array.isArray(p.changes) ? p.changes.filter(obj) : [p], out = [];
    list.forEach(function (x) { var k = s(x, "date") + "|" + s(x, "id"); if (out.indexOf(k) < 0) out.push(k); });
    return out;
  }

  // ── AttSync: คุยกับเว็บ (ทางเข้าโปรแกรมร้าน 95_pos.gs doPost) ทีละรอบ ──
  //   ① ส่งคำสั่งที่ค้างตามลำดับที่กด (ติดคำสั่งแรก = หยุดรอ ไม่ข้ามลำดับ) ② ถามเลขรุ่น (ทุก 1 นาที) → เปลี่ยน = ดึงชีต (เฉพาะชีตที่เปลี่ยน)
  function Retry(m) { this.message = m; }
  Retry.prototype = Object.create(Error.prototype);
  function Offline(m) { this.message = m; }   // ต่อเว็บไม่ได้ / เน็ตช้า
  Offline.prototype = Object.create(Retry.prototype);
  function Busy(m) { this.message = m; }      // เว็บทั้งเว็บสะดุด (ตอบ 500 / ผิดรูปแบบ / ยังไม่รองรับ)
  Busy.prototype = Object.create(Retry.prototype);

  var REV_EVERY = 60000, SAFETY = 30 * 60000, RETRY_WAIT = 30000;
  var GIVE_UP_TRIES = 60;            // เว็บไม่ว่าง (กำลังทำ / ล็อก) ติดกันเกินนี้ และค้างเกิน 2 วัน = ย้ายไปกองไม่ผ่าน (ไม่ทิ้ง)
  var GIVE_UP_ODD = 20;              // ข้อผิดพลาดอื่นซ้ำ ๆ ~10 นาที = ย้ายไปกองไม่ผ่าน ไม่ขวางรายการถัดไป
  var STALE_MS = 60 * 3600000;       // ส่งครั้งแรกนานเกิน 2 วันครึ่ง (เว็บจำผล 3 วัน) = ไม่ส่งซ้ำเอง
  var err = "", lastRev = 0, lastPull = 0, lastFresh = 0, forcePull = false, checkNow = false, retryAt = 0;

  function status(fresh) {
    if (fresh && Date.now() - lastFresh > 20000) { lastFresh = Date.now(); checkNow = true; kick(); }
    return ok({ ready: St.hasBase(), baseRev: St.baseRev(), url: !!St.link(), err: err, lastOk: St.cfgVal("lastOk"), q: St.qBrief(),
      failed: St.failedBrief(), build: St.cfgVal("build"), needLink: St.needLink(), oldest: St.oldestPending() });
  }
  function forceSync() { forcePull = true; checkNow = true; retryAt = 0; kick(); }
  function changed() { try { if (typeof window.appChanged === "function") window.appChanged(); } catch (e) {} }

  // วงรอบตอนเปิดแอพ (เฉพาะหน้า app.html) · ทำทีละรอบ — สั่งระหว่างรอบ = ทำรอบใหม่ทันทีที่เสร็จ
  var looping = false, running = false, again = false, timer = 0;
  function startLoop() { looping = true; checkNow = true; kick(); }
  function kick() {
    if (!looping) return;
    if (running) { again = true; return; }
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
  }
  function tick() {
    if (!looping || running) return;
    running = true; again = false;
    runOnce(false).catch(function () { return 30000; }).then(function (wait) {
      running = false;
      if (!looping) return;
      clearTimeout(timer);
      timer = setTimeout(tick, again ? 0 : wait);
      again = false;
    });
  }

  async function runOnce(check) {
    await init();
    var link = St.link();
    if (!link) return 60000;
    if (St.needLink()) { err = St.needLink(); return 60000; }
    var url = link.url, key = link.key, sentAny = false;
    try {
      // ① ส่งคำสั่ง (คำสั่งแรกยังไม่รู้ผล = หยุดทั้งรอบ ไม่ดึงชีต — ดึงตอนนี้จะได้ชีตที่มีรายการนั้นแล้วแต่ในเครื่องยังคิดซ้ำ = เห็นยอดเบิ้ล)
      var now = Date.now();
      if (now < retryAt && St.pendingCount() > 0) return Math.max(1000, retryAt - now);
      var list = St.pending().slice(0, 30);
      for (var i = 0; i < list.length; i++) {
        var c = list[i], lid = s(c, "lid");
        // ส่งไปแล้วแต่ไม่รู้ผลนานเกิน 2 วันครึ่ง — เว็บจำผลแค่ 3 วัน ส่งซ้ำอาจบันทึกเบิ้ล → ให้เจ้าของตรวจในหน้าเต็มก่อนทำใหม่
        if (num(c.try1At) > 0 && now - num(c.try1At) > STALE_MS) {
          await failed(c, "ส่งไปแล้วแต่ไม่รู้ผลนานเกิน 2 วัน — อาจขึ้นเว็บแล้ว ตรวจในหน้าเต็ม (⋯ → เปิดหน้าเต็ม) ก่อนกดทำใหม่");
          continue;
        }
        var r = await post(url, { key: key, req: { action: "cmd", lid: lid, fn: s(c, "fn"), args: Array.isArray(c.args) ? c.args : [] } }, 180000,
          function () {   // ข้อมูลน่าจะถึงเว็บแล้ว (ไม่ใช่แค่ไม่มีเน็ต) — นับอายุจากครั้งแรกที่ถึง
            if (!num(c.try1At)) { c.try1At = now; St.update(lid, function (x) { if (!num(x.try1At)) x.try1At = now; }).catch(function () {}); }
          });
        if (b(r, "ok")) {
          var res = obj(r.res) || {};
          if (b(res, "ok")) { await St.markSent(lid, await St.nextSeq()); sentAny = true; }
          else await failed(c, s(res, "error").trim() ? s(res, "error") : "เว็บไม่รับคำสั่งนี้");
          forcePull = true;
          continue;
        }
        var m = s(r, "error");
        if (m.indexOf("รหัสเจ้าของไม่ถูกต้อง") >= 0) { keyChanged(key); return 60000; }
        // ข้อความไทยที่ไม่ใช่ "ลองใหม่" = เว็บบอกว่าคำสั่งนี้ผิดรูปแบบ (ส่งซ้ำก็ไม่ผ่าน) · ไม่มีภาษาไทย = ระบบ Google สะดุด → ลองใหม่ (กติกาเดียวกับ posCmd_)
        if (!b(r, "retry") && /[฀-๿]/.test(m)) { await failed(c, m); continue; }
        // เว็บกำลังทำคำสั่งนี้ / ล็อกไม่ว่าง / ระบบ Google สะดุด — รอแล้วส่งรหัสเดิม (เว็บจำผล ไม่ทำซ้ำ)
        var busy = m.indexOf("กำลังทำอยู่") >= 0 || m.indexOf("มีคนอื่นกำลังบันทึก") >= 0, give = false;
        await St.update(lid, function (x) {
          x.tries = num(x.tries) + 1;
          x.err = clip(m, 300);
          give = busy ? x.tries >= GIVE_UP_TRIES && now - num(x.at) > 2 * 86400000 : x.tries >= GIVE_UP_ODD;
        });
        if (give) {
          await failed(c, (busy ? "เว็บไม่ว่างนานเกินไป" : "เว็บไม่รับคำสั่งนี้ซ้ำหลายครั้ง") + (m ? " (" + m + ")" : "") + " — ตรวจในหน้าเต็มก่อนกดทำใหม่ อาจบันทึกไปแล้ว");
          continue;
        }
        retryAt = now + RETRY_WAIT;
        err = m ? m + " — ส่งใหม่อัตโนมัติ" : "เว็บไม่ว่าง — ส่งใหม่อัตโนมัติ";
        return RETRY_WAIT;
      }
      // ② เลขรุ่น → ดึง
      var t = Date.now(), pull = forcePull || !St.hasBase() || t - lastPull > SAFETY;
      if (!pull && (check || checkNow || t - lastRev >= REV_EVERY)) {
        var rv = await post(url, { key: key, req: { action: "rev" } }, 30000);
        if (!b(rv, "ok")) throw new Busy(webErr(s(rv, "error"), key));
        lastRev = t;
        checkNow = false;
        if (s(rv, "rev") !== St.cfgVal("rev")) pull = true;
      }
      if (pull) {
        var pullSeq = St.lastSeq();
        var pr = await post(url, { key: key, req: { action: "pull", have: St.dig() } }, 180000);
        if (!b(pr, "ok")) throw new Busy(webErr(s(pr, "error"), key));
        await St.putBase(pr, pullSeq);
        lastPull = Date.now(); lastRev = lastPull;
        forcePull = false; checkNow = false;
        changed();
      }
      await St.setLastOk();
      if (retryAt <= Date.now()) err = "";
    } catch (e) {
      err = (e && e.message) || (e instanceof Offline ? "ไม่มีอินเทอร์เน็ต" : e instanceof Busy ? "เว็บไม่ว่าง" : "เกิดข้อผิดพลาด");
      return e instanceof Offline ? 30000 : 60000;
    } finally {
      if (sentAny) changed();
    }
    return St.pendingCount() > 0 ? 5000 : 30000;
  }

  function webErr(m, key) {
    if (m.indexOf("รหัสเจ้าของไม่ถูกต้อง") >= 0) { keyChanged(key); return "รหัสเจ้าของเปลี่ยนแล้ว"; }
    return m || "เว็บตอบผิดพลาด";
  }
  // รหัสเจ้าของบนเว็บเปลี่ยน → หยุดส่ง รอวางลิงก์ใหม่ · เจ้าของเพิ่งวางรหัสใหม่ระหว่างที่คำขอด้วยรหัสเก่ากำลังวิ่ง = ไม่นับ
  function keyChanged(usedKey) {
    var l = St.link();
    if (!l || l.key !== usedKey) return;
    St.setNeedLink("รหัสเจ้าของเปลี่ยนแล้ว — กด ⋯ → เปลี่ยนลิงก์เจ้าของ แล้ววางลิงก์ใหม่ (ของที่บันทึกไว้ยังอยู่ครบ)");
    err = St.needLink();
  }
  function failed(c, msg) { return St.markFailed(s(c, "lid"), msg); }

  // เช็คลิงก์ตอนวาง: ถามเลขรุ่นด้วยรหัสนั้น (ผ่าน = ใช้ได้)
  function check(url, key) { return post(url, { key: key, req: { action: "rev" } }, 30000); }

  /* ส่งถึงเว็บ: POST ข้อความธรรมดา (text/plain = ไม่มีการถามสิทธิ์ข้ามเว็บล่วงหน้า) → Apps Script ส่งต่อ (302) → fetch ตามไปเอง
     wrote() = ข้อมูลน่าจะถึงเว็บแล้ว: ได้คำตอบ / รอนานจนหมดเวลา / หลุดกลางทางหลังรอเกิน 3 วิ (หลุดทันที = ยังไม่ถึง) */
  async function post(url, body, ms, wrote) {
    var ac = typeof AbortController === "function" ? new AbortController() : null, t0 = Date.now(), text;
    var to = setTimeout(function () { if (ac) ac.abort(); }, ms);
    try {
      var r = await fetch(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow", credentials: "omit", cache: "no-store", signal: ac ? ac.signal : undefined });
      if (wrote) wrote();
      if (!r.ok) throw new Busy("เว็บไม่ว่าง (ตอบ " + r.status + ") — ลองใหม่อัตโนมัติ");
      text = await r.text();
    } catch (e) {
      if (e instanceof Retry) throw e;
      var late = Date.now() - t0 > 3000;
      if (wrote && late) wrote();
      if (e && e.name === "AbortError") throw new Offline("เน็ตช้าเกินไป — ลองใหม่อัตโนมัติ");
      throw new Offline("ไม่มีอินเทอร์เน็ต — บันทึกในมือถือไว้ก่อน ส่งเองเมื่อมีเน็ต");
    } finally {
      clearTimeout(to);
    }
    var j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (!obj(j)) throw new Busy(/doPost/i.test(text) ? "เว็บเวลาทำงานยังไม่รองรับแอพนี้ (ต้องอัปเดตเว็บก่อน)" : "เว็บตอบกลับผิดรูปแบบ — ลองใหม่อัตโนมัติ");
    return j;
  }

  /* ลิงก์เจ้าของ: https://script.google.com/macros/s/<รหัสเว็บ>/exec?k=<รหัสเจ้าของ> (วางทั้งข้อความก็ได้)
     หรือพิมพ์แค่รหัสเจ้าของ → ใช้เว็บเวลาทำงานของร้าน (ATT_URL) · ถามเลขรุ่นด้วยรหัสนั้นก่อน ผ่าน = จำไว้
     เว็บแอพที่วางบนเว็บสาธารณะไม่ใส่ ATT_URL (ลิงก์นั้นเปิดดูเวลา/ยอดเบิกพนักงานได้โดยไม่ต้องมีรหัส) → ต้องวางทั้งลิงก์ */
  // ลิงก์เจ้าของ → { url, key } · ไม่ใช่ = null (เว็บ Google เท่านั้น — บนคอมรับเว็บจำลองในเครื่องด้วย)
  function ownerOf(text) {
    var u = null;
    try { u = new URL(String(text).replace(/[.,)"']+$/, "")); } catch (e) { return null; }
    var host = u.hostname, okHost = host === "script.google.com" || (DEV && (host === "localhost" || host === "127.0.0.1"));
    var key = (u.searchParams.get("k") || "").trim(), url = u.origin + u.pathname;
    return okHost && /\/exec$/.test(url) && key ? { url: url, key: key } : null;
  }
  // เว็บของร้านไหม: แฮชรหัสเว็บตรงกับที่ใส่ตอนสร้าง (บนคอม = เว็บจำลองผ่าน) — กันลิงก์ปลอมที่ชี้ไปเว็บคนอื่น
  function ours(url) {
    if (DEV) return Promise.resolve(true);
    var m = /\/s\/([^/]+)\/exec$/.exec(url);
    if (!m || !window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve(false);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1])).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("") === DEP_HASH;
    }, function () { return false; });
  }
  // ขอไม่ให้มือถือล้างที่เก็บเอง (iPhone ให้เฉพาะแอพที่เปิดจากไอคอน) · ได้แล้วไม่ขอซ้ำ
  function keepStore() {
    try {
      var sm = navigator.storage;
      if (sm && sm.persist && sm.persisted) sm.persisted().then(function (p) { return p || sm.persist(); }).catch(function () {});
    } catch (e) {}
  }
  async function setLink(text) {
    var t = String(text || "").trim();
    var orKey = ATT_URL ? " — หรือพิมพ์แค่รหัสเจ้าของก็ได้" : "";
    if (!t) return fail(ATT_URL ? "ยังไม่ได้วางลิงก์ / พิมพ์รหัส" : "ยังไม่ได้วางลิงก์เจ้าของ");
    var url = ATT_URL, key = t, m = t.match(/https?:\/\/\S+/);
    if (m) {
      var o = ownerOf(m[0]);
      if (!o) return fail("ลิงก์นี้ไม่ใช่ลิงก์เจ้าของ (ต้องมี ?k= ต่อท้าย)" + orKey);
      url = o.url; key = o.key;
      if (!(await ours(url))) return fail("ลิงก์นี้ไม่ใช่ของเว็บเวลาทำงานร้านเรา — ขอลิงก์เจ้าของจากหน้าเว็บเวลาทำงาน");
    } else if (!ATT_URL) {
      return fail("วางลิงก์เจ้าของทั้งลิงก์ (ขึ้นต้น https://script.google.com… ลงท้าย ?k=…) — แบบเว็บแอพพิมพ์แค่รหัสไม่ได้");
    } else if (t.indexOf(" ") >= 0 || t.length < 6 || t.length > 64) {
      return fail("รหัสเจ้าของไม่ถูกต้อง — วางลิงก์ที่มี ?k= หรือพิมพ์รหัสเจ้าของ");
    }
    try {
      var r = await check(url, key);
      if (!b(r, "ok")) return fail(s(r, "error").indexOf("รหัสเจ้าของ") >= 0 ? "รหัสเจ้าของไม่ถูกต้อง — ตรวจรหัสอีกครั้ง" : s(r, "error"));
      await St.setLink(url, key);
      forceSync();
      keepStore();
      return ok();
    } catch (e) {
      if (e instanceof Offline) return fail("ไม่มีอินเทอร์เน็ต — ต่อเน็ตแล้วกดใหม่");
      return fail(e && e.message);
    }
  }

  // ── Core.api: หน้าแอพเรียกผ่าน ShopAndroid.call ──
  async function api(path, body) {
    if (STALE) return JSON.stringify(fail(STALE_MSG));
    try {
      await init();
      var bd = body ? JSON.parse(body) : {}, p = String(path).split("?")[0];
      var fresh = String(path).indexOf("?") >= 0 && String(path).slice(String(path).indexOf("?") + 1).split("&").indexOf("fresh=1") >= 0;
      switch (p) {
        case "lapp/state": return JSON.stringify(status(fresh));
        case "lapp/base": return St.baseResponse() || JSON.stringify(fail("ยังไม่ได้ข้อมูลจากเว็บ"));
        case "lapp/cmd": {
          var cmd = obj(bd && bd.cmd);
          if (!cmd) throw new Error("ไม่มีคำสั่ง");
          await St.addCmd(cmd);
          kick();
          return JSON.stringify(status(false));
        }
        case "lapp/dismiss": {
          /* "ทำใหม่" = หน้าแอพส่งคำสั่งใหม่แล้วทิ้งรายการเดิมทันที (ไม่รอผลบันทึก) — รอคำสั่งที่ส่งมาก่อนลงที่เก็บให้เสร็จก่อน
             เพิ่งบันทึกคำสั่งไม่ได้ (ที่เก็บเต็ม) = ไม่ทิ้งรายการเดิม (มีรูปใบเบิก) ให้ยังกดทำใหม่ได้ */
          var asked = Date.now();
          await WQ;
          if (LAST_ADD_FAIL > asked - 5000) return JSON.stringify(status(false));
          await St.dismiss((Array.isArray(bd && bd.lids) ? bd.lids : []).map(function (x) { return x === null || x === undefined ? "" : String(x); }));
          return JSON.stringify(status(false));
        }
        case "lapp/sync": forceSync(); return JSON.stringify(status(false));
        case "att/failed": return JSON.stringify(ok({ items: St.failedFull() }));
        case "att/link": return JSON.stringify(await setLink(s(bd, "text")));
        case "att/pclink": return JSON.stringify(ok({ none: true }));   // ใส่ลิงก์จากคอมทางสาย USB มีแต่แอพ Android
        case "att/info": return JSON.stringify(ok({ version: VERSION, url: St.link() ? St.link().url : "", pending: St.pendingCount(),
          failed: St.failedCount(), lastOk: St.cfgVal("lastOk"), build: St.cfgVal("build") }));
        default: return JSON.stringify(fail("ไม่รู้จักคำสั่ง: " + path));
      }
    } catch (e) {
      return JSON.stringify(fail(e && e.message));
    }
  }

  // ── ShopAndroid แบบเว็บ (หน้าในกรอบใช้ตัวเดียวกันผ่าน parent.ShopAndroid) ──
  window.ShopAndroid = {
    call: function (id, path, body) {
      api(path, body).then(function (txt) { try { if (window.__apiDone) window.__apiDone(id, txt); } catch (e) {} });
    },
    ready: function () {},
    open: function (u) {
      try {
        if (/^(tel|mailto|line|geo):/i.test(String(u))) location.href = u;
        else window.open(u, "_blank", "noopener");
      } catch (e) {}
    },
    link: function () { return JSON.stringify({ ok: !!St.link(), version: VERSION }); },
    version: function () { return VERSION; }
  };
  window.WebCore = { init: init, hasLink: function () { return !!St.link(); }, version: VERSION };

  // ── เปิดซ้อนหลายหน้าต่าง: หน้าที่เพิ่งเปิดประกาศตัว → หน้าเก่าหยุด (แตะหน้าเก่า = โหลดใหม่ แล้วหน้านั้นกลายเป็นหน้าล่าสุดแทน) ──
  function becomeStale() {
    if (STALE) return;
    STALE = true; looping = false; clearTimeout(timer);
    function show() {
      if (document.getElementById("wcStale")) return;
      var d = document.createElement("div");
      d.id = "wcStale";
      d.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;"
        + "background:rgba(0,0,0,.75);color:#fff;font:600 16px/1.6 Prompt,sans-serif;text-align:center;cursor:pointer";
      d.textContent = "⚠ " + STALE_MSG;
      d.onclick = function () { location.reload(); };
      document.body.appendChild(d);
    }
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  }
  try {
    var ME = Date.now().toString(36) + Math.random().toString(36).slice(2), BC = new BroadcastChannel("att3s");
    BC.onmessage = function (e) { if (e.data && e.data.t === "hi" && e.data.me !== ME) becomeStale(); };
    BC.postMessage({ t: "hi", me: ME });
  } catch (e) {}

  // ── หน้าไหนก็เปิดเป็นหน้าแรกได้ (ไอคอนบนหน้าจอเปิดหน้าที่กดเพิ่มไว้) · เปิดที่เก็บไม่ได้ = บอกบนจอ แล้วลองใหม่เอง ──
  function bootErr(m) {
    function show() {
      var d = document.getElementById("wcErr");
      if (!d) {
        d = document.createElement("div");
        d.id = "wcErr";
        d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483646;padding:14px 16px;background:#fef2f2;color:#b91c1c;font:600 15px/1.6 Prompt,sans-serif;cursor:pointer";
        d.onclick = function () { location.reload(); };
        document.body.appendChild(d);
      }
      d.textContent = "⚠ " + m + " — แตะเพื่อลองใหม่";
    }
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  }
  /* ลิงก์ส่วนตัว = ที่อยู่หน้า + #o=<ลิงก์เจ้าของแบบ base64url> (base64 ไม่ใช่การซ่อน — ใครได้ที่อยู่นี้ = ได้สิทธิ์เจ้าของ)
     ใส่ในที่อยู่เฉพาะหน้าแอพใน Safari ของ iPhone: ตอนกด แชร์ → เพิ่มไปยังหน้าจอโฮม ไอคอนจำที่อยู่นี้ (ที่เก็บของไอคอนแยกจาก Safari และเริ่มว่าง)
       ที่อื่น (Android/คอม/แอพอื่น/ในไอคอนเอง) = ลบออกจากที่อยู่ (Chrome เก็บที่อยู่ในประวัติ/ซิงก์ขึ้น Google)
     เปิดที่อยู่ที่มี #o= ตอนที่เก็บว่าง: ในไอคอน iPhone = ใส่ให้เลย · ที่อื่น = ใส่ในช่องวางลิงก์ ให้กด เริ่มใช้งาน เอง (ตรวจกับเว็บ)
     รับเฉพาะลิงก์ของเว็บร้าน (ours) · ส่วนหลัง # ไม่ถูกส่งไปที่เว็บ GitHub · ที่เก็บมีลิงก์อยู่แล้ว = ใช้ของที่เก็บ */
  function b64u(t) { return btoa(unescape(encodeURIComponent(t))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function hashLink() {
    var m = /^#(?:.*&)?o=([A-Za-z0-9_-]+)(?:&|$)/.exec(location.hash);
    if (!m) return null;
    try { return ownerOf(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { return null; }
  }
  function ownHash() { var l = St.link(); return l ? "#o=" + b64u(l.url + "?k=" + encodeURIComponent(l.key)) : ""; }
  function noHash() { try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) {} }
  function markHash() {
    var want = IOS && !STANDALONE && !IN_APP && PAGE === "app.html" ? ownHash() : "";
    var h = want || /^#(?:.*&)?o=/.test(location.hash) ? want : location.hash;
    if (location.hash !== h) try { history.replaceState(history.state, "", location.pathname + location.search + h); } catch (e) {}
  }
  // หน้าวางลิงก์ที่มาพร้อม #o= (ที่เก็บว่าง): ใส่ในช่องให้ (ของเว็บร้านเท่านั้น) แล้วลบออกจากที่อยู่
  function prefill() {
    var h = hashLink();
    if (!h) { if (/^#(?:.*&)?o=/.test(location.hash)) noHash(); return; }
    ours(h.url).then(function (ok) {
      function put() {
        var t = document.getElementById("t");
        if (ok && t && !t.value) t.value = h.url + "?k=" + h.key;
        noHash();
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put); else put();
    });
  }
  function boot(n) {
    init().then(function () {
      var h = IOS && STANDALONE && !St.link() && hashLink();
      return h ? ours(h.url).then(function (ok) { return ok ? St.setLink(h.url, h.key) : null; }) : null;
    }).then(function () {
      var d = document.getElementById("wcErr");
      if (d) d.parentNode.removeChild(d);
      var has = !!St.link();
      if (has) markHash();
      if (has && STANDALONE) keepStore();
      var ext = document.querySelector("a[data-ext]");   // ปุ่มเปิดในเบราว์เซอร์ (ขึ้นก่อนอ่านที่เก็บเสร็จ) — ใส่ลิงก์ส่วนตัวที่อ่านได้แล้ว
      if (ext) ext.href = extUrl();
      if (PAGE === "app.html" && !has) { location.replace("setup.html" + location.hash); return; }
      if (PAGE === "setup.html" && has && !/[?&]change=1/.test(location.search)) { location.replace("app.html" + location.hash); return; }
      if (PAGE === "index.html") { location.replace((has ? "app.html" : "setup.html") + location.hash); return; }
      if (PAGE === "setup.html" && !has) prefill();
      addManifest();
      if (PAGE === "app.html") startLoop();
    }, function (e) {
      bootErr("เปิดที่เก็บในมือถือไม่ได้ — ถ้าเปิดแบบส่วนตัว (Private) ให้เปิดแบบปกติ" + (e && e.message ? " (" + e.message + ")" : ""));
      if (n < 5) setTimeout(function () { boot(n + 1); }, 2000);
    });
  }
  boot(0);
  // กลับเข้าแอพ (สลับแอพ / ปลดล็อกจอ) = ถามเว็บเลย + ดูว่ามีรุ่นใหม่ไหม · เน็ตกลับมา = ส่งของที่ค้างเลย
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (looping) { checkNow = true; kick(); changed(); }
    swCheck();
  });
  window.addEventListener("online", function () { kick(); });
  // หน้าที่ถูกพักไว้ทั้งหน้า (ย้อนกลับ/สลับแอพ) แล้วคืนมา = ของในหน่วยความจำอาจเก่ากว่าที่เก็บ → โหลดใหม่
  window.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });

  /* ไฟล์หน้าเว็บเก็บในมือถือ (เปิดได้ตอนไม่มีเน็ต) · มีรุ่นใหม่ = มือถือโหลดไว้เบื้องหลัง แล้วรอจังหวะว่าง
     เปลี่ยนรุ่น = เฉพาะหน้าแอพ (app.html) ตอนไม่ได้เปิดฟอร์ม/กำลังบันทึก/อยู่หน้าเต็ม → สั่ง "skip" แล้วโหลดหน้าใหม่ 1 ครั้ง (ไฟล์ทั้งชุดเป็นรุ่นเดียวกัน)
     ดูตอน: เปิดแอพ · โหลดรุ่นใหม่เสร็จ · กลับเข้าแอพ (iPhone ไม่ค่อยปิดแอพจริง — รอแค่ตอนเปิดใหม่ อาจไม่ได้เปลี่ยนเลย) */
  var SW = "serviceWorker" in navigator && (location.protocol === "https:" || DEV), SW_SWITCHING = false;
  function quiet() {
    if (STALE || Object.keys(ADDING).length) return false;
    try {
      var w = document.getElementById("f").contentWindow, d = w.document;
      if (!/\/m\.html$/.test(w.location.pathname) || w.FORM || w.BUSY || w.FAIL_OPEN || w.PER) return false;
      if (/\bon\b/.test((d.getElementById("sheet") || {}).className || "")) return false;   // แผ่นล่าง (ฟอร์ม/เมนู) เปิดอยู่
    } catch (e) { return false; }
    return true;
  }
  function swApply(reg) {
    if (PAGE !== "app.html" || SW_SWITCHING || !reg || !reg.waiting || !navigator.serviceWorker.controller || !quiet()) return;
    SW_SWITCHING = true;
    navigator.serviceWorker.addEventListener("controllerchange", function () { location.reload(); });
    reg.waiting.postMessage("skip");
  }
  function swCheck() {
    if (!SW) return;
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return;
      swApply(reg);
      reg.update().catch(function () {});
    }).catch(function () {});
  }
  if (SW) {
    try {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
        reg.addEventListener("updatefound", function () {
          var w = reg.installing;
          if (w) w.addEventListener("statechange", function () { if (w.state === "installed") swApply(reg); });
        });
        swApply(reg);
      }).catch(function () {});
    } catch (e) {}
  }

  // ที่อยู่หน้านี้ (มี #o= แล้ว) + ?openExternalBrowser=1 ก่อน # — ปุ่มเปิดในเบราว์เซอร์ของ LINE
  function extUrl() { return location.pathname + location.search + (location.search ? "&" : "?") + "openExternalBrowser=1" + ownHash(); }
  // แถบล่างจอ ปิดได้ (ปิดแล้วไม่ขึ้นอีกจนปิดแอพ/แท็บ)
  function bar(id, html) {
    document.addEventListener("DOMContentLoaded", function () {
      try { if (sessionStorage.getItem(id)) return; } catch (e) {}
      var d = document.createElement("div");
      d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483645;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#fff7ed;color:#9a3412;border-top:1px solid #fdba74;font:400 14px/1.6 Prompt,sans-serif;box-shadow:0 -4px 16px rgba(0,0,0,.12)";
      d.innerHTML = "<span data-x style='float:right;padding:0 4px 8px 12px;font-size:22px;line-height:1;cursor:pointer'>×</span>" + html;
      document.body.appendChild(d);
      var keep = document.body.style.paddingBottom;   // เว้นที่ด้านล่างหน้า — แถบไม่บังปุ่มบันทึกของแผ่นล่าง
      function fit() { document.body.style.paddingBottom = d.parentNode ? d.offsetHeight + "px" : keep; }
      fit();
      window.addEventListener("resize", fit);
      d.querySelector("[data-x]").onclick = function () { d.parentNode.removeChild(d); window.removeEventListener("resize", fit); fit(); try { sessionStorage.setItem(id, "1"); } catch (e) {} };
      var a = d.querySelector("a[data-ext]");
      if (a) { a.href = extUrl(); a.onclick = function () { a.href = extUrl(); }; }
    });
  }

  /* เปิดอยู่ในแอพอื่น (LINE / Facebook / Instagram) = ที่เก็บของหน้าในแอพนั้นแยกจากเบราว์เซอร์ และอาจหายตอนปิด → ชวนเปิดในเบราว์เซอร์
     LINE: ต่อท้าย ?openExternalBrowser=1 = LINE เปิดในเบราว์เซอร์ของมือถือให้ (#o= ติดไปด้วย = ใส่ลิงก์ให้เอง — ถ้าไม่ติด วางในเบราว์เซอร์ครั้งเดียว) */
  if (IN_APP && (PAGE === "setup.html" || PAGE === "app.html")) {
    bar("wcInApp", "<b>เปิดอยู่ในแอพ " + IN_APP + "</b> — ปิดแล้วแอพอาจลืมลิงก์ ต้องวางใหม่<br>"
      + (IN_APP === "LINE"
        ? "<a data-ext style='display:inline-block;margin-top:6px;padding:8px 16px;border-radius:999px;background:#c2410c;color:#fff;font-weight:600;text-decoration:none'>เปิดในเบราว์เซอร์</a>"
        : "กด <b>⋯</b> มุมขวาบน → <b>เปิดในเบราว์เซอร์</b> (อย่ากด คัดลอกลิงก์/แชร์)"));
  }

  /* iPhone เปิดใน Safari (ยังไม่ได้เปิดจากไอคอน) — ไอคอนบนหน้าจอมีที่เก็บแยกจาก Safari
     วางลิงก์ก่อน แล้วค่อยเพิ่มลงหน้าจอจากหน้าแอพ = ไอคอนเปิดหน้าแอพพร้อม #o= → ใส่ลิงก์ให้เอง */
  if (IOS && !STANDALONE && !IN_APP && PAGE === "setup.html") document.addEventListener("DOMContentLoaded", function () {
    var box = document.querySelector(".box"), h = box && box.querySelector("h1");
    if (!h) return;
    var d = document.createElement("div");
    d.style.cssText = "margin:12px 0 4px;padding:12px 14px;border-radius:14px;border:1px solid #fdba74;background:rgba(251,146,60,.12);font-size:14px;font-weight:400;line-height:1.6";
    d.innerHTML = "<b>📲 ลงแอพในหน้าจอ (ทำครั้งเดียว)</b>"
      + "<ol><li>วางลิงก์เจ้าของด้านล่าง → กด <b>เริ่มใช้งาน</b></li>"
      + "<li>พอเข้าแอพแล้ว กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น — ไม่เห็นให้กด <b>•••</b> ก่อน) → <b>เพิ่มไปยังหน้าจอโฮม</b> → กด <b>เพิ่ม</b></li>"
      + "<li>ต่อไปเปิดจากไอคอน ⏱️ บนหน้าจอ — ไอคอนจำลิงก์ให้เอง</li></ol>"
      + "<small>ถ้าไอคอนยังถามลิงก์ ให้วางในไอคอนอีกครั้งเดียว (iPhone แยกที่เก็บของไอคอนกับ Safari)<br>"
      + "ในหน้าแชร์ กดแค่ เพิ่มไปยังหน้าจอโฮม — ห้ามกดส่ง/คัดลอก (ที่อยู่หน้าแอพมีลิงก์เจ้าของติดอยู่)</small>";
    h.parentNode.insertBefore(d, h.nextSibling);
  });
  if (IOS && !STANDALONE && !IN_APP && PAGE === "app.html") {
    bar("wcAddHome", "<b>📲 ลงแอพในหน้าจอ:</b> กด <b>แชร์</b> (ไม่เห็นให้กด <b>•••</b> ก่อน) → <b>เพิ่มไปยังหน้าจอโฮม</b> → <b>เพิ่ม</b> แล้วเปิดจากไอคอน ⏱️ (ไอคอนจำลิงก์ให้เอง)<br>"
      + "<small>ในหน้าแชร์ กดแค่ เพิ่มไปยังหน้าจอโฮม — ห้ามกดส่ง/คัดลอก (ที่อยู่หน้านี้มีลิงก์เจ้าของ)</small>");
  }
})();
