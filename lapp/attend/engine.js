/* แอพเวลาทำงาน: ตัวคิดเบื้องหลังไฟล์เดียว — สร้างด้วย tools/sync_attend.py จาก ShopPOS www/lapp (ห้ามแก้ตรง ๆ) */
/* สร้างจาก PoomCode/ระบบคิดเงินเดือนลูกน้อง (รหัส.gs + 01_core.gs + 03_time.gs + 90_api.gs + 95_pos.gs) ด้วย tools/lapp-sync.py — ห้ามแก้ไฟล์นี้ตรง ๆ · 20d5253b14 */
self.LAPP_APP = {
  okResult: function (r) { return !(r && typeof r === "object" && r.ok === false); },   // api() ไม่สำเร็จ = ไม่ส่งขึ้นเว็บ
  relocate: function (fn, a) { if (fn === "api" && a) posRelocate_(a[0], a[1]); },   // แถวเลื่อน (ปิดยอดแล้ว) = หาแถวใหม่ก่อนคิดซ้ำ
  build: function () { return typeof LAPP_BUILD_ === "string" ? LAPP_BUILD_ : typeof POS_BUILD_ === "string" ? POS_BUILD_ : ""; },
  reset: function () { _ss = {}; _rows = {}; _dCache = {}; _tCache = {}; _specialSet_ = null; _payCtx_ = null; _settleIdx_ = null; _rowAt = {}; _mode = "view"; }   // แบบเว็บ: เริ่มใหม่ทุกครั้งที่เรียก
};
/* ---- gas.js ---- */
/* ShopPOS — แอพเว็บของร้านในเครื่อง: จำลองบริการ Google Apps Script ที่โค้ดเว็บใช้ (ตัวกลางชุดเดียว ใช้ทุกแอพ)
   โค้ดเว็บ (.gs ชุดเดียวกับบนเว็บ) อ่าน/เขียน "ชีต" ในหน่วยความจำ — ชีตตั้งต้น = ค่าที่ตัวโปรแกรมดึงจากเว็บ
   ใช้ในตัวทำงานเบื้องหลัง (worker) เท่านั้น — ตัวแปรของโค้ดเว็บไม่ชนกับหน้าจอ
   · วันที่ในชีต = Date จริง (ส่งมาเป็น {"$d": ms}) · จัดรูปวันที่ด้วยเขตเวลาที่ขอ (ปกติ Asia/Bangkok) เหมือน Utilities.formatDate
   · ต้องใช้เน็ต (อ่านรูปด้วย AI / ดึงไฟล์จาก Drive) = โยน GasOnline → หน้าจอให้ตัวโปรแกรมถามเว็บแทน
   · รหัสสุ่ม (Utilities.getUuid) ของคำสั่งแก้ไข = คิดจากรหัสคำสั่ง (GAS.seed) → ได้รหัสเดียวกับที่เว็บได้ตอนทำคำสั่งเดียวกัน */
var GAS = { book: null, props: { script: {}, user: {}, doc: {} }, cache: {}, seed: "", seedN: 0, files: {}, fileN: 0, tz: "Asia/Bangkok", ctx: {} };

function GasOnline(what) { var e = new Error((what || "คำสั่งนี้") + "ต้องต่ออินเทอร์เน็ต"); e.name = "GasOnline"; return e; }

/* ---------- ชีต ---------- */
function GasSheet(book, name, rows) { this.book = book; this.name = name; this.v = rows || []; }
GasSheet.prototype.getName = function () { return this.name; };
GasSheet.prototype.setName = function (n) { this.name = String(n); return this; };
GasSheet.prototype.getParent = function () { return this.book; };
GasSheet.prototype.getSheetId = function () { return this.book.list.indexOf(this) + 1; };
GasSheet.prototype.getLastRow = function () {
  for (var i = this.v.length - 1; i >= 0; i--) {
    var r = this.v[i];
    if (r) for (var j = 0; j < r.length; j++) if (r[j] !== "" && r[j] != null) return i + 1;
  }
  return 0;
};
GasSheet.prototype.getLastColumn = function () {
  var m = 0;
  for (var i = 0; i < this.v.length; i++) {
    var r = this.v[i];
    if (!r) continue;
    for (var j = r.length - 1; j >= m; j--) if (r[j] !== "" && r[j] != null) { m = j + 1; break; }
  }
  return m;
};
GasSheet.prototype.getMaxRows = function () { return Math.max(this.v.length, 1000); };
GasSheet.prototype.getMaxColumns = function () { return Math.max(this.getLastColumn(), 26); };
GasSheet.prototype.cell = function (r, c) { var row = this.v[r - 1]; var x = row ? row[c - 1] : undefined; return x == null ? "" : x; };
GasSheet.prototype.put = function (r, c, x) {
  while (this.v.length < r) this.v.push([]);
  var row = this.v[r - 1] || (this.v[r - 1] = []);
  while (row.length < c - 1) row.push("");
  row[c - 1] = x == null ? "" : x;
};
function gasCol(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n; }
function gasColName(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
// "P1" · "A:D" · "B:B" · "A2:C5" · "2:4"
GasSheet.prototype.getRange = function (a, b, c, d) {
  if (typeof a === "string") {
    var s = a.indexOf("!") >= 0 ? a.slice(a.indexOf("!") + 1) : a;
    var m = /^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(s.toUpperCase());
    if (!m || (!m[1] && !m[2])) throw new Error("ช่วงไม่ถูกต้อง: " + a);
    var c1 = m[1] ? gasCol(m[1]) : 1, r1 = m[2] ? +m[2] : 1, c2, r2;
    if (m[3] === undefined) { c2 = c1; r2 = r1; }                  // ช่องเดียว "P1"
    else {
      c2 = m[3] ? gasCol(m[3]) : this.getMaxColumns();             // "A:D" = ทั้งคอลัมน์ · "2:4" = ทั้งแถว
      r2 = m[4] ? +m[4] : Math.max(this.v.length, 1);
      if (!m[1]) { c1 = 1; c2 = this.getMaxColumns(); }
    }
    return new GasRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  }
  if (!(a >= 1) || !(b >= 1)) throw new Error("ตำแหน่งแถว/คอลัมน์ไม่ถูกต้อง (" + a + ", " + b + ")");
  var nr = c == null ? 1 : c, nc = d == null ? 1 : d;
  if (!(nr >= 1) || !(nc >= 1)) throw new Error("จำนวนแถว/คอลัมน์ต้องมากกว่า 0");
  return new GasRange(this, a, b, nr, nc);
};
GasSheet.prototype.getDataRange = function () { return new GasRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); };
GasSheet.prototype.appendRow = function (arr) {
  var r = this.getLastRow() + 1;
  for (var j = 0; j < arr.length; j++) this.put(r, j + 1, arr[j]);
  return this;
};
GasSheet.prototype.deleteRow = function (r) { return this.deleteRows(r, 1); };
GasSheet.prototype.deleteRows = function (r, n) { if (r >= 1 && r <= this.v.length) this.v.splice(r - 1, n || 1); return this; };
GasSheet.prototype.insertRowsBefore = function (r, n) { var a = []; for (var i = 0; i < (n || 1); i++) a.push([]); this.v.splice.apply(this.v, [r - 1, 0].concat(a)); return this; };
GasSheet.prototype.insertRowBefore = function (r) { return this.insertRowsBefore(r, 1); };
GasSheet.prototype.insertRowsAfter = function (r, n) { return this.insertRowsBefore(r + 1, n); };
GasSheet.prototype.insertRowAfter = function (r) { return this.insertRowsBefore(r + 1, 1); };
GasSheet.prototype.createTextFinder = function (t) { return this.getDataRange().createTextFinder(t); };
GasSheet.prototype.clear = function () { this.v = []; return this; };
GasSheet.prototype.clearContents = GasSheet.prototype.clear;
["setFrozenRows", "setFrozenColumns", "hideSheet", "showSheet", "setColumnWidth", "setColumnWidths", "autoResizeColumns", "activate", "setTabColor",
 "hideColumns", "showColumns", "setRowHeight", "protect"].forEach(function (k) { GasSheet.prototype[k] = function () { return this; }; });
GasSheet.prototype.isSheetHidden = function () { return false; };
GasSheet.prototype.getFrozenRows = function () { return 1; };

/* ---------- ช่วงเซลล์ ---------- */
function GasRange(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
GasRange.prototype.getValues = function () {
  var out = [];
  for (var i = 0; i < this.nr; i++) {
    var row = [];
    for (var j = 0; j < this.nc; j++) { var x = this.sh.cell(this.r + i, this.c + j); row.push(x instanceof Date ? new Date(x.getTime()) : x); }
    out.push(row);
  }
  return out;
};
GasRange.prototype.getDisplayValues = function () {
  return this.getValues().map(function (r) { return r.map(function (x) { return x instanceof Date ? Utilities.formatDate(x, GAS.tz, "dd/MM/yyyy") : String(x); }); });
};
GasRange.prototype.getValue = function () { var x = this.sh.cell(this.r, this.c); return x instanceof Date ? new Date(x.getTime()) : x; };
GasRange.prototype.getDisplayValue = function () { return this.getDisplayValues()[0][0]; };
GasRange.prototype.setValues = function (vals) {
  if (!vals || vals.length !== this.nr || (vals[0] || []).length !== this.nc)
    throw new Error("จำนวนแถว/คอลัมน์ไม่ตรงกับช่วงที่เลือก (" + this.nr + "×" + this.nc + ")");
  for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.sh.put(this.r + i, this.c + j, vals[i][j]);
  return this;
};
GasRange.prototype.setValue = function (x) {
  for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.sh.put(this.r + i, this.c + j, x);
  return this;
};
GasRange.prototype.clearContent = function () {
  for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++)
    if (this.sh.v[this.r + i - 1]) this.sh.put(this.r + i, this.c + j, "");
  return this;
};
GasRange.prototype.clear = GasRange.prototype.clearContent;
GasRange.prototype.getRow = function () { return this.r; };
GasRange.prototype.getColumn = function () { return this.c; };
GasRange.prototype.getLastRow = function () { return this.r + this.nr - 1; };
GasRange.prototype.getLastColumn = function () { return this.c + this.nc - 1; };
GasRange.prototype.getNumRows = function () { return this.nr; };
GasRange.prototype.getNumColumns = function () { return this.nc; };
GasRange.prototype.getSheet = function () { return this.sh; };
GasRange.prototype.getA1Notation = function () {
  var a = gasColName(this.c) + this.r;
  return this.nr === 1 && this.nc === 1 ? a : a + ":" + gasColName(this.c + this.nc - 1) + (this.r + this.nr - 1);
};
GasRange.prototype.offset = function (dr, dc, nr, nc) { return new GasRange(this.sh, this.r + dr, this.c + dc, nr || this.nr, nc || this.nc); };
// ค้นข้อความ (ค่าทั้งช่อง / ส่วนหนึ่ง) — คืนช่องที่เจอ
GasRange.prototype.createTextFinder = function (text) {
  var rg = this, whole = false, cas = false;
  var f = {
    matchEntireCell: function (b) { whole = !!b; return f; },
    matchCase: function (b) { cas = !!b; return f; },
    useRegularExpression: function () { return f; },
    ignoreDiacritics: function () { return f; },
    findAll: function () {
      var t = String(text), out = [];
      for (var i = 0; i < rg.nr; i++) for (var j = 0; j < rg.nc; j++) {
        var x = rg.sh.cell(rg.r + i, rg.c + j);
        var s = x instanceof Date ? Utilities.formatDate(x, GAS.tz, "dd/MM/yyyy") : String(x);
        var a = cas ? s : s.toLowerCase(), b = cas ? t : t.toLowerCase();
        if (whole ? a === b : a.indexOf(b) >= 0) out.push(new GasRange(rg.sh, rg.r + i, rg.c + j, 1, 1));
      }
      return out;
    },
    findNext: function () { var a = f.findAll(); return a.length ? a[0] : null; }
  };
  return f;
};
["setNumberFormat", "setNumberFormats", "setFontWeight", "setFontWeights", "setBackground", "setBackgrounds", "setFontColor", "setFontColors",
 "setNote", "clearNote", "setWrap", "setHorizontalAlignment", "setVerticalAlignment", "setFontSize", "setBorder", "setDataValidation",
 "clearFormat", "clearDataValidations", "activate", "setFontFamily", "merge", "breakApart"].forEach(function (k) {
  GasRange.prototype[k] = function () { return this; };
});
GasRange.prototype.getNumberFormat = function () { return ""; };

/* ---------- สมุด ---------- */
function GasBook(sheets, order) {
  this.list = [];
  var names = order && order.length ? order : Object.keys(sheets || {});
  for (var i = 0; i < names.length; i++) if (sheets[names[i]]) this.list.push(new GasSheet(this, names[i], sheets[names[i]]));
}
GasBook.prototype.getSheetByName = function (n) {
  for (var i = 0; i < this.list.length; i++) if (this.list[i].name === n) return this.list[i];
  return null;
};
GasBook.prototype.getSheets = function () { return this.list.slice(); };
GasBook.prototype.getNumSheets = function () { return this.list.length; };
GasBook.prototype.insertSheet = function (name, idx) {
  if (typeof name !== "string") name = "ชีต" + (this.list.length + 1);
  if (this.getSheetByName(name)) throw new Error("มีชีตชื่อ " + name + " อยู่แล้ว");
  var sh = new GasSheet(this, name, []);
  if (typeof idx === "number" && idx >= 0 && idx < this.list.length) this.list.splice(idx, 0, sh); else this.list.push(sh);
  return sh;
};
GasBook.prototype.deleteSheet = function (sh) { var i = this.list.indexOf(sh); if (i >= 0) this.list.splice(i, 1); };
GasBook.prototype.getActiveSheet = function () { return this.list[0] || null; };
GasBook.prototype.getName = function () { return "local"; };
GasBook.prototype.getId = function () { return "local"; };
GasBook.prototype.getUrl = function () { return ""; };
GasBook.prototype.getSpreadsheetTimeZone = function () { return GAS.tz; };
GasBook.prototype.toast = function () {};

/* ---------- บริการที่โค้ดเว็บเรียก ---------- */
var SpreadsheetApp = {
  getActiveSpreadsheet: function () { if (!GAS.book) throw new Error("ยังไม่ได้ข้อมูลจากเว็บ"); return GAS.book; },
  getActive: function () { return SpreadsheetApp.getActiveSpreadsheet(); },
  openById: function () { return SpreadsheetApp.getActiveSpreadsheet(); },
  openByUrl: function () { return SpreadsheetApp.getActiveSpreadsheet(); },
  flush: function () {},
  getUi: function () { throw new Error("ไม่มีหน้าต่างชีตในโปรแกรม"); },
  BorderStyle: {}, WrapStrategy: {}
};
// จัดรูปวันที่ตามเขตเวลาที่ขอ (เหมือน Utilities.formatDate) — yyyy yy MM M MMM dd d HH H hh h mm ss a EEE และข้อความใน '...'
var _gasFmt = {};
function gasParts(d, tz) {
  var k = tz || GAS.tz, f = _gasFmt[k];
  if (!f) f = _gasFmt[k] = new Intl.DateTimeFormat("en-US", { timeZone: k, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" });
  var o = {};
  f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, M: +o.month, d: +o.day, H: +o.hour % 24, m: +o.minute, s: +o.second, wd: o.weekday };
}
var _gasTwo = function (n) { return (n < 10 ? "0" : "") + n; };
var _gasMon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var Utilities = {
  formatDate: function (d, tz, fmt) {
    if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error("วันที่ไม่ถูกต้อง");
    var p = gasParts(d, tz), out = "", i = 0;
    fmt = String(fmt);
    while (i < fmt.length) {
      var ch = fmt.charAt(i);
      if (ch === "'") { var j = fmt.indexOf("'", i + 1); if (j < 0) j = fmt.length; out += fmt.slice(i + 1, j); i = j + 1; continue; }
      var n = 1;
      while (fmt.charAt(i + n) === ch) n++;
      var tok = fmt.substr(i, n);
      if (ch === "y") out += n === 2 ? _gasTwo(p.y % 100) : p.y;
      else if (ch === "M") out += n >= 3 ? _gasMon[p.M - 1] : n === 2 ? _gasTwo(p.M) : p.M;
      else if (ch === "d") out += n === 2 ? _gasTwo(p.d) : p.d;
      else if (ch === "H") out += n === 2 ? _gasTwo(p.H) : p.H;
      else if (ch === "h") { var h12 = p.H % 12 || 12; out += n === 2 ? _gasTwo(h12) : h12; }
      else if (ch === "m") out += n === 2 ? _gasTwo(p.m) : p.m;
      else if (ch === "s") out += n === 2 ? _gasTwo(p.s) : p.s;
      else if (ch === "a") out += p.H < 12 ? "AM" : "PM";
      else if (ch === "E") out += p.wd;
      else if (ch === "S") out += "000".slice(0, n);
      else out += tok;
      i += n;
    }
    return out;
  },
  formatString: function (f) { var a = Array.prototype.slice.call(arguments, 1), i = 0; return String(f).replace(/%[sd]/g, function () { return String(a[i++]); }); },
  // รหัสสุ่ม: คำสั่งแก้ไข = คิดจากรหัสคำสั่ง (เว็บได้รหัสเดียวกัน) · อ่านอย่างเดียว = สุ่มจริง
  getUuid: function () {
    if (GAS.seed) {
      var s = GAS.seed + ":" + (GAS.seedN++), h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
      for (var i = 0; i < s.length; i++) for (var k = 0; k < 4; k++) { h[k] ^= s.charCodeAt(i) + k; h[k] = Math.imul(h[k], 0x01000193) >>> 0; }
      var hex = h.map(function (x) { return ("0000000" + x.toString(16)).slice(-8); }).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
    }
    try { if (self.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var r = ""; for (var j = 0; j < 32; j++) r += Math.floor(Math.random() * 16).toString(16);
    return r.slice(0, 8) + "-" + r.slice(8, 12) + "-4" + r.slice(13, 16) + "-a" + r.slice(17, 20) + "-" + r.slice(20);
  },
  base64Encode: function (x) {
    if (typeof x === "string") return btoa(unescape(encodeURIComponent(x)));
    var s = ""; for (var i = 0; i < x.length; i++) s += String.fromCharCode(x[i] & 255);
    return btoa(s);
  },
  base64Decode: function (b) {
    var s = atob(String(b).replace(/[^A-Za-z0-9+/=]/g, "")), out = new Array(s.length);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); out[i] = c > 127 ? c - 256 : c; }
    return out;
  },
  base64EncodeWebSafe: function (x) { return Utilities.base64Encode(x).replace(/\+/g, "-").replace(/\//g, "_"); },
  base64DecodeWebSafe: function (b) { return Utilities.base64Decode(String(b).replace(/-/g, "+").replace(/_/g, "/")); },
  newBlob: function (data, type, name) { return new GasBlob(data, type, name); },
  sleep: function () {},
  computeDigest: function () { throw GasOnline("การคำนวณลายเซ็น"); },
  DigestAlgorithm: {}, Charset: {}
};
function GasBlob(data, type, name) {
  this.bytes = typeof data === "string" ? Utilities.base64Decode(Utilities.base64Encode(data)) : (data || []);
  this.type = type || "application/octet-stream"; this.name = name || "";
}
GasBlob.prototype.getBytes = function () { return this.bytes.slice(); };
GasBlob.prototype.getDataAsString = function () { var s = ""; for (var i = 0; i < this.bytes.length; i++) s += String.fromCharCode(this.bytes[i] & 255); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };
GasBlob.prototype.getContentType = function () { return this.type; };
GasBlob.prototype.setContentType = function (t) { this.type = t; return this; };
GasBlob.prototype.getName = function () { return this.name; };
GasBlob.prototype.setName = function (n) { this.name = n; return this; };
GasBlob.prototype.getBlob = function () { return this; };
GasBlob.prototype.dataUrl = function () { return "data:" + this.type + ";base64," + Utilities.base64Encode(this.bytes); };

var Session = {
  getScriptTimeZone: function () { return GAS.tz; },
  getActiveUser: function () { return { getEmail: function () { return ""; } }; },
  getEffectiveUser: function () { return { getEmail: function () { return ""; } }; },
  getTemporaryActiveUserKey: function () { return "local"; },
  getActiveUserLocale: function () { return "th"; }
};
function gasCacheOf() {
  return {
    get: function (k) { return Object.prototype.hasOwnProperty.call(GAS.cache, k) ? GAS.cache[k] : null; },
    getAll: function (ks) { var o = {}; (ks || []).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(GAS.cache, k)) o[k] = GAS.cache[k]; }); return o; },
    put: function (k, v) { GAS.cache[k] = String(v); },
    putAll: function (o) { for (var k in o) GAS.cache[k] = String(o[k]); },
    remove: function (k) { delete GAS.cache[k]; },
    removeAll: function (ks) { (ks || []).forEach(function (k) { delete GAS.cache[k]; }); }
  };
}
var CacheService = { getScriptCache: gasCacheOf, getUserCache: gasCacheOf, getDocumentCache: gasCacheOf };
function gasPropsOf(which) {
  return {
    getProperty: function (k) { var p = GAS.props[which]; return Object.prototype.hasOwnProperty.call(p, k) ? p[k] : null; },
    setProperty: function (k, v) { GAS.props[which][k] = String(v); return this; },
    setProperties: function (o, del) { if (del) GAS.props[which] = {}; for (var k in o) GAS.props[which][k] = String(o[k]); return this; },
    deleteProperty: function (k) { delete GAS.props[which][k]; return this; },
    deleteAllProperties: function () { GAS.props[which] = {}; return this; },
    getProperties: function () { var o = {}, p = GAS.props[which]; for (var k in p) o[k] = p[k]; return o; },
    getKeys: function () { return Object.keys(GAS.props[which]); }
  };
}
var PropertiesService = {
  getScriptProperties: function () { return gasPropsOf("script"); },
  getUserProperties: function () { return gasPropsOf("user"); },
  getDocumentProperties: function () { return gasPropsOf("doc"); }
};
function gasLock() { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {}, hasLock: function () { return true; } }; }
var LockService = { getScriptLock: gasLock, getUserLock: gasLock, getDocumentLock: gasLock };

