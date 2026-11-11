/* Test Data Generator - business logic (port of tdg/*.py) + UI. Runs 100% in the browser. */
"use strict";

// ------------------------------------------------------------------ validation
const EMAIL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE_RE = /^05[0-9]-\d{7}$/;
// "First Last" in Latin letters; also accepts O'Neal, McDonald, de la Cruz, Jean-Luc.
const NAME_RE = /^[A-Z][A-Za-z']*(?:[ -][A-Za-z][A-Za-z']*)+$/;

function idChecksumOk(d) {
  let total = 0;
  for (let i = 0; i < d.length; i++) {
    const n = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    total += n > 9 ? n - 9 : n;
  }
  return total % 10 === 0;
}
const Validators = {
  full_name: (v) => typeof v === "string" && NAME_RE.test(v),
  gender: (v) => /^(male|female)$/i.test(String(v).trim()),
  email: (v) => typeof v === "string" && !v.includes("..") && EMAIL_RE.test(v),
  phone: (v) => typeof v === "string" && PHONE_RE.test(v),
  israeli_id: (v) => /^\d{9}$/.test(v) && v !== "000000000" && idChecksumOk(v),
};
const REASONS = {
  full_name: "name must be 'First Last' in Latin letters",
  gender: "gender must be Male or Female",
  email: "invalid email format",
  phone: "phone must be 05X-XXXXXXX",
  israeli_id: "ID must be 9 digits with a valid check digit",
};

class Uniqueness {
  constructor(fields) { this.seen = new Map(fields.map((f) => [f, new Set()])); }
  static norm(v) { return String(v ?? "").trim().toLowerCase(); }
  duplicateFields(rec) { return [...this.seen].filter(([f, s]) => f in rec && s.has(Uniqueness.norm(rec[f]))).map(([f]) => f); }
  tryAdd(rec) {
    if (this.duplicateFields(rec).length) return false;
    for (const [f, s] of this.seen) if (f in rec) s.add(Uniqueness.norm(rec[f]));
    return true;
  }
}

// ------------------------------------------------------------------ generators
const MALE = ["Yosef", "David", "Daniel", "Itai", "Omer", "Eitan", "Avi", "Yonatan", "Nadav", "Ran",
  "Uri", "Boaz", "Guy", "Ido", "Moshe", "Noam", "Ariel", "Yuval", "Erez", "Amir"];
const FEMALE = ["Noa", "Tamar", "Maya", "Shira", "Yael", "Michal", "Dana", "Neta", "Hila", "Keren",
  "Orly", "Sivan", "Inbar", "Liat", "Rivka", "Efrat", "Adi", "Roni", "Talia", "Hadas"];
const LAST = ["Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Dahan", "Avraham", "Friedman", "Azoulay",
  "Katz", "Yosef", "Amar", "Ohayon", "Hadad", "Gabay", "Ben David", "Shapira", "Golan",
  "Malka", "Vaknin", "Segal", "Tal", "Rosen", "Klein", "Sasson", "Ashkenazi", "Barak",
  "Elbaz", "Levy", "Navon", "Oren", "Weiss", "Zilber", "Harari", "Kaplan", "Stern"];
const DOMAINS = ["example.com", "test.co.il", "mail.test", "qa.example.org"];
const PREFIXES = ["050", "051", "052", "053", "054", "055", "058"];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const randint = (lo, hi) => lo + rnd(hi - lo + 1);

function idCheckDigit(first8) {
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const n = Number(first8[i]) * (i % 2 === 0 ? 1 : 2);
    total += n > 9 ? n - 9 : n;
  }
  return (10 - (total % 10)) % 10;
}

