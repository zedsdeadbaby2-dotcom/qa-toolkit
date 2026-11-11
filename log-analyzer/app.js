/* Test Log Analyzer - UI. All parsing runs locally (parser.js). */
"use strict";

const $ = (id) => document.getElementById(id);
let LOG = null;          // loaded log
let lastFilter = null;   // last filter shown in "Errors & warnings"
let showTab = null;

function alertBox(el, kind, html) { el.innerHTML = `<div class="alert ${kind}">${html}</div>`; }

function setEnabled(on) {
  document.querySelectorAll(".tab[data-needs-log]").forEach((t) => { t.disabled = !on; t.title = on ? "" : "טענו קובץ לוג קודם"; });
}

function loadBytes(name, bytes) {
  const box = $("loadMsg");
  let log;
  try { log = LA.load(name, bytes); }
  catch (err) { alertBox(box, "err", QA.esc(err.message)); return; }
  LOG = log; lastFilter = null;
  const s = log.stats, p = log.parsed;
  let html = `<b>${QA.esc(name)}</b> נטען כ-${log.kind.toUpperCase()} (<span class="ltr">${QA.esc(log.encoding)}</span>): ` +
    `${QA.fmtInt(s.entries)} רשומות מתוך ${QA.fmtInt(p.totalLines)} שורות.`;
  if (p.skipped.length) html += `<br>${QA.fmtInt(p.skipped.length)} שורות לא זוהו ודולגו (ראו טאב "שורות לא מזוהות").`;
  if (p.notes.length) html += `<br>${QA.fmtInt(p.notes.length)} ערכים (זמן/משך/רמה) לא היו קריאים והתעלמנו מהם.`;
  if (!s.entries) { alertBox(box, "warn", html + "<br>לא נמצאו רשומות לוג. ודאו שזה באמת לוג בדיקות (ראו פורמטים נתמכים במדריך)."); }
  else alertBox(box, "ok", html + `<br>מבט מהיר: ${s.passed} עברו, ${s.failed} נכשלו, ${s.skipped} דולגו.`);
  $("loadedName").textContent = name;
  $("fileName").value = `${name.replace(/\.[^.]+$/, "").slice(0, 60) || "log"}_report_${QA.stamp()}`;
  setEnabled(true);
  renderStats(); renderIssues(); renderUnreadable(); renderExportOptions();
  if (s.entries) showTab("stats");
}

