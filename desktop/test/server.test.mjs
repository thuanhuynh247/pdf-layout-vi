// desktop/test/server.test.mjs — Seams-based TDD suite (node:test, zero external deps)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cleanChildEnv, augmentedPath } from "../server/env-path.mjs";
import { listEngines } from "../server/drivers.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

test("drivers: listEngines returns 10 normalized platform connectors", async () => {
  const engines = await listEngines();
  assert.ok(engines.length >= 10);
  for (const id of ["codex", "claude", "gemini", "antigravity", "muse", "ollama", "openrouter"]) {
    const found = engines.find((e) => e.id === id);
    assert.ok(found, `Missing connector: ${id}`);
    assert.equal(typeof found.installed, "boolean");
    assert.equal(typeof found.loggedIn, "boolean");
    assert.ok(Array.isArray(found.models));
  }
});

test("server HTTP seams: health, engines, static isolation, and path traversal defense", async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const h = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    assert.equal(h.ok, true);
    assert.ok(h.version);

    const eng = await fetch(`${baseUrl}/api/cli/engines`).then((r) => r.json());
    assert.equal(eng.ok, true);
    assert.ok(eng.engines.length >= 10);

    // Ensure traversal outside desktop/app cannot leak server/package.json
    const leakRes = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.ok(leakRes.status === 403 || leakRes.status === 404, `Expected 403/404, got ${leakRes.status}`);

    // Path traversal test on POST /api/output/save
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ptl-out-test-"));
    try {
      const travRes = await fetch(`${baseUrl}/api/output/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputDir: tmpRoot,
          folderName: "..",
          files: [{ name: "../../evil.txt", base64: Buffer.from("bad").toString("base64") }],
        }),
      });
      const travBody = await travRes.json();
      assert.equal(travRes.status, 400, `Expected 400 rejecting traversal folderName '..', got ${travRes.status} (${JSON.stringify(travBody)})`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app helpers: mapPrepareSummary handles web_api.py exact schema without undefined fields", () => {
  const helpers = require("../app/helpers.js");
  const samplePrepare = {
    ok: true,
    name: "paper.pdf",
    pages: 17,
    scanned: [4],
    words: 5120,
    chars: 32000,
    huong: "en-vi",
    done: 0,
    total: 142,
    batches_done: 0,
    batches_total: 6,
  };
  const summary = helpers.mapPrepareSummary(samplePrepare, 2400000);
  assert.equal(summary.totalSegments, 142);
  assert.equal(summary.pages, 17);
  assert.equal(summary.words, 5120);
  assert.deepEqual(summary.scannedPages, [4]);
  assert.equal(summary.batchesTotal, 6);
  assert.equal(summary.huong, "en-vi");

  // Secret redaction in logs
  const redacted = helpers.redactSecrets("Using key sk-or-v1-1234567890abcdef1234567890abcdef and AIzaSyD1234567890abcdefghijklmnop");
  assert.ok(!redacted.includes("1234567890abcdef"));
  assert.ok(!redacted.includes("AIzaSyD1234567890"));
  assert.ok(redacted.includes("<REDACTED>"));

  // JSON fence stripping + chatter repair
  const parsed = helpers.extractJsonText("Here is translation:\n```json\n{\"p1-1\": \"Xin chào\"}\n```\nHope it helps!");
  assert.equal(JSON.parse(parsed)["p1-1"], "Xin chào");

  // LieFlat SVG chart rendering invariants (unbroken 0-100% axis)
  const svg = helpers.buildLieFlatMetricsSvg("QA", [{ label: "Tiêu chí", pct: 95, valueText: "95%", color: "#22c55e" }]);
  assert.ok(svg.includes("<svg") && svg.includes("100%") && svg.includes("0%"));
  const latSvg = helpers.buildBatchLatencySvg([1200, 2400]);
  assert.ok(latSvg.includes("<svg") && latSvg.includes("<rect"));
});

test("server HTTP seams: happy-path output save & isolated static asset routing", async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ptl-happy-out-"));

  try {
    const saveRes = await fetch(`${baseUrl}/api/output/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outputDir: tmpRoot,
        folderName: "Sample-2026-01",
        files: [
          { name: "Sample_VI.pdf", base64: Buffer.from("%PDF-1.4\n%test\n").toString("base64") },
          { name: "Sample_QA.md", base64: Buffer.from("# QA Pass").toString("base64") },
        ],
      }),
    });
    const saved = await saveRes.json();
    assert.equal(saveRes.status, 200);
    assert.equal(saved.ok, true);
    assert.equal(saved.files.length, 2);
    assert.ok(fs.existsSync(path.join(tmpRoot, "Sample-2026-01", "Sample_VI.pdf")));
    assert.ok(fs.existsSync(path.join(tmpRoot, "Sample-2026-01", "Sample_QA.md")));

    const badFileRes = await fetch(`${baseUrl}/api/output/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outputDir: tmpRoot,
        folderName: "Sample-2026-01",
        files: [{ name: "../../evil.txt", base64: Buffer.from("bad").toString("base64") }],
      }),
    });
    assert.equal(badFileRes.status, 400);

    const helpersRes = await fetch(`${baseUrl}/helpers.js`);
    assert.equal(helpersRes.status, 200);
    const engineRes = await fetch(`${baseUrl}/engine/web_api.py`);
    assert.equal(engineRes.status, 200);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});
