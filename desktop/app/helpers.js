/* desktop/app/helpers.js — Shared pure helpers & LieFlat chart generators (UMD: browser + Node test) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PTLHelpers = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function mapPrepareSummary(r, fileBytesLen) {
    var d = r || {};
    var totalSegments = typeof d.total === "number" ? d.total : (typeof d.items === "number" ? d.items : 0);
    var batchesTotal = typeof d.batches_total === "number" ? d.batches_total : (typeof d.batches === "number" ? d.batches : 0);
    var scannedPages = Array.isArray(d.scanned) ? d.scanned : (Array.isArray(d.scanned_pages) ? d.scanned_pages : []);
    return {
      name: String(d.name || ""),
      pages: Number(d.pages || 0),
      totalSegments: totalSegments,
      doneSegments: Number(d.done || 0),
      words: Number(d.words || 0),
      chars: Number(d.chars || 0),
      batchesDone: Number(d.batches_done || 0),
      batchesTotal: batchesTotal,
      scannedPages: scannedPages,
      huong: d.huong === "vi-en" ? "vi-en" : "en-vi",
      bytes: Number(fileBytesLen || 0),
    };
  }

  function extractJsonText(raw) {
    var t = String(raw || "").trim();
    var m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
    if (m) return m[1].trim();
    var fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
    if (fence) {
      var candidate = fence[1].trim();
      var fi = candidate.indexOf("{"), fj = candidate.lastIndexOf("}");
      if (fi >= 0 && fj > fi) return candidate.slice(fi, fj + 1);
    }
    var i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i >= 0 && j > i) return t.slice(i, j + 1);
    return t;
  }

  function redactSecrets(text) {
    return String(text || "")
      .replace(/\b(sk-or-v1-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{16,}|ghp_[A-Za-z0-9]{12,}|gho_[A-Za-z0-9]{12,})\b/g, "<REDACTED>")
      .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "$1<REDACTED>");
  }

  function buildLieFlatMetricsSvg(title, metrics) {
    // metrics: [{ label, pct (0..100), valueText, color }] — 100% unbroken Y-axis (0% -> 100%)
    var list = (metrics || []).slice(0, 6);
    if (!list.length) return "";
    var W = 520, rowH = 34, padTop = 34, padBot = 26, H = padTop + list.length * rowH + padBot;
    var left = 148, barMax = 290;
    var rows = list.map(function (m, idx) {
      var y = padTop + idx * rowH;
      var pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
      var w = Math.round((pct / 100) * barMax);
      var col = m.color || (pct >= 90 ? "#22c55e" : pct >= 70 ? "#14b8a6" : "#f59e0b");
      var safeLbl = String(m.label || "").replace(/[<>&"]/g, "");
      var safeVal = String(m.valueText || (pct + "%")).replace(/[<>&"]/g, "");
      return (
        "<text x='8' y='" + (y + 15) + "' fill='#cbd5e1' font-size='11.5' font-family='Segoe UI, sans-serif'>" + safeLbl + "</text>" +
        "<rect x='" + left + "' y='" + (y + 3) + "' width='" + barMax + "' height='16' rx='3' fill='#1c2736'/>" +
        "<rect x='" + left + "' y='" + (y + 3) + "' width='" + w + "' height='16' rx='3' fill='" + col + "'/>" +
        "<text x='" + (left + barMax + 10) + "' y='" + (y + 15) + "' fill='#eef2f6' font-size='11.5' font-family='Consolas, monospace'>" + safeVal + "</text>"
      );
    }).join("");

    // Unbroken 0%, 50%, 100% axis lines
    var axisYBottom = padTop + list.length * rowH + 6;
    var ticks = [0, 50, 100].map(function (t) {
      var x = left + Math.round((t / 100) * barMax);
      return "<line x1='" + x + "' y1='" + padTop + "' x2='" + x + "' y2='" + axisYBottom + "' stroke='#243142' stroke-dasharray='2,2'/>" +
        "<text x='" + x + "' y='" + (axisYBottom + 14) + "' text-anchor='middle' fill='#64748b' font-size='10' font-family='Consolas, monospace'>" + t + "%</text>";
    }).join("");

    return "<svg viewBox='0 0 " + W + " " + H + "' width='100%' height='auto' role='img' aria-label='" + String(title || "QA Chart").replace(/["<>]/g, "") + "'>" +
      "<text x='8' y='19' fill='#94a3b8' font-size='11.5' font-weight='600' font-family='Segoe UI, sans-serif'>" + String(title || "").replace(/[<>&"]/g, "") + "</text>" +
      ticks + rows +
      "</svg>";
  }

  function buildBatchLatencySvg(latenciesMs) {
    var arr = (latenciesMs || []).slice(-20);
    if (!arr.length) return "";
    var W = 420, H = 92, padL = 36, padR = 12, padT = 16, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxMs = Math.max.apply(null, arr.concat([1000]));
    var bw = Math.max(8, Math.floor(plotW / Math.max(arr.length, 1)) - 4);
    var bars = arr.map(function (ms, i) {
      var ratio = Math.max(0, ms) / maxMs;
      var bh = Math.max(3, Math.round(ratio * plotH));
      var x = padL + i * Math.floor(plotW / arr.length);
      var y = padT + (plotH - bh);
      return "<rect x='" + x + "' y='" + y + "' width='" + bw + "' height='" + bh + "' rx='2' fill='#14b8a6'><title>Lô " + (i + 1) + ": " + ms + " ms</title></rect>";
    }).join("");
    // Unbroken 0 -> maxMs Y-axis
    return "<svg viewBox='0 0 " + W + " " + H + "' width='100%' height='auto'>" +
      "<line x1='" + padL + "' y1='" + padT + "' x2='" + padL + "' y2='" + (padT + plotH) + "' stroke='#334155'/>" +
      "<line x1='" + padL + "' y1='" + (padT + plotH) + "' x2='" + (W - padR) + "' y2='" + (padT + plotH) + "' stroke='#334155'/>" +
      "<text x='" + (padL - 4) + "' y='" + (padT + 8) + "' text-anchor='end' fill='#64748b' font-size='9.5' font-family='Consolas, monospace'>" + (maxMs / 1000).toFixed(1) + "s</text>" +
      "<text x='" + (padL - 4) + "' y='" + (padT + plotH) + "' text-anchor='end' fill='#64748b' font-size='9.5' font-family='Consolas, monospace'>0s</text>" +
      bars +
      "<text x='" + padL + "' y='" + (H - 4) + "' fill='#94a3b8' font-size='10' font-family='Segoe UI, sans-serif'>Độ trễ " + arr.length + " lô gần nhất</text>" +
      "</svg>";
  }

  return {
    mapPrepareSummary: mapPrepareSummary,
    extractJsonText: extractJsonText,
    redactSecrets: redactSecrets,
    buildLieFlatMetricsSvg: buildLieFlatMetricsSvg,
    buildBatchLatencySvg: buildBatchLatencySvg,
  };
});