function loadFile(file) {
  if (file.size > 100 * 1024 * 1024) { alertBox($("loadMsg"), "err", `File is too large (${Math.floor(file.size / 2 ** 20)} MB, max 100 MB).`); return; }
  alertBox($("loadMsg"), "info", "קורא את הקובץ...");
  const r = new FileReader();
  r.onerror = () => alertBox($("loadMsg"), "err", "לא ניתן לקרוא את הקובץ (פתוח בתוכנה אחרת?).");
  r.onload = () => setTimeout(() => loadBytes(file.name, new Uint8Array(r.result)), 0);
  r.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------- stats
function bars(rows, total) {
  return `<div class="bars">${rows.map(([name, n, cls]) => {
    const w = total ? (100 * n) / total : 0;
    return `<div class="barrow"><span>${name}</span><div class="track"><div class="fill ${cls}" style="width:${w}%"></div></div>` +
      `<span class="num">${QA.fmtInt(n)} · ${total ? w.toFixed(1) : "0.0"}%</span></div>`;
  }).join("")}</div>`;
}
function renderStats() {
  const s = LOG.stats, d = s.durations;
  const rate = s.passRate == null ? "-" : s.passRate.toFixed(1) + "%";
  const errs = s.levels.ERROR + s.levels.CRITICAL;
  let html = `<div class="kpis">
    <div class="kpi ok"><div class="k">עברו (Passed)</div><div class="v">${s.passed}</div></div>
    <div class="kpi err"><div class="k">נכשלו (Failed)</div><div class="v">${s.failed}</div></div>
    <div class="kpi"><div class="k">דולגו (Skipped)</div><div class="v">${s.skipped}</div></div>
    <div class="kpi brand"><div class="k">אחוז הצלחה</div><div class="v">${rate}</div><div class="s">עברו / (עברו + נכשלו)</div></div>
    <div class="kpi"><div class="k">זמן ריצה ממוצע</div><div class="v">${d.count ? LA.fmtDur(d.average) : "-"}</div><div class="s">${d.count} תוצאות עם זמן</div></div>
    <div class="kpi ${errs ? "err" : "ok"}"><div class="k">שגיאות / אזהרות</div><div class="v">${errs} / ${s.levels.WARNING}</div></div>
  </div>
  <div class="grid grid-2">
    <div class="card"><h2>תוצאות בדיקות</h2><p class="hint">${s.results} תוצאות · ${s.uniqueTests} שמות בדיקה שונים</p>
      ${s.results ? bars([["Passed", s.passed, "ok"], ["Failed", s.failed, "err"], ["Skipped", s.skipped, "muted"]], s.results) : '<p class="muted">לא נמצאו תוצאות PASSED / FAILED / SKIPPED.</p>'}</div>
    <div class="card"><h2>רמות לוג</h2><p class="hint">${QA.fmtInt(s.entries)} רשומות</p>
      ${bars(LA.LEVELS.map((l) => [l, s.levels[l], { DEBUG: "muted", INFO: "", WARNING: "warn", ERROR: "err", CRITICAL: "crit" }[l]]), Object.values(s.levels).reduce((a, b) => a + b, 0))}</div>
  </div>
  <div class="grid grid-2">
    <div class="card"><h2>זמני ריצה</h2>${d.count ? `<div class="table-wrap"><table><tbody>
      <tr><th>Average</th><td>${LA.fmtDur(d.average)}</td><th>Median</th><td>${LA.fmtDur(d.median)}</td></tr>
      <tr><th>Fastest</th><td>${LA.fmtDur(d.min)}</td><th>Slowest</th><td>${LA.fmtDur(d.max)}</td></tr>
      <tr><th>Total</th><td>${LA.fmtDur(d.total)}</td><th>Timed</th><td>${d.count}</td></tr>
      <tr><th>Avg passed</th><td>${LA.fmtDur(s.passedDur.count ? s.passedDur.average : null)}</td><th>Avg failed</th><td>${LA.fmtDur(s.failedDur.count ? s.failedDur.average : null)}</td></tr>
      </tbody></table></div>` : '<p class="muted">לא נמצאו זמני ריצה בקובץ.</p>'}
      ${s.first != null ? `<h3>טווח זמן</h3><p class="ltr" style="text-align:right">${LA.fmtTime(s.first)} → ${LA.fmtTime(s.last)} (${LA.fmtDur((s.last - s.first) / 1000)})</p>` : ""}</div>
    <div class="card"><h2>5 הבדיקות האיטיות</h2>${s.slowest.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Test</th><th>Duration</th></tr></thead><tbody>
      ${s.slowest.map(([n, v], i) => `<tr><td>${i + 1}</td><td>${QA.esc(n)}</td><td>${LA.fmtDur(v)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">אין נתונים.</p>'}</div>
  </div>`;
  if (s.failedTests.length) {
    html += `<div class="card"><h2>בדיקות שנכשלו (${s.failedTests.length})</h2><div class="table-wrap"><table><thead><tr><th>Line</th><th>Test</th><th>Time</th><th>Message</th></tr></thead><tbody>
      ${s.failedTests.map((e) => `<tr><td>${e.line}</td><td>${QA.esc(LA.label(e))}</td><td>${QA.esc(e.timestamp != null ? LA.fmtTime(e.timestamp) : e.rawTime || "-")}</td><td class="msg">${QA.esc(e.message)}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  $("statsBody").innerHTML = html;
}

// ---------------------------------------------------------------- issues
function issueTable(list) {
  return `<div class="table-wrap"><table><thead><tr><th>Line</th><th>Level</th><th>Time</th><th>Test</th><th>Message</th></tr></thead><tbody>
    ${list.map((e) => `<tr><td>${e.line}</td><td><span class="pill ${e.level}">${e.level}</span></td><td>${QA.esc(e.timestamp != null ? LA.fmtTime(e.timestamp) : e.rawTime || "-")}</td>` +
      `<td>${QA.esc(e.test || "-")}</td><td class="msg">${QA.esc(e.message)}</td></tr>`).join("")}</tbody></table></div>`;
}
function renderIssues() {
  const mode = document.querySelector("input[name=sev]:checked").value;
  lastFilter = LA.filter(LOG.parsed.entries, mode, $("keyword").value);
  const s = LOG.stats;
  $("issueInfo").textContent = `בקובץ ${s.levels.ERROR + s.levels.CRITICAL} שורות שגיאה ו-${s.levels.WARNING} שורות אזהרה.`;
  $("issueBody").innerHTML = lastFilter.entries.length
    ? `<div class="alert info">נמצאו ${lastFilter.entries.length}: <span class="ltr">${QA.esc(lastFilter.title)}</span></div>${issueTable(lastFilter.entries)}`
    : `<div class="alert ok">לא נמצאו שורות: <span class="ltr">${QA.esc(lastFilter.title)}</span></div>`;
  renderExportOptions();
}

// ---------------------------------------------------------------- unreadable
function renderUnreadable() {
  const p = LOG.parsed;
  if (!p.skipped.length && !p.notes.length) { $("unreadBody").innerHTML = '<div class="alert ok">כל השורות זוהו. אין מה להציג.</div>'; return; }
  let html = "";
  if (p.skipped.length) html += `<h3>שורות שדולגו (${p.skipped.length})</h3><div class="table-wrap"><table><thead><tr><th>Line</th><th>Reason</th><th>Text</th></tr></thead><tbody>
    ${p.skipped.slice(0, 1000).map((x) => `<tr><td>${x.line}</td><td>${QA.esc(x.reason)}</td><td class="msg">${QA.esc(x.text)}</td></tr>`).join("")}</tbody></table></div>`;
  if (p.notes.length) html += `<h3>ערכים שהתעלמנו מהם (${p.notes.length})</h3><div class="table-wrap"><table><thead><tr><th>Line</th><th>Problem</th></tr></thead><tbody>
    ${p.notes.slice(0, 1000).map((x) => `<tr><td>${x.line}</td><td>${QA.esc(x.reason)}</td></tr>`).join("")}</tbody></table></div>`;
  $("unreadBody").innerHTML = html;
}

// ---------------------------------------------------------------- export
function renderExportOptions() {
  const opt = $("optFilter");
  const show = lastFilter && (lastFilter.mode !== "both" || lastFilter.keyword);
  opt.hidden = !show;
  if (show) $("optFilterText").textContent = `סיכום + הסינון האחרון: ${lastFilter.title} (${lastFilter.entries.length} שורות)`;
  else if (document.querySelector("input[name=content]:checked").value === "last") document.querySelector("input[name=content][value=issues]").checked = true;
}
function doExport() {
  const content = document.querySelector("input[name=content]:checked").value;
  const fmt = document.querySelector("input[name=fmt]:checked").value;
  let issues = null, title = "";
  if (content === "issues") { issues = LA.filter(LOG.parsed.entries, "both").entries; title = "ERRORS AND WARNINGS"; }
  if (content === "last" && lastFilter) { issues = lastFilter.entries; title = lastFilter.title; }
  const name = QA.safeFileName($("fileName").value, fmt, `report_${QA.stamp()}.${fmt}`);
  if (name.toLowerCase() === LOG.name.toLowerCase()) { alertBox($("exportMsg"), "err", "זה שם קובץ הלוג שטענתם. בחרו שם אחר כדי לא לדרוס אותו."); return; }
  const text = fmt === "txt" ? LA.textReport(LOG, issues, title) : LA.csvReport(LOG, issues);
  QA.download(name, text, fmt === "txt" ? "text/plain" : "text/csv");
  alertBox($("exportMsg"), "ok", `הדוח <span class="ltr">${QA.esc(name)}</span> ירד למחשב.`);
  if (fmt === "txt") $("reportPreview").textContent = text;
}

document.addEventListener("DOMContentLoaded", () => {
  showTab = QA.initTabs();
  setEnabled(false);
  QA.initDrop($("drop"), $("fileInput"), loadFile);
  document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () =>
    loadBytes(b.dataset.sample, new TextEncoder().encode(SAMPLES[b.dataset.sample]))));
  $("pasteBtn").addEventListener("click", () => {
    const t = $("pasteArea").value;
    if (!t.trim()) { alertBox($("loadMsg"), "err", "הדביקו קודם טקסט של לוג."); return; }
    loadBytes($("pasteCsv").checked ? "pasted.csv" : "pasted.log", new TextEncoder().encode(t));
  });
  document.querySelectorAll("input[name=sev]").forEach((r) => r.addEventListener("change", () => LOG && renderIssues()));
  let timer;
  $("keyword").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => LOG && renderIssues(), 200); });
  $("exportBtn").addEventListener("click", doExport);
});