/* ---------- Drive ในเครื่อง: ไฟล์ที่สร้างตอนยังไม่ขึ้นเว็บ (รูปบิล) อยู่ในหน่วยความจำ · ที่อยู่ = รูปในตัว (data:) ให้หน้าจอโชว์ได้ทันที
   ไฟล์จริงบน Drive: ลบ/ย้าย/แชร์ = ไม่ทำอะไร (เว็บทำตอนได้คำสั่ง) · อ่านเนื้อไฟล์ = ต้องต่อเน็ต ---------- */
function GasFolder(id, name) { this.id = id; this.name = name; this.trashed = false; }
GasFolder.prototype.getId = function () { return this.id; };
GasFolder.prototype.getName = function () { return this.name; };
GasFolder.prototype.getUrl = function () { return ""; };
GasFolder.prototype.isTrashed = function () { return this.trashed; };
GasFolder.prototype.setTrashed = function (b) { this.trashed = !!b; return this; };
GasFolder.prototype.createFolder = function (n) { return gasNewFolder(n); };
GasFolder.prototype.getFoldersByName = function (n) { return gasIter(gasFoldersNamed(n)); };
GasFolder.prototype.getFilesByName = function () { return gasIter([]); };
GasFolder.prototype.getFiles = function () { return gasIter([]); };
GasFolder.prototype.getFolders = function () { return gasIter([]); };
GasFolder.prototype.createFile = function (blob, content, mime) {
  if (typeof blob === "string") blob = new GasBlob(content || "", mime || "text/plain", blob);
  var id = "local-" + (GAS.seed || "x") + "-" + (++GAS.fileN);
  var f = new GasFile(id, blob);
  GAS.files[id] = f;
  return f;
};
GasFolder.prototype.addFile = function () { return this; };
GasFolder.prototype.removeFile = function () { return this; };
GasFolder.prototype.setSharing = function () { return this; };
function GasFile(id, blob) { this.id = id; this.blob = blob || null; this.trashed = false; }
GasFile.prototype.getId = function () { return this.id; };
GasFile.prototype.getName = function () { return this.blob ? this.blob.getName() : ""; };
GasFile.prototype.getUrl = function () { return this.blob ? this.blob.dataUrl() : ""; };
GasFile.prototype.getDownloadUrl = GasFile.prototype.getUrl;
GasFile.prototype.getBlob = function () { if (!this.blob) throw GasOnline("เปิดไฟล์จาก Drive "); return this.blob; };
GasFile.prototype.getAs = GasFile.prototype.getBlob;
GasFile.prototype.getMimeType = function () { return this.blob ? this.blob.getContentType() : ""; };
GasFile.prototype.getSize = function () { return this.blob ? this.blob.bytes.length : 0; };
GasFile.prototype.isTrashed = function () { return this.trashed; };
GasFile.prototype.setTrashed = function (b) { this.trashed = !!b; return this; };
GasFile.prototype.setSharing = function () { return this; };
GasFile.prototype.moveTo = function () { return this; };
GasFile.prototype.setName = function () { return this; };
GasFile.prototype.setDescription = function () { return this; };
GasFile.prototype.getParents = function () { return gasIter([]); };
GasFile.prototype.makeCopy = function () { return this; };
GasFile.prototype.getLastUpdated = function () { return new Date(); };
var _gasFolders = [];
function gasNewFolder(n) { var f = new GasFolder("localdir-" + (_gasFolders.length + 1), n); _gasFolders.push(f); return f; }
function gasFoldersNamed(n) { return _gasFolders.filter(function (f) { return f.name === n && !f.trashed; }); }
function gasIter(list) { var i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; }
var DriveApp = {
  getFolderById: function (id) { var f = _gasFolders.filter(function (x) { return x.id === id; })[0]; return f || new GasFolder(String(id), ""); },
  getFoldersByName: function (n) { return gasIter(gasFoldersNamed(n)); },
  createFolder: function (n) { return gasNewFolder(n); },
  getRootFolder: function () { return DriveApp.getFolderById("root"); },
  getFileById: function (id) { return GAS.files[id] || new GasFile(String(id), null); },
  getFilesByName: function () { return gasIter([]); },
  createFile: function (blob, c, m) { return DriveApp.getRootFolder().createFile(blob, c, m); },
  Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK", ANYONE: "ANYONE", PRIVATE: "PRIVATE" },
  Permission: { VIEW: "VIEW", EDIT: "EDIT", COMMENT: "COMMENT" }
};
var UrlFetchApp = {
  fetch: function () { throw GasOnline("การอ่านรูปด้วย AI / ติดต่อเว็บอื่น "); },
  fetchAll: function () { throw GasOnline("การอ่านรูปด้วย AI / ติดต่อเว็บอื่น "); }
};
var ScriptApp = {
  getService: function () { return { getUrl: function () { return String(GAS.ctx.serviceUrl || ""); } }; },   // ที่อยู่เว็บจริง (เว็บบอกตอนดึง) — ลิงก์ที่หน้าจอสร้างชี้เว็บจริง
  getOAuthToken: function () { throw GasOnline("การติดต่อ Google "); },
  getScriptId: function () { return "local"; }
};
var Logger = { log: function () {} };
var HtmlService = { createTemplateFromFile: function () { throw new Error("ไม่ใช้ในโปรแกรม"); }, createHtmlOutput: function () { throw new Error("ไม่ใช้ในโปรแกรม"); },
  createHtmlOutputFromFile: function () { throw new Error("ไม่ใช้ในโปรแกรม"); }, XFrameOptionsMode: {}, SandboxMode: {} };
var ContentService = { createTextOutput: function () { throw new Error("ไม่ใช้ในโปรแกรม"); }, MimeType: {} };

/* ชีตชุดใหม่ (ค่าที่ดึงจากเว็บ) — วันที่ {"$d": ms} → Date · คัดลอกทุกแถว (ของเดิมไม่ถูกแก้) */
function gasRevive(x) {
  if (x && typeof x === "object" && !Array.isArray(x) && typeof x.$d === "number" && Object.keys(x).length === 1) return new Date(x.$d);
  return x;
}
function gasLoad(base, ctx) {
  var sheets = (base && base.sheets) || {}, copy = {};
  for (var k in sheets) if (Object.prototype.hasOwnProperty.call(sheets, k))
    copy[k] = (sheets[k] || []).map(function (r) { return (r || []).map(gasRevive); });
  GAS.book = new GasBook(copy, base && base.order);
  GAS.cache = {};
  GAS.ctx = ctx || {};
  GAS.props = { script: Object.assign({}, (ctx && ctx.props) || {}), user: Object.assign({}, (ctx && ctx.user) || {}), doc: {} };
  GAS.files = {}; GAS.fileN = 0; GAS.seed = ""; GAS.seedN = 0;
  _gasFolders = [];
}

;
/* ---- host.js ---- */
/* ShopPOS — แอพเว็บของร้านในเครื่อง: ตัวคิดเบื้องหลัง (worker) ใช้ร่วมทุกแอพ
   ตัวทำงานของแต่ละแอพ: importScripts("../gas.js", "../host.js", <ไฟล์ .gs ของแอพ>) แล้วตั้ง LAPP_APP (ไม่ตั้ง = ค่าตั้งต้น)
   ชีต = ฉบับล่าสุดที่ตัวโปรแกรมดึงจากเว็บ + คำสั่งแก้ไขที่ยังไม่อยู่ในฉบับนั้น (คิดซ้ำตามลำดับ) → หน้าจอเห็นสิ่งที่เพิ่งกดทันที
   ข้อความจากหน้าจอ:
     {t:"init", base, q, ctx}          → โหลดชีต + คิดคำสั่งที่ค้างซ้ำ → {t:"ready", bad:[รหัสคำสั่งที่คิดซ้ำไม่ได้]}
     {t:"call", id, fn, args, cmd?}    → เรียกฟังก์ชันชื่อ fn ของโค้ดเว็บ (cmd = คำสั่งแก้ไข) → {t:"res", id, ok, ret | err, online}
   คำสั่งแก้ไข: รหัสสุ่มคิดจากรหัสคำสั่ง (เว็บได้รหัสเดียวกัน) · ล้มกลางทาง = คิดชีตใหม่จากฉบับเว็บ + คำสั่งที่ค้าง (ไม่ค้างครึ่ง ๆ กลาง ๆ) */
var LAPP_APP = self.LAPP_APP || {};   // { okResult(ret), relocate(fn, args), skip(cmd), build(), reset() }
var LAPP_BASE = null, LAPP_Q = [], LAPP_CTX = {};

function lappCall(fn, args, cmd) {
  var f = self[fn];
  if (typeof f !== "function" || /_$/.test(fn)) throw new Error("ไม่รู้จักคำสั่ง: " + fn);   // ฟังก์ชันลงท้าย _ = ภายใน (หน้าเว็บเรียกไม่ได้)
  // บนเว็บทุกครั้งที่เรียก = เริ่มใหม่ (ตัวแปรจำชั่วคราวของโค้ดเว็บว่าง) · ในเครื่องตัวคิดอยู่ตลอด → ล้างเองก่อนเรียก
  if (LAPP_APP.reset) LAPP_APP.reset();
  GAS.seed = cmd ? String(cmd.lid) : ""; GAS.seedN = 0;
  if ("LAPP_SEED_" in self) { self.LAPP_SEED_ = GAS.seed; self.LAPP_SEED_N_ = 0; }   // newId_() ของโค้ดเว็บ (ไฟล์ โปรแกรมร้าน.gs) = รหัสเดียวกับบนเว็บ
  try { return f.apply(self, args || []); }
  finally { GAS.seed = ""; if ("LAPP_SEED_" in self) self.LAPP_SEED_ = ""; }
}
function lappOk(ret) { return LAPP_APP.okResult ? !!LAPP_APP.okResult(ret) : true; }
// คิดคำสั่งที่ค้างซ้ำบนชีตชุดใหม่ · ทำไม่ได้แล้ว = ข้าม (ตัวโปรแกรมบอกผลจริงจากเว็บ)
function lappReplay(c) {
  if (LAPP_APP.skip && LAPP_APP.skip(c)) return true;
  var args = JSON.parse(JSON.stringify(c.args || []));
  if (LAPP_APP.relocate) { try { LAPP_APP.relocate(c.fn, args); } catch (e) {} }
  return lappOk(lappCall(c.fn, args, c));
}
function lappRebuild() {
  var ctx = {}, k, wc = (LAPP_BASE && LAPP_BASE.ctx) || {};
  for (k in wc) ctx[k] = wc[k];                // ค่าจากเว็บ (เช่น ค่าตั้งของแอพ)
  for (k in LAPP_CTX) ctx[k] = LAPP_CTX[k];    // ค่าจากหน้าจอ
  gasLoad(LAPP_BASE, ctx);
  var bad = [];
  LAPP_Q.forEach(function (c) { var ok = false; try { ok = lappReplay(c); } catch (e) {} if (!ok) bad.push(c.lid); });
  return bad;
}

onmessage = function (e) {
  var m = e.data || {};
  if (m.t === "init") {
    var bad = [], err = "";
    try {
      if (m.base) LAPP_BASE = m.base;
      if (m.ctx) LAPP_CTX = m.ctx;
      LAPP_Q = m.q || [];
      bad = lappRebuild();
    } catch (x) { err = String((x && x.message) || x); }
    postMessage({ t: "ready", id: m.id, bad: bad, err: err, build: LAPP_APP.build ? LAPP_APP.build() : "" });
    return;
  }
  if (m.t !== "call") return;
  try {
    var ret = lappCall(m.fn, m.args, m.cmd || null), queued = false;
    if (m.cmd) {
      if (lappOk(ret)) { LAPP_Q.push(m.cmd); queued = true; }   // จำไว้คิดซ้ำตอนได้ชีตชุดใหม่ + ส่งขึ้นเว็บ
      else lappRebuild();                                          // ทำไม่สำเร็จ (บอกผลเป็นค่า) = ชีตกลับเป็นเหมือนก่อนกด ไม่ส่งขึ้นเว็บ
    }
    postMessage({ t: "res", id: m.id, ok: true, ret: ret, queued: queued });
  } catch (x) {
    if (m.cmd) { try { lappRebuild(); } catch (y) {} }
    postMessage({ t: "res", id: m.id, ok: false, err: String((x && x.message) || x), online: !!(x && x.name === "GasOnline") });
  }
};

;
/* ---- code.js ---- */
/* สร้างจาก PoomCode/ระบบคิดเงินเดือนลูกน้อง (รหัส.gs + 01_core.gs + 03_time.gs + 90_api.gs + 95_pos.gs) ด้วย tools/lapp-sync.py — ห้ามแก้ไฟล์นี้ตรง ๆ · 20d5253b14 */
// ═══════════════════════════════════════════════════════════════════
// 3S Sukcharoen Recycle — Web App  v1.0
// ไฟล์ 00: ค่าตั้งต้นทั้งหมด  (แก้ที่นี่ที่เดียว)
// ═══════════════════════════════════════════════════════════════════

// ── ชีตของแต่ละระบบ ──
var BOOKS = {
  TIME:     "local",  // work spaec — เวลาทำงาน
  TRUCK:    "",   // 🚚 V.15 — ใส่ทีหลัง (Phase 2)
  DELIVERY: "",   // 🦈 V.69 — ใส่ทีหลัง (Phase 3)
};

var TZ       = "Asia/Bangkok";
var DATE_FMT = "yyyy-MM-dd";

// ── ชื่อชีตในเล่ม TIME ──
// ชีทที่เว็บสร้างเอง — เก็บค่าแรงที่เจ้าของพิมพ์ทับสูตร
//   สคริปต์ในชีต (autoUpdateDailySummaryCore_) อ่านชีทนี้แล้วเคารพค่าที่แก้มือ
//   ต้องแก้ รหัส.gs v9.7 ของชีต work spaec 4 จุดก่อน ไม่งั้นค่าที่พิมพ์จะโดนสูตรทับตอนทริกเกอร์รัน
var MANUAL_PAY_SHEET = "💰 ค่าแรงแก้มือ";
var SETTLE_SHEET     = "💳 บันทึกตัดหนี้";   // [v9.8] สคริปต์ชีตเขียนตอน 💳 ตัดหนี้ — ใช้หาหนี้ยกมา ณ ต้นช่วง

var SH = {
  RAW:       "ชีทเก็บข้อมูลดิบสแกนหน้า",
  EMPLOYEES: "รายชื่อพนักงาน",
  DAILY:     "สรุปรายวัน",
  HISTORY:   "ประวัติการทำงานถาวร",
  MONTHLY:   "สรุปข้อมูลรายเดือน",
};

// ── คอลัมน์ สรุปรายวัน / ประวัติถาวร (0-based, เหมือนกันทั้งคู่) ──
var COL = {
  DATE: 0, ID: 1, NAME: 2, IN: 3, OUT: 4, HRS: 5, STATUS: 6,
  PAY: 7, ADV: 8, PAYER: 9, NOTE: 10, BRANCH: 11, TIP: 12
};
var DATA_COLS = 13;

// ── คอลัมน์ รายชื่อพนักงาน (0-based) ──
var EMP = {
  ID: 0, NAME: 1, RATE_HOUR: 2, RATE_DAY: 5, SALARY_MONTH: 6,
  SPECIAL: 7, DEBT: 10, BRANCH: 11
};

// ── กติกาคิดเงิน (ยกมาจาก รหัส.gs v9.7 ห้ามแก้ให้ต่างจากไฟล์เดิม) ──
var FULL_DAY_HRS  = 9;      // ทำครบกี่ชั่วโมง = เต็มวัน
var HALF_DAY_PAY  = 400;    // รายเดือน ทำไม่ครบ → ได้เท่านี้
var HOURLY_SHORT  = 50;     // รายวัน ทำไม่ครบ → ชม.ละเท่านี้
var OT_START_HRS  = 9;      // เกินกี่ชั่วโมง = เริ่มนับ OT
var OT_PER_30MIN  = 35;     // OT ทุก 30 นาที
var OT_ON_HOURLY  = false;

