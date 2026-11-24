// server/config-store.mjs — Persistent Desktop App settings, Glossary/Termbase, Failover & API key vault
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Bộ thuật ngữ Y Dược theo cách gọi của Dược thư Quốc gia Việt Nam; bản Y Dược tự bật bộ hợp với chiều dịch.
export const GLOSSARY_PRESETS = {
  academic: {
    id: "academic",
    name: "Học thuật & Nghiên cứu",
    terms: [
      { src: "qualitative content analysis", dst: "phân tích nội dung định tính" },
      { src: "empirical evidence", dst: "bằng chứng thực nghiệm" },
      { src: "theoretical framework", dst: "khung lý thuyết" },
      { src: "peer-reviewed", dst: "phản biện độc lập" },
      { src: "methodology", dst: "phương pháp luận" },
      { src: "literature review", dst: "tổng quan tài liệu" },
    ],
  },
  finance: {
    id: "finance",
    name: "Tài chính & Kế toán",
    terms: [
      { src: "balance sheet", dst: "bảng cân đối kế toán" },
      { src: "cash flow statement", dst: "báo cáo lưu chuyển tiền tệ" },
      { src: "EBITDA", dst: "EBITDA" },
      { src: "working capital", dst: "vốn lưu động" },
      { src: "accounts receivable", dst: "phải thu khách hàng" },
      { src: "fiscal year", dst: "năm tài chính" },
    ],
  },
  tech: {
    id: "tech",
    name: "Kỹ thuật & Phần mềm",
    terms: [
      { src: "latency", dst: "độ trễ" },
      { src: "throughput", dst: "thông lượng" },
      { src: "concurrency", dst: "xử lý đồng thời" },
      { src: "deployment pipeline", dst: "quy trình triển khai" },
      { src: "idempotent", dst: "bất biến (idempotent)" },
      { src: "sandbox", dst: "môi trường cách ly (sandbox)" },
    ],
  },
  legal: {
    id: "legal",
    name: "Pháp lý & Hợp đồng",
    terms: [
      { src: "force majeure", dst: "bất khả kháng" },
      { src: "indemnification", dst: "bồi hoàn thiệt hại" },
      { src: "governing law", dst: "luật điều chỉnh" },
      { src: "intellectual property", dst: "sở hữu trí tuệ" },
      { src: "confidentiality", dst: "bảo mật thông tin" },
      { src: "termination clause", dst: "điều khoản chấm dứt" },
    ],
  },
  medical: {
    id: "medical",
    name: "Y sinh & Y khoa",
    terms: [
      { src: "clinical trial", dst: "thử nghiệm lâm sàng" },
      { src: "diagnostic imaging", dst: "chẩn đoán hình ảnh" },
      { src: "biomarker", dst: "dấu ấn sinh học" },
      { src: "adverse event", dst: "biến cố bất lợi" },
      { src: "placebo-controlled", dst: "đối chứng giả dược" },
      { src: "dosage regimen", dst: "phác đồ liều dùng" },
    ],
  },  "y-duoc-en": {
    id: "y-duoc-en",
    name: "Y Dược Anh → Việt",
    huong: "en-vi",
    terms: [
      { src: "contraindication", dst: "chống chỉ định" },
      { src: "indication", dst: "chỉ định" },
      { src: "dosage and administration", dst: "liều dùng và cách dùng" },
      { src: "adverse drug reaction", dst: "phản ứng có hại của thuốc (ADR)" },
      { src: "side effect", dst: "tác dụng phụ" },
      { src: "adverse event", dst: "biến cố bất lợi" },
      { src: "overdose", dst: "quá liều" },
      { src: "drug interaction", dst: "tương tác thuốc" },
      { src: "warnings and precautions", dst: "cảnh báo và thận trọng" },
      { src: "pharmacokinetics", dst: "dược động học" },
      { src: "pharmacodynamics", dst: "dược lực học" },
      { src: "bioavailability", dst: "sinh khả dụng" },
      { src: "half-life", dst: "thời gian bán thải" },
      { src: "active ingredient", dst: "hoạt chất" },
      { src: "excipient", dst: "tá dược" },
      { src: "film-coated tablet", dst: "viên nén bao phim" },
      { src: "hard capsule", dst: "viên nang cứng" },
      { src: "oral suspension", dst: "hỗn dịch uống" },
      { src: "solution for injection", dst: "dung dịch tiêm" },
      { src: "intravenous (IV)", dst: "tiêm tĩnh mạch (IV)" },
      { src: "intramuscular (IM)", dst: "tiêm bắp (IM)" },
      { src: "subcutaneous", dst: "tiêm dưới da" },
      { src: "renal impairment", dst: "suy thận" },
      { src: "hepatic impairment", dst: "suy gan" },
      { src: "creatinine clearance", dst: "độ thanh thải creatinin" },
      { src: "hypersensitivity", dst: "quá mẫn" },
      { src: "anaphylactic shock", dst: "sốc phản vệ" },
      { src: "pregnancy", dst: "thời kỳ mang thai" },
      { src: "breastfeeding", dst: "thời kỳ cho con bú" },
      { src: "shelf life", dst: "hạn dùng" },
      { src: "storage conditions", dst: "điều kiện bảo quản" },
      { src: "very common (≥1/10)", dst: "rất thường gặp (≥1/10)" },
      { src: "uncommon (≥1/1,000 to <1/100)", dst: "ít gặp (≥1/1.000 đến <1/100)" },
      { src: "clinical trial", dst: "thử nghiệm lâm sàng" },
      { src: "randomized controlled trial", dst: "thử nghiệm ngẫu nhiên có đối chứng" },
      { src: "double-blind", dst: "mù đôi" },
      { src: "placebo", dst: "giả dược" },
      { src: "primary endpoint", dst: "tiêu chí đánh giá chính" },
      { src: "marketing authorization", dst: "giấy phép lưu hành" },
      { src: "prescription-only medicine", dst: "thuốc kê đơn" },
      { src: "over-the-counter (OTC)", dst: "thuốc không kê đơn (OTC)" },
      { src: "hypertension", dst: "tăng huyết áp" },
      { src: "diabetes mellitus", dst: "đái tháo đường" },
      { src: "myocardial infarction", dst: "nhồi máu cơ tim" },
      { src: "QT prolongation", dst: "kéo dài khoảng QT" },
      { src: "Good Manufacturing Practice (GMP)", dst: "Thực hành tốt sản xuất thuốc (GMP)" },
    ],
  },
  "y-duoc-fr": {
    id: "y-duoc-fr",
    name: "Y Dược Pháp → Việt",
    huong: "fr-vi",
    terms: [
      { src: "contre-indication", dst: "chống chỉ định" },
      { src: "indications thérapeutiques", dst: "chỉ định" },
      { src: "posologie", dst: "liều dùng" },
      { src: "mode d'administration", dst: "cách dùng" },
      { src: "effets indésirables", dst: "tác dụng không mong muốn" },
      { src: "mises en garde", dst: "cảnh báo" },
      { src: "précautions d'emploi", dst: "thận trọng khi dùng" },
      { src: "interactions médicamenteuses", dst: "tương tác thuốc" },
      { src: "surdosage", dst: "quá liều" },
      { src: "grossesse", dst: "thời kỳ mang thai" },
      { src: "allaitement", dst: "thời kỳ cho con bú" },
      { src: "propriétés pharmacodynamiques", dst: "đặc tính dược lực học" },
      { src: "propriétés pharmacocinétiques", dst: "đặc tính dược động học" },
      { src: "substance active", dst: "hoạt chất" },
      { src: "excipient", dst: "tá dược" },
      { src: "excipient à effet notoire", dst: "tá dược có tác dụng đã biết" },
      { src: "comprimé pelliculé", dst: "viên nén bao phim" },
      { src: "gélule", dst: "viên nang cứng" },
      { src: "comprimé effervescent", dst: "viên sủi" },
      { src: "solution injectable", dst: "dung dịch tiêm" },
      { src: "voie orale", dst: "đường uống" },
      { src: "voie intraveineuse", dst: "đường tĩnh mạch" },
      { src: "insuffisance rénale", dst: "suy thận" },
      { src: "insuffisance hépatique", dst: "suy gan" },
      { src: "clairance de la créatinine", dst: "độ thanh thải creatinin" },
      { src: "hypersensibilité", dst: "quá mẫn" },
      { src: "choc anaphylactique", dst: "sốc phản vệ" },
      { src: "durée de conservation", dst: "hạn dùng" },
      { src: "précautions particulières de conservation", dst: "lưu ý đặc biệt khi bảo quản" },
      { src: "notice", dst: "tờ hướng dẫn sử dụng" },
      { src: "résumé des caractéristiques du produit (RCP)", dst: "tóm tắt đặc tính sản phẩm (RCP)" },
      { src: "autorisation de mise sur le marché (AMM)", dst: "giấy phép lưu hành (AMM)" },
      { src: "médicament soumis à prescription médicale", dst: "thuốc kê đơn" },
      { src: "essai clinique", dst: "thử nghiệm lâm sàng" },
      { src: "essai randomisé en double aveugle", dst: "thử nghiệm ngẫu nhiên mù đôi" },
      { src: "antalgique", dst: "thuốc giảm đau" },
      { src: "antipyrétique", dst: "thuốc hạ sốt" },
      { src: "anti-inflammatoire non stéroïdien (AINS)", dst: "thuốc chống viêm không steroid (AINS)" },
      { src: "hypertension artérielle", dst: "tăng huyết áp" },
      { src: "diabète", dst: "đái tháo đường" },
      { src: "infarctus du myocarde", dst: "nhồi máu cơ tim" },
      { src: "accident vasculaire cérébral (AVC)", dst: "đột quỵ (AVC)" },
      { src: "très fréquent", dst: "rất thường gặp" },
      { src: "peu fréquent", dst: "ít gặp" },
      { src: "très rare", dst: "rất hiếm gặp" },
      { src: "fréquence indéterminée", dst: "chưa rõ tần suất" },
    ],
  },
};

