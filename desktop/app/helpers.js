/* desktop/app/helpers.js — Shared pure helpers, Glossary, Failover, Export & LieFlat SVG charts (UMD: browser + Node test) */
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
      huong: d.huong === "vi-en" || d.huong === "fr-vi" ? d.huong : "en-vi",
      linhVuc: d.linh_vuc === "y-duoc" ? "y-duoc" : "chung",
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

  function escapeRe(x) { return String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Thuật ngữ có xuất hiện trong lô đang dịch (không phân biệt hoa thường, khớp trọn từ để "po", "iv" không dính vào từ khác)
  function glossaryTermsInText(entries, text) {
    var t = String(text || "");
    if (!t) return entries || [];
    return (entries || []).filter(function (g) {
      if (!g || !g.src) return false;
      var re = new RegExp("(^|[^\\p{L}\\p{N}])" + escapeRe(String(g.src).trim()) + "(?=$|[^\\p{L}\\p{N}])", "iu");
      return re.test(t);
    });
  }

  function buildGlossaryPromptBlock(entries, huong, text) {
    var pool = (entries || []).filter(function (g) { return g && g.src && g.dst; });
    if (text !== undefined) pool = glossaryTermsInText(pool, text);
    var list = pool.slice(0, 150);
    if (!list.length) return "";
    var header = huong === "vi-en"
      ? "\nMANDATORY GLOSSARY (use exact English equivalents when these terms appear):"
      : "\nBẢNG THUẬT NGỮ BẮT BUỘC (dùng đúng bản dịch chuẩn sau khi gặp trong văn bản):";
    var lines = list.map(function (g) {
      return "- " + String(g.src).trim() + " => " + String(g.dst).trim();
    });
    return header + "\n" + lines.join("\n") + "\n";
  }

  function directionLabel(huong) {
    return huong === "vi-en" ? "Việt → Anh" : (huong === "fr-vi" ? "Pháp → Việt" : "Anh → Việt");
  }

  // Bộ thuật ngữ Y Dược hợp với chiều dịch (bản Y Dược tự bật); Việt → Anh không có bộ mẫu
  function medicalPresetFor(huong) {
    return huong === "fr-vi" ? "y-duoc-fr" : (huong === "en-vi" ? "y-duoc-en" : "");
  }

  function mergeGlossary(lists) {
    var seen = {};
    var out = [];
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (t) {
        if (!t || !t.src || !t.dst) return;
        var k = String(t.src).trim().toLowerCase();
        if (seen[k]) return;
        seen[k] = true;
        out.push(t);
      });
    });
    return out;
  }

  function pickFailoverEngine(currentId, failoverOrder, enginesList, triedIds) {
    var tried = new Set(triedIds || []);
    if (currentId) tried.add(currentId);
    var map = {};
    (enginesList || []).forEach(function (e) { map[e.id] = e; });
    var order = Array.isArray(failoverOrder) && failoverOrder.length
      ? failoverOrder
      : (enginesList || []).map(function (e) { return e.id; });
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      if (!id || tried.has(id)) continue;
      var eng = map[id];
      if (eng && eng.installed && eng.loggedIn) return eng;
    }
    return null;
  }

  function parseGlossaryImport(rawText) {
    var text = String(rawText || "").trim();
    if (!text) return [];
    if (text[0] === "[" || text[0] === "{") {
      try {
        var parsed = JSON.parse(text);
        var arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.terms) ? parsed.terms : []);
        return arr
          .filter(function (x) { return x && x.src && x.dst; })
          .map(function (x) { return { src: String(x.src).trim(), dst: String(x.dst).trim(), note: String(x.note || "").trim() }; });
      } catch {
        /* fall through to line parser */
      }
    }
    var out = [];
    text.split(/\r?\n/).forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed || trimmed[0] === "#") return;
      var parts = trimmed.includes("=>")
        ? trimmed.split("=>")
        : trimmed.includes("\t")
          ? trimmed.split("\t")
          : trimmed.split(",");
      if (parts.length >= 2) {
        var src = parts[0].replace(/^["']|["']$/g, "").trim();
        var dst = parts[1].replace(/^["']|["']$/g, "").trim();
        if (src && dst && !/^source$/i.test(src) && !/^src$/i.test(src)) {
          out.push({ src: src, dst: dst, note: parts[2] ? parts[2].replace(/^["']|["']$/g, "").trim() : "" });
        }
      }
    });
    return out;
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/[",\r\n]/.test(s)) return "\"" + s.replace(/"/g, "\"\"") + "\"";
    return s;
  }

  function exportSegmentsToCsv(segments) {
    var lines = ["ID,Source,Translation,Origin,Warning"];
    (segments || []).forEach(function (s) {
      lines.push([
        csvCell(s.id),
        csvCell(s.src),
        csvCell(s.dst),
        csvCell(s.origin || "ai"),
        csvCell(s.warn || ""),
      ].join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  function exportSegmentsToMarkdown(segments, docName) {
    var head = "# Bảng đối chiếu song ngữ — " + String(docName || "PDF") + "\n\n| ID | Văn bản gốc | Bản dịch | Trạng thái |\n| :--- | :--- | :--- | :--- |\n";
    var escMd = function (v) { return String(v || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " "); };
    var rows = (segments || []).map(function (s) {
      var st = s.warn ? "⚠ " + s.warn : (s.origin === "tm" ? "TM" : s.origin === "manual" ? "Sửa tay" : "OK");
      return "| `" + escMd(s.id) + "` | " + escMd(s.src) + " | " + escMd(s.dst) + " | " + escMd(st) + " |";
    });
    return head + rows.join("\n") + "\n";
  }

  function xmlEsc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function exportSegmentsToTmx(segments, huong) {
    var srcLang = huong === "vi-en" ? "vi-VN" : (huong === "fr-vi" ? "fr-FR" : "en-US");
    var dstLang = huong === "vi-en" ? "en-US" : "vi-VN";
    var body = (segments || []).filter(function (s) { return s.src && s.dst; }).map(function (s) {
      return "    <tu tuid=\"" + xmlEsc(s.id) + "\">\n" +
        "      <tuv xml:lang=\"" + srcLang + "\"><seg>" + xmlEsc(s.src) + "</seg></tuv>\n" +
        "      <tuv xml:lang=\"" + dstLang + "\"><seg>" + xmlEsc(s.dst) + "</seg></tuv>\n" +
        "    </tu>";
    }).join("\n");
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
      "<tmx version=\"1.4\">\n" +
      "  <header creationtool=\"PDF Layout VI Studio\" creationtoolversion=\"4.0.0\" datatype=\"PlainText\" segtype=\"sentence\" srclang=\"" + srcLang + "\"/>\n" +
      "  <body>\n" + body + "\n  </body>\n" +
      "</tmx>\n";
  }

  function buildLieFlatMetricsSvg(title, metrics) {
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
        "<text x='8' y='" + (y + 15) + "' fill='currentColor' opacity='0.82' font-size='11.5' font-family='Segoe UI, sans-serif'>" + safeLbl + "</text>" +
        "<rect x='" + left + "' y='" + (y + 3) + "' width='" + barMax + "' height='16' rx='3' fill='currentColor' opacity='0.10'/>" +
        "<rect x='" + left + "' y='" + (y + 3) + "' width='" + w + "' height='16' rx='3' fill='" + col + "'/>" +
        "<text x='" + (left + barMax + 10) + "' y='" + (y + 15) + "' fill='currentColor' font-size='11.5' font-family='Consolas, monospace'>" + safeVal + "</text>"
      );
    }).join("");

    var axisYBottom = padTop + list.length * rowH + 6;
    var ticks = [0, 50, 100].map(function (t) {
      var x = left + Math.round((t / 100) * barMax);
      return "<line x1='" + x + "' y1='" + padTop + "' x2='" + x + "' y2='" + axisYBottom + "' stroke='currentColor' opacity='0.16' stroke-dasharray='2,2'/>" +
        "<text x='" + x + "' y='" + (axisYBottom + 14) + "' text-anchor='middle' fill='currentColor' opacity='0.55' font-size='10' font-family='Consolas, monospace'>" + t + "%</text>";
    }).join("");

    return "<svg class='lieflat-svg' viewBox='0 0 " + W + " " + H + "' width='100%' height='auto' role='img' aria-label='" + String(title || "QA Chart").replace(/["<>]/g, "") + "'>" +
      "<text x='8' y='19' fill='currentColor' opacity='0.68' font-size='11.5' font-weight='600' font-family='Segoe UI, sans-serif'>" + String(title || "").replace(/[<>&"]/g, "") + "</text>" +
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
    return "<svg class='lieflat-svg' viewBox='0 0 " + W + " " + H + "' width='100%' height='auto'>" +
      "<line x1='" + padL + "' y1='" + padT + "' x2='" + padL + "' y2='" + (padT + plotH) + "' stroke='currentColor' opacity='0.25'/>" +
      "<line x1='" + padL + "' y1='" + (padT + plotH) + "' x2='" + (W - padR) + "' y2='" + (padT + plotH) + "' stroke='currentColor' opacity='0.25'/>" +
      "<text x='" + (padL - 4) + "' y='" + (padT + 8) + "' text-anchor='end' fill='currentColor' opacity='0.55' font-size='9.5' font-family='Consolas, monospace'>" + (maxMs / 1000).toFixed(1) + "s</text>" +
      "<text x='" + (padL - 4) + "' y='" + (padT + plotH) + "' text-anchor='end' fill='currentColor' opacity='0.55' font-size='9.5' font-family='Consolas, monospace'>0s</text>" +
      bars +
      "<text x='" + padL + "' y='" + (H - 4) + "' fill='currentColor' opacity='0.65' font-size='10' font-family='Segoe UI, sans-serif'>Độ trễ " + arr.length + " lô gần nhất</text>" +
      "</svg>";
  }

  return {
    mapPrepareSummary: mapPrepareSummary,
    directionLabel: directionLabel,
    medicalPresetFor: medicalPresetFor,
    mergeGlossary: mergeGlossary,
    extractJsonText: extractJsonText,
    redactSecrets: redactSecrets,
    buildGlossaryPromptBlock: buildGlossaryPromptBlock,
    glossaryTermsInText: glossaryTermsInText,
    pickFailoverEngine: pickFailoverEngine,
    parseGlossaryImport: parseGlossaryImport,
    exportSegmentsToCsv: exportSegmentsToCsv,
    exportSegmentsToMarkdown: exportSegmentsToMarkdown,
    exportSegmentsToTmx: exportSegmentsToTmx,
    buildLieFlatMetricsSvg: buildLieFlatMetricsSvg,
    buildBatchLatencySvg: buildBatchLatencySvg,
  };
});