var PAY_ON_ABSENT    = false;
var PAY_ON_SUSPEND   = false;
var PAY_ON_SICKLEAVE = true;
var PAY_FORGOT_CLOCK = true;

var LATE_AFTER   = "08:10";  // เข้าหลังเวลานี้ = มาสาย (= โดนหักสาย ตั้งแต่ RULE_Q_FROM) · เดิม 08:05
var WORK_START   = "08:00";  // มาก่อนเวลานี้ ให้เริ่มนับที่ 08:00
var BREAK_START  = "12:00";
var BREAK_END    = "13:00";

// ── กติกาใหม่ 15 ต.ค. 2569 (ต้องตรงกับสคริปต์ในชีต) — ใช้กับวันที่ตั้งแต่ RULE_Q_FROM ──
//   ชม.ทำงาน ปัดลงทีละ 15 นาที: เศษ 0–14 นาที = .00 · 15–29 = .25 · 30–44 = .5 · 45–59 = .75
//   สายเกิน 10 นาที (เข้าหลัง LATE_AFTER) หัก FINE_LATE · เลิกก่อน EARLY_BEFORE หัก FINE_EARLY
//   ใช้กับทุกคน ทุกประเภทค่าจ้าง · วันก่อน RULE_Q_FROM คิดแบบเดิม (ปัดครึ่งชั่วโมง ไม่หัก) งวดเก่ายอดไม่เปลี่ยน
var RULE_Q_FROM  = "2026-10-16";
var FINE_LATE    = 20;
var FINE_EARLY   = 20;
var EARLY_BEFORE = "17:00";

// ── สถานะ ──
var SPECIAL_STATUSES = [
  "🏠 ลากลับบ้าน", "🤒 ลาป่วย", "📋 ลากิจ",
  "🌴 วันหยุด", "🚫 พักงาน", "✈️ ลาพักร้อน"
];
var COMPUTED_STATUSES = ["✅ ปกติ", "🟡 มาสาย", "❌ ไม่มา", "❌ ลืมสแกนออก"];
var STATUS_AUTO = "🔄 คืนค่าอัตโนมัติ";

// ── สิทธิ์ ──
//   เจ้าของเข้าด้วย  .../exec?k=<OWNER_KEY>
//   ลูกน้องเข้าด้วย  .../exec           (ดูอย่างเดียว)
//   ตั้งคีย์ครั้งแรก: รัน setOwnerKey("รหัสที่อยากใช้") หนึ่งครั้ง
var PROP_OWNER_KEY = "OWNER_KEY";

// ── ลูกน้องเห็นอะไรได้บ้าง ──
//   ดูรายเดือน / ดูรายวัน = เห็นข้อมูลทุกคนพร้อมกัน → เจ้าของเท่านั้น
var STAFF_CAN_MONTH = false;
var STAFF_CAN_DAY   = false;

//   true  = ลูกน้องไม่เห็น ค่าแรง / ทิป / ยอดคงเหลือ  (ตรงกับ code.gs v9.2 เดิม)
//   false = เห็นหมดเหมือนเจ้าของ
var HIDE_PAY_FROM_STAFF = true;

// ── ⚠️ กันแก้เวลาชนกับทริกเกอร์เดิม ──
//   สคริปต์เดิมในชีต (autoUpdateDailySummaryCore_) สร้าง "สรุปรายวัน" ใหม่จากชีตสแกนดิบ
//   ทุกครั้งที่ทริกเกอร์ทำงาน โดยคงไว้เฉพาะ เบิก/ผู้จ่าย/หมายเหตุ/สาขา/ทิป/สถานะพิเศษ
//
//   ✅ แก้แล้ว: ตอนนี้แก้เวลาในวันที่ยังไม่ปิดยอด ระบบจะเขียนลง "ชีทเก็บข้อมูลดิบสแกนหน้า"
//      ให้ด้วย → ทริกเกอร์สร้างใหม่กี่รอบก็ได้ค่าเดิม ไม่โดนทับอีก
//   false = แก้เวลาได้ (ค่าเริ่มต้น)
//   true  = กลับไปห้ามแก้ เผื่อไม่อยากให้แตะชีตดิบ
var LOCK_TIME_ON_OPEN_DAY = false;

// ── ⭐ คนพิเศษ ──
//   ใส่ "รหัสพนักงาน" ของคนพิเศษที่นี่ เช่น  ["56", "69", "52"]
//   คนในลิสต์นี้:
//     • สแกนหน้าเข้า-ออก และคิดค่าแรงเหมือนคนงานธรรมดาทุกอย่าง
//     • หายไปจากแท็บ ดูรายวัน / ดูราย 2 เดือน / ช่องเลือกคนในดูรายบุคคล
//     • ไปโผล่ในแท็บ "⭐ คนพิเศษ" แทน แยกขาดจากกัน ยอดรวมไม่ปนกัน
//   เว้นว่าง [] = ไม่มีใครพิเศษ ระบบทำงานเหมือนเดิมทุกประการ
//   ⚠️ แก้ลิสต์นี้แล้วต้อง Deploy เป็น "New version" ถึงจะมีผล
// [v10] เลิกแยกแท็บคนพิเศษแล้ว — ทุกคนอยู่ในดูรายวัน/ประวัติ/รายบุคคลรวมกัน
//   (อยากแยกกลับ: ใส่รหัสคืน เช่น ["56", "69", "52", "99", "1", "2", "3", "4"])
var SPECIAL_IDS = [];

function setOwnerKey(key) {
  // รันได้จาก Apps Script editor เท่านั้น — เรียกผ่าน google.script.run จากหน้าเว็บ (ไม่ได้ล็อกอิน) จะไม่มีอีเมล
  // เดิมใครมีลิงก์ดูอย่างเดียวก็เรียกเปลี่ยนคีย์เจ้าของได้ แล้วเปิด ?k=ใหม่ ได้สิทธิ์เต็ม
  if (!Session.getActiveUser().getEmail()) throw new Error("ฟังก์ชันนี้ใช้ได้จาก Apps Script editor เท่านั้น");
  if (!key || String(key).length < 6) throw new Error("คีย์ต้องยาวอย่างน้อย 6 ตัว");
  PropertiesService.getScriptProperties().setProperty(PROP_OWNER_KEY, String(key));
  return "ตั้งคีย์เรียบร้อย — เปิดเว็บด้วย ?k=" + key;
}
;
// ═══════════════════════════════════════════════════════════════════
// ไฟล์ 01: แกนกลาง — เปิดชีต, อ่าน/เขียน, ล็อก, แปลงค่า, คิดเงิน
//   กติกา: ทุกฟังก์ชันในไฟล์นี้ห้ามเรียก SpreadsheetApp.getUi()
//           (Web App ไม่มี UI ของชีต — เรียกแล้วพัง)
// ═══════════════════════════════════════════════════════════════════

// ── แคชต่อการรัน 1 ครั้ง (กันบั๊กเดิม: อ่านชีตซ้ำ 40 รอบ) ──
var _ss = {}, _rows = {};

function book_(which) {
  if (!_ss[which]) {
    var id = BOOKS[which];
    if (!id) throw new Error("ยังไม่ได้ตั้งค่า BOOKS." + which + " ใน 00_config.gs");
    _ss[which] = SpreadsheetApp.openById(id);
  }
  return _ss[which];
}

function sheet_(which, name) {
  var sh = book_(which).getSheetByName(name);
  if (!sh) {
    var all = book_(which).getSheets().map(function(s) { return s.getName(); }).join(" | ");
    throw new Error('ไม่พบชีต "' + name + '"\nชีตที่มี: ' + all);
  }
  return sh;
}

// อ่านทั้งชีตครั้งเดียว แล้วเติมคอลัมน์ให้ครบ want
function rows_(which, name, want) {
  var key = which + "/" + name;
  if (_rows[key]) return _rows[key];
  var sh = sheet_(which, name), last = sh.getLastRow();
  if (last < 2) return (_rows[key] = []);
  var cols = Math.min(Math.max(sh.getLastColumn(), 1), want);
  var vals = sh.getRange(2, 1, last - 1, cols).getValues();
  if (cols < want) vals = vals.map(function(r) {
    while (r.length < want) r.push("");
    return r;
  });
  return (_rows[key] = vals);
}

function cacheClear_() { _rows = {}; _rowAt = {}; }

// ── ล็อก: ทุกการเขียนต้องผ่านตรงนี้ (กันสองคนเขียนชนกัน) ──
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error("มีคนอื่นกำลังบันทึกอยู่ ลองใหม่อีกครั้ง");
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── กันกดซ้ำ / เน็ตหลุดแล้วส่งซ้ำ ──
function onceOnly_(requestId, fn) {
  if (!requestId) return fn();
  var c = CacheService.getScriptCache(), k = "req_" + requestId;
  var hit = c.get(k);
  if (hit) return JSON.parse(hit);
  var out = fn();
  c.put(k, JSON.stringify(out), 600);   // จำ 10 นาที
  return out;
}

// ── แปลงค่า ──
function fmtDate_(d) { return Utilities.formatDate(d, TZ, DATE_FMT); }

// 🚀 [v10.1] จำผลแปลงวันที่/เวลา — ประวัติถาวรหมื่นแถว แต่วันที่ซ้ำกันวันละ 20 กว่าแถว
//    Utilities.formatDate ช้า (เรียกหมื่นครั้ง = หลายวินาที) → แปลงครั้งเดียวต่อค่า
var _dCache = {}, _tCache = {};
function toDateStr_(v) {
  if (!v) return "";
  if (v instanceof Date) { var k = v.getTime(); return _dCache[k] || (_dCache[k] = fmtDate_(v)); }
  var s = String(v).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    var p = s.split("-");
    return p[0] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[2]).slice(-2);
  }
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  var d = new Date(s);
  return isNaN(d.getTime()) ? "" : fmtDate_(d);
}

function toTimeStr_(v) {
  if (v === 0 || v === "0") return "--:--";
  if (!v) return "--:--";
  if (v instanceof Date) { var k = v.getTime(); return _tCache[k] || (_tCache[k] = Utilities.formatDate(v, TZ, "HH:mm")); }
  var s = String(v).trim();
  if (!s) return "--:--";
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return ("0" + m[1]).slice(-2) + ":" + m[2];
  return s;
}

function isBlankTime_(t) { return !t || t === "--:--"; }

function normBranch_(s) {
  s = String(s || "").trim().replace(/\s+/g, " ");
  return s.replace(/^(สาขา)\s*(\d+)$/, "$1 $2");
}

function todayStr_() { return fmtDate_(new Date()); }

// ═══════════════════════════════════════════════════════════════════
// 🧮 เครื่องคิดเงิน — แหล่งความจริงแหล่งเดียว
//    ฝั่งเว็บห้ามคิดเอง ต้องเรียกผ่าน API เท่านั้น
//    (บทเรียน: code.gs v9.2 ก๊อปตรรกะไป แล้วไฟล์หลักขึ้น v9.7 = ตัวเลขคนละอัน)
// ═══════════════════════════════════════════════════════════════════

function isLeaveStatus_(status) {
  status = String(status || "");
  if (status.indexOf("พักงาน")  >= 0) return true;
  if (status.indexOf("ป่วย")    >= 0) return true;
  if (status.indexOf("วันหยุด") >= 0) return true;
  return status.indexOf("ลา") >= 0 && status.indexOf("ลาออก") < 0;
}

function statusFromTimes_(cIn, cOut) {
  cIn  = toTimeStr_(cIn);
  cOut = toTimeStr_(cOut);
  if (isBlankTime_(cIn))  return "❌ ไม่มา";
  if (isBlankTime_(cOut)) return "❌ ลืมสแกนออก";
  return (cIn > LATE_AFTER) ? "🟡 มาสาย" : "✅ ปกติ";
}

function calcWorkHours_(dateStr, cIn, cOut) {
  cIn  = toTimeStr_(cIn);
  cOut = toTimeStr_(cOut);
  if (isBlankTime_(cIn) || isBlankTime_(cOut)) return 0;

  var tIn  = new Date(dateStr + "T" + cIn  + ":00");
  var tOut = new Date(dateStr + "T" + cOut + ":00");
  if (isNaN(tIn.getTime()) || isNaN(tOut.getTime())) return 0;

  // มาก่อน 08:00 → เริ่มนับที่ 08:00
  var t8 = new Date(dateStr + "T" + WORK_START + ":00");
  if (tIn < t8) tIn = t8;

  // กะดึก: บวก 24 ชม. เฉพาะ "เข้าตั้งแต่เที่ยง และออกก่อน 06:00"
  if (tOut <= tIn) {
    var inH  = parseInt(cIn.split(":")[0], 10);
    var outH = parseInt(cOut.split(":")[0], 10);
    if (inH >= 12 && outH <= 6) tOut = new Date(tOut.getTime() + 24 * 3600000);
  }
  if (tOut <= tIn) return 0;

  var h = (tOut - tIn) / 3600000;
  if (h > 20) return 0;                  // ผิดปกติ — ไม่คิดให้

  // หักพักเที่ยง
  var bs = new Date(dateStr + "T" + BREAK_START + ":00").getTime();
  var be = new Date(dateStr + "T" + BREAK_END   + ":00").getTime();
  var ov = Math.min(tOut.getTime(), be) - Math.max(tIn.getTime(), bs);
  if (ov > 0) h -= ov / 3600000;

  return roundWorkHrs_(h, dateStr);
}

// ปัดชั่วโมงทำงาน — ตั้งแต่ RULE_Q_FROM ปัดลงทีละ 15 นาที · ก่อนหน้านั้นปัดครึ่งชั่วโมงที่ใกล้สุด (แบบเดิม)
function roundWorkHrs_(h, dateStr) {
  if (!(h > 0)) return 0;
  return toDateStr_(dateStr) >= RULE_Q_FROM ? Math.floor(h * 4 + 1e-6) / 4 : Math.round(h * 2) / 2;
}

// ค่าปรับของวันนั้น { late, early, total } — ไม่มา/ลา/ป่วย/พักงาน/ยังไม่สแกนออก = ไม่หัก
//   ลืมสแกนออก = หักได้แค่สาย (ไม่รู้เวลาเลิก) · ออกหลังเที่ยงคืน (กะดึก) ไม่นับเลิกก่อน
function dayFines_(dateStr, status, checkIn, checkOut) {
  var f = { late: 0, early: 0, total: 0 };
  if (!dateStr || toDateStr_(dateStr) < RULE_Q_FROM) return f;
  status = String(status || "");
  if (status.indexOf("ไม่มา") >= 0 || status.indexOf("พักงาน") >= 0 || status.indexOf("ป่วย") >= 0 ||
      status.indexOf("วันหยุด") >= 0 || (status.indexOf("ลา") >= 0 && status.indexOf("ลาออก") < 0)) return f;
  var cIn = toTimeStr_(checkIn), cOut = toTimeStr_(checkOut);
  if (isBlankTime_(cIn)) return f;
  if (isBlankTime_(cOut) && status.indexOf("ลืมสแกน") < 0) return f;   // ยังทำงานอยู่ รอจบวัน
  if (cIn > LATE_AFTER) f.late = FINE_LATE;
  if (!isBlankTime_(cOut) && cOut < EARLY_BEFORE && cOut > cIn) f.early = FINE_EARLY;
  f.total = f.late + f.early;
  return f;
}

function otPay_(hours) {
  var extra = (parseFloat(hours) || 0) - OT_START_HRS;
  if (extra <= 0) return 0;
  return Math.floor(extra / 0.5 + 1e-9) * OT_PER_30MIN;
}

// dateStr (ไม่ใส่ก็ได้) = หักสาย/เลิกก่อนของวันนั้น (dayFines_) · ไม่ใส่ = ค่าแรงก่อนหัก (ใช้แยก OT)
function calcDayPay_(payType, payRate, hours, status, checkIn, checkOut, dateStr) {
  var base = calcDayPayBase_(payType, payRate, hours, status, checkIn, checkOut);
  if (!dateStr || !(base > 0)) return base;
  var fine = dayFines_(dateStr, status, checkIn, checkOut).total;
  return fine ? Math.max(0, base - fine) : base;
}

function calcDayPayBase_(payType, payRate, hours, status, checkIn, checkOut) {
  status  = String(status || "");
  hours   = parseFloat(hours)   || 0;
  payRate = parseFloat(payRate) || 0;

  var isAbsent  = status.indexOf("ไม่มา")   >= 0;
  var isForgot  = status.indexOf("ลืมสแกน") >= 0;
  var isSuspend = status.indexOf("พักงาน")  >= 0;
  var isSick    = status.indexOf("ป่วย")    >= 0 ||
                  status.indexOf("วันหยุด") >= 0 ||
                  (status.indexOf("ลา") >= 0 && status.indexOf("ลาออก") < 0);
  var isOff = isAbsent || isSuspend || isSick;

  var notIn  = isBlankTime_(toTimeStr_(checkIn));
  var notOut = isBlankTime_(toTimeStr_(checkOut));
  var stillWorking = notOut && !isOff && !isForgot;
  var isStandby    = isAbsent && notIn;

  if (payType === "วัน") {
    if (isSuspend)    return PAY_ON_SUSPEND ? payRate : 0;
    if (isSick)       return 0;
    if (isAbsent)     return PAY_ON_ABSENT  ? payRate : 0;
    if (stillWorking) return 0;
    if (isForgot)     return PAY_FORGOT_CLOCK ? (payRate / 2) : 0;
    return (hours >= FULL_DAY_HRS) ? (payRate + otPay_(hours)) : (hours * HOURLY_SHORT);
  }

  if (payType === "เดือน") {
    var perDay = payRate / 30;
    if (isStandby)    return 0;
    if (isSuspend)    return PAY_ON_SUSPEND   ? perDay : 0;
    if (isSick)       return PAY_ON_SICKLEAVE ? perDay : 0;
    if (isAbsent)     return PAY_ON_ABSENT    ? perDay : 0;
    if (stillWorking) return 0;
    if (isForgot)     return PAY_FORGOT_CLOCK ? HALF_DAY_PAY : 0;
    return (hours >= FULL_DAY_HRS) ? (perDay + otPay_(hours)) : HALF_DAY_PAY;
  }

  if (isOff)        return 0;
  if (stillWorking) return 0;
  return hours * payRate + (OT_ON_HOURLY ? otPay_(hours) : 0);
}

function dayOtPay_(payType, payRate, hours, status, cIn, cOut) {
  var capped = Math.min(parseFloat(hours) || 0, OT_START_HRS);
  return calcDayPay_(payType, payRate, hours,  status, cIn, cOut) -
         calcDayPay_(payType, payRate, capped, status, cIn, cOut);
}

// ── โปรไฟล์ค่าจ้างของพนักงาน 1 คน จากแถวชีตรายชื่อ ──
function payProfileOf_(r) {
  var h = parseFloat(r[EMP.RATE_HOUR])    || 0;
  var d = parseFloat(r[EMP.RATE_DAY])     || 0;
  var m = parseFloat(r[EMP.SALARY_MONTH]) || 0;
  if (m > 0) return { payType: "เดือน", payRate: m };
  if (d > 0) return { payType: "วัน",   payRate: d };
  return { payType: "ชม.", payRate: h };
}

