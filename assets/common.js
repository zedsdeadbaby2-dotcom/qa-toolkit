/* Shared helpers: CSV read/write, downloads, tabs, theme. */
"use strict";

const QA = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = (d = new Date()) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const fmtInt = (n) => Number(n).toLocaleString("en-US");

  /** RFC 4180 CSV parser. Returns [{line, cells}] where line = first physical line of the row. */
  function parseCsv(text, delimiter = ",") {
    const rows = [];
    let cells = [], cell = "", inQ = false, line = 1, rowStart = 1, i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        if (ch === "\n") line++;
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === "") { inQ = true; i++; continue; }
      if (ch === delimiter) { cells.push(cell); cell = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        cells.push(cell); rows.push({ line: rowStart, cells }); cells = []; cell = "";
        if (ch === "\r" && text[i + 1] === "\n") i++;
        i++; line++; rowStart = line; continue;
      }
      cell += ch; i++;
    }
    if (cell !== "" || cells.length) { cells.push(cell); rows.push({ line: rowStart, cells }); }
    return rows;
  }

  function sniffDelimiter(firstLine) {
    let best = ",", max = 0;
    for (const d of [",", ";", "\t", "|"]) {
      const c = firstLine.split(d).length - 1;
      if (c > max) { max = c; best = d; }
    }
    return best;
  }

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (header, rows) =>
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

  /** Download text as UTF-8 with BOM (so Excel shows Hebrew correctly). */
  function download(name, text, mime = "text/csv") {
    const blob = new Blob(["﻿", text], { type: `${mime};charset=utf-8` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /** Make a safe file name from user text; keeps the wanted extension. */
  function safeFileName(text, ext, fallback) {
    let name = String(text || "").trim().replace(/^["']|["']$/g, "");
    name = name.split(/[\\/]/).pop() || "";
    name = name.replace(/[<>:"|?*\x00-\x1f\x7f]/g, "_").replace(/[ .]+$/, "");
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) name = "_" + name;
    if (!name || name === "." + ext) name = fallback;
    if (!name.toLowerCase().endsWith("." + ext)) name += "." + ext;
    return name.slice(-120);
  }

  function initTabs(root = document) {
    const tabs = [...root.querySelectorAll(".tab[data-panel]")];
    const show = (id) => {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.panel === id));
      root.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== id; });
      try { history.replaceState(null, "", "#" + id); } catch (_) { /* file:// */ }
    };
    tabs.forEach((t) => t.addEventListener("click", () => !t.disabled && show(t.dataset.panel)));
    const fromHash = location.hash.slice(1);
    const first = tabs.find((t) => t.dataset.panel === fromHash && !t.disabled) || tabs[0];
    if (first) show(first.dataset.panel);
    return show;
  }

  function initTheme() {
    const btn = document.getElementById("themeBtn");
    let saved = null;
    try { saved = localStorage.getItem("qa-theme"); } catch (_) { /* private mode */ }
    if (saved) document.documentElement.dataset.theme = saved;
    if (!btn) return;
    btn.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("qa-theme", next); } catch (_) { /* ignore */ }
    });
  }

  function initDrop(zone, input, onFile) {
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { if (input.files[0]) onFile(input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  document.addEventListener("DOMContentLoaded", initTheme);
  return { esc, pad, stamp, fmtInt, parseCsv, sniffDelimiter, toCsv, download, safeFileName, initTabs, initDrop };
})();
