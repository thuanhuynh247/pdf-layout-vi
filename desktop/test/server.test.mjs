// desktop/test/server.test.mjs — Seams-based TDD suite for PDF Layout VI Studio v4.0.0 (node:test, zero external deps)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Isolate AppData persistence for every test run
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ptl-v4-data-"));
process.env.PDF_LAYOUT_DATA_DIR = TEST_DATA_DIR;

const { cleanChildEnv, augmentedPath } = await import("../server/env-path.mjs");
const { listEngines } = await import("../server/drivers.mjs");
const { createAppServer } = await import("../server/index.mjs");

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("env-path: strips nested Claude env vars and deduplicates PATH", () => {
  process.env.CLAUDECODE = "1";
  process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
  const env = cleanChildEnv({ CUSTOM_VAR: "ok" });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(env.CUSTOM_VAR, "ok");
  assert.ok(env.PATH && env.PATH.length > 0);
  const parts = augmentedPath("C:\\TestA;C:\\TestA").split(process.platform === "win32" ? ";" : ":");
  assert.equal(parts.filter((x) => x.toLowerCase() === "c:\\testa").length, 1);
});

test("drivers: listEngines returns 11 normalized platform connectors including Google Gemini API & CLI", async () => {
  const engines = await listEngines();
  assert.ok(engines.length >= 11);
  for (const id of ["codex", "claude", "gemini", "gemini-api", "antigravity", "muse", "ollama", "openrouter"]) {
    const found = engines.find((e) => e.id === id);
    assert.ok(found, `Missing connector: ${id}`);
    assert.equal(typeof found.installed, "boolean");
    assert.equal(typeof found.loggedIn, "boolean");
    assert.ok(Array.isArray(found.models));
  }
  const gemCli = engines.find((e) => e.id === "gemini");
  const gemApi = engines.find((e) => e.id === "gemini-api");
  assert.ok(!gemCli.models.includes("gemini-2.5-pro"), "Deprecated gemini-2.5-pro must not be listed");
  assert.ok(gemApi.models.includes("gemini-2.5-flash") && gemApi.models.includes("gemini-3-flash-preview"));
});