const Gen = {
  gender: (r, o) => (o.genderMode === "male" ? "Male" : o.genderMode === "female" ? "Female" : pick(["Male", "Female"])),
  full_name: (r, o) => {
    const g = r.gender || Gen.gender(r, o);
    return `${pick(g === "Male" ? MALE : FEMALE)} ${pick(LAST)}`;
  },
  email: (r, o) => {
    const name = r.full_name || Gen.full_name(r, o);
    const local = name.replace(/-/g, " ").split(/\s+/).map((p) => p.toLowerCase()).join(".");
    return `${local}${randint(1, 99999)}@${pick(DOMAINS)}`;
  },
  phone: () => `${pick(PREFIXES)}-${String(randint(0, 9999999)).padStart(7, "0")}`,
  israeli_id: () => {
    const body = String(randint(1, 99999999)).padStart(8, "0");
    return body + idCheckDigit(body);
  },
};

const FIELDS = [
  { key: "full_name", title: "Full name", he: "שם מלא", example: "Noa Cohen" },
  { key: "gender", title: "Gender", he: "מגדר", example: "Female" },
  { key: "email", title: "Email", he: "אימייל", example: "noa.cohen123@example.com" },
  { key: "phone", title: "Phone", he: "טלפון נייד", example: "052-1234567" },
  { key: "israeli_id", title: "Israeli ID", he: "תעודת זהות", example: "123456782" },
];
const ORDER = ["gender", "full_name", "email", "phone", "israeli_id"];
const IDENTIFIERS = ["email", "phone", "israeli_id"];
const MAX_COUNT = 100000;
const title = (k) => (FIELDS.find((f) => f.key === k) || {}).title || k;
const ordered = (keys) => FIELDS.map((f) => f.key).filter((k) => keys.includes(k));

function generate(cfg) {
  const fields = ordered(cfg.fields);
  const uniqFields = ordered(cfg.unique.filter((u) => fields.includes(u)));
  const uniq = new Uniqueness(uniqFields);
  const out = { records: [], fields, duplicates: 0, invalid: 0, error: null };
  while (out.records.length < cfg.count) {
    let ok = false;
    for (let a = 0; a < cfg.retries; a++) {
      const rec = {};
      for (const k of ORDER) if (fields.includes(k)) rec[k] = Gen[k](rec, cfg);
      const clean = Object.fromEntries(fields.map((k) => [k, rec[k]]));
      if (!fields.every((k) => Validators[k](clean[k]))) { out.invalid++; continue; }
      if (uniq.tryAdd(clean)) { out.records.push(clean); ok = true; break; }
      out.duplicates++;
    }
    if (!ok) {
      out.error = `Generated only ${out.records.length}/${cfg.count} unique records: value space exhausted for unique fields (${uniqFields.map(title).join(", ")}).`;
      break;
    }
  }
  return out;
}

function audit(rows, fields) {
  const uniqCols = fields.filter((f) => IDENTIFIERS.includes(f));
  const uniq = new Uniqueness(uniqCols);
  const known = fields.filter((f) => Validators[f]);
  const invalid = [], duplicate = [];
  rows.forEach((rec, i) => {
    const bad = known.filter((k) => !Validators[k](rec[k] ?? ""));
    if (bad.length) invalid.push({ row: i + 1, reasons: bad.map((k) => `${k}: ${REASONS[k]}`), rec });
    const dup = uniq.duplicateFields(rec);
    if (dup.length) duplicate.push({ row: i + 1, reasons: dup.map((k) => `${k} repeats an earlier row`), rec });
    else uniq.tryAdd(rec);
  });
  return { uniqCols, invalid, duplicate };
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
let current = null; // last generation result

function readConfig() {
  const count = Number($("count").value);
  const fields = [...document.querySelectorAll("input[name=field]:checked")].map((x) => x.value);
  const unique = [...document.querySelectorAll("input[name=unique]:checked")].map((x) => x.value);
  const retries = Number($("retries").value);
  const genderMode = document.querySelector("input[name=gmode]:checked").value;
  const errs = [];
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) errs.push(`מספר הרשומות חייב להיות מספר שלם בין 1 ל-${QA.fmtInt(MAX_COUNT)}.`);
  if (!fields.length) errs.push("יש לבחור לפחות שדה אחד.");
  if (!Number.isInteger(retries) || retries < 1 || retries > 100000) errs.push("מספר הניסיונות חייב להיות בין 1 ל-100,000.");
  return { cfg: { count, fields, unique, retries, genderMode }, errs };
}

