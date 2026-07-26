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
  /** 与 section_images 一一对应的署名串（摄影者 · 许可证 · 来源）。 */
  section_credits?: string[];
  /** 与 section_images 一一对应的原始页链接，署名可点回去。 */
  section_sources?: string[];
  /** 该槽位没有合适器官的照片时，如实写明缺什么（如「暂无该物种的花期公开照片」）。 */
  section_missing?: string[];
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
  /** Populated when the species matched a 国家/省级重点保护 list — renders a full
   *  green shield card (判断依据 deterministic; the three narrative sections via LLM). */
  conservation_card?: {
    /** 判断依据: which 名录 matched, with level (deterministic). */
    basis_zh: string;
    /** 当前珍稀濒危 / 面临挑战 (LLM). */
    status_zh: string;
    /** 生态价值 (LLM). */
    value_zh: string;
    /** 保护建议 (LLM). */
    advice_zh: string;
    /** Protection level label (e.g. 一级/二级) for the head badge. */
    level?: string | null;
    /** True if a national (非省级) list matched — sets the card title. */
    national?: boolean;
    sources?: { name: string; url: string | null }[];
  } | null;
  /** #3 定种置信度 + 补拍指引（非 HTML 渲染字段；随 ai_payload 存库，草稿页 React 侧展示）。
   *  模型对本次照片不足以确诊时置 'low'，并在 needs_more_photos_* 写明该补拍哪些
   *  器官/角度（如花特写、果实、叶背、整株）。此时不得给出「确诊」口吻，best-guess
   *  一律以「疑似」标注。'high'/'medium' 则正常出稿。 */
  identification_confidence?: "high" | "medium" | "low";
  needs_more_photos_zh?: string;
  needs_more_photos_en?: string;
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
/* 配图框与拍摄记录（.img-slot）**同一套裱框格式**（用户 2026-07-25 要求对齐）：
   同样的 1px 边 + 双层纸裱（5px paper / 6px rule-soft）+ 同一道投影。之前 sec-img
   用的是更薄的 3px/4px 裱边且没有投影，和 hero 那张实拍照片放在一页里明显不是一套。 */
.sec-figure{max-width:320px;width:100%;margin:16px auto;}
.sec-img{max-width:100%;width:100%;height:auto;border:1px solid var(--rule);box-shadow:0 0 0 5px var(--paper),0 0 0 6px var(--rule-soft),0 14px 30px -12px rgba(30,16,8,.26);margin:0;display:block;}
/* 配图署名条 —— 外部图多为 CC BY-NC 等要求署名的许可，这一行属于合规要求。 */
/* 选择器必须压过 .section-body p（0,1,1）—— 只写 .img-credit（0,1,0）会输掉，
   实测被 16px 的正文规则盖住。注意：本块在 TS 模板字符串里，禁止出现反引号。 */