function configDir() {
  if (process.env.PDF_LAYOUT_DATA_DIR) return path.resolve(process.env.PDF_LAYOUT_DATA_DIR);
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "pdf-layout-vi");
}

function configPath() {
  return path.join(configDir(), "desktop-config.json");
}

export function defaultOutputDir() {
  const dir = path.join(os.homedir(), "Documents", "PDF-Layout-VI");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function sanitizeGlossary(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const src = String(item.src || "").trim();
    const dst = String(item.dst || "").trim();
    if (!src || !dst) continue;
    const key = src.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ src: src.slice(0, 160), dst: dst.slice(0, 200), note: String(item.note || "").trim().slice(0, 160) });
    if (out.length >= 500) break;
  }
  return out;
}

function readRaw() {
  const defaults = {
    activeEngine: "codex",
    failoverEngines: ["gemini-api", "gemini", "claude", "openrouter", "ollama"],
    chunkChars: 7000,
    outputDir: defaultOutputDir(),
    theme: "dark",
    tmEnabled: true,
    glossaryPreset: "none",
    glossary: [],
    models: {},
    apiKeys: {},
  };
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      ...defaults,
      ...parsed,
      failoverEngines: Array.isArray(parsed.failoverEngines) ? parsed.failoverEngines : defaults.failoverEngines,
      glossary: sanitizeGlossary(parsed.glossary),
      models: { ...defaults.models, ...(parsed.models || {}) },
      apiKeys: { ...defaults.apiKeys, ...(parsed.apiKeys || {}) },
    };
  } catch {
    return defaults;
  }
}