function msg(el, kind, html) { el.innerHTML = `<div class="alert ${kind}">${html}</div>`; }

function renderTable(fields, rows, limit = 20, extra = null) {
  const head = (extra ? ["Row"] : ["#"]).concat(fields.map(title)).concat(extra ? ["Problem"] : []);
  const body = rows.slice(0, limit).map((r, i) => {
    const rec = extra ? r.rec : r;
    const cells = [extra ? r.row : i + 1].concat(fields.map((f) => rec[f] ?? "")).concat(extra ? [r.reasons.join("; ")] : []);
    return `<tr>${cells.map((c) => `<td>${QA.esc(c)}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${QA.esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function onGenerate() {
  const { cfg, errs } = readConfig();
  const box = $("genMsg");
  if (errs.length) { msg(box, "err", errs.join("<br>")); return; }
  if (current && !current.saved && !confirm("יש נתונים שלא הורדו. ליצור נתונים חדשים במקומם?")) return;
  if (cfg.unique.includes("gender") && cfg.fields.includes("gender") && cfg.count > 2)
    msg(box, "warn", "שימו לב: למגדר יש רק 2 ערכים אפשריים, לכן ייחודיות עליו תעצור אחרי 2 רשומות.");
  const t0 = performance.now();
  const res = generate(cfg);
  const ms = Math.round(performance.now() - t0);
  if (res.error) {
    if (!res.records.length || !confirm(`${res.error}\n\nלשמור את ${res.records.length} הרשומות שנוצרו?`)) {
      msg(box, "err", QA.esc(res.error) + "<br>הקטינו את הכמות או בטלו ייחודיות על חלק מהשדות.");
      return;
    }
  }
  current = { ...res, saved: false };
  msg(box, res.error ? "warn" : "ok",
    `נוצרו <b>${QA.fmtInt(res.records.length)}</b> רשומות תוך ${ms} ms ` +
    `(נדחו: ${QA.fmtInt(res.duplicates)} כפולות, ${QA.fmtInt(res.invalid)} לא תקינות).`);
  $("fileName").value = `test_data_${QA.stamp()}.csv`;
  $("results").hidden = false;
  $("previewInfo").textContent = res.records.length > 20
    ? `מוצגות 20 הרשומות הראשונות מתוך ${QA.fmtInt(res.records.length)}`
    : `${res.records.length} רשומות`;
  $("preview").innerHTML = renderTable(res.fields, res.records);
  $("kpiRows").textContent = QA.fmtInt(res.records.length);
  $("kpiFields").textContent = res.fields.length;
  $("kpiDup").textContent = QA.fmtInt(res.duplicates);
  $("kpiTime").textContent = `${ms} ms`;
}

function onDownload() {
  if (!current) return;
  const name = QA.safeFileName($("fileName").value, "csv", `test_data_${QA.stamp()}.csv`);
  QA.download(name, QA.toCsv(current.fields, current.records.map((r) => current.fields.map((f) => r[f]))));
  current.saved = true;
  msg($("dlMsg"), "ok", `הקובץ <span class="ltr">${QA.esc(name)}</span> ירד למחשב (${QA.fmtInt(current.records.length)} שורות, UTF-8, נפתח ב-Excel).`);
}

function onCheckFile(file) {
  const box = $("checkResult");
  if (file.size > 50 * 1024 * 1024) { msg(box, "err", `הקובץ גדול מדי (${Math.round(file.size / 2 ** 20)} MB, מקסימום 50 MB).`); return; }
  if (!file.size) { msg(box, "err", "הקובץ ריק."); return; }
  const reader = new FileReader();
  reader.onerror = () => msg(box, "err", "לא ניתן לקרוא את הקובץ.");
  reader.onload = () => {
    const bytes = new Uint8Array(reader.result);
    if (bytes.subarray(0, 4096).includes(0)) { msg(box, "err", "זה נראה כמו קובץ בינארי ולא קובץ CSV."); return; }
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (_) { msg(box, "err", "הקובץ אינו בקידוד UTF-8. שמרו אותו מ-Excel כ-<b>CSV UTF-8</b> ונסו שוב."); return; }
    text = text.replace(/^﻿/, "").replace(/^(\s*\r?\n)+/, "");
    const rows = QA.parseCsv(text, QA.sniffDelimiter(text.split(/\r?\n/)[0] || ""));
    if (!rows.length) { msg(box, "err", "לא נמצאה שורת כותרת."); return; }
    const headers = rows[0].cells.map((h) => h.trim().toLowerCase());
    const dups = headers.filter((h, i) => h && headers.indexOf(h) !== i);
    if (dups.length) { msg(box, "err", `שמות עמודות כפולים: ${QA.esc([...new Set(dups)].join(", "))}`); return; }
    const data = rows.slice(1).filter((r) => r.cells.some((c) => c.trim()))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r.cells[i] ?? ""])));
    const known = headers.filter((h) => Validators[h]);
    const rep = audit(data, known);
    let html = `<div class="kpis">
      <div class="kpi brand"><div class="k">שורות</div><div class="v">${QA.fmtInt(data.length)}</div></div>
      <div class="kpi ${rep.invalid.length ? "err" : "ok"}"><div class="k">שורות לא תקינות</div><div class="v">${rep.invalid.length}</div></div>
      <div class="kpi ${rep.duplicate.length ? "err" : "ok"}"><div class="k">שורות כפולות</div><div class="v">${rep.duplicate.length}</div></div>
    </div>
    <p class="muted">עמודות בקובץ: <span class="ltr">${QA.esc(headers.join(", "))}</span><br>
    עמודות שנבדקו: <span class="ltr">${QA.esc(known.join(", ") || "none")}</span> ·
    בדיקת כפילויות על: <span class="ltr">${QA.esc(rep.uniqCols.join(", ") || "none (no ID columns)")}</span> (שם ומגדר מותר שיחזרו)</p>`;
    if (!known.length) html += `<div class="alert warn">לא נמצאה אף עמודה מוכרת (full_name, gender, email, phone, israeli_id).</div>`;
    else if (!rep.invalid.length && !rep.duplicate.length) html += `<div class="alert ok">כל השורות תקינות וייחודיות.</div>`;
    if (rep.invalid.length) html += `<h3>שורות לא תקינות</h3>${renderTable(known, rep.invalid, 200, true)}`;
    if (rep.duplicate.length) html += `<h3>שורות כפולות</h3>${renderTable(known, rep.duplicate, 200, true)}`;
    box.innerHTML = html;
  };
  reader.readAsArrayBuffer(file);
}

document.addEventListener("DOMContentLoaded", () => {
  QA.initTabs();
  $("fieldList").innerHTML = FIELDS.map((f) =>
    `<label class="check"><input type="checkbox" name="field" value="${f.key}" checked> ${f.he} <small class="ltr">${f.example}</small></label>`).join("");
  $("uniqueList").innerHTML = FIELDS.map((f) =>
    `<label class="check"><input type="checkbox" name="unique" value="${f.key}" ${IDENTIFIERS.includes(f.key) ? "checked" : ""}> ${f.he}</label>`).join("");
  $("genBtn").addEventListener("click", onGenerate);
  $("dlBtn").addEventListener("click", onDownload);
  QA.initDrop($("drop"), $("fileInput"), onCheckFile);
  window.addEventListener("beforeunload", (e) => { if (current && !current.saved) { e.preventDefault(); e.returnValue = ""; } });
});
