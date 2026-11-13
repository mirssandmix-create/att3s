/* แอพเวลาทำงาน: สร้างตัวคิดเบื้องหลังจากไฟล์เดียว (engine.js) ผ่าน Blob
   ไม่พึ่งการโหลดไฟล์ย่อยจากใน worker (importScripts) — บางรุ่นของ WebView ไม่ผ่านตัวแจกไฟล์ในแอพ
   ต้องโหลดหลัง LAPP_CFG และก่อน ../client.js */
(function () {
  var url = null, pending = null;
  LAPP_CFG.makeWorker = function () {
    if (url) return Promise.resolve(new Worker(url));
    if (!pending) pending = fetch("engine.js").then(function (r) {
      if (!r.ok) throw new Error("โหลดตัวคิดไม่ได้ (" + r.status + ")");
      return r.text();
    }).then(function (t) {
      url = URL.createObjectURL(new Blob([t], { type: "text/javascript" }));
      return url;
    }, function (e) { pending = null; throw e; });
    return pending.then(function (u) { return new Worker(u); });
  };
  /* หน้าเต็ม (แบบในคอม) ไม่มีที่ทำใหม่ — ส่งไม่ผ่าน = ชวนไปหน้ามือถือ (ไม่ลบรายการ/รูปที่เก็บไว้ทำใหม่) */
  if (!LAPP_CFG.onFail) LAPP_CFG.onFail = function (list, clicked) {
    var n = (list || []).length;
    if (confirm("⚠ มีรายการส่งขึ้นเว็บไม่ผ่าน " + n + " รายการ\nไปหน้ามือถือเพื่อดูและกดทำใหม่ไหม?")) location.href = "m.html";
  };
})();
