// HTML template for AI-generated plant draft pages.
// Mirrors the visual style of the user-provided reference (paper background,
// Cormorant Garamond + Noto Serif SC, vermillion rules, sectioned layout).
// Placeholders use {{key}} so we can safely string-replace.

export type PlantDraftFields = {
  title: string;
  scientific_name: string;
  common_name_en: string;
  common_names_zh: string;
  family: string;
  genus: string;
  summary_zh: string;
  summary_en: string;
  /** 拍摄记录：对本张照片的形态分析 + 定种判断依据（与 summary 内容不同）。 */
  field_notes_zh?: string;
  field_notes_en?: string;
  morphology_zh: string;
  morphology_en: string;
  habitat_zh: string;
  habitat_en: string;
  name_origin_zh: string;
  name_origin_en: string;
  culture_zh: string;
  culture_en: string;
  care_tips_zh: string;
  care_tips_en: string;
  care_facts: { category: string; value?: string; tag?: string; detail: string }[];
  tags: string[];
  iucn_status: string;
  photo_url: string;
  /** Real online species photos for the 5 body sections (hero always uses the
   *  user's own photo_url). Any slot left empty falls back to photo_url and is
   *  marked as a replaceable default. */
  section_images?: string[];
  /** Populated only when GBIF/GRIIS confirms the species is an invasive alien
   *  species in China. Renders a red warning card just before Section I. */
  invasive?: {
    status_zh: string;
    harm_zh: string;
    control_zh: string;
    /** GRIIS invasion degree label (四等级之一), e.g. 「入侵物种（Invasive）」. */
    degree?: string | null;
    /** Citation: the specific registry + year, e.g.「GRIIS 全球入侵等级（中国）（2023）」. */
    source?: string;
    source_url?: string | null;
    /** National-list fact when the species is on one of the four official batches
     *  《中国外来入侵物种名单》 — batch + 重点管理名录 status (deterministic, not LLM). */
    china_list?: {
      batch: string;
      date: string;
      publisher: string;
      keyManaged: boolean;
    } | null;
  } | null;
  /** Display badges for conservation / trade / invasion registries the species
   *  matched (国家/省级重点保护, CITES, GTS, GRIIS). Renders a status card after
   *  the invasive card. Empty/absent → no card. See conservationBadges(). */
  conservation?: { kind: string; label: string }[] | null;
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
<title>{{title}} {{scientific_name}}</title>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=EB+Garamond:ital,wght@0,400;1,400&family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<style>
:root{--paper:#f5ede4;--paper-deep:#ecddd0;--ink:#1e1008;--ink-soft:#3a2010;--ink-faint:#6e4c28;--rule:#a06030;--rule-soft:#c89060;--accent:#4080b0;--gold:#7a5010;--chip-bg:rgba(64,128,176,0.07);--chip-border:rgba(64,128,176,0.24);}
@media(prefers-color-scheme:dark){:root{--paper:#1c1917;--paper-deep:#292524;--ink:#f5f5f4;--ink-soft:#e7e5e4;--ink-faint:#a8a29e;--rule:#d97706;--rule-soft:#78350f;--accent:#38bdf8;--gold:#fbbf24;--chip-bg:rgba(56,189,248,0.07);--chip-border:rgba(56,189,248,0.24);}}
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
.masthead .commons-zh{margin-top:4px;font-size:14px;color:var(--ink-soft);letter-spacing:.04em;font-style:italic;}
.tax-row{display:flex;flex-wrap:wrap;gap:18px;justify-content:center;margin-top:18px;font-family:'Cormorant Garamond',serif;font-size:15px;letter-spacing:.1em;color:var(--ink-faint);text-transform:uppercase;}
.tax-row span strong{color:var(--ink-soft);}
.hero{display:grid;grid-template-columns:1.4fr 1fr;gap:36px;margin:46px 0 56px;align-items:start;}
@media (max-width:820px){.hero{grid-template-columns:1fr;} .masthead h1{font-size:44px;}}
.hero .field-capture{margin-top:0;}
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
.name-origin{background:var(--chip-bg);border:1px solid var(--chip-border);padding:20px 22px;flex:1;}
.name-origin .no-title{display:block;font-family:'Cormorant Garamond',serif;letter-spacing:.32em;font-size:12px;color:var(--accent);text-transform:uppercase;margin-bottom:10px;}
.tag-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px;}
.tag-chip{display:inline-block;font-family:'Cormorant Garamond',serif;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:var(--chip-bg);border:1px solid var(--chip-border);padding:5px 12px;border-radius:2px;}
.footer-rule{margin-top:60px;padding-top:22px;border-top:3px double var(--rule);text-align:center;font-family:'Cormorant Garamond',serif;font-size:13px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-faint);}
.footer-rule .ai-stamp{display:block;margin-top:6px;font-style:italic;letter-spacing:.1em;text-transform:none;font-size:12px;}
strong{color:var(--ink);}
i,em{color:var(--gold);}

/* Section Images Layout */
.sec-img{max-width:280px;width:100%;height:auto;border:1px solid var(--rule);box-shadow:0 0 0 3px var(--paper),0 0 0 4px var(--rule-soft);margin:16px auto;display:block;}
@media (min-width:768px){
  .section-with-img{display:grid;grid-template-columns:1fr 280px;gap:32px;align-items:center;}
  .sec-img{margin:0;}
}

/* Section V — care facts: summary CARDS shown ABOVE the rationale text. Each card =
   value/range + (tag) + brief intro, under a category label. */
.care-facts{display:grid;grid-template-columns:1fr;gap:12px;margin:6px 0 30px;}
@media (min-width:620px){.care-facts{grid-template-columns:1fr 1fr;}}
.care-fact{background:var(--chip-bg);border:1px solid var(--chip-border);border-left:3px solid var(--accent);padding:13px 15px;border-radius:3px;}
.care-fact .cf-top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:5px 10px;margin-bottom:5px;}
.care-fact .cf-cat{flex:none;white-space:nowrap;font-family:'Noto Serif SC',serif;font-weight:600;font-size:13.5px;color:var(--accent);letter-spacing:.03em;}
.care-fact .cf-tag{font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.06em;color:var(--gold);border:1px solid var(--rule-soft);border-radius:999px;padding:1px 10px;max-width:100%;}
.care-fact .cf-val{font-family:'Noto Serif SC',serif;font-weight:500;font-size:14.5px;color:var(--ink);line-height:1.45;margin-bottom:5px;}
.care-fact .cf-detail{font-size:12.5px;color:var(--ink-soft);line-height:1.6;}
.care-why{display:block;font-family:'Cormorant Garamond',serif;letter-spacing:.26em;font-size:12px;color:var(--accent);text-transform:uppercase;margin-bottom:10px;}

/* Mobile: shrink generous desktop padding so content fills the phone width */
@media (max-width:640px){
  .page-wrap{padding:24px 16px 56px;}
  .masthead{padding:20px 0;margin-bottom:26px;}
  .masthead h1{font-size:32px;}
  .masthead .zh-title{font-size:24px;}
  .masthead .latin{font-size:18px;}
  .tax-row{gap:10px;font-size:13px;}
  .hero{margin:28px 0 36px;gap:22px;}
  .sec-rule{margin:32px 0 16px;gap:10px;}
  .sec-rule .sec-num{font-size:28px;width:32px;}
  .sec-rule h2{font-size:20px;}
  .sec-rule .en{display:none;}
  .section-body p{font-size:15px;}
  .name-origin{padding:16px 16px;}
  .care-facts{grid-template-columns:1fr;}
}

/* Invasive-species warning card — a deliberately alarming, off-palette danger
   block shown before Section I when GBIF/GRIIS flags a China invasive. */
.invasive-card{margin:8px 0 44px;border:2px solid #c0392b;border-left:8px solid #c0392b;border-radius:6px;background:#fbeae6;background-image:repeating-linear-gradient(135deg,rgba(192,57,43,0.05) 0,rgba(192,57,43,0.05) 12px,transparent 12px,transparent 24px);box-shadow:0 10px 26px -14px rgba(192,57,43,.5);overflow:hidden;}
.invasive-card .ic-head{display:flex;align-items:center;gap:14px;padding:16px 20px;background:#c0392b;color:#fff;}
.invasive-card .ic-icon{font-size:30px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));}
.invasive-card .ic-kicker{display:block;font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.26em;text-transform:uppercase;opacity:.92;}
.invasive-card .ic-head h2{font-family:'Noto Serif SC',serif;font-size:22px;font-weight:700;color:#fff;letter-spacing:.04em;}
.invasive-card .ic-badge{margin-left:auto;font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.08em;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.5);border-radius:999px;padding:3px 12px;white-space:nowrap;}
.invasive-card .ic-body{display:grid;grid-template-columns:1fr;gap:16px;padding:20px 22px;}
@media (min-width:768px){.invasive-card .ic-body{grid-template-columns:1fr 1fr 1fr;}}
.invasive-card .ic-block .ic-label{display:block;font-family:'Noto Serif SC',serif;font-weight:600;font-size:14px;color:#a12a1a;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(192,57,43,.28);}
.invasive-card .ic-block p{font-size:14px;line-height:1.66;color:#4a1c14;margin:0;}
.invasive-card .ic-national{margin:0 22px;padding:11px 14px;border-radius:6px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.24);font-size:13px;line-height:1.6;color:#5a2016;}
.invasive-card .ic-national strong{color:#a12a1a;}
.invasive-card .ic-km{display:inline-block;margin-left:6px;font-weight:600;}
.invasive-card .ic-km.on{color:#a12a1a;}
.invasive-card .ic-km.off{color:#7a5010;}
.invasive-card .ic-cite{margin:16px 22px 20px;padding-top:12px;border-top:1px solid rgba(192,57,43,.22);font-family:'Cormorant Garamond',serif;font-size:12.5px;letter-spacing:.04em;color:#7a2a1c;}
.invasive-card .ic-cite a{color:#7a2a1c;text-decoration:underline;}
@media(prefers-color-scheme:dark){
  .invasive-card{background:#2a1512;border-color:#e05a45;border-left-color:#e05a45;background-image:repeating-linear-gradient(135deg,rgba(224,90,69,0.06) 0,rgba(224,90,69,0.06) 12px,transparent 12px,transparent 24px);}
  .invasive-card .ic-head{background:#8f2a1c;}
  .invasive-card .ic-block .ic-label{color:#f0a595;border-bottom-color:rgba(224,90,69,.35);}
  .invasive-card .ic-block p{color:#e9d9d4;}
  .invasive-card .ic-national{background:rgba(224,90,69,.12);border-color:rgba(224,90,69,.32);color:#e9d9d4;}
  .invasive-card .ic-national strong,.invasive-card .ic-km.on{color:#f0a595;}
  .invasive-card .ic-km.off{color:#d9b57a;}
}

/* Conservation / registry status card — calm green-gold counterpart to the
   invasive card, shown before Section I when the species matches 重点保护/CITES/
   GTS/GRIIS registries. Each match is a coloured chip. */
.conservation-card{margin:8px 0 44px;border:1px solid var(--rule-soft);border-left:6px solid #4c8a3f;border-radius:6px;background:linear-gradient(180deg,rgba(76,138,63,0.06),rgba(122,80,16,0.04));box-shadow:0 10px 26px -18px rgba(76,138,63,.5);overflow:hidden;}
.conservation-card .cc-head{display:flex;align-items:center;gap:13px;padding:14px 20px;border-bottom:1px solid rgba(76,138,63,.24);}
.conservation-card .cc-icon{font-size:26px;line-height:1;}
.conservation-card .cc-kicker{display:block;font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-faint);}
.conservation-card .cc-head h2{font-family:'Noto Serif SC',serif;font-size:20px;font-weight:700;color:#3f6f34;letter-spacing:.04em;}
.conservation-card .cc-body{display:flex;flex-wrap:wrap;gap:10px;padding:16px 20px;}
.conservation-card .cc-chip{display:inline-block;font-family:'Noto Serif SC',serif;font-size:14px;font-weight:600;line-height:1.4;padding:6px 14px;border-radius:999px;border:1px solid;}
.conservation-card .cc-protected{color:#2f5c26;background:rgba(76,138,63,.12);border-color:rgba(76,138,63,.4);}
.conservation-card .cc-cites{color:#215a6b;background:rgba(64,128,176,.12);border-color:rgba(64,128,176,.4);}
.conservation-card .cc-gts{color:#7a5010;background:rgba(122,80,16,.12);border-color:rgba(122,80,16,.4);}
.conservation-card .cc-griis{color:#9a3512;background:rgba(192,57,43,.1);border-color:rgba(192,57,43,.38);}
@media(prefers-color-scheme:dark){
  .conservation-card{background:linear-gradient(180deg,rgba(76,138,63,0.12),rgba(122,80,16,0.06));border-color:var(--rule-soft);border-left-color:#6fae5f;}
  .conservation-card .cc-head h2{color:#8fd07e;}
  .conservation-card .cc-protected{color:#bfe6b2;background:rgba(76,138,63,.2);border-color:rgba(111,174,95,.5);}
  .conservation-card .cc-cites{color:#a8d8ea;background:rgba(56,189,248,.14);border-color:rgba(56,189,248,.45);}
  .conservation-card .cc-gts{color:#f3cf8a;background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.45);}
  .conservation-card .cc-griis{color:#f0a595;background:rgba(224,90,69,.14);border-color:rgba(224,90,69,.45);}
}
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
    <p class="commons-zh">俗名/商品名：{{common_names_zh}}</p>
    <div class="tax-row">
      <span>Family · <strong>{{family}}</strong></span>
      <span>Genus · <strong>{{genus}}</strong></span>
      <span>IUCN · <strong>{{iucn_status}}</strong></span>
    </div>
  </section>

  <section class="hero">
    <div class="img-slot"><img src="{{photo_url}}" alt="{{title}} 拍摄照片"/></div>
    <div>
      <div class="field-capture">
        <p class="capture-meta">FIELD CAPTURE · 拍 摄 记 录</p>
        <p class="place">{{capture_place}}</p>
        <p class="coords">{{capture_lat}}, {{capture_lng}} · {{capture_date}}</p>
        {{field_capture_notes}}
      </div>
    </div>
  </section>

  {{invasive_card}}

  {{conservation_card}}

  <div class="sec-rule">
    <span class="sec-num"><i>I</i></span>
    <h2>名称溯源</h2>
    <span class="en">Name Origin</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body section-with-img">
    <div class="name-origin">
      <span class="no-title">NAME ORIGIN · 名 称 溯 源</span>
      <p>{{name_origin_zh}}</p>
      <p class="en-p">{{name_origin_en}}</p>
    </div>
    <img class="sec-img"{{sec_img_1_mark}} src="{{sec_img_1}}" alt="{{title}} 名称溯源"/>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>II</i></span>
    <h2>形态特征</h2>
    <span class="en">Morphological Characters</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body section-with-img">
    <div>
      <p>{{morphology_zh}}</p>
      <p class="en-p">{{morphology_en}}</p>
    </div>
    <img class="sec-img"{{sec_img_2_mark}} src="{{sec_img_2}}" alt="{{title}} 形态特征"/>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>III</i></span>
    <h2>生境与分布</h2>
    <span class="en">Habitat &amp; Distribution</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body section-with-img">
    <div>
      <p>{{habitat_zh}}</p>
      <p class="en-p">{{habitat_en}}</p>
    </div>
    <img class="sec-img"{{sec_img_3_mark}} src="{{sec_img_3}}" alt="{{title}} 生境与分布"/>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>IV</i></span>
    <h2>植物人文</h2>
    <span class="en">Plants Humanities</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body section-with-img">
    <div>
      <p>{{culture_zh}}</p>
      <p class="en-p">{{culture_en}}</p>
    </div>
    <img class="sec-img"{{sec_img_4_mark}} src="{{sec_img_4}}" alt="{{title}} 植物人文"/>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>V</i></span>
    <h2>养护建议</h2>
    <span class="en">Care Tips</span>
    <div class="sec-line"></div>
  </div>
  <div class="care-facts">{{care_facts_rows}}</div>
  <div class="section-body section-with-img">
    <div>
      <span class="care-why">为什么这样养护 · Rationale</span>
      <p>{{care_tips_zh}}</p>
      <p class="en-p">{{care_tips_en}}</p>
    </div>
    <img class="sec-img"{{sec_img_5_mark}} src="{{sec_img_5}}" alt="{{title}} 养护建议"/>
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
  const careFactsRows = (fields.care_facts ?? [])
    .filter((f) => f && (f.category || f.value || f.detail))
    .map((f) => {
      const cat = esc(f.category || "");
      const val = esc(f.value || "");
      const tag = esc(f.tag || "");
      const detail = esc(f.detail || "");
      // Older drafts only have {category, detail} — degrade gracefully (no value/tag).
      return (
        `<div class="care-fact">` +
        `<div class="cf-top">${cat ? `<span class="cf-cat">${cat}</span>` : ""}${tag ? `<span class="cf-tag">${tag}</span>` : ""}</div>` +
        (val ? `<div class="cf-val">${val}</div>` : "") +
        (detail ? `<p class="cf-detail">${detail}</p>` : "") +
        `</div>`
      );
    })
    .join("");
  // Invasive-species warning card (only when GBIF/GRIIS confirmed a China invasive).
  const inv = fields.invasive;
  const invSourceTxt = esc(inv?.source || "GBIF · GRIIS 中国名录");
  const invUrl = (inv?.source_url || "").replace(/"/g, "&quot;");
  const invCitation = inv?.source_url
    ? `<a href="${invUrl}" target="_blank" rel="noopener">${invSourceTxt}</a>`
    : invSourceTxt;
  const cl = inv?.china_list;
  const nationalLine = cl
    ? `<div class="ic-national">📋 <strong>国家名录</strong>：《中国外来入侵物种名单》${esc(cl.batch)}（${esc(cl.date)} · ${esc(cl.publisher)}）` +
      `<span class="ic-km ${cl.keyManaged ? "on" : "off"}">${cl.keyManaged ? "已纳入" : "未纳入"}《重点管理外来入侵物种名录》（农业农村部 567 号公告，2022）</span></div>`
    : "";
  const invasiveCard =
    inv && (inv.status_zh || inv.harm_zh || inv.control_zh || inv.china_list)
      ? `<section class="invasive-card">` +
        `<div class="ic-head"><span class="ic-icon">⚠️</span>` +
        `<div><span class="ic-kicker">Biosecurity Alert · 外来入侵物种警示</span><h2>外来入侵物种</h2></div>` +
        (inv.degree ? `<span class="ic-badge">入侵等级：${esc(inv.degree)}</span>` : "") +
        `</div>` +
        `<div class="ic-body">` +
        (inv.status_zh
          ? `<div class="ic-block"><span class="ic-label">在中国的入侵状况</span><p>${esc(inv.status_zh)}</p></div>`
          : "") +
        (inv.harm_zh
          ? `<div class="ic-block"><span class="ic-label">生态危害</span><p>${esc(inv.harm_zh)}</p></div>`
          : "") +
        (inv.control_zh
          ? `<div class="ic-block"><span class="ic-label">管控与防治建议</span><p>${esc(inv.control_zh)}</p></div>`
          : "") +
        `</div>` +
        nationalLine +
        `<div class="ic-cite">判定依据 · Source：${invCitation}</div>` +
        `</section>`
      : "";
  // Conservation / registry status card (only when the species matched a registry).
  const consBadges = (fields.conservation ?? []).filter((b) => b && b.label);
  const conservationCard = consBadges.length
    ? `<section class="conservation-card">` +
      `<div class="cc-head"><span class="cc-icon">🛡️</span>` +
      `<div><span class="cc-kicker">Conservation &amp; Registry Status · 保护与名录状态</span>` +
      `<h2>保护与名录收录</h2></div></div>` +
      `<div class="cc-body">` +
      consBadges
        .map((b) => `<span class="cc-chip cc-${esc(b.kind)}">${esc(b.label)}</span>`)
        .join("") +
      `</div></section>`
    : "";
  // Field-capture notes (拍摄记录): analysis of the user's photo + the basis for
  // the identification — deliberately distinct from summary_zh (the narrative
  // lead). Older drafts have no field_notes → fall back to the summary so the
  // block never renders empty.
  const fieldNotesZh = esc(fields.field_notes_zh || "");
  const fieldNotesEn = esc(fields.field_notes_en || "");
  const fieldCaptureNotes =
    fieldNotesZh || fieldNotesEn
      ? `<p>${fieldNotesZh}</p>` + (fieldNotesEn ? `<p class="en-p">${fieldNotesEn}</p>` : "")
      : esc(fields.summary_zh || "")
        ? `<p>${esc(fields.summary_zh || "")}</p>`
        : "";
  const titleDisplay = fields.common_name_en || fields.title;
  // Section illustrations: use the online species photos when available; any
  // missing slot falls back to the user's photo and keeps the "replaceable
  // default" marker so an editor is prompted to swap it.
  const secImgs = fields.section_images ?? [];
  const attrEsc = (u: string) => (u ?? "").replace(/"/g, "&quot;");
  const sectionDict: Record<string, string> = {};
  for (let i = 0; i < 5; i++) {
    const url = (secImgs[i] || "").trim();
    sectionDict[`sec_img_${i + 1}`] = attrEsc(url || fields.photo_url);
    sectionDict[`sec_img_${i + 1}_mark`] = url ? "" : ' data-default-img="1"';
  }
  const dict: Record<string, string> = {
    ...sectionDict,
    title: esc(fields.title),
    title_display: esc(titleDisplay),
    scientific_name: esc(fields.scientific_name || "—"),
    common_name_en: esc(fields.common_name_en || ""),
    common_names_zh: esc(fields.common_names_zh || "无"),
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
    field_capture_notes: fieldCaptureNotes,
    name_origin_zh: esc(fields.name_origin_zh || ""),
    name_origin_en: esc(fields.name_origin_en || ""),
    morphology_zh: esc(fields.morphology_zh || ""),
    morphology_en: esc(fields.morphology_en || ""),
    habitat_zh: esc(fields.habitat_zh || ""),
    habitat_en: esc(fields.habitat_en || ""),
    culture_zh: esc(fields.culture_zh || ""),
    culture_en: esc(fields.culture_en || ""),
    care_tips_zh: esc(fields.care_tips_zh || ""),
    care_tips_en: esc(fields.care_tips_en || ""),
    care_facts_rows: careFactsRows,
    invasive_card: invasiveCard,
    conservation_card: conservationCard,
    ai_model: esc(fields.ai_model || ""),
  };
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k) => dict[k] ?? "");
}