// ── รายชื่อพนักงานทั้งหมด (อ่านครั้งเดียว) ──
function employees_() {
  return rows_("TIME", SH.EMPLOYEES, 12)
    .filter(function(r) { return String(r[EMP.ID]).trim(); })
    .map(function(r) {
      var p = payProfileOf_(r);
      return {
        id:      String(r[EMP.ID]).trim(),
        name:    String(r[EMP.NAME]).trim(),
        payType: p.payType,
        payRate: p.payRate,
        special: String(r[EMP.SPECIAL] || "").trim(),
        debt:    parseFloat(r[EMP.DEBT]) || 0,
        branch:  normBranch_(r[EMP.BRANCH])
      };
    });
}

// ═══════════════════════════════════════════════════════════════════
// ⭐ คนพิเศษ — แยกออกจากคนงานธรรมดาแบบเด็ดขาด
//    รายชื่ออยู่ที่ SPECIAL_IDS ใน 00_config.gs (เจ้าของกรอกเอง)
//    scope ที่ใช้ทั้งระบบมีแค่ 2 ค่า:
//      "special" = เอาเฉพาะคนพิเศษ
//      อย่างอื่น/ไม่ส่ง = เอาเฉพาะคนงานธรรมดา (ค่าเริ่มต้น ของเดิมทุกหน้าใช้อันนี้)
//    SPECIAL_IDS = [] → isSpecialId_ คืน false ทุกคน หน้าเดิมจึงได้ข้อมูลครบเท่าเดิม
// ═══════════════════════════════════════════════════════════════════
var _specialSet_ = null;
function specialSet_() {
  if (_specialSet_) return _specialSet_;
  _specialSet_ = {};
  var list = (typeof SPECIAL_IDS !== "undefined" && SPECIAL_IDS) ? SPECIAL_IDS : [];
  list.forEach(function(x) {
    var k = String(x == null ? "" : x).trim();
    if (k) _specialSet_[k] = 1;
  });
  return _specialSet_;
}

function isSpecialId_(id) {
  return !!specialSet_()[String(id == null ? "" : id).trim()];
}

// อยู่ในกลุ่มที่กำลังดูอยู่ไหม
function inScope_(id, scope) {
  return scope === "special" ? isSpecialId_(id) : !isSpecialId_(id);
}

function employeesBy_(scope) {
  return employees_().filter(function(e) { return inScope_(e.id, scope); });
}

// จำนวนคนพิเศษที่ตั้งไว้จริง (เอาไว้ตัดสินใจว่าจะโชว์แท็บไหม)
function specialCount_() {
  return employees_().filter(function(e) { return isSpecialId_(e.id); }).length;
}
;
// ═══════════════════════════════════════════════════════════════════
// ไฟล์ 03: ระบบเวลาทำงาน
//   หน้าหลัก = 👤 ดูรายคน (เลือกคน + ช่วงวัน → แก้เวลาเข้า-ออกได้ + พิมพ์)
//   หน้ารอง  = 📅 ดูรายวัน (ภาพรวมทั้งวัน)
// ═══════════════════════════════════════════════════════════════════

var EDITABLE  = ["in", "out", "status", "branch", "adv", "payer", "note", "tip", "pay"];
// [16 ต.ค.] คิดตอนใช้ ไม่อ้าง COL (ไฟล์ รหัส) ตอนโหลดไฟล์ — ลำดับไฟล์ใน Apps Script เปลี่ยนได้ (รหัส อยู่ล่าง 03 = เว็บเปิดไม่ได้ทั้งเว็บ)
var FIELD_COL = null;
function fieldCol_() {
  return FIELD_COL || (FIELD_COL = {
    in: COL.IN, out: COL.OUT, status: COL.STATUS, branch: COL.BRANCH,
    adv: COL.ADV, payer: COL.PAYER, note: COL.NOTE, tip: COL.TIP, pay: COL.PAY
  });
}
var NUM_FIELDS  = ["adv", "tip", "pay"];
var TIME_FIELDS = ["in", "out", "status"];   // แก้ช่องพวกนี้ = ค่าแรงคิดใหม่
var MAX_EDIT  = 200;

// ── งวดปัจจุบัน (1–15 หรือ 16–สิ้นเดือน) ──
function getPeriod_() {
  var n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
  var last = new Date(y, m + 1, 0).getDate();
  return d <= 15
    ? { from: fmtDate_(new Date(y, m, 1)),  to: fmtDate_(new Date(y, m, 15)) }
    : { from: fmtDate_(new Date(y, m, 16)), to: fmtDate_(new Date(y, m, last)) };
}

// ── งวดของวันที่หนึ่ง (1–15 หรือ 16–สิ้นเดือน) ── "2026-10-19" → { from: "2026-10-16", to: "2026-10-31" }
function periodOf_(dateStr) {
  var p = String(dateStr).split("-"), y = +p[0], m = +p[1], d = +p[2];
  var last = new Date(y, m, 0).getDate(), mm = (m < 10 ? "0" : "") + m;
  return d <= 15 ? { from: y + "-" + mm + "-01", to: y + "-" + mm + "-15" }
                 : { from: y + "-" + mm + "-16", to: y + "-" + mm + "-" + last };
}

// ── แถวไหนอยู่ชีตไหน ──
//    DAILY = วันที่ยังไม่ปิดยอด | HISTORY = ปิดยอดแล้ว
// เรียงรหัสแบบตัวเลข — "5" ต้องมาก่อน "26" ไม่ใช่หลัง
function cmpId_(a, b) {
  var x = parseInt(a, 10), y = parseInt(b, 10);
  if (!isNaN(x) && !isNaN(y) && x !== y) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

function srcSheet_(src) {
  if (src === "DAILY")   return SH.DAILY;
  if (src === "HISTORY") return SH.HISTORY;
  throw new Error("ไม่รู้จักแหล่งข้อมูล: " + src);
}

// 🛡️ [XC2-6] วันที่เจ้าของกำลังแก้ในชีต — เมนู 🗓️ ดู/แก้ไขประวัติย้อนหลัง โหลดวันนั้นลงสรุปรายวัน
//   แล้วตั้ง P1 = "EDITING:yyyy-MM-dd" · กด 💾 บันทึก = แถวทั้งวันในประวัติถูกแทนด้วยสำเนาในสรุปรายวัน
//   ยกเลิก (ลบ P1) = สำเนาถูกล้าง → เบิก/เวลา/ค่าแรงที่เว็บเขียนลงวันนั้นระหว่างนี้หายเงียบ ๆ
//   (เบิกยังอยู่ใน 📒 แต่ช่อง I ที่บิลใช้หักหาย) → ห้ามเขียนวันนั้นจากเว็บจนกว่าจะจบโหมดแก้
function editingDate_() {
  var f = "";
  try { f = String(sheet_("TIME", SH.DAILY).getRange("P1").getValue() || "").trim(); } catch (e) {}
  return f.indexOf("EDITING:") === 0 ? toDateStr_(f.slice(8).trim()) : "";
}

function requireNotEditing_(dateStr, ed) {
  if (ed === undefined) ed = editingDate_();   // ส่งค่าที่อ่านไว้แล้วมาได้ (กันอ่าน P1 ซ้ำทีละแถว)
  if (ed && ed === toDateStr_(dateStr))
    throw new Error("วันที่ " + ed + " กำลังถูกแก้ในชีต (เมนูแก้ไขประวัติย้อนหลัง) — สิ่งที่บันทึกจากเว็บตอนนี้จะหาย\n" +
                    "ให้เจ้าของกด 💾 บันทึกการแก้ไข ในชีตให้เสร็จก่อน แล้วกดโหลดใหม่");
}

// ═══════════════════════════════════════════════════════════════════
// 💰 [v9.8] ค่าแรงที่เว็บโชว์/รวม = กติกาเดียวกับ บัตร/บิล/สลิป/ตัดหนี้ ในสคริปต์ชีต
//    เดิมเว็บอ่านคอลัมน์ H ตรง ๆ ส่วนชีตคิดใหม่จากสูตร → เว็บ 600 บิลจ่าย 400
//    ตอนนี้ทั้งสองฝั่ง: มีในชีท "💰 ค่าแรงแก้มือ" → ใช้ค่านั้น · ไม่มี → calcDayPay_ เรตปัจจุบัน
// ═══════════════════════════════════════════════════════════════════
var _payCtx_ = null;
function payCtx_() {
  if (_payCtx_) return _payCtx_;
  var emps = {}, man = {};
  employees_().forEach(function(e) { emps[e.id] = e; });
  try {
    var sh = book_("TIME").getSheetByName(MANUAL_PAY_SHEET);
    if (sh && sh.getLastRow() >= 2) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r) {
        var id = String(r[1] || "").trim(), v = parseFloat(r[2]);
        if (id && !isNaN(v)) man[toDateStr_(r[0]) + "|" + id] = v;
      });
    }
  } catch (e) { Logger.log("payCtx_: " + (e && e.message ? e.message : e)); }
  _payCtx_ = { emps: emps, man: man };
  return _payCtx_;
}

function payOfRow_(r) {
  var C  = payCtx_();
  var id = String(r[COL.ID]).trim();
  var mv = C.man[toDateStr_(r[COL.DATE]) + "|" + id];
  if (mv !== undefined) return mv;
  var e = C.emps[id];
  if (!e) return parseFloat(r[COL.PAY]) || 0;          // ไม่มีในรายชื่อ → ค่าที่เก็บไว้
  var p = calcDayPay_(e.payType, e.payRate, parseFloat(r[COL.HRS]) || 0, String(r[COL.STATUS] || ""),
                      toTimeStr_(r[COL.IN]), toTimeStr_(r[COL.OUT]), toDateStr_(r[COL.DATE]));
  return p > 0 ? Math.round(p * 100) / 100 : 0;
}

// ค่าปรับที่หักจริงในวันนั้น (ให้หน้าเว็บขึ้นสี) — แก้ค่าแรงเอง = ยกเว้น ไม่หัก · ไม่มีในรายชื่อ = คงค่าเดิม ไม่หัก
function fineOfRow_(r) {
  var C = payCtx_(), d = toDateStr_(r[COL.DATE]), id = String(r[COL.ID]).trim();
  if (C.man[d + "|" + id] !== undefined || !C.emps[id]) return { late: 0, early: 0, total: 0 };
  return dayFines_(d, String(r[COL.STATUS] || ""), r[COL.IN], r[COL.OUT]);
}

// 🔴 [v9.8] หนี้ยกมา ณ ต้นช่วงที่ดู — กติกาเดียวกับ debtAt_() ในสคริปต์ชีต
//    ดูงวดที่ตัดหนี้ไปแล้ว → "K เดิม" ของการตัดครั้งนั้น (เดิมใช้ K ปัจจุบัน = เบิกงวดนั้นถูกหัก 2 รอบ)
var _settleIdx_ = null;
function debtAtWeb_(empId, fromStr, curK) {
  curK = parseFloat(curK) || 0;
  if (!fromStr) return curK;
  if (!_settleIdx_) {
    _settleIdx_ = {};
    try {
      var sh = book_("TIME").getSheetByName(SETTLE_SHEET);
      if (sh && sh.getLastRow() >= 2) {
        sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function(r) {
          var id = String(r[3] || "").trim(), f = toDateStr_(r[1]), t = toDateStr_(r[2]);
          if (id && f && t) (_settleIdx_[id] = _settleIdx_[id] || []).push({ from: f, to: t, oldK: parseFloat(r[5]) || 0 });
        });
      }
    } catch (e) { Logger.log("debtAtWeb_: " + (e && e.message ? e.message : e)); }
  }
  var cover = null, after = null;
  (_settleIdx_[String(empId).trim()] || []).forEach(function(s) {
    if (s.from <= fromStr && fromStr <= s.to) { if (!cover) cover = s; }
    else if (s.from > fromStr && (!after || s.from < after.from)) after = s;
  });
  if (cover) return cover.oldK;
  if (after) return after.oldK;
  return curK;
}

function packRow_(r, i, src) {
  return {
    src:    src,
    row:    i + 2,
    date:   toDateStr_(r[COL.DATE]),
    id:     String(r[COL.ID]).trim(),
    name:   String(r[COL.NAME] || "").trim(),
    in:     toTimeStr_(r[COL.IN]),
    out:    toTimeStr_(r[COL.OUT]),
    hrs:    parseFloat(r[COL.HRS]) || 0,
    status: String(r[COL.STATUS] || "").trim(),
    pay:    payOfRow_(r),   // [v9.8] ตรงกับบิล/สลิป (เดิมอ่าน H ตรง ๆ)
    fine:   fineOfRow_(r),  // หักสาย/เลิกก่อน (รวมในค่าแรงแล้ว) — หน้าเว็บขึ้นสี
    adv:    parseFloat(r[COL.ADV]) || 0,
    tip:    parseFloat(r[COL.TIP]) || 0,
    payer:  String(r[COL.PAYER] || "").trim(),
    note:   String(r[COL.NOTE] || "").trim(),
    branch: normBranch_(r[COL.BRANCH]),
    closed: (src === "HISTORY"),
    timeLocked: (src === "DAILY" && LOCK_TIME_ON_OPEN_DAY)
  };
}

// ── 🔒 ลูกน้องไม่เห็นค่าแรง/ทิป/ยอดคงเหลือ — ตัดออกฝั่ง server ก่อนส่ง ──
//    (ซ่อนแค่ในหน้าเว็บไม่พอ ใครก็เรียก api() ตรง ๆ ได้)
function blankPay_(s) {
  if (s) { s.pay = null; s.tip = null; s.net = null; }
}