test("server HTTP seams: health v4.0.0, loopback CORS security, static isolation & path traversal defense", async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const h = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    assert.equal(h.ok, true);
    assert.equal(h.version, "4.0.0");
    assert.ok(Array.isArray(h.features) && h.features.includes("visual-preview") && h.features.includes("tm-cache"));

    // Cross-origin request from untrusted external site MUST be rejected (403)
    const crossRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(crossRes.status, 403);

    // Trusted official website origin allowed ONLY on CLI bridge routes (/api/health, /api/cli/*)
    const webHealth = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://pdf.huynhanhthuan.com" },
    });
    assert.equal(webHealth.status, 200);
    assert.equal(webHealth.headers.get("access-control-allow-origin"), "https://pdf.huynhanhthuan.com");

    const webPna = await fetch(`${baseUrl}/api/cli/engines`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://pdf.huynhanhthuan.com",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(webPna.status, 204);
    assert.equal(webPna.headers.get("access-control-allow-origin"), "https://pdf.huynhanhthuan.com");
    assert.equal(webPna.headers.get("access-control-allow-private-network"), "true");

    // Trusted web origin MUST still be rejected on local file/config endpoints (least privilege)
    const webConfigBlocked = await fetch(`${baseUrl}/api/config`, {
      headers: { Origin: "https://pdf.huynhanhthuan.com" },
    });
    assert.equal(webConfigBlocked.status, 403);

    // Loopback origin MUST be echoed safely
    const localRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: `http://127.0.0.1:${addr.port}` },
    });
    assert.equal(localRes.status, 200);
    assert.equal(localRes.headers.get("access-control-allow-origin"), `http://127.0.0.1:${addr.port}`);

    // Static traversal outside desktop/app cannot leak package.json
    const leakRes = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.ok(leakRes.status === 403 || leakRes.status === 404);

    // Path traversal tests on /api/output/save
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ptl-out-test-"));
    try {
      const travFolder = await fetch(`${baseUrl}/api/output/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputDir: tmpRoot, folderName: "..", files: [] }),
      });
      assert.equal(travFolder.status, 400);

      const travFile = await fetch(`${baseUrl}/api/output/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputDir: tmpRoot,
          folderName: "Valid-2026",
          files: [{ name: "../../evil.txt", base64: Buffer.from("bad").toString("base64") }],
        }),
      });
      assert.equal(travFile.status, 400);

      const okSave = await fetch(`${baseUrl}/api/output/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputDir: tmpRoot,
          folderName: "Valid-2026",
          files: [
            { name: "Sample_VI.pdf", base64: Buffer.from("%PDF-1.4\n%ok\n").toString("base64") },
            { name: "Sample_QA.md", base64: Buffer.from("# QA Pass").toString("base64") },
          ],
        }),
      });
      const saved = await okSave.json();
      assert.equal(okSave.status, 200);
      assert.equal(saved.ok, true);
      assert.equal(saved.files.length, 2);
      assert.ok(fs.existsSync(path.join(tmpRoot, "Valid-2026", "Sample_VI.pdf")));
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server HTTP seams: Translation Memory (TM) cache, Glossary presets, Config & History persistence", async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Glossary presets
    const presetsRes = await fetch(`${baseUrl}/api/glossary/presets`).then((r) => r.json());
    assert.equal(presetsRes.ok, true);
    assert.ok(presetsRes.presets.academic && presetsRes.presets.finance && presetsRes.presets.tech);

    // 2. Config persistence (theme, failover, glossary)
    const cfgRes = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: "light",
        tmEnabled: true,
        glossaryPreset: "academic",
        failoverEngines: ["gemini", "ollama"],
        glossary: [{ src: "Vector PDF", dst: "PDF dạng vector" }],
      }),
    }).then((r) => r.json());
    assert.equal(cfgRes.ok, true);
    assert.equal(cfgRes.config.theme, "light");
    assert.equal(cfgRes.config.glossaryPreset, "academic");
    assert.deepEqual(cfgRes.config.failoverEngines, ["gemini", "ollama"]);
    assert.equal(cfgRes.config.glossary.length, 1);

    // 3. Translation Memory save -> lookup -> stats -> clear
    const saveTm = await fetch(`${baseUrl}/api/tm/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dir: "en-vi",
        engine: "codex",
        pairs: [{ src: "Introduction to Swiss Schools", dst: "Giới thiệu về các trường Thụy Sĩ" }],
      }),
    }).then((r) => r.json());
    assert.equal(saveTm.ok, true);
    assert.equal(saveTm.count, 1);

    const lookup = await fetch(`${baseUrl}/api/tm/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dir: "en-vi",
        items: [
          { id: "p1-1", text: "  introduction   to swiss schools  " },
          { id: "p1-2", text: "Brand new sentence" },
        ],
      }),
    }).then((r) => r.json());
    assert.equal(lookup.ok, true);
    assert.equal(lookup.hitCount, 1);
    assert.equal(lookup.hits["p1-1"], "Giới thiệu về các trường Thụy Sĩ");
    assert.equal(lookup.misses.length, 1);
    assert.equal(lookup.misses[0].id, "p1-2");

    const clrTm = await fetch(`${baseUrl}/api/tm/clear`, { method: "POST" }).then((r) => r.json());
    assert.equal(clrTm.count, 0);

    // 4. Project History add -> list -> delete
    const added = await fetch(`${baseUrl}/api/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfName: "thesis.pdf",
        pages: 24,
        segments: 190,
        engine: "codex",
        tmHitPct: 22,
        qaPass: true,
        outputDir: "C:\\Docs\\thesis",
      }),
    }).then((r) => r.json());
    assert.equal(added.ok, true);
    assert.ok(added.item.id);

    const hist = await fetch(`${baseUrl}/api/history`).then((r) => r.json());
    assert.equal(hist.items.length, 1);
    assert.equal(hist.items[0].pdfName, "thesis.pdf");

    const del = await fetch(`${baseUrl}/api/history/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: added.item.id }),
    }).then((r) => r.json());
    assert.equal(del.remaining, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app helpers v4.0.0: schema, secrets, glossary, failover, CSV/MD/TMX export & LieFlat SVG", () => {
  const helpers = require("../app/helpers.js");

  const summary = helpers.mapPrepareSummary(
    { ok: true, name: "paper.pdf", pages: 17, scanned: [4], words: 5120, chars: 32000, huong: "en-vi", done: 0, total: 142, batches_done: 0, batches_total: 6 },
    2400000
  );
  assert.equal(summary.totalSegments, 142);
  assert.equal(summary.batchesTotal, 6);

  const redacted = helpers.redactSecrets("Using key sk-or-v1-1234567890abcdef1234567890abcdef and AIzaSyD1234567890abcdefghijklmnop");
  assert.ok(!redacted.includes("1234567890abcdef") && redacted.includes("<REDACTED>"));

  const parsedJson = helpers.extractJsonText("Here:\n```json\n{\"p1-1\": \"Xin chào\"}\n```");
  assert.equal(JSON.parse(parsedJson)["p1-1"], "Xin chào");

  // Glossary prompt injection & import parser
  const gBlock = helpers.buildGlossaryPromptBlock([{ src: "latency", dst: "độ trễ" }], "en-vi");
  assert.ok(gBlock.includes("BẢNG THUẬT NGỮ BẮT BUỘC") && gBlock.includes("latency => độ trễ"));
  const imported = helpers.parseGlossaryImport("alpha => an-pha\nbeta,bê-ta\n");
  assert.equal(imported.length, 2);
  assert.equal(imported[1].dst, "bê-ta");

  // Auto-failover engine selector
  const engines = [
    { id: "codex", installed: true, loggedIn: true },
    { id: "claude", installed: true, loggedIn: false },
    { id: "gemini", installed: true, loggedIn: true },
  ];
  const next = helpers.pickFailoverEngine("codex", ["claude", "gemini"], engines, ["codex"]);
  assert.equal(next.id, "gemini");

  // Exports: CSV (UTF-8 BOM), Markdown, TMX 1.4
  const segs = [{ id: "p1-1", src: "Hello, \"world\" & <all>", dst: "Xin chào, thế giới", origin: "ai", warn: "" }];
  const csv = helpers.exportSegmentsToCsv(segs);
  assert.ok(csv.startsWith("\uFEFFID,Source,Translation") && csv.includes("\"Hello, \"\"world\"\" & <all>\""));
  const md = helpers.exportSegmentsToMarkdown(segs, "demo.pdf");
  assert.ok(md.includes("| `p1-1` |"));
  const tmx = helpers.exportSegmentsToTmx(segs, "en-vi");
  assert.ok(tmx.includes("<tmx version=\"1.4\">") && tmx.includes("&amp; &lt;all&gt;"));

  // LieFlat SVG invariants
  const svg = helpers.buildLieFlatMetricsSvg("QA", [{ label: "Tiêu chí", pct: 95, valueText: "95%", color: "#22c55e" }]);
  assert.ok(svg.includes("<svg") && svg.includes("100%") && svg.includes("0%"));
  const latSvg = helpers.buildBatchLatencySvg([1200, 2400]);
  assert.ok(latSvg.includes("<svg") && latSvg.includes("<rect"));
});

test("DOM ID parity: every #id referenced in desktop/app/app.js exists in desktop/app/index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../app/index.html"), "utf8");
  const js = fs.readFileSync(path.resolve(__dirname, "../app/app.js"), "utf8");
  const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
  const jsIds = new Set([...js.matchAll(/\$\(["']#([a-zA-Z0-9_-]+)["']\)/g)].map((m) => m[1]));
  assert.ok(jsIds.size >= 80, `Expected >= 80 DOM ID bindings, found ${jsIds.size}`);
  const missing = [...jsIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `Missing DOM IDs in index.html: ${missing.join(", ")}`);
});
