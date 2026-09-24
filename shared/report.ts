import type { PhotoAnnotation } from "./rca";

type ReportEvidence = {
  kind: string;
  name: string;
  note?: string;
  annotations?: PhotoAnnotation[];
  imageData?: string;
};

type ReportCase = {
  title: string;
  equipmentType: string;
  assetTag: string;
  location: string;
  severity: string;
  narrative: string;
  tags?: string[];
  evidence: ReportEvidence[];
  result?: {
    executiveSummary: string;
    eventChain: string[];
    immediateCause: string;
    contributingFactors: string[];
    rootCause: string;
    recommendations: { priority: string; action: string; owner: string; horizon: string }[];
    confidence: number;
    openQuestions: string[];
    methodNotes: string;
  };
};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);

export function buildRcaReportHtml(item: ReportCase, generatedAt: string) {
  const result = item.result;
  if (!result) return "";
  const evidenceHtml = item.evidence.map((entry) => {
    const markers = entry.annotations?.length ? `<div class="markers"><b>Маркеры:</b> ${entry.annotations.map((marker) => escapeHtml(marker.text)).join("; ")}</div>` : "";
    const image = entry.imageData ? `<img src="${entry.imageData}" />` : "";
    return `<div class="evidence"><div><b>${escapeHtml(entry.name)}</b><span>${escapeHtml(entry.kind)}</span></div>${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}${markers}${image}</div>`;
  }).join("");
  const recommendations = result.recommendations.map((item) => `<li><b>${escapeHtml(item.priority)} · ${escapeHtml(item.action)}</b><br/><span>${escapeHtml(item.owner)} · ${escapeHtml(item.horizon)}</span></li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page{size:A4;margin:18mm 16mm}body{font-family:Arial,Helvetica,sans-serif;color:#162631;font-size:11px;line-height:1.45}h1{font-size:25px;margin:0 0 5px;color:#162631}h2{font-size:15px;margin:22px 0 8px;color:#162631;border-bottom:2px solid #f2673a;padding-bottom:5px}h3{font-size:12px;margin:12px 0 4px;color:#f2673a;text-transform:uppercase;letter-spacing:1px}.masthead{display:flex;justify-content:space-between;border-bottom:5px solid #f2673a;padding-bottom:12px}.brand{font-size:10px;letter-spacing:2px;color:#f2673a;font-weight:bold}.meta{color:#6b7b85;text-align:right;font-size:10px}.summary{background:#f2f5f6;border-left:4px solid #f2673a;padding:12px 14px;margin-top:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fact{background:#f7f8fa;padding:9px;border-radius:5px}.fact b{display:block;font-size:9px;color:#6b7b85;text-transform:uppercase;letter-spacing:.7px}.root{background:#162631;color:#fff;padding:14px;border-radius:5px}.root b{color:#f7b08e;font-size:9px;letter-spacing:1px}.root p{font-size:14px;font-weight:bold;margin:5px 0 0}.timeline li{margin:6px 0}.timeline span{display:inline-block;background:#edf2f3;border-radius:10px;padding:3px 7px;font-size:9px;margin-right:6px}.recommendations li{margin:9px 0}.recommendations span{color:#6b7b85}.evidence{border:1px solid #e2e7ea;padding:9px;margin:7px 0;border-radius:5px}.evidence span{float:right;color:#6b7b85;font-size:9px;text-transform:uppercase}.evidence p{margin:5px 0;color:#405361}.markers{color:#a56600;font-size:10px}.evidence img{display:block;max-width:180px;max-height:130px;margin-top:7px}.footer{margin-top:25px;color:#6b7b85;font-size:9px;border-top:1px solid #e2e7ea;padding-top:8px}
  </style></head><body><div class="masthead"><div><div class="brand">PUMPRCA / RCA REPORT</div><h1>${escapeHtml(item.title)}</h1><div>${escapeHtml(item.equipmentType)} · ${escapeHtml(item.assetTag)}</div></div><div class="meta">Сформировано: ${escapeHtml(generatedAt)}<br/>Статус: ${escapeHtml(item.severity)}<br/>Теги: ${escapeHtml((item.tags ?? []).join(", ") || "не указаны")}</div></div>
  <h2>1. Описание события</h2><div class="summary">${escapeHtml(item.narrative)}</div><div class="grid"><div class="fact"><b>Локация</b>${escapeHtml(item.location)}</div><div class="fact"><b>Уверенность AI-гипотезы</b>${result.confidence}%</div></div>
  <h2>2. Краткий вывод</h2><p>${escapeHtml(result.executiveSummary)}</p><div class="root"><b>ROOT CAUSE</b><p>${escapeHtml(result.rootCause)}</p></div>
  <h2>3. Цепочка событий</h2><ol class="timeline">${result.eventChain.map((event) => `<li><span>СОБЫТИЕ</span>${escapeHtml(event)}</li>`).join("")}</ol>
  <h2>4. Причины и факторы</h2><h3>Непосредственная причина</h3><p>${escapeHtml(result.immediateCause)}</p><h3>Способствующие факторы</h3><ul>${result.contributingFactors.map((factor) => `<li>${escapeHtml(factor)}</li>`).join("")}</ul>
  <h2>5. Рекомендованные действия</h2><ul class="recommendations">${recommendations}</ul>
  <h2>6. Свидетельства расследования</h2>${evidenceHtml || "<p>Материалы не приложены.</p>"}
  <h2>7. Открытые вопросы и ограничения</h2><ul>${result.openQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul><p>${escapeHtml(result.methodNotes)}</p>
  <div class="footer">Документ сформирован PumpRCA. AI-вывод является рабочей инженерной гипотезой и требует проверки ответственным специалистом перед принятием эксплуатационных решений.</div></body></html>`;
}