function writeRaw(cfg) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = configPath();
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, target);
  return cfg;
}

export function getConfig() {
  return readRaw();
}

export function getPublicConfig() {
  const cfg = readRaw();
  const maskedKeys = {};
  for (const [k, v] of Object.entries(cfg.apiKeys || {})) {
    const s = String(v || "").trim();
    if (!s) continue;
    maskedKeys[k] = {
      configured: true,
      preview: s.length > 10 ? `${s.slice(0, 5)}…${s.slice(-4)}` : "••••••",
    };
  }
  return {
    activeEngine: cfg.activeEngine || "codex",
    failoverEngines: Array.isArray(cfg.failoverEngines) ? cfg.failoverEngines : ["gemini-api", "gemini", "claude", "openrouter", "ollama"],
    chunkChars: Number(cfg.chunkChars) || 7000,
    outputDir: cfg.outputDir || defaultOutputDir(),
    theme: cfg.theme === "light" ? "light" : "dark",
    tmEnabled: cfg.tmEnabled !== false,
    glossaryPreset: typeof cfg.glossaryPreset === "string" ? cfg.glossaryPreset : "none",
    glossary: sanitizeGlossary(cfg.glossary),
    models: cfg.models || {},
    apiKeys: maskedKeys,
    configFile: configPath(),
  };
}

export function updateConfig(patch = {}) {
  const cur = readRaw();
  if (typeof patch.activeEngine === "string" && patch.activeEngine.trim()) {
    cur.activeEngine = patch.activeEngine.trim();
  }
  if (Array.isArray(patch.failoverEngines)) {
    cur.failoverEngines = patch.failoverEngines
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  if (patch.chunkChars !== undefined) {
    const n = Number(patch.chunkChars);
    if (Number.isFinite(n) && n >= 1500 && n <= 20000) cur.chunkChars = Math.round(n);
  }
  if (typeof patch.outputDir === "string" && patch.outputDir.trim()) {
    cur.outputDir = patch.outputDir.trim();
  }
  if (patch.theme === "dark" || patch.theme === "light") {
    cur.theme = patch.theme;
  }
  if (typeof patch.tmEnabled === "boolean") {
    cur.tmEnabled = patch.tmEnabled;
  }
  if (typeof patch.glossaryPreset === "string") {
    cur.glossaryPreset = patch.glossaryPreset.trim() || "none";
  }
  if (Array.isArray(patch.glossary)) {
    cur.glossary = sanitizeGlossary(patch.glossary);
  }
  if (patch.models && typeof patch.models === "object") {
    for (const [k, v] of Object.entries(patch.models)) {
      if (v === null || v === "") delete cur.models[k];
      else cur.models[k] = String(v).trim();
    }
  }
  if (patch.apiKeys && typeof patch.apiKeys === "object") {
    for (const [k, v] of Object.entries(patch.apiKeys)) {
      if (v === null || v === "") delete cur.apiKeys[k];
      else cur.apiKeys[k] = String(v).trim();
    }
  }
  writeRaw(cur);
  return getPublicConfig();
}