function scrubPay_(out) {
  if (!HIDE_PAY_FROM_STAFF || isOwner_()) return out;
  (out.rows || []).forEach(function(r) {
    r.pay = null; r.tip = null; r.per = null;   // ยอดรวมงวด (ค่าแรง/เบิก/คงเหลือ) = เจ้าของดูเท่านั้น
    (r.advs || []).forEach(function(a) { a.photo = ""; });   // รูปตอนเบิก = เจ้าของดูเท่านั้น
  });
  blankPay_(out.summary);
  out.hidePay = true;
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 🚀 [v10.1] อ่านเฉพาะแถวของช่วงวันที่
//    เดิมอ่านประวัติถาวร "ทั้งชีต" (หมื่นแถว × 13 คอลัมน์) ทุกครั้งที่เปิดหน้ารายวัน แม้วันนั้นอยู่ในสรุปรายวัน
//    ตอนนี้: อ่านคอลัมน์วันที่คอลัมน์เดียว → หาแถวแรก-แถวสุดท้ายที่ตรง → ดึงเต็มแถวเฉพาะช่วงนั้น
//    คืน [{ r: แถว, i: ลำดับนับจากแถว 2 }]  (i + 2 = เลขแถวจริงในชีต)
// ═══════════════════════════════════════════════════════════════════
function rowsIn_(name, fromStr, toStr) {
  if (name !== SH.HISTORY) {                       // ชีตเล็ก (สรุปรายวัน) อ่านทั้งชีตเหมือนเดิม
    return rows_("TIME", name, DATA_COLS).map(function(r, i) { return { r: r, i: i }; });
  }
  var sh = sheet_("TIME", name), last = sh.getLastRow();
  if (last < 2) return [];
  var dates = sh.getRange(2, 1, last - 1, 1).getValues(), lo = -1, hi = -1;
  for (var i = 0; i < dates.length; i++) {
    var d = toDateStr_(dates[i][0]);
    if (d && d >= fromStr && d <= toStr) { if (lo < 0) lo = i; hi = i; }
  }
  if (lo < 0) return [];
  var cols = Math.min(Math.max(sh.getLastColumn(), 1), DATA_COLS);
  return sh.getRange(lo + 2, 1, hi - lo + 1, cols).getValues().map(function(r, k) {
    while (r.length < DATA_COLS) r.push("");
    return { r: r, i: lo + k };
  });
}

// อ่านทีละแถว (แก้/เบิก แถวเดียว ไม่ต้องอ่านทั้งชีต) — แคชต่อการรัน
var _rowAt = {};
function rowAt_(name, row) {
  var k = name + "#" + row;
  if (_rowAt[k]) return _rowAt[k];
  row = Number(row);
  if (!(row >= 2)) return null;
  var sh = sheet_("TIME", name);
  if (row > sh.getLastRow()) return null;
  var r = sh.getRange(row, 1, 1, DATA_COLS).getValues()[0];
  return (_rowAt[k] = r);
}

// ── กวาดทุกแถวในช่วงวัน แล้วแยกเป็นถัง: รหัส → แถว, วันที่ → แถว ──
//    อ่านชีตครั้งเดียวต่อการรัน แม้จะขอ 22 คนพร้อมกัน
function collectRows_(fromStr, toStr, scope) {
  var flat = [], byId = {}, dayOf = {}, seen = {}, dup = [];
  [["HISTORY", SH.HISTORY], ["DAILY", SH.DAILY]].forEach(function(pair) {
    rowsIn_(pair[1], fromStr, toStr).forEach(function(x) {
      var r = x.r, i = x.i;
      var id = String(r[COL.ID]).trim();
      if (!id) return;
      if (!inScope_(id, scope)) return;      // ⭐ คนพิเศษกับคนงานธรรมดาไม่ปนกัน
      var d = toDateStr_(r[COL.DATE]);
      if (!d || d < fromStr || d > toStr) return;
      // วันเดียวกันโผล่ทั้ง 2 ชีต → ใช้ของ HISTORY (ปิดยอดแล้ว = ตัวจริง)
      if (dayOf[d] && dayOf[d] === "HISTORY" && pair[0] === "DAILY") return;
      if (!dayOf[d]) dayOf[d] = pair[0];
      if (dayOf[d] !== pair[0]) return;
      /* 🛡️ แถวซ้ำ "ในชีตเดียวกัน" — เกิดตอนปิดยอดวันเดียวกัน 2 รอบ
         (ทริกเกอร์ปิดยอด กับ ตัวปิดยอดอัตโนมัติตอนขึ้นวันใหม่ ชนกัน)
         ถ้าไม่กรอง: ค่าแรงรวม/วันทำงาน ของวันนั้นจะถูกนับสองเท่า
         เก็บแถวบนสุดไว้ (แถวที่แก้ผ่านเว็บแล้วเขียนกลับ) ที่เหลือรายงานไว้เตือน */
      var k = d + "|" + id;
      if (seen[k]) { dup.push({ date: d, id: id, src: pair[0], row: i + 2 }); return; }
      seen[k] = true;
      var o = packRow_(r, i, pair[0]);
      (byId[id] = byId[id] || []).push(o);
      flat.push(o);
    });
  });
  advAttach_(flat, advIndex_(fromStr, toStr));   // 📒 [v10] รายการเบิกของแต่ละแถว
  return { flat: flat, byId: byId, dayOf: dayOf, dup: dup };
}

function empMap_(scope) {
  var m = {};
  employeesBy_(scope).forEach(function(e) { m[e.id] = e; });
  return m;
}

function normRange_(fromStr, toStr) {
  var p = getPeriod_();
  var f = toDateStr_(fromStr) || p.from, t = toDateStr_(toStr) || p.to;
  return f > t ? { from: t, to: f } : { from: f, to: t };
}

function buildPerson_(emp, list, fromStr, toStr) {
  var debt = debtAtWeb_(emp.id, fromStr, emp.debt);   // [v9.8] หนี้ ณ ต้นช่วง
  list = (list || []).slice().sort(function(a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;      // ใหม่ → เก่า
  });
  return {
    emp: { id: emp.id, name: emp.name, payType: emp.payType,
           special: emp.special, branch: emp.branch, debt: debt },
    from: fromStr, to: toStr, rows: list,
    summary: summarize_(list, debt)
  };
}

// ═══════════════════════════════════════════════════════════════════
// 🖨️ ดึงหลายคนพร้อมกัน — ใช้ตอนพิมพ์ทีเดียวหลายใบ
// ═══════════════════════════════════════════════════════════════════
function timeGetPeople(ids, fromStr, toStr, scope) {
  if (!ids || !ids.length) throw new Error("ยังไม่ได้เลือกพนักงาน");
  if (ids.length > 60)     throw new Error("เลือกได้ไม่เกิน 60 คนต่อครั้ง");
  var R = normRange_(fromStr, toStr);
  var em = empMap_(scope);
  var C  = collectRows_(R.from, R.to, scope);

  var people = [];
  ids.forEach(function(raw) {
    var id = String(raw).trim(), e = em[id];
    if (!e) return;
    people.push(scrubPay_(buildPerson_(e, C.byId[id], R.from, R.to)));
  });
  return { from: R.from, to: R.to, people: people };
}

// ═══════════════════════════════════════════════════════════════════
// 👤 ดูรายคน — หน้าหลัก
// ═══════════════════════════════════════════════════════════════════
function timeGetPerson(empId, fromStr, toStr, scope) {
  empId = String(empId || "").trim();
  if (!empId) throw new Error("ยังไม่ได้เลือกพนักงาน");

  // ดูรายบุคคลเลือกคนได้ทั้งสองกลุ่ม — ยึด scope ตามตัวคนที่เลือก ไม่ต้องให้หน้าเว็บส่งมา
  var sc = isSpecialId_(empId) ? "special" : "normal";
  var R  = normRange_(fromStr, toStr);
  var em = empMap_(sc);
  var e  = em[empId];
  if (!e) throw new Error("ไม่พบรหัสพนักงาน " + empId);

  var C = collectRows_(R.from, R.to, sc);
  return scrubPay_(buildPerson_(e, C.byId[empId], R.from, R.to));
}

function summarize_(rows, debt) {
  var s = { days: rows.length, work: 0, absent: 0, late: 0, leave: 0,
            hrs: 0, pay: 0, adv: 0, tip: 0, branches: {},
            fine: 0, fineLate: 0, fineEarly: 0 };   // หักสาย/เลิกก่อน (รวมในค่าแรงแล้ว แยกโชว์)
  rows.forEach(function(r) {
    s.hrs += r.hrs; s.pay += r.pay; s.adv += r.adv; s.tip += r.tip;
    if (r.fine) { s.fine += r.fine.total; if (r.fine.late) s.fineLate++; if (r.fine.early) s.fineEarly++; }
    var off = r.status.indexOf("ไม่มา") >= 0;
    var lv  = isLeaveStatus_(r.status);
    if (off)      s.absent++;
    else if (lv)  s.leave++;
    else { s.work++; if (r.status.indexOf("มาสาย") >= 0) s.late++; }
    if (r.branch && !off && !lv) s.branches[r.branch] = (s.branches[r.branch] || 0) + 1;
  });
  s.hrs   = Math.round(s.hrs * 100) / 100;
  s.pay   = Math.round(s.pay * 100) / 100;
  s.debt  = debt || 0;
  s.owe   = Math.round((s.adv + s.debt) * 100) / 100;   // เบิกงวดนี้ + หนี้ยกมา
  s.net   = Math.round((s.pay + s.tip - s.owe) * 100) / 100;
  s.branchList = Object.keys(s.branches)
    .sort(function(a, b) { return s.branches[b] - s.branches[a]; })
    .map(function(k) { return k + " × " + s.branches[k]; });
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// 📅 ดูรายวัน — ภาพรวมทั้งวัน
// ═══════════════════════════════════════════════════════════════════
function timeGetDay(dateStr, scope) {
  // 🛡️ [G 2026-10-09] เช็คสิทธิ์ซ้ำในตัวฟังก์ชัน — ฟังก์ชันที่ไม่ลงท้าย _ เรียกตรงผ่าน google.script.run ได้
  //   (ข้าม api()/ROUTES) → เดิมหน้าเว็บที่ไม่มีคีย์ก็ดึงรายวัน/ประวัติของทุกคน (เบิก/หมายเหตุ) ได้
  requireCan_(STAFF_CAN_DAY, "ดูรายวัน");
  if (!dateStr || dateStr === "latest") dateStr = latestDay_();   // [v10] หน้า "ดูรายวัน" = วันล่าสุดเท่านั้น
  dateStr = toDateStr_(dateStr);
  if (!dateStr) throw new Error("วันที่ไม่ถูกต้อง");

  var out = [], src = null, seen = {}, dup = [];
  [["HISTORY", SH.HISTORY], ["DAILY", SH.DAILY]].forEach(function(pair) {
    if (out.length) return;                       // เจอในประวัติแล้ว ไม่ต้องดูสรุปรายวัน
    rowsIn_(pair[1], dateStr, dateStr).forEach(function(x) {
      var r = x.r, i = x.i;
      if (toDateStr_(r[COL.DATE]) !== dateStr) return;
      var id = String(r[COL.ID]).trim();
      if (!id) return;
      if (!inScope_(id, scope)) return;      // ⭐ แยกกลุ่ม
      src = pair[0];
      // 🛡️ กันแถวซ้ำจากการปิดยอดซ้ำ — ไม่งั้นยอดรวมของวันนี้คูณสอง
      if (seen[id]) { dup.push({ date: dateStr, id: id, src: pair[0], row: i + 2 }); return; }
      seen[id] = true;
      out.push(packRow_(r, i, pair[0]));
    });
  });

  if (!out.length) return { date: dateStr, found: false, rows: [] };
  out.sort(function(a, b) { return cmpId_(a.id, b.id); });
  advAttach_(out, advIndex_(dateStr, dateStr));   // 📒 [v10]
  // 💰 ค่าแรงรวม / เบิกรวม / คงเหลือ ของงวดนี้ (ต้นงวด → วันที่ดู) รายคน — เห็นว่าใครเบิกเกินค่าแรงที่ทำได้ (19 ต.ค.)
  //   ค่าแรงรวมรวมทิปแล้ว · ไม่รวมหนี้ยกมา (ดูในหน้ารายคน) · อ่านไม่ได้ = ไม่โชว์ช่องนี้ ไม่ทำให้หน้ารายวันพัง
  var P = periodOf_(dateStr), per = null;
  try {
    per = {};
    var C = collectRows_(P.from, dateStr, scope);
    Object.keys(C.byId).forEach(function(id) {
      var t = { pay: 0, adv: 0 };
      C.byId[id].forEach(function(x) { t.pay += (x.pay || 0) + (x.tip || 0); t.adv += x.adv || 0; });
      t.pay = Math.round(t.pay * 100) / 100;
      t.adv = Math.round(t.adv * 100) / 100;
      t.net = Math.round((t.pay - t.adv) * 100) / 100;
      per[id] = t;
    });
  } catch (e) { per = null; Logger.log("ยอดรวมงวด: " + (e && e.message ? e.message : e)); }
  out.forEach(function(r) { r.per = per ? (per[r.id] || { pay: 0, adv: 0, net: 0 }) : null; });
  var req = closeReqOf_(dateStr);
  return scrubPay_({
    date: dateStr, found: true, src: src, dup: dup, scope: (scope === "special" ? "special" : "normal"),
    closed: (src === "HISTORY"),
    canClose: canCloseDay_(dateStr, src),
    closeReq: (src === "DAILY" && req) ? req : null,
    timeLocked: (src === "DAILY" && LOCK_TIME_ON_OPEN_DAY),
    rows: out, summary: summarize_(out, 0),
    per: per ? { from: P.from, to: dateStr } : null
  });
}

// ═══════════════════════════════════════════════════════════════════
// 📆 ดูรายเดือน — แถบพับได้ทีละวัน แก้ได้ทุกวัน
//    ym = "2026-09"
// ═══════════════════════════════════════════════════════════════════
// ── ช่วงเดือน: ymFrom..ymTo (ค่าเริ่มต้น = 2 เดือนล่าสุด) ──
var MAX_MONTHS = 6;

function monthRange_(ymFrom, ymTo) {
  var re = /^\d{4}-\d{2}$/;
  var b = re.test(String(ymTo   || "")) ? ymTo   : todayStr_().slice(0, 7);
  var a = re.test(String(ymFrom || "")) ? ymFrom : shiftYm_(b, -1);
  if (a > b) { var s = a; a = b; b = s; }
  if (countYm_(a, b) > MAX_MONTHS) a = shiftYm_(b, -(MAX_MONTHS - 1));
  return { a: a, b: b };
}

function shiftYm_(ym, n) {
  var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10) - 1 + n;
  var d = new Date(y, m, 1);
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
}

function countYm_(a, b) {
  return (parseInt(b.slice(0, 4), 10) - parseInt(a.slice(0, 4), 10)) * 12 +
         (parseInt(b.slice(5, 7), 10) - parseInt(a.slice(5, 7), 10)) + 1;
}

function timeGetMonths(ymFrom, ymTo, scope) {
  requireCan_(STAFF_CAN_MONTH, "ดูรายเดือน");   // [G] เรียกตรงผ่าน google.script.run ได้ — เช็คซ้ำ
  var R = monthRange_(ymFrom, ymTo);
  var ey = parseInt(R.b.slice(0, 4), 10), em = parseInt(R.b.slice(5, 7), 10);
  var last = new Date(ey, em, 0).getDate();
  return historyOf_(R.a + "-01", R.b + "-" + ("0" + last).slice(-2), scope, R.a, R.b);
}

// ═══════════════════════════════════════════════════════════════════
// 📜 [v10] ประวัติการทำงาน — เลือกช่วงวันที่เองได้ (แทน "ดูราย 2 เดือน")
// ═══════════════════════════════════════════════════════════════════
var MAX_RANGE_DAYS = 186;
function timeGetRange(fromStr, toStr, scope) {
  requireCan_(STAFF_CAN_MONTH, "ดูประวัติการทำงาน");   // [G] เรียกตรงผ่าน google.script.run ได้ — เช็คซ้ำ
  var R = normRange_(fromStr, toStr);
  var days = Math.round((new Date(R.to + "T00:00:00") - new Date(R.from + "T00:00:00")) / 864e5) + 1;
  if (days > MAX_RANGE_DAYS) throw new Error("เลือกช่วงได้ไม่เกิน " + MAX_RANGE_DAYS + " วัน (ประมาณ 6 เดือน)");
  return historyOf_(R.from, R.to, scope, R.from.slice(0, 7), R.to.slice(0, 7));
}

// วันล่าสุดที่มีข้อมูล = วันในสรุปรายวัน (ยังไม่ปิด) ถ้ามี ไม่งั้นวันล่าสุดในประวัติถาวร
function latestDay_() {
  var best = "";
  rows_("TIME", SH.DAILY, DATA_COLS).forEach(function(r) {
    var d = toDateStr_(r[COL.DATE]); if (String(r[COL.ID]).trim() && d > best) best = d; });
  if (best) return best;
  rows_("TIME", SH.HISTORY, DATA_COLS).forEach(function(r) {
    var d = toDateStr_(r[COL.DATE]); if (String(r[COL.ID]).trim() && d > best) best = d; });
  return best || todayStr_();
}

function historyOf_(from, to, scope, ymA, ymB) {
  var R = { a: ymA, b: ymB };
  var C = collectRows_(from, to, scope);

  var flat = C.flat.slice().sort(function(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;   // วันใหม่ → เก่า
    return cmpId_(a.id, b.id);
  });

  // สรุปย่อรายเดือน + รายวัน
  var months = {}, days = [], cur = null;
  flat.forEach(function(r) {
    var ym = r.date.slice(0, 7);
    (months[ym] = months[ym] || []).push(r);
    if (!cur || cur.date !== r.date) { cur = { date: r.date, list: [] }; days.push(cur); }
    cur.list.push(r);
  });
  days.forEach(function(d) { d.summary = summarize_(d.list, 0); d.n = d.list.length; delete d.list; });

  var byMonth = Object.keys(months).sort().reverse().map(function(ym) {
    return { ym: ym, n: months[ym].length, summary: summarize_(months[ym], 0) };
  });

  // ⚠️ ต้อง scrub ด้วย — HIDE_PAY_FROM_STAFF กับ STAFF_CAN_MONTH เป็นคนละสวิตช์
  //    เปิดให้ลูกน้องดูรายเดือนเมื่อไหร่ ค่าแรงจะหลุดทันทีถ้าไม่กรองตรงนี้
  var out = scrubPay_({
    ymFrom: R.a, ymTo: R.b, from: from, to: to, scope: (scope === "special" ? "special" : "normal"),
    rows: flat, days: days, byMonth: byMonth, dup: C.dup,
    summary: summarize_(flat, 0)
  });
  if (out.hidePay) {
    byMonth.forEach(function(m) { blankPay_(m.summary); });
    days.forEach(function(d)    { blankPay_(d.summary); });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 🖊️ เขียนเวลาลง "ชีทเก็บข้อมูลดิบสแกนหน้า"
//    ทำไมต้องเขียน: สคริปต์ในชีต (autoUpdateDailySummaryCore_) สร้างสรุปรายวัน
//    ใหม่จากชีตดิบทุกครั้งที่ทริกเกอร์ทำงาน — แก้แค่สรุปรายวันเดี๋ยวก็โดนทับ
//    แก้ที่ต้นทางด้วย → ทริกเกอร์รันกี่รอบก็ได้ค่าเดิม
//
//    โครงชีตดิบ: A วันที่ · B รหัส · C ชื่อ · D เวลา   (ไม่มีหัวคอลัมน์ เริ่มแถว 1)
//    คอลัมน์ D อ่านด้วย getDisplayValues() → ต้องเขียนเป็นข้อความ ตรึงรูปแบบ "@"
// ═══════════════════════════════════════════════════════════════════
var RAW_COLS     = 4;
var RAW_GAP_MIN  = 10;   // สคริปต์เดิมยุบสแกนที่ห่างกันน้อยกว่านี้เป็นครั้งเดียว

function rawRewrite_(dateStr, empId, name, cIn, cOut) {
  return rawRewriteMany_([{ date: dateStr, id: empId, name: name, cIn: cIn, cOut: cOut }]);
}

// 🚀 [v10.1] หลายคนในครั้งเดียว — อ่านคอลัมน์ วันที่/รหัส ครั้งเดียว
// 🛡️ [G 2026-10-09] แก้เฉพาะแถวของ (วันนั้น + คนนั้น) — ไม่ล้างแล้วเขียนกลับทั้งชีทอีกต่อไป
//   เดิม: อ่านทั้งชีท → ล้างทั้งชีท → เขียนกลับ ถ้าเครื่องสแกนหน้าเพิ่มแถวใหม่ระหว่างนั้น (1–3 วิ)
//   แถวนั้นโดนเขียนทับหาย (เช่นคนที่เพิ่งสแกนออก → "ลืมสแกนออก" ได้ครึ่งวัน) — บัคที่พบ 2026-10-02 ข้อ 7
//   ตอนนี้: เขียนทับแถวเดิมของคนนี้ทีละแถว (ตรวจซ้ำว่ายังเป็นของคนนี้ก่อนเขียน)
//           แถวเดิมเกิน → ล้างให้ว่าง · แถวเดิมไม่พอ → appendRow (ต่อท้ายแบบอะตอม ไม่ชนเครื่องสแกน)
//   แถวว่างที่เหลือไม่มีผล (สคริปต์ในชีตข้ามแถวที่ไม่มีวันที่) · แถวของคนอื่น/วันอื่นไม่ถูกแตะเลย
function rawRewriteMany_(list) {
  var sh    = sheet_("TIME", SH.RAW);
  var last  = sh.getLastRow();
  var ab    = last >= 1 ? sh.getRange(1, 1, last, 2).getValues() : [];
  var keyOf = function(r) { return toDateStr_(r[0]) + "|" + String(r[1]).trim(); };
  var total = 0;
  list.forEach(function(x) {
    var id = String(x.id).trim(), key = x.date + "|" + id;
    var hits = [];
    for (var i = 0; i < ab.length; i++) if (keyOf(ab[i]) === key) hits.push(i + 1);

    var add = [];
    var mk  = function(t) {
      return [x.date, id, String(x.name || ""), t.length === 5 ? t + ":00" : t];   // "08:02" → "08:02:00"
    };
    if (!isBlankTime_(x.cIn))  add.push(mk(x.cIn));
    if (!isBlankTime_(x.cOut)) add.push(mk(x.cOut));

    for (var k = 0; k < Math.max(hits.length, add.length); k++) {
      if (k < hits.length) {
        // ตรวจซ้ำ — สคริปต์ในชีตอาจปิดยอดแล้วล้างแถวของวันที่ปิด (แถวเลื่อน) ระหว่างนี้
        if (keyOf(sh.getRange(hits[k], 1, 1, 2).getValues()[0]) !== key)
          throw new Error("ชีทสแกนเปลี่ยนระหว่างบันทึก (ระบบเพิ่งปิดยอด/จัดแถว) — กดโหลดใหม่แล้วแก้อีกครั้ง");
        var rg = sh.getRange(hits[k], 1, 1, RAW_COLS);
        if (k < add.length) {
          sh.getRange(hits[k], 4).setNumberFormat("@");   // กันเวลาเพี้ยนเป็นปี 1899
          rg.setValues([add[k]]);
        } else {
          rg.clearContent();
        }
      } else {
        sh.appendRow(add[k]);
      }
    }
    total += add.length;
  });
  return total;
}

// เวลาเข้า-ออกต้องห่างพอ ไม่งั้นสคริปต์เดิมยุบเป็นสแกนเดียว → กลายเป็น "ลืมสแกนออก"
function rawGapOk_(dateStr, cIn, cOut) {
  if (isBlankTime_(cIn) || isBlankTime_(cOut)) return true;
  var a = new Date(dateStr + "T" + cIn + ":00");
  var b = new Date(dateStr + "T" + cOut + ":00");
  if (isNaN(a) || isNaN(b)) return true;
  return Math.abs(b - a) / 60000 >= RAW_GAP_MIN;
}

// ═══════════════════════════════════════════════════════════════════
// 💰 ค่าแรงที่พิมพ์ทับสูตร — เก็บในชีท "💰 ค่าแรงแก้มือ"
//    ทำไมต้องเก็บ: autoUpdateDailySummaryCore_ คิดค่าแรงใหม่จากสูตรทุกครั้ง
//    ไม่ได้คงค่าคอลัมน์ H ไว้เหมือน เบิก/ทิป/สาขา → พิมพ์ทับแล้วโดนล้าง
//    ชีทนี้เป็นที่เดียวที่รอด เพราะสคริปต์ในชีตอ่านมันก่อนเขียนทับ
//    (ใช้ได้ต่อเมื่อแก้ รหัส.gs v9.7 ของชีต work spaec 4 จุดตามคู่มือแล้ว)
//    โครง: A วันที่ | B รหัส | C ค่าแรง | D แก้เมื่อ   (แถว 1 = หัวคอลัมน์)
// ═══════════════════════════════════════════════════════════════════
function manualPaySheet_() {
  var ss = book_("TIME");
  var sh = ss.getSheetByName(MANUAL_PAY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MANUAL_PAY_SHEET, ss.getNumSheets());
    sh.getRange(1, 1, 1, 4).setValues([["วันที่", "รหัส", "ค่าแรง", "แก้เมื่อ"]])
      .setFontWeight("bold").setBackground("#0f2942").setFontColor("#ffffff");
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 1).setNumberFormat("@");
  }
  return sh;
}

//   pay = null → ลบรายการนั้นทิ้ง (กลับไปใช้สูตร)
function manualPaySet_(dateStr, empId, pay) {
  return manualPaySetMany_([{ date: dateStr, id: empId, pay: pay }]);
}

// 🚀 [v10.1] หลายแถวในครั้งเดียว · ไม่มีอะไรเปลี่ยน (แก้เวลาคนที่ไม่เคยแก้ค่าแรงมือ) = ไม่เขียนชีตเลย
function manualPaySetMany_(list) {
  var sh   = manualPaySheet_();
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];

  var drop = {};
  list.forEach(function(x) { drop[x.date + "|" + String(x.id).trim()] = 1; });
  var keep = rows.filter(function(r) {
    return !drop[toDateStr_(r[0]) + "|" + String(r[1]).trim()];
  });
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm");
  var added = 0;
  list.forEach(function(x) {
    if (x.pay !== null && x.pay !== undefined && !isNaN(x.pay)) {
      keep.push([x.date, String(x.id), Math.round(x.pay * 100) / 100, stamp]); added++;
    }
  });
  if (!added && keep.length === rows.length) return keep.length;
  if (last >= 2) sh.getRange(2, 1, last - 1, 4).clearContent();
  if (keep.length) {
    sh.getRange(2, 1, keep.length, 1).setNumberFormat("@");
    sh.getRange(2, 2, keep.length, 1).setNumberFormat("@");
    sh.getRange(2, 1, keep.length, 4).setValues(keep);
  }
  return keep.length;
}

