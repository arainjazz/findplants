// HTML template for AI-generated plant draft pages.
// Mirrors the visual style of the user-provided reference (paper background,
// Cormorant Garamond + Noto Serif SC, vermillion rules, sectioned layout).
// Placeholders use {{key}} so we can safely string-replace.

export type PlantDraftFields = {
  title: string;
  scientific_name: string;
  common_name_en: string;
  family: string;
  genus: string;
  summary_zh: string;
  summary_en: string;
  morphology_zh: string;
  morphology_en: string;
  habitat_zh: string;
  habitat_en: string;
  name_origin_zh: string;
  name_origin_en: string;
  culture_zh: string;
  culture_en: string;
  tags: string[];
  iucn_status: string;
  photo_url: string;
  capture_place: string;
  capture_lat: string;
  capture_lng: string;
  capture_date: string;
  ai_model: string;
};

const TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>{{title}} {{scientific_name}} — Plantspedia</title>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=EB+Garamond:ital,wght@0,400;1,400&family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<style>
:root{--paper:#f5ede4;--paper-deep:#ecddd0;--ink:#1e1008;--ink-soft:#3a2010;--ink-faint:#6e4c28;--rule:#a06030;--rule-soft:#c89060;--accent:#4080b0;--gold:#7a5010;--chip-bg:rgba(64,128,176,0.07);--chip-border:rgba(64,128,176,0.24);}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Serif SC',serif;color:var(--ink-soft);background-color:var(--paper);background-image:radial-gradient(ellipse 68% 50% at 10% 8%,rgba(64,128,176,0.14) 0%,transparent 66%),radial-gradient(ellipse 54% 42% at 90% 85%,rgba(48,104,128,0.11) 0%,transparent 60%);line-height:1.72;min-height:100vh;}
.page-wrap{max-width:1180px;margin:0 auto;padding:54px 56px 80px;}
.draft-banner{background:#fff5e0;border:1px dashed var(--rule);padding:14px 18px;margin-bottom:32px;font-size:13px;color:var(--ink-faint);letter-spacing:.04em;}
.draft-banner strong{color:var(--rule);}
.img-slot{display:block;overflow:visible;background:var(--paper-deep);border:1px solid var(--rule);box-shadow:0 0 0 5px var(--paper),0 0 0 6px var(--rule-soft),0 14px 30px -12px rgba(30,16,8,.26);}
.img-slot img{display:block;width:100%;height:auto;}
.masthead{border-top:3px double var(--rule);border-bottom:3px double var(--rule);padding:28px 0;margin-bottom:36px;text-align:center;}
.masthead .meta{font-family:'Cormorant Garamond',serif;font-size:14px;letter-spacing:.32em;text-transform:uppercase;color:var(--ink-faint);}
.masthead h1{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:64px;line-height:1.05;color:var(--ink);margin:14px 0 6px;}
.masthead .zh-title{font-family:'Noto Serif SC',serif;font-weight:500;font-size:36px;color:var(--ink);}
.masthead .latin{font-family:'EB Garamond',serif;font-style:italic;font-size:22px;color:var(--gold);margin-top:10px;}
.masthead .commons{margin-top:8px;font-size:14px;color:var(--ink-faint);letter-spacing:.06em;}
.tax-row{display:flex;flex-wrap:wrap;gap:18px;justify-content:center;margin-top:18px;font-family:'Cormorant Garamond',serif;font-size:15px;letter-spacing:.1em;color:var(--ink-faint);text-transform:uppercase;}
.tax-row span strong{color:var(--ink-soft);}
.hero{display:grid;grid-template-columns:1.4fr 1fr;gap:36px;margin:46px 0 56px;align-items:start;}
@media (max-width:820px){.hero{grid-template-columns:1fr;} .masthead h1{font-size:44px;}}
.hero .capture-meta{font-family:'Cormorant Garamond',serif;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:14px;}
.hero .place{font-family:'Noto Serif SC',serif;font-size:22px;color:var(--ink);font-weight:500;margin-bottom:6px;}
.hero .coords{font-family:'EB Garamond',serif;font-size:14px;color:var(--ink-faint);margin-bottom:18px;}
.hero p{font-size:16px;color:var(--ink-soft);}
.hero p+p{margin-top:14px;}
.sec-rule{display:flex;align-items:center;gap:16px;margin:46px 0 22px;}
.sec-rule .sec-num{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:38px;color:var(--rule);width:50px;text-align:center;}
.sec-rule h2{font-family:'Noto Serif SC',serif;font-size:26px;font-weight:600;color:var(--ink);}
.sec-rule .en{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:18px;color:var(--ink-faint);margin-left:auto;}
.sec-rule .sec-line{flex:1;height:1px;background:linear-gradient(to right,var(--rule),transparent);min-width:40px;}
.section-body p{font-size:16px;margin-bottom:14px;}
.section-body p.en-p{font-family:'EB Garamond',serif;font-style:italic;color:var(--ink-faint);font-size:15px;line-height:1.7;border-left:2px solid var(--rule-soft);padding-left:14px;}
.name-origin{background:var(--chip-bg);border:1px solid var(--chip-border);padding:20px 22px;margin-top:18px;}
.name-origin .no-title{display:block;font-family:'Cormorant Garamond',serif;letter-spacing:.32em;font-size:12px;color:var(--accent);text-transform:uppercase;margin-bottom:10px;}
.tag-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px;}
.tag-chip{display:inline-block;font-family:'Cormorant Garamond',serif;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:var(--chip-bg);border:1px solid var(--chip-border);padding:5px 12px;border-radius:2px;}
.footer-rule{margin-top:60px;padding-top:22px;border-top:3px double var(--rule);text-align:center;font-family:'Cormorant Garamond',serif;font-size:13px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-faint);}
.footer-rule .ai-stamp{display:block;margin-top:6px;font-style:italic;letter-spacing:.1em;text-transform:none;font-size:12px;}
strong{color:var(--ink);}
i,em{color:var(--gold);}
</style>
</head>
<body>
<div class="page-wrap">
  <div class="draft-banner">
    <strong>AI 草稿</strong> · 此页由访客上传的照片自动识别并按模板生成，等待编辑审核后正式收录。所有内容仅供参考，详细信息以收录后版本为准。
  </div>

  <section class="masthead">
    <p class="meta">PLANTSPEDIA · ENTRY DRAFT</p>
    <h1>{{title_display}}</h1>
    <p class="zh-title">{{title}}</p>
    <p class="latin"><i>{{scientific_name}}</i></p>
    <p class="commons">{{common_name_en}}</p>
    <div class="tax-row">
      <span>Family · <strong>{{family}}</strong></span>
      <span>Genus · <strong>{{genus}}</strong></span>
      <span>IUCN · <strong>{{iucn_status}}</strong></span>
    </div>
  </section>

  <section class="hero">
    <div class="img-slot"><img src="{{photo_url}}" alt="{{title}} 拍摄照片"/></div>
    <div>
      <p class="capture-meta">FIELD CAPTURE · 拍 摄 记 录</p>
      <p class="place">{{capture_place}}</p>
      <p class="coords">{{capture_lat}}, {{capture_lng}} · {{capture_date}}</p>
      <p>{{summary_zh}}</p>
      <p class="en-p">{{summary_en}}</p>
    </div>
  </section>

  <div class="sec-rule">
    <span class="sec-num"><i>I</i></span>
    <h2>名称溯源</h2>
    <span class="en">Name Origin</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body">
    <div class="name-origin">
      <span class="no-title">NAME ORIGIN · 名 称 溯 源</span>
      <p>{{name_origin_zh}}</p>
      <p class="en-p">{{name_origin_en}}</p>
    </div>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>II</i></span>
    <h2>形态特征</h2>
    <span class="en">Morphological Characters</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body">
    <p>{{morphology_zh}}</p>
    <p class="en-p">{{morphology_en}}</p>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>III</i></span>
    <h2>生境与分布</h2>
    <span class="en">Habitat &amp; Distribution</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body">
    <p>{{habitat_zh}}</p>
    <p class="en-p">{{habitat_en}}</p>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>IV</i></span>
    <h2>文化与利用</h2>
    <span class="en">Culture &amp; Uses</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body">
    <p>{{culture_zh}}</p>
    <p class="en-p">{{culture_en}}</p>
    <div class="tag-row">{{tag_chips}}</div>
  </div>

  <div class="footer-rule">
    Plantspedia · AI-assisted draft entry
    <span class="ai-stamp">Generated by {{ai_model}} · awaiting editorial review</span>
  </div>
