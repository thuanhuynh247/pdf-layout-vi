"""Dựng bộ thuật ngữ Y Dược (EN→VI, FR→VI) từ phụ lục báo cáo nghiên cứu + bổ sung khóa tra ICD."""
import json, re, sys
from pathlib import Path
rep = Path(sys.argv[1]).read_text(encoding="utf-8")
out = Path(sys.argv[2])
body = rep[rep.index("## Phụ lục"):]
rows = []
for line in body.splitlines():
    if not line.startswith("|") or line.startswith("|---") or "| Nhóm |" in line:
        continue
    c = [x.strip() for x in line.strip().strip("|").split("|")]
    if len(c) < 5: continue
    g, en, fr, vi, src = c[:5]
    if "biến thể" in g or not vi: continue
    rows.append((g, en, fr, vi, src))

def keys(term):
    term = term.strip()
    if not term: return []
    m = re.match(r"^([a-z0-9]{1,6})\s*\((.+)\)$", term)   # viết tắt kê đơn: "qid (four times a day)"
    if m: return [m.group(1)]
    alts = re.findall(r"\(([^)]*[A-Za-z]{4,}[^)]*)\)", term)
    base = re.sub(r"\s*\([^)]*\)", "", term).strip()
    ks = [base] + [a for a in alts if " " in a or "-" in a]
    return [k for k in ks if len(k) >= 2]

# Khóa tiếng Anh/Pháp cho tên bệnh ICD-10 (phụ lục chỉ có tên Việt theo danh mục Bộ Y tế); tên Việt lấy nguyên phụ lục
ICD_KEYS = {
 "I10": (["hypertension", "essential hypertension"], ["hypertension artérielle", "hypertension essentielle"]),
 "I20–I23": (["acute coronary syndrome"], ["syndrome coronarien aigu"]),
 "I25": (["chronic ischaemic heart disease", "chronic ischemic heart disease"], ["cardiopathie ischémique chronique"]),
 "I48": (["atrial fibrillation"], ["fibrillation auriculaire", "fibrillation atriale"]),
 "I50": (["heart failure"], ["insuffisance cardiaque"]),
 "I26": (["pulmonary embolism"], ["embolie pulmonaire"]),
 "I61": (["intracerebral haemorrhage", "intracerebral hemorrhage"], ["hémorragie intracérébrale"]),
 "I63": (["cerebral infarction", "ischaemic stroke", "ischemic stroke"], ["infarctus cérébral"]),
 "E10–E14": (["diabetes mellitus"], ["diabète sucré"]),
 "E05": (["hyperthyroidism", "thyrotoxicosis"], []),
 "J45": (["asthma"], ["asthme"]),
 "J44": (["chronic obstructive pulmonary disease", "COPD"], ["bronchopneumopathie chronique obstructive", "BPCO"]),
 "A15–A19": (["tuberculosis"], ["tuberculose"]),
 "B18.2": (["chronic hepatitis C", "chronic viral hepatitis C"], ["hépatite C chronique"]),
 "K75.4": (["autoimmune hepatitis"], ["hépatite auto-immune"]),
 "N18": (["chronic kidney disease", "chronic renal failure"], ["insuffisance rénale chronique", "maladie rénale chronique"]),
 "G40": (["epilepsy"], []), "G20": (["Parkinson's disease"], []), "G30": (["Alzheimer's disease"], []),
 "F20": (["schizophrenia"], []), "F32": (["depressive episode"], []),
 "M05": (["rheumatoid arthritis"], ["polyarthrite rhumatoïde"]),
 "M17": (["osteoarthritis of the knee", "knee osteoarthritis"], ["gonarthrose"]),
 "M16": (["osteoarthritis of the hip", "hip osteoarthritis"], ["coxarthrose"]),
 "M10": (["gout"], ["goutte"]),
 "M81": (["osteoporosis"], ["ostéoporose"]),
 "D69.3": (["immune thrombocytopenic purpura", "idiopathic thrombocytopenic purpura"], ["purpura thrombopénique idiopathique"]),
 "L40": (["psoriasis"], ["psoriasis"]),
 "L20": (["atopic dermatitis"], ["dermatite atopique"]),
 "L50": (["urticaria"], ["urticaire"]),
}
VI_OVERRIDE = {"M81": "Loãng xương", "E05": "Cường giáp", "M10": "Gút", "M05": "Viêm khớp dạng thấp"}
en_t, fr_t = [], []
def add(lst, src, dst, note):
    lst.append({"src": src, "dst": dst, "note": note[:160]})
for g, en, fr, vi, src in rows:
    m = re.match(r"\(6\) ICD-10 (.+)", g)
    if m:
        code = m.group(1)
        if code not in ICD_KEYS: 
            if fr: add(fr_t, re.sub(r"\s*\[.*?\]", "", fr), vi, f"ICD-10 {code}; {src}")
            continue
        e_k, f_k = ICD_KEYS[code]
        dst = VI_OVERRIDE.get(code, vi)
        for k in e_k: add(en_t, k, dst, f"ICD-10 {code}; VI: {src}")
        for k in f_k or ([re.sub(r"\s*\[.*?\]", "", fr)] if fr else []): add(fr_t, k, dst, f"ICD-10 {code}; VI: {src}")
        continue
    grp = re.sub(r"^\(\d\)\s*", "", g)
    for k in keys(en): add(en_t, k, vi, f"{grp}; {src}")
    for k in keys(fr): add(fr_t, k, vi, f"{grp}; {src}")

def dedupe(lst):
    seen, out_ = set(), []
    for t in lst:
        k = t["src"].lower()
        if k in seen: continue
        seen.add(k); out_.append(t)
    return out_
data = {"nguon": "Báo cáo nghiên cứu 'Thuật ngữ Y Dược Anh Pháp Việt' (11/2026): chỉ gồm thuật ngữ tiếng Việt có nguồn",
        "en": dedupe(en_t), "fr": dedupe(fr_t)}
out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(data["en"]), len(data["fr"]))