// ═══════════════════════════════════════════════════════════════════
// 💾 บันทึกการแก้ไข — ใช้ได้ทั้ง 2 หน้า
//    changes = [{ src, row, id, date, field, value }, ...]
// ═══════════════════════════════════════════════════════════════════
function timeSaveRows(changes, requestId) {
  requireOwner_();
  if (!changes || !changes.length) return { changed: 0 };
  if (changes.length > MAX_EDIT) throw new Error("แก้ทีเดียวได้ไม่เกิน " + MAX_EDIT + " ช่อง");

  changes.forEach(function(c) {
    if (EDITABLE.indexOf(c.field) < 0) throw new Error('ช่อง "' + c.field + '" แก้ไม่ได้');
    if (LOCK_TIME_ON_OPEN_DAY && c.src === "DAILY" && (c.field === "in" || c.field === "out"))
      throw new Error("วันที่ " + c.date + " ยังไม่ปิดยอด — แก้เวลาไม่ได้ (LOCK_TIME_ON_OPEN_DAY = true)");
  });

  return onceOnly_(requestId, function() {
    return withLock_(function() {
      cacheClear_();
      var emps = {};
      employees_().forEach(function(e) { emps[e.id] = e; });

      // จัดกลุ่ม: ชีต → แถว
      //   🚀 [v10.1] แก้ไม่กี่แถว → อ่านเฉพาะแถวนั้น (เดิมอ่านประวัติถาวรทั้งชีตทุกครั้งที่กดบันทึก)
      var nRows = {};
      changes.forEach(function(c) { nRows[c.src + ":" + c.row] = 1; });
      var few = Object.keys(nRows).length <= 15;
      var buckets = {};
      changes.forEach(function(c) {
        var name = srcSheet_(c.src), r;
        if (few) r = rowAt_(name, c.row);
        else     r = rows_("TIME", name, DATA_COLS)[Number(c.row) - 2];
        if (!r) throw new Error("แถว " + c.row + " ไม่มีอยู่จริง");
        if (String(r[COL.ID]).trim() !== String(c.id).trim() ||
            toDateStr_(r[COL.DATE]) !== toDateStr_(c.date))
          throw new Error("แถว " + c.row + " ไม่ตรงกับข้อมูลเดิม — ชีตถูกแก้ระหว่างทาง กรุณาโหลดใหม่");
        var k = c.src + ":" + c.row;
        buckets[k] = buckets[k] || { src: c.src, name: name, row: Number(c.row), r: r.slice(),
                                     time: false, timeTouched: false, payTouched: false, statusTouched: false };
        if (c.field === "in" || c.field === "out")   buckets[k].time = true;          // ต้องอัปชีตดิบ
        if (TIME_FIELDS.indexOf(c.field) >= 0)       buckets[k].timeTouched = true;   // ค่าแรงคิดใหม่
        if (c.field === "status")                    buckets[k].statusTouched = true; // ชม./สถานะคิดใหม่
        if (c.field === "pay")                       buckets[k].payTouched  = true;
        applyField_(buckets[k].r, c.field, c.value);
      });

      // [XC2-6] วันที่เจ้าของกำลังแก้ในชีต (โหมดแก้ย้อนหลัง) → ห้ามเขียนวันนั้น (หายตอนกด 💾 / ลบ P1)
      var editingNow = editingDate_();
      Object.keys(buckets).forEach(function(k) { requireNotEditing_(buckets[k].r[COL.DATE], editingNow); });

      // ยามเรื่องช่วงห่างสแกน — ตรวจก่อนเขียนอะไรทั้งนั้น
      Object.keys(buckets).forEach(function(k) {
        var b = buckets[k];
        if (b.src !== "DAILY" || !b.time) return;
        var d = toDateStr_(b.r[COL.DATE]);
        var ci = toTimeStr_(b.r[COL.IN]), co = toTimeStr_(b.r[COL.OUT]);
        if (!rawGapOk_(d, ci, co))
          throw new Error(
            "เวลาเข้า-ออกห่างกันน้อยกว่า " + RAW_GAP_MIN + " นาที\n" +
            "ระบบสแกนจะยุบเป็นครั้งเดียวแล้วกลายเป็น \"ลืมสแกนออก\"\n\n" +
            "ถ้าตั้งใจให้เป็นแบบนั้น ให้ล้างเวลาออกทิ้งแทน");
        // 🛡️ [G 2026-10-09] เวลาออกก่อนเวลาเข้า (กะข้ามคืน / พิมพ์สลับ) ในวันที่ยังไม่ปิดยอด
        //   เว็บคิด ชม. กะดึกถูก แต่ชีตดิบเก็บแค่ "เวลา" ของวันเดียว — สคริปต์ในชีตเรียงสแกนใหม่
        //   เป็น เข้า=เวลาน้อย ออก=เวลามาก (20:00→02:00 กลายเป็น 08:00→20:00 = 11 ชม. + OT)
        //   แล้วเขียนทับภายใน 1–5 นาที = ค่าแรงผิดเงียบ ๆ (บัคที่พบ 2026-10-02 ข้อ 3) → ห้ามไว้ก่อน
        if (!isBlankTime_(ci) && !isBlankTime_(co) && co < ci)
          throw new Error(
            "วันที่ " + d + " ยังไม่ปิดยอด — ใส่เวลาออก (" + co + ") ก่อนเวลาเข้า (" + ci + ") ไม่ได้\n" +
            "ระบบสแกนจะเรียงใหม่เป็น เข้า " + co + " ออก " + ci + " แล้วคิดชั่วโมง/OT ผิด\n\n" +
            "ถ้าเป็นกะข้ามคืน: ปิดยอดวันนั้นก่อน แล้วแก้เวลาใน \"ประวัติการทำงาน\"");
      });

      // 🛡️ [G 2026-10-09] ยืนยันแถวอีกครั้งก่อนเขียน — สคริปต์ในชีต (คนละโปรเจกต์ ใช้ล็อกร่วมกันไม่ได้)
      //   อาจปิดยอด (แทรกแถวบนสุดของประวัติ / ล้างสรุปรายวันเป็นวันพรุ่งนี้) ระหว่างที่เราเขียนชีตดิบ/ค่าแรงมือ
      //   เดิมเขียนตามเลขแถวที่ตรวจไว้ตอนต้น → ไปทับแถวของคนอื่น/วันอื่น (ค่าแรง/เบิกผิดคนเงียบ ๆ)
      // [XC2-7] ตรวจ "ก่อน" เขียนชีตดิบ/ค่าแรงมือ (ทุกแถว) และตรวจซ้ำก่อนเขียนแต่ละแถว
      //   (อ่านจากชีตตรง ๆ ไม่ใช้แถวที่จำไว้ตอนต้น)
      var rowStillHere = function(b) {
        var cur = sheet_("TIME", b.name).getRange(b.row, 1, 1, 2).getValues()[0];
        return String(cur[COL.ID]).trim() === String(b.r[COL.ID]).trim() &&
               toDateStr_(cur[COL.DATE]) === toDateStr_(b.r[COL.DATE]);
      };
      var movedErr = function(b, done) {
        return new Error("แถว " + b.row + " ถูกย้ายระหว่างบันทึก (ชีตเพิ่งปิดยอดหรือจัดแถวใหม่) — " +
                         "บันทึกไปแล้ว " + done + " แถว กดโหลดใหม่แล้วแก้ที่เหลืออีกครั้ง");
      };

      var n = 0, rawN = 0, raw = [], pays = [];
      Object.keys(buckets).forEach(function(k) {
        var b = buckets[k];
        if (!rowStillHere(b)) throw movedErr(b, 0);
        var d = toDateStr_(b.r[COL.DATE]), id = String(b.r[COL.ID]).trim();
        recalcRow_(b.r, d, emps[id],
                   { timeTouched: b.timeTouched, payTouched: b.payTouched, statusTouched: b.statusTouched });
        // วันที่ยังไม่ปิดยอด + แก้เวลา → เขียนต้นทาง (ชีตดิบ) ด้วย — รวบเขียนครั้งเดียวด้านล่าง
        if (b.src === "DAILY" && b.time)
          raw.push({ date: d, id: id, name: String(b.r[COL.NAME] || ""), cIn: toTimeStr_(b.r[COL.IN]), cOut: toTimeStr_(b.r[COL.OUT]) });
        // 💰 [v9.8] ค่าแรงแก้มือ (บัตร/บิล/สลิป/ตัดหนี้ในชีตอ่านจากชีทนี้) — รวบเขียนครั้งเดียว
        if (b.payTouched)       pays.push({ date: d, id: id, pay: parseFloat(b.r[COL.PAY]) });
        else if (b.timeTouched) pays.push({ date: d, id: id, pay: null });   // แก้เวลา = เลิกแก้มือ
      });

      if (pays.length) {
        try { manualPaySetMany_(pays); }
        catch (e) {
          // เดิมกลืน error แล้วตอบว่าสำเร็จ → ค่าแรงที่พิมพ์โชว์แป๊บเดียว ทริกเกอร์คิดสูตรทับภายใน 1-5 นาที
          throw new Error("บันทึกค่าแรงที่พิมพ์เองไม่สำเร็จ (ชีตค่าแรงมือ): " + e.message + " — ยังไม่ได้บันทึก ลองใหม่อีกครั้ง");
        }
      }
      if (raw.length) rawN = rawRewriteMany_(raw);

      Object.keys(buckets).forEach(function(k) {
        var b = buckets[k];
        var sh = sheet_("TIME", b.name);
        if (!rowStillHere(b)) throw movedErr(b, n);
        // ตรึง D/E เป็นข้อความก่อนเขียน — กัน Sheets แปลง "08:30" เป็นวันที่ปี 1899
        sh.getRange(b.row, COL.IN + 1, 1, 2).setNumberFormat("@");
        sh.getRange(b.row, 1, 1, DATA_COLS).setValues([b.r]);
        n++;
      });
      SpreadsheetApp.flush();
      cacheClear_();
      _payCtx_ = null;
      return { changed: n, rawWritten: rawN };
    });
  });
}

function applyField_(r, field, value) {
  var v = String(value == null ? "" : value).trim();
  if (field === "in" || field === "out") {
    r[fieldCol_()[field]] = v ? toTimeStr_(v) : "--:--";
  } else if (field === "status") {
    r[COL.STATUS] = v;
  } else if (field === "branch") {
    r[COL.BRANCH] = normBranch_(v);
  } else if (NUM_FIELDS.indexOf(field) >= 0) {
    if (v === "") { r[fieldCol_()[field]] = ""; return; }
    var n = parseFloat(v.replace(/,/g, ""));
    if (isNaN(n)) throw new Error('"' + value + '" ไม่ใช่ตัวเลข');
    r[fieldCol_()[field]] = Math.round(n * 100) / 100;
  } else {                       // payer / note
    r[fieldCol_()[field]] = v;
  }
}

// ── คิด ชม. → สถานะ → ค่าแรง ใหม่ ──
//    ⚠️ ลำดับนี้ต้องเหมือน recalcHistoryRows_() ใน รหัส.gs v9.7 เป๊ะ ๆ
function recalcRow_(r, dateStr, emp, opt) {
  opt = opt || {};
  var cIn  = toTimeStr_(r[COL.IN]);
  var cOut = toTimeStr_(r[COL.OUT]);
  r[COL.IN] = cIn; r[COL.OUT] = cOut;

  // ⚠️ ลำดับนี้ต้องเหมือน recalcHistoryRows_() ใน รหัส.gs v9.7 เป๊ะ ๆ
  var st  = String(r[COL.STATUS] || "").trim();
  var hrs = calcWorkHours_(dateStr, cIn, cOut);   // คิดเสมอ แม้เป็นสถานะพิเศษ

  // คิด ชม./สถานะ ใหม่เฉพาะเมื่อแก้เวลาหรือสถานะ (หรือยังว่าง / ขอคืนค่าอัตโนมัติ)
  // แก้แค่หมายเหตุ/เบิก/ทิป/สาขา → คง ชม. ที่พิมพ์เองและสถานะลาแบบกำหนดเองไว้ (เดิมถูกคำนวณทับ เงินเปลี่ยน)
  var redo = opt.timeTouched || opt.statusTouched || !st || st === STATUS_AUTO;
  if (redo) {
    if (SPECIAL_STATUSES.indexOf(st) < 0) st = statusFromTimes_(cIn, cOut);
    if (!st || st === STATUS_AUTO)        st = statusFromTimes_(cIn, cOut);
    r[COL.HRS] = hrs; r[COL.STATUS] = st;
  }

  // ── กติกาค่าแรง ──
  //   พิมพ์ค่าแรงเอง          → ใช้ตัวที่พิมพ์ ไม่คิดทับ
  //   แก้เวลา/สถานะ           → คิดใหม่จากสูตร (ทิ้งค่าที่เคยพิมพ์)
  //   แก้อย่างอื่น (สาขา/เบิก) → คงค่าเดิมไว้ ไม่แตะ
  var recalcPay = opt.timeTouched && !opt.payTouched;
  if (recalcPay && emp) {
    var pay = calcDayPay_(emp.payType, emp.payRate, hrs, st, cIn, cOut, dateStr);
    r[COL.PAY] = pay > 0 ? Math.round(pay * 100) / 100 : 0;
  }
  return r;   // ไม่มีในชีทรายชื่อ → คงค่าแรงเดิมไว้
}

// ── ข้อมูลตั้งต้น ──
function timeBootstrap() {
  var emps = employees_(), branches = {};
  emps.forEach(function(e) { if (e.branch) branches[e.branch] = 1; });
  rows_("TIME", SH.DAILY, DATA_COLS).forEach(function(r) {
    var b = normBranch_(r[COL.BRANCH]); if (b) branches[b] = 1;
  });
  var p = getPeriod_();
  var slim = function(e) {
    return { id: e.id, name: e.name, branch: e.branch, payType: e.payType };
  };
  return {
    canMonth:  isOwner_() || STAFF_CAN_MONTH,
    canDay:    isOwner_() || STAFF_CAN_DAY,
    hidePay:   HIDE_PAY_FROM_STAFF && !isOwner_(),
    today:     todayStr_(),
    period:    p,
    // ⭐ แยกสองกลุ่มตั้งแต่ตอนโหลด หน้าเว็บจะได้ไม่ต้องกรองเอง
    employees: emps.filter(function(e) { return !isSpecialId_(e.id); }).map(slim),
    special:   emps.filter(function(e) { return  isSpecialId_(e.id); }).map(slim),
    branches: Object.keys(branches).sort(),
    statuses: COMPUTED_STATUSES.concat(SPECIAL_STATUSES).concat([STATUS_AUTO])
  };
}
// ═══════════════════════════════════════════════════════════════════
// 📒 [v10] เบิกเงินแบบรายการ — 1 ครั้งที่เบิก = 1 แถวในชีท "📒 บันทึกเบิก"
//    แทนชีทเก่า "📒 บันทึกเบิกเงิน" (จดยอดบวก/ลบปนกัน อ่านยาก แก้ย้อนหลังแล้วเพี้ยน)
//    คอลัมน์ I (เบิก) ของสรุปรายวัน/ประวัติ = ผลรวมรายการที่ยังไม่ถูกลบ (ระบบเขียนให้เอง)
//    → บิล/สลิป/ตัดหนี้ ที่อ่านคอลัมน์ I ใช้ต่อได้เหมือนเดิม
//    ลบ = ไม่ลบแถวจริง แค่ใส่ "ลบแล้ว" (ย้อนดูได้ว่าใครลบอะไรเมื่อไหร่)
//    โครงเดียวกับสคริปต์ในชีต (ADV_ITEMS_SHEET) — แก้ที่หนึ่งต้องแก้อีกที่
// ═══════════════════════════════════════════════════════════════════
var ADV_ITEMS_SHEET = "📒 บันทึกเบิก";
var ADV_HEADS = ["รายการ", "วันที่", "เวลาเบิก", "รหัส", "ชื่อ", "จำนวน", "ผู้จ่าย",
                 "หมายเหตุ", "รูป", "ที่มา", "บันทึกเมื่อ", "ลบแล้ว"];
var AV = { ID: 0, DATE: 1, TIME: 2, EMP: 3, NAME: 4, AMT: 5, PAYER: 6, NOTE: 7,
           PHOTO: 8, SRC: 9, AT: 10, DEL: 11 };
var ADV_PHOTO_FOLDER = "รูปเบิกเงิน";
var CLOSE_FROM_HOUR  = 18;            // กดปิดยอดวันนี้เองได้ตั้งแต่ 18:00
var REQ_SHEET        = "_คำขอระบบ";  // เว็บฝากคำขอ → สคริปต์ในชีตทำให้ (ทริกเกอร์ทุก 1–5 นาที)