</div>
</body>
</html>`;

function esc(s: string) {
  return (s ?? "").replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
}

export function renderDraftHtml(fields: PlantDraftFields): string {
  const tagChips = (fields.tags ?? [])
    .map((t) => `<span class="tag-chip">${esc(t)}</span>`)
    .join("");
  const titleDisplay = fields.common_name_en || fields.title;
  const dict: Record<string, string> = {
    title: esc(fields.title),
    title_display: esc(titleDisplay),
    scientific_name: esc(fields.scientific_name || "—"),
    common_name_en: esc(fields.common_name_en || ""),
    family: esc(fields.family || "—"),
    genus: esc(fields.genus || "—"),
    iucn_status: esc(fields.iucn_status || "—"),
    photo_url: fields.photo_url,
    capture_place: esc(fields.capture_place || "未知地点"),
    capture_lat: esc(fields.capture_lat || ""),
    capture_lng: esc(fields.capture_lng || ""),
    capture_date: esc(fields.capture_date || ""),
    summary_zh: esc(fields.summary_zh || ""),
    summary_en: esc(fields.summary_en || ""),
    name_origin_zh: esc(fields.name_origin_zh || ""),
    name_origin_en: esc(fields.name_origin_en || ""),
    morphology_zh: esc(fields.morphology_zh || ""),
    morphology_en: esc(fields.morphology_en || ""),
    habitat_zh: esc(fields.habitat_zh || ""),
    habitat_en: esc(fields.habitat_en || ""),
    culture_zh: esc(fields.culture_zh || ""),
    culture_en: esc(fields.culture_en || ""),
    tag_chips: tagChips,
    ai_model: esc(fields.ai_model || ""),
  };
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k) => dict[k] ?? "");
}