.section-body p.img-credit,p.img-credit{max-width:100%;margin:8px 0 0;font-size:11px;line-height:1.5;text-align:center;color:var(--ink-faint,#8a988f);word-break:break-word;}
.img-credit a{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor;}
/* 该器官确实没有公开照片时的空槽说明 —— 如实写明缺什么，不塞随机图充数。 */
.section-body p.img-missing,p.img-missing{max-width:100%;margin:0;padding:28px 12px;font-size:11px;line-height:1.6;text-align:center;color:var(--ink-faint,#8a988f);border:1px dashed var(--rule);background:var(--paper);}
img.sec-img[src=""]{display:none;}
@media (min-width:768px){
  /* align-items:start（不是 center）—— center 会把配图/「暂无」虚线框吊在正文的垂直
     中央，正文一长，图上下就各裂出一大片说不清来由的空白（用户报的「莫名其妙的空挡」）。
     顶对齐后图跟正文首行齐平，短的一侧只在下方留白，是正常的。 */
  .section-with-img{display:grid;grid-template-columns:1fr 320px;gap:32px;align-items:start;}
  .sec-figure{margin:0;}
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
  /* 眉标改叫「名称和分类趣闻」后变长了，桌面版的 .32em 字距会让它在 375px 上折成两行。 */
  .name-origin .no-title{letter-spacing:.12em;font-size:11px;}
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

@media(max-width:640px){
  .invasive-card .ic-head{flex-wrap:wrap;gap:8px 12px;padding:14px 16px;}
  .invasive-card .ic-head h2{font-size:19px;}
  .invasive-card .ic-badge{margin-left:0;order:3;flex-basis:100%;white-space:normal;}
  .invasive-card .ic-body{padding:16px;}
  .invasive-card .ic-national,.invasive-card .ic-cite{margin-left:16px;margin-right:16px;}
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
/* Full 重点保护 card (green counterpart of the invasive card). */
.conservation-card.cc-full{border:2px solid #4c8a3f;border-left:8px solid #4c8a3f;background:#eef5ea;background-image:repeating-linear-gradient(135deg,rgba(76,138,63,0.05) 0,rgba(76,138,63,0.05) 12px,transparent 12px,transparent 24px);box-shadow:0 10px 26px -14px rgba(76,138,63,.5);}
.conservation-card.cc-full .cc-head{background:#4c8a3f;color:#fff;border-bottom:none;padding:16px 20px;gap:14px;}
.conservation-card.cc-full .cc-icon{font-size:30px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));}
.conservation-card.cc-full .cc-kicker{color:rgba(255,255,255,.92);letter-spacing:.26em;}
.conservation-card.cc-full .cc-head h2{color:#fff;font-size:22px;}
.conservation-card.cc-full .cc-badge{margin-left:auto;font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.06em;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.5);border-radius:999px;padding:3px 12px;white-space:nowrap;}
.conservation-card.cc-full .cc-grid{display:grid;grid-template-columns:1fr;gap:16px;padding:20px 22px;}
@media(min-width:768px){.conservation-card.cc-full .cc-grid{grid-template-columns:1fr 1fr;}}
.conservation-card.cc-full .cc-block .cc-label{display:block;font-family:'Noto Serif SC',serif;font-weight:600;font-size:14px;color:#2f5c26;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(76,138,63,.3);}
.conservation-card.cc-full .cc-block p{font-size:14px;line-height:1.66;color:#233c1c;margin:0;}
.conservation-card.cc-full .cc-chips{display:flex;flex-wrap:wrap;gap:10px;padding:0 22px 4px;}
.conservation-card.cc-full .cc-cite{margin:14px 22px 20px;padding-top:12px;border-top:1px solid rgba(76,138,63,.26);font-family:'Cormorant Garamond',serif;font-size:12.5px;letter-spacing:.04em;color:#3f6f34;}
.conservation-card.cc-full .cc-cite a{color:#3f6f34;text-decoration:underline;}

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
    <div class="img-slot"><img src="{{photo_url}}" alt="{{title}} 拍摄照片"/>{{tentative_note}}</div>
    <div>
      <h2 style="font-size:18px;font-weight:600;color:var(--ink);margin-bottom:12px;letter-spacing:0.1em;">拍摄记录 · Field Capture</h2>
      <div class="field-capture">
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
    <h2>植物人文</h2>
    <span class="en">Plants Humanities</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body section-with-img">
    <div>
      <p>{{culture_zh}}</p>
      <p class="en-p">{{culture_en}}</p>
    </div>
    <figure class="sec-figure"><img class="sec-img"{{sec_img_4_mark}} src="{{sec_img_4}}" alt="{{title}} 植物人文"/>{{sec_img_4_credit}}</figure>
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
    <figure class="sec-figure"><img class="sec-img"{{sec_img_2_mark}} src="{{sec_img_2}}" alt="{{title}} 形态特征"/>{{sec_img_2_credit}}</figure>
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
    <figure class="sec-figure"><img class="sec-img"{{sec_img_3_mark}} src="{{sec_img_3}}" alt="{{title}} 生境与分布"/>{{sec_img_3_credit}}</figure>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>IV</i></span>
    <h2>名称和分类趣闻</h2>
    <span class="en">Name &amp; Taxonomy Curiosities</span>
    <div class="sec-line"></div>
  </div>
  <div class="section-body section-with-img">
    <div class="name-origin">
      <span class="no-title">NAME &amp; TAXONOMY · 名 称 和 分 类 趣 闻</span>
      <p>{{name_origin_zh}}</p>
      <p class="en-p">{{name_origin_en}}</p>
    </div>
    <figure class="sec-figure"><img class="sec-img"{{sec_img_1_mark}} src="{{sec_img_1}}" alt="{{title}} 名称和分类趣闻"/>{{sec_img_1_credit}}</figure>
  </div>

  <div class="sec-rule">
    <span class="sec-num"><i>V</i></span>
    <h2>生长条件</h2>
    <span class="en">Growth Conditions</span>
    <div class="sec-line"></div>
  </div>
  <div class="care-facts">{{care_facts_rows}}</div>
  <div class="section-body section-with-img">
    <div>
      <span class="care-why">生长条件与养护依据 · Rationale</span>
      <p>{{care_tips_zh}}</p>
      <p class="en-p">{{care_tips_en}}</p>
    </div>
    <figure class="sec-figure"><img class="sec-img"{{sec_img_5_mark}} src="{{sec_img_5}}" alt="{{title}} 生长条件"/>{{sec_img_5_credit}}</figure>
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
  // Conservation status card. When a 重点保护 list matched → full green shield card
  // (判断依据 + 珍稀濒危/挑战 + 生态价值 + 保护建议). Any other registry matches
  // (CITES/GTS/GRIIS) still show as chips — inside the full card, or on their own.
  const cc = fields.conservation_card;
  const consBadges = (fields.conservation ?? []).filter((b) => b && b.label);
  const nonProtChips = consBadges.filter((b) => b.kind !== "protected");
  const ccCite = (cc?.sources ?? []).filter((s) => s && s.name);
  const ccCiteHtml = ccCite.length
    ? ccCite
        .map((s) =>
          s.url
            ? `<a href="${(s.url || "").replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${esc(s.name)}</a>`
            : esc(s.name),
        )
        .join(" · ")
    : esc(cc?.basis_zh || "国家/省级重点保护野生植物名录");
  const chipsRow = nonProtChips.length
    ? `<div class="cc-chips">` +
      nonProtChips
        .map((b) => `<span class="cc-chip cc-${esc(b.kind)}">${esc(b.label)}</span>`)
        .join("") +
      `</div>`
    : "";
  let conservationCard = "";
  if (cc && (cc.status_zh || cc.value_zh || cc.advice_zh || cc.basis_zh)) {
    conservationCard =
      `<section class="conservation-card cc-full">` +
      `<div class="cc-head"><span class="cc-icon">🛡️</span>` +
      `<div><span class="cc-kicker">Conservation Status · 重点保护物种</span>` +
      `<h2>${cc.national ? "国家" : "省级"}重点保护野生植物</h2></div>` +
      (cc.level ? `<span class="cc-badge">保护级别：${esc(cc.level)}</span>` : "") +
      `</div>` +
      `<div class="cc-grid">` +
      (cc.basis_zh
        ? `<div class="cc-block"><span class="cc-label">判定依据 · 收录名录</span><p>${esc(cc.basis_zh)}</p></div>`
        : "") +
      (cc.status_zh
        ? `<div class="cc-block"><span class="cc-label">珍稀濒危 · 面临挑战</span><p>${esc(cc.status_zh)}</p></div>`
        : "") +
      (cc.value_zh
        ? `<div class="cc-block"><span class="cc-label">生态价值</span><p>${esc(cc.value_zh)}</p></div>`
        : "") +
      (cc.advice_zh
        ? `<div class="cc-block"><span class="cc-label">保护建议</span><p>${esc(cc.advice_zh)}</p></div>`
        : "") +
      `</div>` +
      chipsRow +
      `<div class="cc-cite">判定依据 · Source：${ccCiteHtml}</div>` +
      `</section>`;
  } else if (consBadges.length) {
    conservationCard =
      `<section class="conservation-card">` +
      `<div class="cc-head"><span class="cc-icon">🛡️</span>` +
      `<div><span class="cc-kicker">Conservation &amp; Registry Status · 保护与名录状态</span>` +
      `<h2>保护与名录收录</h2></div></div>` +
      `<div class="cc-body">` +
      consBadges
        .map((b) => `<span class="cc-chip cc-${esc(b.kind)}">${esc(b.label)}</span>`)
        .join("") +
      `</div></section>`;
  }
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
  // When the identification is still tentative (low confidence — e.g. 3 补拍 done but
  // the species couldn't be confirmed), caption the field-capture photo so it's clear
  // the write-up rests on a 疑似 ID rather than a confirmed one.
  const isTentative =
    fields.identification_confidence === "low" || /^\s*（?\s*疑似/.test(fields.summary_zh || "");
  const tentativeNote = isTentative
    ? `<p class="tentative-note" style="margin-top:8px;font-size:12px;color:var(--ink-faint,#8a988f);text-align:center;line-height:1.5;">（基于疑似识别创建资料）</p>`
    : "";
  const titleDisplay = fields.common_name_en || fields.title;
  // Section illustrations: use the online species photos when available; any
  // missing slot falls back to the user's photo and keeps the "replaceable
  // default" marker so an editor is prompted to swap it.
  const secImgs = fields.section_images ?? [];
  const secCredits = fields.section_credits ?? [];
  const secSources = fields.section_sources ?? [];
  const secMissing = fields.section_missing ?? [];
  const attrEsc = (u: string) => (u ?? "").replace(/"/g, "&quot;");
  const sectionDict: Record<string, string> = {};
  for (let i = 0; i < 5; i++) {
    const url = (secImgs[i] || "").trim();
    const miss = (secMissing[i] || "").trim();
    // 明确知道缺什么器官时，回落到用户自己的照片是**误导**——那张照片并不展示这个部位。
    // 此时把 src 留空并由下面的 credit 位渲染说明；其余情况维持原有的「默认配图」行为。
    sectionDict[`sec_img_${i + 1}`] = url ? attrEsc(url) : miss ? "" : attrEsc(fields.photo_url);
    // 缺图时同时给 hidden：`src=""` 在部分浏览器会被解析成「重新请求当前页」，
    // 靠 CSS 隐藏管不住那次请求。hidden 属性让它从一开始就不参与渲染。
    sectionDict[`sec_img_${i + 1}_mark`] = url
      ? ""
      : miss
        ? ' data-missing-organ="1" hidden'
        : ' data-default-img="1"';
    // 署名条。只有用了外部图才渲染 —— 回落到用户自己的照片时不该署第三方的名。
    // 这些图多为 CC BY-NC 等要求署名的许可，这一行是合规的一部分，不是装饰。
    const credit = url ? (secCredits[i] || "").trim() : "";
    const src = url ? (secSources[i] || "").trim() : "";
    if (!url && miss) {
      sectionDict[`sec_img_${i + 1}_credit`] = `<p class="img-missing">${esc(miss)}</p>`;
      continue;
    }
    sectionDict[`sec_img_${i + 1}_credit`] = credit
      ? `<p class="img-credit">${
          src
            ? `<a href="${attrEsc(src)}" target="_blank" rel="noreferrer nofollow">${esc(credit)}</a>`
            : esc(credit)
        }</p>`
      : "";
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
    tentative_note: tentativeNote,
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