function advSheet_() {
  var ss = book_("TIME"), sh = ss.getSheetByName(ADV_ITEMS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(ADV_ITEMS_SHEET, ss.getNumSheets());
  sh.getRange(1, 1, 1, ADV_HEADS.length).setValues([ADV_HEADS])
    .setBackground("#0f2942").setFontColor("#ffffff").setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.getRange("A:D").setNumberFormat("@");
  return sh;
}

function advAll_() { return rows_("TIME", ADV_ITEMS_SHEET, ADV_HEADS.length); }

// รายการที่ยังไม่ถูกลบ จัดกลุ่ม "วันที่|รหัส"
function advIndex_(fromStr, toStr) {
  var idx = {};
  try { advSheet_(); } catch (e) { return idx; }
  advAll_().forEach(function(r) {
    if (!r[AV.ID] || String(r[AV.DEL] || "").trim()) return;
    var d = toDateStr_(r[AV.DATE]);
    if (fromStr && (d < fromStr || d > toStr)) return;
    var k = d + "|" + String(r[AV.EMP]).trim();
    (idx[k] = idx[k] || []).push(advPack_(r));
  });
  Object.keys(idx).forEach(function(k) {
    idx[k].sort(function(a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  });
  return idx;
}

function advPack_(r) {
  return { item: String(r[AV.ID]), time: toTimeStr_(r[AV.TIME]) === "--:--" ? "" : toTimeStr_(r[AV.TIME]),
           amt: parseFloat(r[AV.AMT]) || 0, payer: String(r[AV.PAYER] || "").trim(),
           note: String(r[AV.NOTE] || "").trim(), photo: String(r[AV.PHOTO] || "").trim(),
           src: String(r[AV.SRC] || "").trim() };
}

// ติดรายการเบิกให้แถว (ที่ packRow_ ทำไว้แล้ว)
//   ยอดในคอลัมน์ I ≠ ผลรวมรายการ (ข้อมูลก่อนมีระบบนี้ / มีคนพิมพ์ในชีตตรง ๆ)
//   → โชว์ส่วนต่างเป็น "ยอดเดิมในชีต" 1 รายการ ผลรวมบนจอจึงตรงกับคอลัมน์ I เสมอ
function advAttach_(rows, idx) {
  rows.forEach(function(r) {
    var list = (idx[r.date + "|" + r.id] || []).slice();
    var sum = list.reduce(function(s, a) { return s + a.amt; }, 0);
    var diff = Math.round((r.adv - sum) * 100) / 100;
    if (diff) list.unshift({ item: "legacy", time: "", amt: diff, payer: r.payer, note: "ยอดเดิมในชีต", photo: "", src: "ชีต" });
    r.advs = list;
  });
  return rows;
}

function advPhotoUrl_(id) { return id ? "https://drive.google.com/thumbnail?id=" + id + "&sz=w800" : ""; }

function advFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty("ADV_PHOTO_FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parent = DriveApp.getRootFolder();
  try { var it = DriveApp.getFileById(BOOKS.TIME).getParents(); if (it.hasNext()) parent = it.next(); } catch (e) {}
  var f = parent.createFolder(ADV_PHOTO_FOLDER);
  props.setProperty("ADV_PHOTO_FOLDER_ID", f.getId());
  return f;
}

function advSavePhoto_(b64, dateStr, empId) {
  if (!b64) return "";
  var m = String(b64).match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) throw new Error("ไฟล์รูปไม่ถูกต้อง");
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 4 * 1024 * 1024) throw new Error("รูปใหญ่เกินไป");
  var name = dateStr + "_" + empId + "_" + Utilities.formatDate(new Date(), TZ, "HHmmss") + ".jpg";
  var file = advFolder_().createFile(Utilities.newBlob(bytes, m[1], name));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return file.getId();
}

// หาแถวของ (วันที่, รหัส) ในสรุปรายวัน/ประวัติ — ยึดตำแหน่งที่หน้าเว็บส่งมา แล้วตรวจซ้ำ
//   🚀 [v10.1] อ่านแถวเดียว (เดิมอ่านทั้งชีต — ประวัติถาวรหมื่นแถว)
function advRow_(p) {
  var name = srcSheet_(p.src), r = rowAt_(name, p.row);
  if (!r || String(r[COL.ID]).trim() !== String(p.id).trim() || toDateStr_(r[COL.DATE]) !== toDateStr_(p.date))
    throw new Error("ข้อมูลในชีตเปลี่ยนไปแล้ว — กดโหลดใหม่ก่อน");
  return { sheet: sheet_("TIME", name), row: Number(p.row), r: r };
}

// รายการเบิก (ยังไม่ลบ) ของ วันที่+รหัส · อ่านชีตบันทึกเบิกครั้งเดียวต่อการรัน
//   แต่ละรายการมี _i = ลำดับในชีต (แถวจริง = _i + 2)
function advListOf_(dateStr, empId) {
  advSheet_();
  var out = [];
  advAll_().forEach(function(r, i) {
    if (!r[AV.ID] || String(r[AV.DEL] || "").trim()) return;
    if (String(r[AV.EMP]).trim() !== empId || toDateStr_(r[AV.DATE]) !== dateStr) return;
    var a = advPack_(r); a._i = i; out.push(a);
  });
  return out;
}

// ต่อท้ายชีตบันทึกเบิก (เขียนครั้งเดียว) แล้วเติมลงแคชให้ตรงกับชีต
function advAppend_(rows) {
  var sh = advSheet_(), all = advAll_(), at = all.length + 2;
  sh.getRange(at, 1, rows.length, 4).setNumberFormat("@");
  sh.getRange(at, 1, rows.length, ADV_HEADS.length).setValues(rows);
  rows.forEach(function(r) { all.push(r); });
  return at;
}

function advStamp_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"); }

// 🛡️ [G 2026-10-09] หาแถวของ (วันที่, รหัส) ใหม่ "ตอนจะเขียน"
//   สคริปต์ในชีต (คนละโปรเจกต์ ใช้ล็อกร่วมกันไม่ได้) อาจปิดยอดระหว่างที่เราเพิ่มรายการ:
//   แถวในสรุปรายวันกลายเป็นของวันพรุ่งนี้ (คนเดิม ตำแหน่งเดิม) / ประวัติถูกแทรกแถวบนสุดจนเลื่อน
//   เดิมเขียนตามเลขแถวที่ตรวจไว้ตอนต้น → ยอดเบิกวันนี้ไปลงแถวพรุ่งนี้ = หักซ้ำ
//   ตอนนี้: แถวเดิมยังใช่ → ใช้เลย · ไม่ใช่ → ไล่หาในชีตเดิม แล้วชีตอีกฝั่ง (วันที่ถูกปิดยอดไปแล้วอยู่ในประวัติ)
//   ไม่เจอเลย → null (ผู้เรียกยกเลิกรายการที่เพิ่งทำ)
function advLocate_(at, dateStr, empId) {
  var match = function(r) { return String(r[1]).trim() === empId && toDateStr_(r[0]) === dateStr; };
  var first = at.sheet, otherName = first.getName() === SH.DAILY ? SH.HISTORY : SH.DAILY;
  if (at.row >= 2 && at.row <= first.getLastRow() && match(first.getRange(at.row, 1, 1, 2).getValues()[0]))
    return { sheet: first, row: at.row };
  var order = [first, book_("TIME").getSheetByName(otherName)];
  for (var k = 0; k < order.length; k++) {
    var sh = order[k];
    if (!sh || sh.getLastRow() < 2) continue;
    var ab = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < ab.length; i++) if (match(ab[i])) return { sheet: sh, row: i + 2 };
  }
  return null;
}

