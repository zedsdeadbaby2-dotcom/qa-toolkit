/* Log parsing + statistics + reports (port of tla/parser.py, analyzer.py, report.py). Pure, no DOM. */
"use strict";

const LA = (() => {
  const LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
  const LEVEL_MAP = {
    TRACE: "DEBUG", DEBUG: "DEBUG", DBG: "DEBUG", INFO: "INFO", NOTICE: "INFO", INF: "INFO",
    WARN: "WARNING", WARNING: "WARNING", WRN: "WARNING", ERR: "ERROR", ERROR: "ERROR",
    CRITICAL: "CRITICAL", CRIT: "CRITICAL", FATAL: "CRITICAL", SEVERE: "CRITICAL",
  };
  const STATUS_MAP = {
    PASS: "PASSED", PASSED: "PASSED", OK: "PASSED", SUCCESS: "PASSED", SUCCEEDED: "PASSED", GREEN: "PASSED",
    FAIL: "FAILED", FAILED: "FAILED", FAILURE: "FAILED", BROKEN: "FAILED", ERROR: "FAILED", RED: "FAILED",
    SKIP: "SKIPPED", SKIPPED: "SKIPPED", IGNORED: "SKIPPED", PENDING: "SKIPPED", NOT_RUN: "SKIPPED",
  };
  const MAX_DURATION_S = 7 * 24 * 3600;
  const MAX_SCAN = 2000; // only the first 2,000 chars of a line are searched for test names (speed)

  const normLevel = (t) => (t ? LEVEL_MAP[t.trim().replace(/^[\[\]:]+|[\[\]:]+$/g, "").toUpperCase()] || null : null);
  const normStatus = (t) => (t ? STATUS_MAP[t.trim().toUpperCase().replace(/[ -]/g, "_")] || null : null);

  // ------------------------------------------------------------- durations
  const UNIT = {
    ms: 0.001, msec: 0.001, millis: 0.001, milliseconds: 0.001, millisecond: 0.001,
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  };
  function parseDuration(text, defUnit = "s") {
    if (text == null) return null;
    let t = String(text).trim();
    if (!t) return null;
    let v;
    let m = /^(\d{1,3}):([0-5]\d):([0-5]\d(?:\.\d{1,9})?)$/.exec(t);
    if (m) v = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
    else {
      t = t.replace(/^(\d{1,3}(?:,\d{3})+)(?=\D|$)/, (s) => s.replace(/,/g, "")); // 1,234 ms -> 1234 ms
      m = /^(\d{1,9}(?:[.,]\d{1,9})?)\s*([a-z]+)?$/i.exec(t);
      if (!m) return null;
      const unit = (m[2] || defUnit).toLowerCase();
      if (!(unit in UNIT)) return null;
      v = parseFloat(m[1].replace(",", ".")) * UNIT[unit];
    }
    return Number.isNaN(v) || v < 0 || v > MAX_DURATION_S ? null : v;
  }

  // ------------------------------------------------------------- timestamps
  // Value = milliseconds, "naive UTC" (aware stamps converted to UTC). Time-only -> {timeOnly}.
  function mk(y, mo, d, h, mi, s, frac) {
    const ms = Date.UTC(y, mo - 1, d, h, mi, s, frac ? Math.round(parseFloat("0." + frac) * 1000) : 0);
    const dt = new Date(ms);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
    return ms;
  }
  function parseTimestamp(text) {
    if (!text) return null;
    const t = text.trim().replace(/^\[+|\]+$/g, "");
    if (!t || t.length > 40) return null;
    let m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
    if (m) {
      let ms = mk(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7]);
      if (ms == null) return null;
      if (m[8] && m[8] !== "Z") {
        const sign = m[8][0] === "-" ? -1 : 1, z = m[8].slice(1).replace(":", "");
        ms -= sign * (+z.slice(0, 2) * 60 + +z.slice(2, 4)) * 60000;
      }
      return { ms };
    }
    m = /^(\d{2})[/.](\d{2})[/.](\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
    if (m) { const ms = mk(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] || 0)); return ms == null ? null : { ms }; }
    m = /^(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?$/.exec(t);
    if (m && +m[1] < 24 && +m[2] < 60 && +m[3] < 60)
      return { timeOnly: ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + (m[4] ? Math.round(parseFloat("0." + m[4]) * 1000) : 0) };
    return null;
  }
  class DateTracker {
    constructor() { this.day = null; }
    fix(e) {
      if (!e.ts) { e.timestamp = null; return; }
      if (e.ts.timeOnly != null) e.timestamp = this.day != null ? this.day + e.ts.timeOnly : null;
      else { e.timestamp = e.ts.ms; this.day = e.ts.ms - (e.ts.ms % 86400000); }
      delete e.ts;
    }
  }

  // ------------------------------------------------------------- text logs
  const TS = String.raw`\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}[/.]\d{2}[/.]\d{4} \d{2}:\d{2}(?::\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?`;
  const LW = "TRACE|DEBUG|DBG|INFO|INF|NOTICE|WARN(?:ING)?|WRN|ERR(?:OR)?|CRIT(?:ICAL)?|FATAL|SEVERE";
  const PREFIX = String.raw`(?:[\[(][^\])]{1,40}[\])][\s|,;:\-]*){1,2}(?=[\[<(]?(?:${LW})(?:[\]>)]|[\s:|,;\-]|$))`;
  const LINE_RE = new RegExp(String.raw`^\s*(?:\[?(?<ts>${TS})\]?)?[\s|,;]*(?:${PREFIX})?(?:[\[<(]?(?<level>${LW})[\]>)]?(?=[\s:|,;\-]|$))?[\s:|,;\-]*(?<rest>.*)$`, "is");
  const STATUS_RE = /(?:\bstatus\s*[=:]\s*(?<kv>\w+))|\b(?<word>PASS(?:ED)?|FAIL(?:ED|URE)?|SKIP(?:PED)?)\b/gi;
  const ADJ_RE = /^[\s:|,;=>\-\])]*$/;
  const TEST_KV_RE = /\btest(?:_?name)?\s*[=:]\s*["']?(?<n>[^\s,;"']+)/i;
  const TEST_TOKEN_RE = /(?<n>[\w./\\-]+::[\w\[\]\-.]+|\b[Tt]est[_A-Z][\w.\-]*\w|\b\w+[_.][Tt]est\w*)/;
  const UNITS = "(?:ms|msec|millis|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?)";
  const DUR_KV_RE = new RegExp(String.raw`\b(?<k>duration|elapsed|took|time|runtime)\s*[=:]\s*(?<v>\d[\d.:,]*(?:\s*${UNITS})?)\b`, "gi");
  const DUR_UNIT_RE = /(?<![\w.:])(?<v>\d{1,9}(?:[.,]\d{1,9})?\s*(?:ms|msec|s|sec|secs|seconds?|m|min|mins|minutes?))\b/i;
  // "Totals: 10 PASSED, 2 FAILED" style summary lines are not a test result
  const SUMMARY_RE = /\b\d+\s+(?:PASS(?:ED)?|FAIL(?:ED|URES?)?|SKIP(?:PED)?)\b[^\n]*\b\d+\s+(?:PASS(?:ED)?|FAIL(?:ED|URES?)?|SKIP(?:PED)?)\b/i;
  const CONT_RE = /^(?:\s+\S|Traceback \(most recent call last\)|Caused by[: ]|During handling of|[\w.]*(?:Error|Exception|Failure)\b[:(]?|at [\w.$<>]+\()/;
  const MAX_CONT = 2000;

  function findTest(rest) {
    const s = rest.slice(0, MAX_SCAN);
    const m = TEST_KV_RE.exec(s) || TEST_TOKEN_RE.exec(s);
    return m ? { name: m.groups.n, end: m.index + m[0].length } : null;
  }
  function findStatus(rest, test) {
    if (SUMMARY_RE.test(rest)) return null;
    STATUS_RE.lastIndex = 0;
    let sm;
    while ((sm = STATUS_RE.exec(rest))) {
      if (sm.groups.kv) { const st = normStatus(sm.groups.kv); if (st) return st; continue; }
      const w = sm.groups.word;
      const after = test && test.end <= sm.index && ADJ_RE.test(rest.slice(test.end, sm.index));
      if ((w === w.toUpperCase()) || after) return normStatus(w);
    }
    return null;
  }
  function durations(rest) {
    const vals = [];
    for (const m of rest.matchAll(DUR_KV_RE))
      if (!(m.groups.k.toLowerCase() === "time" && m.groups.v.includes(":"))) vals.push(m.groups.v);
    const parsed = vals.map((v) => parseDuration(v)).filter((d) => d != null);
    return { vals, dur: parsed.find((d) => d > 0) ?? (parsed.length ? parsed[0] : null) };
  }

  const newResult = () => ({ entries: [], skipped: [], notes: [], totalLines: 0 });
  const skip = (r, line, reason, text) => r.skipped.push({ line, reason, text: (text || "").slice(0, 300) });
  const note = (r, line, reason) => r.notes.push({ line, reason });

  function parseTextLine(no, line, r) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) return null;
    const m = LINE_RE.exec(s);
    const rest = (m ? m.groups.rest : s).trim();
    const level = m && m.groups.level ? normLevel(m.groups.level) : null;
    const tm = findTest(rest);
    const status = findStatus(rest, tm);
    if (!level && !status) { skip(r, no, "no log level (INFO/WARNING/ERROR...) or test status found", s); return null; }
    const e = { line: no, level, status, message: rest, test: null, rawTime: "", ts: null, duration: null };
    if (m && m.groups.ts) { e.rawTime = m.groups.ts; e.ts = parseTimestamp(m.groups.ts); }
    if (tm) e.test = tm.name.replace(/^[\[\](),.:;]+|[\[\](),.:;]+$/g, "");
    const d = durations(rest);
    if (d.vals.length) {
      e.duration = d.dur;
      if (e.duration == null) note(r, no, `unreadable duration '${d.vals[0].trim()}' ignored`);
    } else if (status) {
      const um = DUR_UNIT_RE.exec(rest);
      if (um) e.duration = parseDuration(um.groups.v);
    }
    return e;
  }
  function isEvent(line) {
    const m = LINE_RE.exec(line.trim());
    if (!m) return false;
    const rest = m.groups.rest.trim();
    return !!(m.groups.level || findStatus(rest, findTest(rest)));
  }
  function parseText(lines) {
    const r = newResult(), dates = new DateTracker();
    let last = null;
    lines.forEach((line, i) => {
      const no = i + 1;
      r.totalLines = no;
      if (last && line.trim() && CONT_RE.test(line) && !isEvent(line)) {
        if (last.message.length < MAX_CONT) last.message = `${last.message} | ${line.trim()}`.slice(0, MAX_CONT);
        return;
      }
      const e = parseTextLine(no, line, r);
      if (e) { dates.fix(e); r.entries.push(e); last = e; }
      else if (line.trim() && !/^\s*(#|\/\/)/.test(line)) last = null;
    });
    return r;
  }

  // ------------------------------------------------------------- CSV logs
  const ALIASES = {
    timestamp: ["timestamp", "datetime", "date_time", "date", "ts", "start_time", "time", "logged_at", "created_at"],
    level: ["level", "severity", "log_level", "loglevel", "lvl", "priority", "type"],
    test: ["test_name", "test", "testname", "test_case", "testcase", "case", "name", "scenario"],
    status: ["status", "result", "outcome", "verdict", "test_status", "state"],
    duration: ["duration", "duration_s", "duration_sec", "duration_seconds", "seconds", "elapsed", "elapsed_s",
      "runtime", "time_taken", "duration_ms", "elapsed_ms", "time_ms", "runtime_ms"],
    message: ["message", "msg", "details", "description", "error", "error_message", "text", "log", "info"],
  };
  const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[\s\-./]+/g, "_").replace(/^_+|_+$/g, "");
  function mapColumns(headers) {
    const norm = {};
    headers.forEach((h) => { if (h) norm[normHeader(h)] = h; });
    const map = {};
    for (const [f, al] of Object.entries(ALIASES))
      for (const a of al) if (a in norm && !Object.values(map).includes(norm[a])) { map[f] = norm[a]; break; }
    return map;
  }
  function looksLikeCsvHeader(headers) {
    const m = mapColumns(headers);
    return Object.keys(m).length >= 2 && ("level" in m || "status" in m);
  }
  function parseCsvLog(headers, rows) {
    const r = newResult(), dates = new DateTracker(), cols = mapColumns(headers);
    // a "time" column holding plain numbers (JUnit style) is a duration, not a clock time
    if (cols.timestamp && normHeader(cols.timestamp) === "time" && !cols.duration) {
      const vals = rows.map((x) => (x.row[cols.timestamp] || "").trim()).filter(Boolean);
      if (vals.length && vals.every((v) => /^\d+(?:[.,]\d+)?$/.test(v))) { cols.duration = cols.timestamp; delete cols.timestamp; }
    }
    const unit = normHeader(cols.duration || "").endsWith("ms") ? "ms" : "s";
    const get = (row, k) => (cols[k] ? (row[cols[k]] || "") : "").trim();
    for (const { line, row } of rows) {
      r.totalLines = line;
      if (!Object.values(row).some((v) => String(v || "").trim())) continue;
      const lt = get(row, "level"), st = get(row, "status");
      const level = normLevel(lt), status = normStatus(st);
      if (lt && !level) note(r, line, `unknown level '${lt.slice(0, 20)}' ignored`);
      if (st && !status) note(r, line, `unknown status '${st.slice(0, 20)}' ignored`);
      const message = get(row, "message").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(" | ");
      if (!level && !status) { skip(r, line, "row has no valid level or status", Object.values(row).join(", ").slice(0, 200)); continue; }
      const e = { line, level, status, message, test: get(row, "test") || null, rawTime: "", ts: null, duration: null };
      const ts = get(row, "timestamp");
      if (ts) { e.rawTime = ts; e.ts = parseTimestamp(ts); if (!e.ts) note(r, line, `unreadable time '${ts.slice(0, 30)}' ignored`); }
      const d = get(row, "duration");
      if (d) { e.duration = parseDuration(d, unit); if (e.duration == null) note(r, line, `unreadable duration '${d.slice(0, 20)}' ignored`); }
      dates.fix(e);
      r.entries.push(e);
    }
    return r;
  }

  // ------------------------------------------------------------- decode + load
  function decode(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16" };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16" };
    const head = bytes.subarray(0, 4096);
    if (head.includes(0)) {
      // UTF-16 without BOM: every 2nd byte is 0 for Latin text
      let zOdd = 0, zEven = 0;
      for (let i = 0; i < head.length; i++) if (head[i] === 0) (i % 2 ? zOdd++ : zEven++);
      if (zOdd > head.length / 4 && zEven === 0) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" };
      if (zEven > head.length / 4 && zOdd === 0) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" };
      throw new Error("This looks like a binary file, not a text/CSV log.");
    }
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""), encoding: "utf-8" }; } catch (_) { /* next */ }
    // mostly UTF-8 with a few bad bytes: keep UTF-8 (bad bytes become �) instead of garbling everything
    const loose = new TextDecoder("utf-8").decode(bytes);
    const bad = (loose.match(/�/g) || []).length;
    if (bad <= Math.max(3, loose.length / 1000) && /[֐-׿]/.test(loose)) return { text: loose.replace(/^﻿/, ""), encoding: "utf-8 (some bad bytes)" };
    try { return { text: new TextDecoder("windows-1255", { fatal: true }).decode(bytes), encoding: "cp1255" }; } catch (_) { /* next */ }
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "latin-1" };
  }

  function load(name, bytes) {
    if (!bytes.length) throw new Error(`'${name}' is empty.`);
    if (bytes.length > 100 * 1024 * 1024) throw new Error(`File is too large (${Math.floor(bytes.length / 2 ** 20)} MB, max 100 MB).`);
    const { text, encoding } = decode(bytes);
    let lines = text.split(/\r\n|\r|\n/);
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    const firstIdx = lines.findIndex((l) => l.trim());
    const first = firstIdx >= 0 ? lines[firstIdx] : "";
    const delim = QA.sniffDelimiter(first);
    let isCsv = /\.(csv|tsv)$/i.test(name);
    if (!isCsv && first) {
      const cells = (QA.parseCsv(first, delim)[0] || { cells: [] }).cells;
      isCsv = cells.length > 1 && looksLikeCsvHeader(cells);
    }
    let parsed, kind;
    if (isCsv) {
      kind = "csv";
      const odd = (text.match(/"/g) || []).length % 2 === 1;
      let rows;
      const warnings = [];
      if (odd) {
        const bad = lines.findIndex((l) => (l.match(/"/g) || []).length % 2) + 1;
        warnings.push({ line: bad, reason: "unclosed quote (\") - file was read line by line so no rows are lost" });
        rows = lines.map((l, i) => ({ line: i + 1, cells: (QA.parseCsv(l, delim)[0] || { cells: [] }).cells }));
      } else rows = QA.parseCsv(text, delim);
      rows = rows.filter((r, i) => i >= rows.findIndex((x) => x.cells.some((c) => c.trim())));
      if (!rows.length) throw new Error(`'${name}' has no header row.`);
      const headers = rows[0].cells.map((h) => h.trim());
      if (!headers.some(Boolean)) throw new Error(`'${name}' has no header row.`);
      const data = rows.slice(1).map((r) => ({ line: r.line, row: Object.fromEntries(headers.map((h, i) => [h, r.cells[i] ?? ""]).filter(([h]) => h)) }));
      parsed = parseCsvLog(headers, data);
      parsed.totalLines = lines.length;
      warnings.forEach((w) => note(parsed, w.line, w.reason));
    } else {
      kind = "text";
      parsed = parseText(lines);
    }
    return { name, kind, encoding, parsed, stats: computeStats(parsed.entries) };
  }

  // ------------------------------------------------------------- statistics
  function durStats(vals) {
    if (!vals.length) return { count: 0, average: 0, median: 0, min: 0, max: 0, total: 0 };
    const s = [...vals].sort((a, b) => a - b), n = s.length, total = s.reduce((a, b) => a + b, 0);
    return { count: n, average: total / n, median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, min: s[0], max: s[n - 1], total };
  }
  const label = (e) => e.test || `(line ${e.line})`;
  function computeStats(entries) {
    const st = { entries: entries.length, levels: Object.fromEntries(LEVELS.map((l) => [l, 0])) };
    entries.forEach((e) => { if (e.level) st.levels[e.level]++; });
    const res = entries.filter((e) => e.status);
    st.passed = res.filter((e) => e.status === "PASSED").length;
    st.failed = res.filter((e) => e.status === "FAILED").length;
    st.skipped = res.filter((e) => e.status === "SKIPPED").length;
    st.results = st.passed + st.failed + st.skipped;
    st.executed = st.passed + st.failed;
    st.passRate = st.executed ? (100 * st.passed) / st.executed : null;
    st.uniqueTests = new Set(res.filter((e) => e.test).map((e) => e.test)).size;
    st.failedTests = res.filter((e) => e.status === "FAILED");
    let timed = res.filter((e) => e.duration != null);
    if (!timed.length) timed = entries.filter((e) => e.duration != null);
    st.durations = durStats(timed.map((e) => e.duration));
    st.passedDur = durStats(timed.filter((e) => e.status === "PASSED").map((e) => e.duration));
    st.failedDur = durStats(timed.filter((e) => e.status === "FAILED").map((e) => e.duration));
    st.slowest = [...timed].sort((a, b) => b.duration - a.duration).slice(0, 5).map((e) => [label(e), e.duration]);
    const times = entries.map((e) => e.timestamp).filter((t) => t != null);
    st.first = times.length ? Math.min(...times) : null;
    st.last = times.length ? Math.max(...times) : null;
    return st;
  }

  const FILTERS = { errors: ["ERROR", "CRITICAL"], warnings: ["WARNING"], both: ["WARNING", "ERROR", "CRITICAL"] };
  const FILTER_TITLES = { errors: "ERRORS", warnings: "WARNINGS", both: "ERRORS AND WARNINGS" };
  function filter(entries, mode, keyword) {
    const kw = (keyword || "").trim().toLowerCase();
    const lv = new Set(FILTERS[mode]);
    const list = entries.filter((e) => lv.has(e.level) && (!kw || e.message.toLowerCase().includes(kw) || (e.test || "").toLowerCase().includes(kw)));
    return { mode, keyword: kw ? keyword.trim() : "", entries: list, title: FILTER_TITLES[mode] + (kw ? ` containing '${keyword.trim()}'` : "") };
  }

  // ------------------------------------------------------------- formatting + reports
  function fmtDur(s) {
    if (s == null) return "-";
    if (s < 1) return `${Math.round(s * 1000)} ms`;
    if (s < 60) return `${s.toFixed(2)} s`;
    let m = Math.floor(s / 60);
    const sec = s - m * 60;
    if (m < 60) return `${m}m ${sec.toFixed(1).padStart(4, "0")}s`;
    const h = Math.floor(m / 60); m -= h * 60;
    return `${h}h ${String(m).padStart(2, "0")}m ${String(Math.round(sec)).padStart(2, "0")}s`;
  }
  function fmtTime(ms) {
    if (ms == null) return "-";
    const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
  const pct = (a, t) => (t ? `${((100 * a) / t).toFixed(1)}%`.padStart(6) : "     -");
  const bar = (a, t, w = 30) => { const f = t ? Math.round((w * a) / t) : 0; return "#".repeat(f) + ".".repeat(w - f); };
  const nowLocal = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); };

  function summaryLines(s) {
    const L = [];
    L.push("TEST RESULTS");
    if (s.results) {
      for (const [n, v] of [["Passed", s.passed], ["Failed", s.failed], ["Skipped", s.skipped]])
        L.push(`  ${n.padEnd(9)}${String(v).padStart(7)}  ${pct(v, s.results)}  ${bar(v, s.results)}`);
      L.push(`  ${"Total".padEnd(9)}${String(s.results).padStart(7)}  (${s.uniqueTests} different test names)`);
      L.push(`  Pass rate (passed / executed, skipped not counted): ${s.passRate == null ? "-" : s.passRate.toFixed(1) + "%"}`);
    } else L.push("  No PASSED / FAILED / SKIPPED results found in this file.");
    L.push("", "RUN TIMES");
    const d = s.durations;
    if (d.count) {
      L.push(`  Average  ${fmtDur(d.average).padStart(12)}     Median ${fmtDur(d.median).padStart(12)}`);
      L.push(`  Fastest  ${fmtDur(d.min).padStart(12)}     Slowest ${fmtDur(d.max).padStart(11)}`);
      L.push(`  Total    ${fmtDur(d.total).padStart(12)}     (${d.count} timed results)`);
      if (s.passedDur.count || s.failedDur.count)
        L.push(`  Avg passed ${fmtDur(s.passedDur.count ? s.passedDur.average : null).padStart(10)}     Avg failed ${fmtDur(s.failedDur.count ? s.failedDur.average : null).padStart(10)}`);
    } else L.push("  No run times found in this file.");
    L.push("", "LOG LEVELS");
    const tl = Object.values(s.levels).reduce((a, b) => a + b, 0);
    for (const l of LEVELS) L.push(`  ${l.padEnd(9)}${String(s.levels[l]).padStart(7)}  ${pct(s.levels[l], tl)}  ${bar(s.levels[l], tl)}`);
    if (s.first != null) L.push("", "TIME RANGE", `  From ${fmtTime(s.first)}  to  ${fmtTime(s.last)}   (${fmtDur((s.last - s.first) / 1000)})`);
    if (s.slowest.length) { L.push("", `SLOWEST ${s.slowest.length}`); s.slowest.forEach(([n, v], i) => L.push(`  ${i + 1}. ${fmtDur(v).padStart(10)}  ${n}`)); }
    if (s.failedTests.length) {
      L.push("", `FAILED TESTS (${s.failedTests.length})`);
      s.failedTests.slice(0, 50).forEach((e) => L.push(`  line ${String(e.line).padEnd(6)} ${label(e)}  ${e.message ? "- " + e.message.slice(0, 80) : ""}`));
      if (s.failedTests.length > 50) L.push(`  ... and ${s.failedTests.length - 50} more`);
    }
    return L;
  }
  function entryLine(e) {
    const t = e.timestamp != null ? fmtTime(e.timestamp) : e.rawTime || "-";
    const msg = e.message.length <= 200 ? e.message : e.message.slice(0, 197) + "...";
    return `line ${String(e.line).padEnd(6)} ${(e.level || "-").padEnd(8)} ${t.padEnd(19)}  ${msg}`;
  }
  function textReport(log, issues, title) {
    const eq = "=".repeat(70);
    let L = [eq, "TEST LOG REPORT", eq, `Source file : ${log.name}`, `Created     : ${fmtTime(nowLocal())}`,
      `Log entries : ${log.stats.entries}   (unreadable lines skipped: ${log.parsed.skipped.length})`, "", ...summaryLines(log.stats)];
    if (issues) { L.push("", `${title} (${issues.length})`); L = L.concat(issues.length ? issues.map((e) => "  " + entryLine(e)) : ["  none"]); }
    L.push("", eq, "End of report");
    return L.join("\r\n") + "\r\n";
  }
  const safeCell = (v) => { const s = String(v ?? ""); return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s; };
  function csvReport(log, issues) {
    const s = log.stats, rows = [];
    const add = (section, item, value = "", x = {}) => rows.push([section, item, value, x.line ?? "", x.level ?? "", x.time ?? "", x.test ?? "", x.message ?? ""].map(safeCell));
    add("info", "source_file", log.name); add("info", "created", fmtTime(nowLocal()));
    add("info", "log_entries", s.entries); add("info", "skipped_lines", log.parsed.skipped.length);
    add("summary", "passed", s.passed); add("summary", "failed", s.failed); add("summary", "skipped", s.skipped);
    add("summary", "total_results", s.results); add("summary", "pass_rate_percent", s.passRate == null ? "" : s.passRate.toFixed(1));
    const d = s.durations;
    for (const [k, v] of [["avg_duration_s", d.average], ["median_duration_s", d.median], ["min_duration_s", d.min], ["max_duration_s", d.max], ["total_duration_s", d.total]])
      add("duration", k, d.count ? v.toFixed(3) : "");
    LEVELS.forEach((l) => add("level_count", l, s.levels[l]));
    s.slowest.forEach(([n, v]) => add("slowest", n, v.toFixed(3)));
    const ex = (e) => ({ line: e.line, level: e.level, time: e.rawTime, test: e.test, message: e.message });
    s.failedTests.forEach((e) => add("failed_test", label(e), "", ex(e)));
    (issues || []).forEach((e) => add("issue", e.level || "", "", ex(e)));
    return QA.toCsv(["section", "item", "value", "line", "level", "time", "test", "message"], rows);
  }

  return { LEVELS, load, filter, fmtDur, fmtTime, label, summaryLines, textReport, csvReport, parseDuration, parseText, FILTERS };
})();