// เขียนยอดรวม (I) + ผู้จ่าย (J) + โน้ตบนช่อง I ให้ตรงกับรายการ
//   [G] คืน null ถ้าหาแถวของ (วันที่, รหัส) ไม่เจอแล้ว (ไม่ได้เขียนอะไร)
function advSync_(at, list) {
  list = list.slice().sort(function(a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  var sum = Math.round(list.reduce(function(s, a) { return s + a.amt; }, 0) * 100) / 100;
  var payers = [];
  list.forEach(function(a) { if (a.payer && payers.indexOf(a.payer) < 0) payers.push(a.payer); });
  var loc = advLocate_(at, toDateStr_(at.r[COL.DATE]), String(at.r[COL.ID]).trim());
  if (!loc) return null;
  loc.sheet.getRange(loc.row, COL.ADV + 1, 1, 2).setValues([[sum || "", payers.join(", ")]]);
  var cell = loc.sheet.getRange(loc.row, COL.ADV + 1);
  if (!list.length) cell.clearNote();
  else cell.setNote("📒 รายการเบิก\n" + list.map(function(a) {
    return "  " + (a.time || "--:--") + "   " + a.amt.toLocaleString() + " ฿" +
           (a.payer ? "  " + a.payer : "") + (a.note ? "  (" + a.note + ")" : "");
  }).join("\n") + "\n────────────\nรวม " + sum.toLocaleString() + " ฿");
  return sum;
}

// ยอดในคอลัมน์ I ที่ยังไม่มีรายการรองรับ → บันทึกเป็นรายการ "ยอดเดิมในชีต" ก่อนเพิ่ม/ลบ/แก้
//   ใส่ลง list ให้ด้วย · คืนรหัสรายการใหม่ (ไม่มีส่วนต่าง = null)
function advAdoptLegacy_(at, dateStr, empId, name, list) {
  var sum = list.reduce(function(s, a) { return s + a.amt; }, 0);
  var diff = Math.round(((parseFloat(at.r[COL.ADV]) || 0) - sum) * 100) / 100;
  if (!diff) return null;
  var id = "A" + newId_().slice(0, 8);
  var row = [id, dateStr, "", empId, name, diff, String(at.r[COL.PAYER] || "").trim(),
             "ยอดเดิมในชีต", "", "ชีต", advStamp_(), ""];
  advAppend_([row]);
  var a = advPack_(row); a._i = advAll_().length - 1; list.push(a);
  return id;
}

// [G 2026-10-09] ใส่ "ลบแล้ว" ให้รายการตามรหัสรายการ (ชีทนี้มีแต่ต่อท้าย เลขแถวไม่เลื่อน)
function advMarkDel_(itemId, text) {
  cacheClear_();
  var all = advAll_();
  for (var i = all.length - 1; i >= 0; i--) {
    if (String(all[i][AV.ID]) === itemId) { advSheet_().getRange(i + 2, AV.DEL + 1).setValue(text); return true; }
  }
  return false;
}

function advCheck_(p) {
  var amt = parseFloat(String(p.amount == null ? "" : p.amount).replace(/,/g, ""));
  if (!(amt > 0)) throw new Error("ใส่จำนวนเงินเบิก");
  if (amt > 100000) throw new Error("จำนวนเงินมากผิดปกติ");
  var t = String(p.time || "").trim();
  if (t && !/^\d{1,2}:\d{2}$/.test(t)) throw new Error("เวลาไม่ถูกต้อง");
  return { amt: Math.round(amt * 100) / 100, time: t ? toTimeStr_(t) : "",
           payer: String(p.payer || "").trim().slice(0, 40), note: String(p.note || "").trim().slice(0, 200) };
}

function timeAddAdv(p, requestId) {
  requireOwner_();
  var v = advCheck_(p);
  return onceOnly_(requestId, function() {
    var photoId = advSavePhoto_(p.photo, toDateStr_(p.date), String(p.id).trim());   // อัปโหลดนอกล็อก (ช้า)
    return withLock_(function() {
      cacheClear_();
      var at = advRow_(p), d = toDateStr_(p.date), id = String(p.id).trim(), name = String(at.r[COL.NAME] || "");
      requireNotEditing_(d);   // [XC2-6] วันนั้นกำลังถูกแก้ในชีต → เบิกที่เขียนตอนนี้หายตอนกด 💾
      var list = advListOf_(d, id);
      advAdoptLegacy_(at, d, id, name, list);
      var item = "A" + newId_().slice(0, 8);
      var row = [item, d, v.time, id, name, v.amt, v.payer, v.note,
                 photoId ? advPhotoUrl_(photoId) : "", "เว็บ", advStamp_(), ""];
      advAppend_([row]);
      list.push(advPack_(row));
      var total = advSync_(at, list);
      if (total === null) {   // [G] แถวของวันนั้นหายไประหว่างทาง → ยกเลิกรายการที่เพิ่งเพิ่ม ไม่ให้ค้างแบบไม่มียอดรองรับ
        advMarkDel_(item, "ยกเลิกอัตโนมัติ " + advStamp_() + " (หาแถวในชีตไม่เจอ)");
        SpreadsheetApp.flush();
        throw new Error("ข้อมูลในชีตเปลี่ยนไประหว่างบันทึก (ปิดยอด/ย้ายแถว) — เบิกนี้ยังไม่ได้บันทึก กดโหลดใหม่แล้วบันทึกอีกครั้ง");
      }
      SpreadsheetApp.flush();
      return { item: item, total: total };
    });
  });
}

// หารายการในชีต (รองรับ "legacy" = ยอดเดิมในชีต → บันทึกเป็นรายการก่อน)
function advFind_(at, d, id, item, list) {
  var target = String(item || "");
  if (target === "legacy") target = advAdoptLegacy_(at, d, id, String(at.r[COL.NAME] || ""), list);
  for (var i = 0; i < list.length; i++) if (list[i].item === target) return list[i];
  throw new Error("ไม่พบรายการนี้ (อาจถูกลบ/แก้จากเครื่องอื่น) — กดโหลดใหม่");
}

function timeDelAdv(p, requestId) {
  requireOwner_();
  return onceOnly_(requestId, function() {
    return withLock_(function() {
      cacheClear_();
      var at = advRow_(p), d = toDateStr_(p.date), id = String(p.id).trim();
      requireNotEditing_(d);   // [XC2-6]
      var list = advListOf_(d, id), a = advFind_(at, d, id, p.item, list);
      var delCell = advSheet_().getRange(a._i + 2, AV.DEL + 1);
      delCell.setValue("ลบ " + advStamp_() + " (เว็บ)");
      list.splice(list.indexOf(a), 1);
      var total = advSync_(at, list);
      if (total === null) {   // [G] แถวของวันนั้นหายไประหว่างทาง → คืนรายการ (ไม่ลบ) ให้ยอดกับรายการตรงกันเหมือนเดิม
        delCell.setValue("");
        SpreadsheetApp.flush();
        throw new Error("ข้อมูลในชีตเปลี่ยนไประหว่างบันทึก (ปิดยอด/ย้ายแถว) — ยังไม่ได้ลบ กดโหลดใหม่แล้วลองอีกครั้ง");
      }
      SpreadsheetApp.flush();
      return { total: total };
    });
  });
}

// ✏️ [v10.1] แก้รายการเบิก (จำนวน/เวลา/ผู้จ่าย/หมายเหตุ/รูป) ในแถวเดิม — ไม่ต้องลบแล้วเขียนใหม่
//   ร่องรอย: ช่อง "บันทึกเมื่อ" ต่อท้ายว่าแก้เมื่อไหร่ ยอดเดิมเท่าไหร่
function timeEditAdv(p, requestId) {
  requireOwner_();
  var v = advCheck_(p);
  return onceOnly_(requestId, function() {
    var photoId = advSavePhoto_(p.photo, toDateStr_(p.date), String(p.id).trim());   // เปลี่ยนรูป (ถ้ามี) นอกล็อก
    return withLock_(function() {
      cacheClear_();
      var at = advRow_(p), d = toDateStr_(p.date), id = String(p.id).trim();
      requireNotEditing_(d);   // [XC2-6]
      var list = advListOf_(d, id), a = advFind_(at, d, id, p.item, list);
      var r = advAll_()[a._i];
      var was = r[AV.AT] instanceof Date ? Utilities.formatDate(r[AV.AT], TZ, "yyyy-MM-dd HH:mm") : String(r[AV.AT] || "");
      var trail = was + " · แก้ " + advStamp_().slice(5) +
                  (a.amt !== v.amt ? " (เดิม " + a.amt.toLocaleString() + ")" : "");
      var photo = photoId ? advPhotoUrl_(photoId) : (p.dropPhoto ? "" : a.photo);
      // C เวลา … K บันทึกเมื่อ (คอลัมน์ 3–11) เขียนทีเดียว
      var vals = [v.time, r[AV.EMP], r[AV.NAME], v.amt, v.payer, v.note, photo, r[AV.SRC], trail.slice(0, 300)];
      var old  = [r[AV.TIME], r[AV.EMP], r[AV.NAME], r[AV.AMT], r[AV.PAYER], r[AV.NOTE], r[AV.PHOTO], r[AV.SRC], r[AV.AT]];
      var rg   = advSheet_().getRange(a._i + 2, AV.TIME + 1, 1, vals.length);
      rg.setValues([vals]);
      a.amt = v.amt; a.time = v.time; a.payer = v.payer; a.note = v.note; a.photo = photo;
      var total = advSync_(at, list);
      if (total === null) {   // [G] แถวของวันนั้นหายไประหว่างทาง → คืนค่าเดิม ให้ยอดกับรายการตรงกันเหมือนเดิม
        rg.setValues([old]);
        SpreadsheetApp.flush();
        throw new Error("ข้อมูลในชีตเปลี่ยนไประหว่างบันทึก (ปิดยอด/ย้ายแถว) — ยังไม่ได้แก้ กดโหลดใหม่แล้วลองอีกครั้ง");
      }
      SpreadsheetApp.flush();
      return { item: a.item, total: total, photo: photo };
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// 🔒 [v10] ปิดยอดวันนี้จากเว็บ (ตั้งแต่ 18:00)
//    ตัวปิดยอดจริงอยู่ในสคริปต์ในชีต (ใช้ล็อก/กันปิดซ้ำของมันเอง) → เว็บฝากคำขอไว้
//    ทริกเกอร์อัปเดตสรุปรายวัน (ทุก 1–5 นาที) เห็นคำขอแล้วปิดให้
//    คนที่สแกนเข้าแต่ยังไม่สแกนออก → นับเป็น "ลืมสแกนออก" (เหมือนหลัง 19:00)
// ═══════════════════════════════════════════════════════════════════
function reqSheet_() {
  var ss = book_("TIME"), sh = ss.getSheetByName(REQ_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(REQ_SHEET, ss.getNumSheets());
  sh.getRange(1, 1, 1, 5).setValues([["คำขอ", "วันที่", "ขอเมื่อ", "สถานะ", "หมายเหตุ"]]).setFontWeight("bold");
  sh.getRange("B:B").setNumberFormat("@");
  sh.hideSheet();
  return sh;
}

// คำขอปิดยอดล่าสุดของวันนั้น → { state: "รอ"|"เสร็จ"|"ไม่สำเร็จ", at, note }
function closeReqOf_(dateStr) {
  var sh = book_("TIME").getSheetByName(REQ_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var out = null;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function(r) {
    if (String(r[0]) === "ปิดยอด" && toDateStr_(r[1]) === dateStr)
      out = { state: String(r[3] || "รอ").split(" ")[0], at: String(r[2] || ""), note: String(r[4] || "") };
  });
  return out;
}

function nowHourTh_() { return parseInt(Utilities.formatDate(new Date(), TZ, "H"), 10); }

function canCloseDay_(dateStr, src) {
  if (!isOwner_() || src !== "DAILY") return false;
  var today = todayStr_();
  return dateStr < today || (dateStr === today && nowHourTh_() >= CLOSE_FROM_HOUR);
}

function timeCloseDay(p) {
  requireOwner_();
  var d = toDateStr_(p.date);
  return withLock_(function() {
    cacheClear_();
    var daily = rows_("TIME", SH.DAILY, DATA_COLS);
    if (!daily.some(function(r) { return toDateStr_(r[COL.DATE]) === d; }))
      throw new Error("วันที่ " + d + " ไม่ได้อยู่ในสรุปรายวัน (อาจปิดยอดไปแล้ว)");
    if (!canCloseDay_(d, "DAILY")) throw new Error("ปิดยอดวันนี้ได้ตั้งแต่ " + CLOSE_FROM_HOUR + ":00 น.");
    var cur = closeReqOf_(d);
    if (cur && cur.state === "รอ") return { pending: true, already: true };
    reqSheet_().appendRow(["ปิดยอด", d, Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"), "รอ", "เว็บ"]);
    return { pending: true };
  });
}
;
// ═══════════════════════════════════════════════════════════════════
// ไฟล์ 90: ประตูเดียวเข้าออก — หน้าเว็บเรียกได้แค่ api() ตัวนี้
//   ข้อดี: เพิ่มระบบใหม่ = เพิ่ม 1 บรรทัดใน ROUTES ไม่ต้องแก้ฝั่งเว็บ
// ═══════════════════════════════════════════════════════════════════

var _mode = "view";   // ตั้งค่าโดย doGet ทุกครั้งที่โหลดหน้า

function doGet(e) {
  var key   = (e && e.parameter && e.parameter.k) || "";
  var owner = PropertiesService.getScriptProperties().getProperty(PROP_OWNER_KEY);
  var mode  = (owner && key === owner) ? "edit" : "view";

  var t = HtmlService.createTemplateFromFile("index");
  t.MODE = mode;
  t.KEY  = (mode === "edit") ? key : "";
  return t.evaluate()
    .setTitle("3S — ระบบเวลาทำงาน")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── ตรวจสิทธิ์ ──
function isOwner_() { return _mode === "edit"; }

function requireOwner_() {
  if (!isOwner_()) throw new Error("ลิงก์นี้ดูได้อย่างเดียว — ใช้ลิงก์ของเจ้าของเพื่อแก้ข้อมูล");
}

function requireCan_(flag, what) {
  if (!isOwner_() && !flag)
    throw new Error("ลิงก์นี้ดูได้เฉพาะ \"รายบุคคล\" — " + what + " ต้องใช้ลิงก์ของเจ้าของ");
}

// ── ตารางเส้นทาง ──
var ROUTES = {
  // 🚀 [v10.1] โหลดหน้าแรกพร้อมข้อมูลวันล่าสุดในรอบเดียว (เดิม 2 รอบต่อกัน)
  "time.bootstrap": { fn: function(p) { var b = timeBootstrap();
                                        if (p.withDay && (isOwner_() || STAFF_CAN_DAY)) b.day = timeGetDay("latest");
                                        return b; },                                       write: false },
  "time.getPerson": { fn: function(p) { return timeGetPerson(p.id, p.from, p.to); },        write: false },
  "time.getPeople": { fn: function(p) { return timeGetPeople(p.ids, p.from, p.to, p.scope); }, write: false },
  "time.getDay":    { fn: function(p) { requireCan_(STAFF_CAN_DAY,   "ดูรายวัน");
                                        return timeGetDay(p.date, p.scope); },             write: false },
  "time.getMonths": { fn: function(p) { requireCan_(STAFF_CAN_MONTH, "ดูรายเดือน");
                                        return timeGetMonths(p.ymFrom, p.ymTo, p.scope); }, write: false },
  "time.getRange": { fn: function(p) { requireCan_(STAFF_CAN_MONTH, "ดูประวัติการทำงาน");
                                        return timeGetRange(p.from, p.to, p.scope); },     write: false },
  // 🚀 [v10.1] บันทึกจากหน้ารายวัน → ส่งข้อมูลวันใหม่กลับมาด้วยเลย ไม่ต้องเรียกโหลดซ้ำอีกรอบ
  "time.saveRows":  { fn: function(p) { var r = timeSaveRows(p.changes, p.reqId);
                                        if (p.reloadDay) r.day = timeGetDay("latest");
                                        return r; },                                       write: true  },
  "time.addAdv":    { fn: function(p) { return timeAddAdv(p, p.reqId); },                   write: true  },
  "time.delAdv":    { fn: function(p) { return timeDelAdv(p, p.reqId); },                   write: true  },
  "time.editAdv":   { fn: function(p) { return timeEditAdv(p, p.reqId); },                  write: true  },
  "time.closeDay":  { fn: function(p) { return timeCloseDay(p); },                          write: true  },
  "ping":           { fn: function(p) { return { ok: true, at: todayStr_() }; },            write: false }
};

/**
 * จุดเดียวที่ index.html เรียก
 * @param {string} action  ชื่อใน ROUTES
 * @param {Object} payload ข้อมูล
 * @param {string} key     คีย์เจ้าของ (ส่งมาทุกครั้ง — google.script.run ไม่มี session)
 */
function api(action, payload, key) {
  var owner = PropertiesService.getScriptProperties().getProperty(PROP_OWNER_KEY);
  _mode = (owner && key === owner) ? "edit" : "view";
  cacheClear_();

  try {
    var route = ROUTES[action];
    if (!route) throw new Error("ไม่รู้จักคำสั่ง: " + action);
    if (route.write) requireOwner_();
    var data = route.fn(payload || {});
    if (route.write) posBump_();   // แก้จากหน้าเว็บ/มือถือ (เช่น เบิกเงิน) → โปรแกรมร้านรู้ว่าต้องดึงใหม่ภายใน 1 นาที (ฟังก์ชันอยู่ใน 95_pos)
    return { ok: true, mode: _mode, data: data };
  } catch (err) {
    Logger.log(action + " → " + err.message + "\n" + (err.stack || ""));
    return { ok: false, mode: _mode, error: String(err.message || err) };
  }
}
;
// ═══════════════════════════════════════════════════════════════════
// ไฟล์ 95: ทางเข้าของโปรแกรมร้าน (ShopPOS) — หน้า ⏱️ เวลาทำงาน ในโปรแกรม (16 ต.ค. 2569)
//   โปรแกรมคิดผลในเครื่องด้วยโค้ดชุดเดียวกับเว็บนี้ (รหัส/01/03/90/95) → กดแล้วขึ้นทันที เน็ตหลุดก็ใช้ได้
//   แล้วส่งคำสั่งมาทำที่นี่เบื้องหลัง · ชีตคือตัวจริงเสมอ (โปรแกรมดึงกลับไปแทนของในเครื่อง)
//
//   POST JSON { key: รหัสเจ้าของ (แบบลิงก์ ?k=), req: { action, ... } }
//     rev  → เลขรุ่น (ไฟล์ work spaec แก้ล่าสุด + คำสั่งจากโปรแกรม) — โปรแกรมถามก่อนดึง เท่าเดิม = ไม่ดึง
//     pull → ชีตที่หน้าเวลาทำงานใช้ (วันที่ = {"$d": ms} · ช่องเวลาอย่างเดียว = "HH:mm")
//            have = ลายนิ้วมือของชีตที่โปรแกรมมีแล้ว → ส่งเฉพาะชีตที่เปลี่ยน · ชีตสแกนดิบส่งแค่ 21 วันล่าสุด
//     cmd  → คำสั่งแก้ไขแบบเดียวกับหน้าเว็บ (ROUTES ที่ write: true) · lid = รหัสคำสั่ง
//            ทำแล้วจำผล 3 วัน — ส่งซ้ำ (คำตอบหายกลางทาง/หมดเวลารอ) ได้ผลเดิม ไม่ทำซ้ำ (ไม่เบิกซ้ำ)
//            แถวเลื่อนระหว่างรอส่ง (ปิดยอดแล้ว / ชีตจัดแถวใหม่) → หาแถวของ (วันที่, รหัส) ให้ใหม่ก่อนทำ
//   รหัสรายการเบิกใหม่ (newId_) คิดจากรหัสคำสั่ง → ในเครื่องกับบนเว็บได้รหัสเดียวกัน (แก้/ลบต่อได้ก่อนส่งขึ้นเว็บ)
//   ไฟล์นี้ใช้ในโปรแกรมด้วย (newId_ / posRelocate_) — ส่วน doPost ไม่ถูกเรียกในเครื่อง
//   ⚠️ ห้ามอ้างตัวแปรของไฟล์อื่นที่ระดับบนสุดของไฟล์นี้ (ลำดับไฟล์ใน Apps Script ไม่แน่นอน) — ใช้ในฟังก์ชันเท่านั้น
// ═══════════════════════════════════════════════════════════════════

var POS_BUILD_ = "2026-10-16.1";   // รุ่นของทางเข้านี้ (โปรแกรมโชว์) · แก้กติกาคิดเงิน (01/03) = เปลี่ยนเลขนี้ด้วย
var POS_RAW_DAYS_ = 21;
var POS_Q_DAYS_ = 3;
var LAPP_SEED_ = "", LAPP_SEED_N_ = 0;

// ชีตที่โปรแกรมใช้ (ในฟังก์ชัน — ชื่อชีตอยู่ในไฟล์อื่น)
function posSheets_() {
  return [SH.DAILY, SH.EMPLOYEES, SH.HISTORY, SH.RAW, MANUAL_PAY_SHEET, SETTLE_SHEET, ADV_ITEMS_SHEET, REQ_SHEET];
}

/* รหัสรายการใหม่: คำสั่งจากโปรแกรม = คิดจากรหัสคำสั่ง (ตัวเดียวกับที่โปรแกรมคิดในเครื่อง) · หน้าเว็บ = สุ่มแบบเดิม */
function newId_() {
  if (!LAPP_SEED_) return Utilities.getUuid();
  var s = LAPP_SEED_ + ":" + (LAPP_SEED_N_++), h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (var i = 0; i < s.length; i++) for (var k = 0; k < 4; k++) { h[k] ^= s.charCodeAt(i) + k; h[k] = Math.imul(h[k], 0x01000193) >>> 0; }
  var hex = h.map(function (x) { return ("0000000" + x.toString(16)).slice(-8); }).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var owner = PropertiesService.getScriptProperties().getProperty(PROP_OWNER_KEY);
    if (!owner || String(body.key || "") !== owner) throw new Error("รหัสเจ้าของไม่ถูกต้อง — ตั้งรหัสเดียวกับลิงก์ ?k= ของเจ้าของ");
    var req = body.req || {};
    _mode = "edit";
    cacheClear_();
    if (req.action === "rev")       out = { ok: true, rev: posRev_(), build: POS_BUILD_ };
    else if (req.action === "pull") out = posPull_(req);
    else if (req.action === "cmd")  out = posCmd_(req, owner);
    else throw new Error("ไม่รู้จักคำสั่ง: " + req.action);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ── เลขรุ่น ── ไฟล์แก้ล่าสุด (เครื่องสแกน/สคริปต์ในชีต แก้อะไรก็ขยับ) + เลขที่ขยับทุกครั้งที่แก้ผ่านเว็บนี้ (หน้าเว็บ/มือถือ/โปรแกรม)
//   เดิมแก้จากหน้าเว็บพึ่งเวลาแก้ไฟล์ของ Drive อย่างเดียว (ขยับช้าได้หลายนาที) → เบิกเงินจากมือถือแล้วโปรแกรมบางเครื่องยังไม่ขึ้น (18 ต.ค.)
function posBump_() {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("POS_VER", String((parseInt(props.getProperty("POS_VER"), 10) || 0) + 1));
  } catch (e) {}
}
function posRev_() {
  var t = 0;
  try { t = DriveApp.getFileById(BOOKS.TIME).getLastUpdated().getTime(); } catch (e) {}
  return t + ":" + (PropertiesService.getScriptProperties().getProperty("POS_VER") || "0");
}

// ── ดึงชีต ──
function posPull_(req) {
  var rev = posRev_();   // อ่านเลขรุ่นก่อนอ่านค่า: มีคนแก้ระหว่างนี้ = รอบหน้าเลขต่างแล้วดึงใหม่
  var ss = book_("TIME"), have = req.have || {}, order = [], sheets = {}, dig = {};
  var cut = fmtDate_(new Date(Date.now() - POS_RAW_DAYS_ * 864e5));
  posSheets_().forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) return;                                   // ยังไม่มีชีต (ยังไม่เคยเบิก/แก้ค่าแรงมือ) — โค้ดสร้างเองตอนใช้
    order.push(n);
    var last = sh.getLastRow(), cols = sh.getLastColumn();
    if (n === SH.HISTORY) cols = Math.min(cols, DATA_COLS);
    var vals = last >= 1 && cols >= 1 ? sh.getRange(1, 1, last, cols).getValues() : [];
    if (n === SH.RAW) vals = vals.filter(function (r, i) { return i === 0 || toDateStr_(r[0]) >= cut; });   // สแกนดิบ: ใช้แค่วันที่ยังไม่ปิดยอด
    var rows = vals.map(function (r) { return r.map(posVal_); });
    var d = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows), Utilities.Charset.UTF_8));
    dig[n] = d;
    if (have[n] !== d) sheets[n] = rows;
  });
  // ในเครื่องใช้รหัสเจ้าของสมมุติ ("local") — รหัสจริงไม่ออกจากเว็บ (คำสั่งที่ส่งมาใช้รหัสจริงจากโปรแกรม)
  return { ok: true, rev: rev, build: POS_BUILD_, order: order, sheets: sheets, dig: dig, ctx: { props: { OWNER_KEY: "local" } } };
}
// วันที่ → {"$d": ms} · ช่องเวลาอย่างเดียว (วันที่ 1899-12-30) → "HH:mm" แบบที่ toTimeStr_ ให้
function posVal_(v) {
  if (!(v instanceof Date)) return v;
  var t = v.getTime();
  if (isNaN(t)) return "";
  if (v.getFullYear() < 1900) return toTimeStr_(v);
  return { $d: t };
}

// ── ทำคำสั่งจากโปรแกรม ── args = [action, payload, คีย์ในเครื่อง] (ใช้รหัสจริงแทนคีย์ในเครื่อง)
function posCmd_(req, owner) {
  var lid = String(req.lid || ""), fn = String(req.fn || ""), args = Array.isArray(req.args) ? req.args : [];
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(lid)) throw new Error("รหัสคำสั่งไม่ถูกต้อง");
  var action = String(args[0] || ""), route = ROUTES[action];
  if (fn !== "api" || !route || !route.write) throw new Error("ไม่รู้จักคำสั่งแก้ไข: " + fn + " " + action);
  var props = PropertiesService.getScriptProperties(), pk = "posq_" + lid;
  var done = props.getProperty(pk);
  if (done) return { ok: true, res: JSON.parse(done).r, again: true };
  // ส่งซ้ำตอนรอบแรกยังทำไม่เสร็จ (โปรแกรมเลิกรอก่อน) → บอกให้ลองใหม่ทีหลัง ไม่ทำซ้อน
  var cache = CacheService.getScriptCache(), ck = "posrun_" + lid;
  if (cache.get(ck)) return { ok: false, retry: true, error: "คำสั่งนี้กำลังทำอยู่" };
  cache.put(ck, "1", 360);
  try {
    var p = args[1] && typeof args[1] === "object" ? args[1] : {};
    p.reloadDay = false;                                 // โปรแกรมดึงชีตเอง ไม่ต้องส่งวันกลับมา
    posRelocate_(action, p);
    cacheClear_();
    LAPP_SEED_ = lid; LAPP_SEED_N_ = 0;
    var r;
    try { r = api(action, p, owner); } finally { LAPP_SEED_ = ""; }
    var msg = r.ok ? "" : String(r.error || "");
    // ล็อกไม่ว่าง / ระบบ Google สะดุด (ข้อความอังกฤษ) = ลองใหม่ทีหลัง ยังไม่จำผล · ข้อความไทย = โค้ดบอกว่าทำไม่ได้ = จำผลว่าไม่ผ่าน
    if (!r.ok && (/มีคนอื่นกำลังบันทึกอยู่/.test(msg) || !/[฀-๿]/.test(msg))) return { ok: false, retry: true, error: msg };
    var small = { ok: !!r.ok, error: msg };
    props.setProperty(pk, JSON.stringify({ t: Date.now(), r: small }));
    posBump_();
    posPruneQ_(props);
    return { ok: true, res: small };
  } finally {
    cache.remove(ck);
  }
}
// ลบผลคำสั่งที่จำไว้เกิน 3 วัน (ทำนาน ๆ ครั้ง)
function posPruneQ_(props) {
  if (Math.random() > 0.1) return;
  var all = props.getProperties(), old = Date.now() - POS_Q_DAYS_ * 864e5;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("posq_") !== 0) return;
    var t = 0;
    try { t = JSON.parse(all[k]).t || 0; } catch (e) {}
    if (t < old) props.deleteProperty(k);
  });
}

// ── แถวเลื่อนระหว่างรอส่ง → หาแถวของ (วันที่, รหัส) ใหม่ ──
//   ใช้ทั้งบนเว็บ (ก่อนทำคำสั่งจากโปรแกรม) และในโปรแกรม (คิดคำสั่งที่ค้างซ้ำบนชีตชุดใหม่)
function posRelocate_(action, p) {
  if (!p) return;
  if (action === "time.saveRows") {
    (p.changes || []).forEach(function (c) {
      var loc = posFind_(c.src, c.row, c.id, c.date);
      if (loc) { c.src = loc.src; c.row = loc.row; }
    });
  } else if (action === "time.addAdv" || action === "time.delAdv" || action === "time.editAdv") {
    var loc = posFind_(p.src, p.row, p.id, p.date);
    if (loc) { p.src = loc.src; p.row = loc.row; }
  }
}
// null = แถวเดิมยังตรง (หรือหาไม่เจอ — ปล่อยให้คำสั่งบอกเอง)
function posFind_(src, row, id, date) {
  id = String(id == null ? "" : id).trim(); date = toDateStr_(date);
  if (!id || !date) return null;
  var match = function (r) { return r && String(r[COL.ID]).trim() === id && toDateStr_(r[COL.DATE]) === date; };
  if ((src === "DAILY" || src === "HISTORY") && match(rowAt_(srcSheet_(src), row))) return null;
  var order = src === "HISTORY" ? ["HISTORY", "DAILY"] : ["DAILY", "HISTORY"];
  for (var k = 0; k < order.length; k++) {
    var rows = rows_("TIME", srcSheet_(order[k]), DATA_COLS);
    for (var i = 0; i < rows.length; i++) if (match(rows[i])) return { src: order[k], row: i + 2 };
  }
  return null;
}

;

// รูปเบิกที่ยังไม่ขึ้น Drive = รูปในตัว (data:)
var _lappAdvPhotoUrl = advPhotoUrl_;
advPhotoUrl_ = function (id) { var f = GAS.files[id]; return f && f.blob ? f.getUrl() : _lappAdvPhotoUrl(id); };
