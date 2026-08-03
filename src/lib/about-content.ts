/**
 * 「关于 / 使用指南」页的内容模型与初稿。
 *
 * 存储决策（2026-07-31 与用户确认）：内容存在 `site_config` 的 `about_page` 这个 key 下，
 * **不新建表**——与「金叶创作指导 Skill」完全同一个套路（见 identify-plant.functions.ts 的
 * GOLD_SKILL_CONFIG_KEY）。好处是站长登录后就地改、存完立刻生效，不用重新部署，也不用
 * 去 Supabase 后台跑迁移。没存过 / 读失败 → 回退到本文件的 DEFAULT_ABOUT，页面永远有内容。
 *
 * 🔴 配图**绝不能**把 Vite 打包出来的哈希路径写进正文存库：`/assets/home-a1b2c3.jpg`
 * 会在下一次 build 后变成另一个哈希，存库的正文就指向一张 404。所以随站发布的截图一律写成
 * 稳定令牌 `<img data-shot="home">`，渲染前由 resolveShots() 换成当下的真实 URL。站长在
 * 编辑器里自己上传的图走 Supabase Storage 的绝对 URL，不受此影响，两种可以混用。
 */

import homeShot from "@/assets/about/home.jpg";
import identifyShot from "@/assets/about/identify.jpg";
import plantsIndexShot from "@/assets/about/plants-index.jpg";
import plantDetailShot from "@/assets/about/plant-detail.jpg";
import registryFiltersShot from "@/assets/about/registry-filters.jpg";
import registryChipsShot from "@/assets/about/registry-chips.jpg";
import mapLegendShot from "@/assets/about/map-legend.jpg";
import blogShot from "@/assets/about/blog.jpg";
import projectsShot from "@/assets/about/projects.jpg";
import imageSearchShot from "@/assets/about/image-search.jpg";
import signupShot from "@/assets/about/signup.jpg";

/** 随站发布的截图。key 即正文里 `data-shot="…"` 的取值。 */
export const SHOTS: Record<string, string> = {
  home: homeShot,
  identify: identifyShot,
  plantsIndex: plantsIndexShot,
  plantDetail: plantDetailShot,
  registryFilters: registryFiltersShot,
  registryChips: registryChipsShot,
  mapLegend: mapLegendShot,
  blog: blogShot,
  projects: projectsShot,
  imageSearch: imageSearchShot,
  signup: signupShot,
};

/**
 * 把正文里的 `data-shot="key"` 换成当下打包出来的真实 URL。认不出的 key 保持原样
 * ——那样图位会空着，但**不会**渲染成一张碎图，也不会连累整段正文。
 */
export function resolveShots(html: string): string {
  return html.replace(/data-shot="([a-zA-Z0-9_-]+)"/g, (whole, key: string) => {
    const url = SHOTS[key];
    return url ? `src="${url}" data-shot="${key}"` : whole;
  });
}

export type AboutSectionKind = "prose" | "matrix";

export type AboutSection = {
  /** 锚点 id，同时是 URL 里 #… 的那一段。改了会让旧链接失效，非必要不动。 */
  id: string;
  /** 中文标题 */
  zh: string;
  /** 英文小标题（目录与正文题头都用它做副题） */
  en: string;
  /** 1 = 大章（about / readme），2 = 子章节 */
  level: 1 | 2;
  kind: AboutSectionKind;
  /**
   * kind="prose" → 正文 HTML；
   * kind="matrix" → 三栏权限对照的纯文本表，一行一条：
   *   `#分组名`                     → 分组小标题
   *   `条目|访客|注册用户|编辑`      → 一行对照（✓ / — / 任意说明文字）
   */
  html: string;
};

export type AboutDoc = {
  sections: AboutSection[];
  updatedAt: string | null;
  updatedBy: string | null;
};

/** 站长可编辑的正文上限，防止一次误粘贴把 site_config 撑爆。 */
export const ABOUT_MAX_CHARS = 200_000;

// ─── 初稿 ────────────────────────────────────────────────────────────────────

const S = (
  id: string,
  zh: string,
  en: string,
  level: 1 | 2,
  html: string,
  kind: AboutSectionKind = "prose",
): AboutSection => ({ id, zh, en, level, kind, html: html.trim() });

export const DEFAULT_SECTIONS: AboutSection[] = [
  // ══════════════════════════ 大章一 · about ══════════════════════════
  S(
    "about",
    "关于本站",
    "About",
    1,
    `
<p class="lead">Plantspedia（草木志）是一个由社区共同创建、共同编辑、共同维护的植物百科。
它同时是一套<b>参与式植物科普与科考的工具</b>：任何人用一部手机拍一张照片，就能给这个星球的
植物名录添上一条有时间、有地点、有照片的真实记录。</p>

<p>我们不打算做又一个"查植物"的网站。查得到的东西已经很多了。这里真正在解决的是另一件事
——<b>让普通人有办法参与进来，并且他参与的那一份被认真对待、被留下来、被别人看见。</b></p>

<div class="callout">
<p><b>一句话讲清楚它怎么转：</b>你拍照 → AI 给出候选物种并写出一份中英双语草稿 →
编辑校对、补图、修正 → 通过后正式收录进站内档案 → 这条记录同时落在<b>物种档案</b>和
<b>身边物种地图</b>上，成为公开可查、可被引用的一条数据。</p>
</div>

<figure class="shot">
  <img data-shot="home" alt="Plantspedia 首页">
  <figcaption>首页 · 最新更新 / 编辑推荐 / 热度 / 地区植物名录 / 主题标签</figcaption>
</figure>
`,
  ),

  S(
    "about-community",
    "一个社区共同创建和编辑维护的平台",
    "Built and Kept by a Community",
    2,
    `
<p>这个站没有"编辑部"和"读者"的分界线。它的运转方式更接近一本大家一起抄写、一起校勘的册子：</p>

<ul>
  <li><b>任何人都能贡献一条观察。</b>拍照识别不需要任何身份门槛，识别出的草稿会自动进入审核队列。</li>
  <li><b>任何人都可以申请成为编辑。</b>通过后就能校对正文、替换配图、纠正物种判断、维护地区名录。</li>
  <li><b>每一次改动都留痕。</b>谁在什么时候改了哪一段，站内的 Log 都记着，且可以撤销——
  这让"放手让人改"变成一件风险可控的事。</li>
  <li><b>贡献会被计数，也会被看见。</b>识别、修文、换图各自积累叶片；被采纳的贡献价值翻倍。
  详见下面的<a href="#about-leaves">叶片</a>一节。</li>
</ul>

<p>之所以坚持这套做法，是因为公民科学最容易死在两个地方：一是门槛太高，普通人插不上手；
二是贡献了没有回响，第二次就不来了。留痕 + 计数 + 采纳，针对的正是第二个。</p>
`,
  ),

  S(
    "about-vision",
    "愿景：在玩中做科考",
    "The Vision — Fieldwork as a Game",
    2,
    `
<p>我们想去的地方，比"一个百科站"要远一些。</p>

<p>理想的样子是：<b>一场科普爱好者、师生、亲子（大人和孩子）都能一起玩的生物多样性调查游戏。</b>
周末带孩子去公园，不是"认识十种植物"这样的任务，而是"我们这一队今天为这片草地补上了 7 条记录，
其中 2 条是这个区第一次被记到"。自然教育和科学考察本来就该长成这个样子——
<b>在玩中完成，而不是在课本上完成。</b></p>

<ul>
  <li><b>对孩子</b>：拍照就能参与，看得见自己的那一条被收录、出现在地图上。</li>
  <li><b>对师生</b>：一个班、一次野外实习，可以作为一个项目跑完整个流程，产出可公开引用的成果。</li>
  <li><b>对爱好者</b>：不必是植物学家，也能持续做一件专业上真正有用的事。</li>
  <li><b>对组织者</b>：政府部门、公益机构、自然教育机构可以直接把它当作调研工具用，
  不必自己再开发一套系统。</li>
</ul>

<div class="callout">
<p>这一部分是<b>方向</b>，不是已经做完的功能。目前站内已经落地的是它的地基：识别、收录、地图、
名录、项目、叶片、留痕。游戏化的那一层（队伍、任务、赛季、成就）尚未开始。写在这里是为了让你
知道我们要往哪儿走，也欢迎你在这个阶段就来影响它的样子。</p>
</div>
`,
  ),

  S(
    "about-now",
    "现在正在做的：参与式植物调研",
    "What We Do Now",
    2,
    `
<p>眼下的重心，是把网站的功能扎扎实实地用在<b>具体的、有边界的、有人真正需要结果的调研项目</b>上。
比起泛泛地"收录更多物种"，一个有明确目标的调研更容易组织，也更容易让参与者看到自己的作用。</p>

<h4>已经在做和适合做的几类</h4>
<ul>
  <li><b>特定区域的入侵生物调研。</b>圈定一个区域，发动参与者拍照上报，系统自动比对 GRIIS
  全球外来入侵名录并标红，最后得到一张带坐标的分布图。</li>
  <li><b>过敏源植物调研。</b>把致敏植物（如蒿属、葎草、法国梧桐等）作为主题标签集中收集，
  形成一份对市民有直接用处的分布与花期参考。</li>
  <li><b>地区植物名录的建立与核对。</b>一个旗县、一片草原、一个保护区的植物清单，
  由参与者一条条拍实、核实、补齐。</li>
  <li><b>重点保护物种的分布记录。</b>配合国家和省级重点保护名录，记录实际遇见的位置与状态。</li>
</ul>

<h4>为什么这件事需要一个网站</h4>
<p>因为门槛。让公民参与生态保护和生态治理，最大的障碍从来不是意愿，而是<b>"我不认识它，我帮不上忙"</b>。
这个站把这一步的成本压到了"拍一张照片"——识别、比对名录、生成条目、落到地图，剩下的交给系统和编辑。
一个完全不懂植物的人，第一天就能做出有效贡献。</p>

<p>对于希望邀请公众参与的政府部门或民间公益机构来说，这意味着可以直接发起一场调研，
而不必先培训参与者，也不必自建系统。我们乐意配合这类合作。</p>

<figure class="shot">
  <img data-shot="projects" alt="项目预告与成果页">
  <figcaption>「项目预告与成果」——每场调研作为一个项目公开，可按时间、地点、主题、发起人检索</figcaption>
</figure>
`,
  ),

  S(
    "about-biodiversity",
    "我们如何服务生物多样性保护",
    "Biodiversity in Practice",
    2,
    `
<p>"支持生物多样性保护"如果只是一句口号，就没有意义。下面几节是这句话在站内<b>具体对应到哪些功能</b>——
每一条都可以在页面上看到、点到。</p>

<p>核心机制只有一个：<b>站内接入了多份权威名录，任何一个物种一旦被收录，系统会按规范化的拉丁学名
自动比对这些名录，命中就在条目上挂出对应的标记。</b>编辑不需要记得"这个是不是保护植物"，
系统会告诉他。</p>

<figure class="shot">
  <img data-shot="registryFilters" alt="已收录档案检索页的名录筛选器">
  <figcaption>「已收录档案检索」顶部的筛选器：国家和各省重点保护目录 · 归类标签 · 科 · 属 ·
  IUCN · 国际贸易管制（CITES） · GTS · GRIIS 全球入侵等级 · 条目类型</figcaption>
</figure>

<div class="callout">
<p><b>一个重要的设计取舍：</b>这些名录是<b>存在站内数据表中按学名匹配</b>的，不是每次实时去外部接口查。
好处是快、稳定、离线也在；代价是名录本身需要人工更新。名录的来源与更新时间可以在管理界面里查到。</p>
</div>
`,
  ),

  S(
    "about-registries",
    "站内接入的名录，逐一说明",
    "The Registries, One by One",
    2,
    `
<p>下面这些标记会直接出现在物种条目的顶部。以入侵物种「空心莲子草」为例：</p>

<figure class="shot">
  <img data-shot="registryChips" alt="物种条目顶部的名录标记">
  <figcaption>条目顶部的名录标记行——橙色的「入侵物种」是 GRIIS 命中后自动挂上的，
  后面几个是科属、生活型与人工主题标签</figcaption>
</figure>

<h4>① 国家和各省重点保护野生植物名录</h4>
<p>国家重点保护（2021 版）与各省级名录。命中后条目上会出现<b>粉色</b>（国家级）或
<b>黄色</b>（省级 / 地区级）的保护标记，并写明保护级别。这类物种在「身边物种地图」上
也会用<b>橙色圆点</b>单独标出，方便在一片记录里一眼找到它们。</p>

<h4>② IUCN 濒危等级</h4>
<p>世界自然保护联盟的评估等级：极危 CR / 濒危 EN / 易危 VU / 近危 NT / 无危 LC /
数据缺乏 DD / 野外灭绝 EW / 未评估 NE。与其它几项不同，IUCN 等级是<b>条目上的一个字段</b>，
由编辑填写或由 AI 建议后经编辑确认，可在检索页按等级筛选。</p>

<h4>③ CITES 华盛顿公约国际贸易管制</h4>
<p>《濒危野生动植物种国际贸易公约》附录 I / II / III。命中后挂<b>紫色</b>标记，
写明所在附录。这一项之所以重要，是因为它管的是<b>贸易</b>——很多人并不知道自己在花市、
在网店买到的某一株植物是受国际贸易管制的。把它标在科普页上，比写在法规文件里更容易被看到。</p>

<h4>④ GTS 全球树木红色名录</h4>
<p>由国际植物园保护联盟（BGCI）主导的全球树木评估，给出每一种树的受威胁状况。
命中后挂<b>蓝色</b>标记。全球约三分之一的树种处于受威胁状态，而其中相当一部分
在公众认知里完全是"普通的树"。</p>

<h4>⑤ GRIIS 全球外来与入侵物种名录</h4>
<p>命中后挂<b>橙色</b>警示标记，并给出入侵等级。这是入侵生物调研的直接依据——
参与者拍到一株草，系统当场告诉他"这是已登记的外来入侵种"，这比事后统计有力得多。
地图上这类记录用<b>红色圆点</b>标出。</p>

<h4>⑥ 地区植物名录</h4>
<p>由编辑维护的地方性清单（某旗县、某草原、某保护区的植物名录）。它回答的是
"这一株在本地算不算有记录"，是地方调研的基本骨架。</p>

<h4>⑦ 主题标签</h4>
<p>由编辑<b>人工</b>挂上的专题标签（例如"圣水草原的植被""过敏源植物"）。
它在标记行里用<b>加粗的绿色描边</b>显示，与自动匹配的名录明确区分开——
一眼能看出这是人特意归的类，而不是机器比对出来的。</p>
`,
  ),

  S(
    "about-leaves",
    "叶片：让每一次参与都被记下来",
    "Leaves — Counting Every Contribution",
    2,
    `
<p>叶片是站内的贡献计数。它不是积分商城，也不能兑换任何站外的东西；
它只做一件事：<b>把"你做过什么"变成一个看得见的数字，并据此把更重的工具交给做得更多的人。</b></p>

<h4>怎么积累</h4>
<ul>
  <li><b>识别铜叶</b>——每提交一份识别草稿得 1 片；如果为了让判断更可靠而补拍了几次，
  每补拍一次再加 1 片（判为"疑似"的记录恒为 1 片，不随补拍增加）。</li>
  <li><b>修文铜叶</b>——每完成一次正文修改得 1 片。</li>
  <li><b>换图铜叶</b>——每完成一次配图替换得 1 片。</li>
  <li><b>被采纳则翻倍</b>——站长或资深编辑"采纳"了你的这一份，它的价值变成 2 倍。
  这是整套机制里唯一的质量杠杆：数量人人可得，采纳只给真正有用的那些。
  <b>普通编辑不能采纳</b>，包括不能采纳自己的——否则这道杠杆就失效了。</li>
</ul>

<h4>怎么换级</h4>
<p>10 片铜叶折 1 片银叶，10 片银叶折 1 片金叶。铜叶合计<b>只增不减</b>，
永远显示你的累计贡献；被消耗的只是折算出来的银叶和金叶。</p>

<table>
  <thead><tr><th>层级</th><th>怎么得到</th><th>能做什么</th></tr></thead>
  <tbody>
    <tr><td>见习编辑</td><td>刚通过编辑申请</td><td>校对正文、替换配图</td></tr>
    <tr><td>铜叶编辑</td><td>有铜叶积累</td><td>同上</td></tr>
    <tr><td>银叶编辑</td><td>10 铜叶 = 1 银叶</td><td>消耗 1 片银叶，为一个物种生成一份含多张配图的完整科普草稿</td></tr>
    <tr><td>金叶编辑</td><td>10 银叶 = 1 金叶</td><td>消耗 1 片金叶，一键创建一份完整的物种科普详页</td></tr>
    <tr><td>资深编辑</td><td><b>由站长指定</b>，与叶片数无关</td><td>采纳他人的贡献（使其价值翻倍）· 撤销他人的错误改动 · 银叶不限量</td></tr>
  </tbody>
</table>

<div class="callout">
<p>这套设计的用意是：<b>让写作型的重工具（生成完整科普长页）必须靠持续的基础贡献换来</b>，
而不是谁都能无限点。基础贡献——多拍一张、多校一段、多换一张清楚的图——才是这个站真正稀缺的东西。</p>
</div>
`,
  ),

  S(
    "about-contact",
    "谁在做，以及怎么找到我们",
    "Who & Contact",
    2,
    `
<p>Plantspedia 目前由一个很小的团队在维护，内容以鄂尔多斯 / 内蒙古的草木为起点，
逐步向外扩展。站内所有正式条目都经过人工校对，AI 只承担初稿和辅助的角色。</p>

<ul>
  <li><b>想参与编辑</b>：点导航栏的「申请成为编辑」，填写你的姓名、专业、
  是否系统学过植物学以及联系方式，我们会人工审核。</li>
  <li><b>想发起一场调研 / 机构合作</b>：直接来信说明区域、主题和大致时间，我们来配合工具与流程。</li>
  <li><b>发现错误</b>：任何条目下都可以留言；如果你已经是编辑，可以直接改，改动会留痕。</li>
  <li><b>联系邮箱</b>：<a href="mailto:arainjazz@163.com">arainjazz@163.com</a></li>
</ul>

<div class="callout warn">
<p><b>一句必须说清的话：</b>站内的识别结果和科普内容<b>不能作为食用、药用或任何医疗用途的依据</b>。
植物中有毒的比人们以为的多得多，长得像的更多。请不要根据这里的任何一页去吃一株植物。</p>
</div>
`,
  ),

  // ══════════════════════════ 大章二 · readme ══════════════════════════
  S(
    "readme",
    "使用指南",
    "Readme",
    1,
    `
<p class="lead">这一部分逐页讲清楚：<b>这一页是干什么的、怎么用、以及它背后是怎么运转的。</b>
如果你只想快速上手，看完下面这张三栏对照表就够了。</p>
`,
  ),

  S(
    "readme-roles",
    "三种身份分别能做什么",
    "What Each Role Can Do",
    2,
    `#浏览与检索
浏览已收录条目|✓|✓|✓
全文搜索、按科属 / 名录筛选|✓|✓|✓
查看身边物种地图|✓|✓|✓
植物搜图（跨库检索配图）|✓|✓|✓
阅读博客与项目成果|✓|✓|✓
#识别与记录
拍照 / 上传识别植物|✓|✓|✓
记录 GPS 位置、落到地图上|✓|✓|✓
生成中英双语科普草稿|✓|✓|✓
草稿计入我的贡献（叶片）|—|✓|✓
补拍以提高判定可靠性|✓|✓|✓
#社区互动
在条目下留言、回复|—|✓|✓
查看自己的修改记录（Log）|—|✓|✓
个人主页与贡献统计|—|✓|✓
与小P蛙对话（站内 AI 助手）|—|✓|✓
用自己的 API Key 驱动小P蛙|—|✓|✓
#编辑与维护
审核草稿、正式收录为条目|—|—|✓
校对正文、替换配图|—|—|✓
纠正物种判断与学名|—|—|✓
维护地区名录与主题标签|—|—|✓
撰写博客、发布项目成果|—|—|✓
消耗银叶生成完整科普草稿|—|—|✓
消耗金叶一键创建科普详页|—|—|✓
撤销他人的错误改动|—|—|资深编辑
采纳他人贡献（使其翻倍）|—|—|资深编辑
银叶不限量（随便生成完整草稿）|—|—|资深编辑
指定谁当资深编辑|—|—|站长
配置站点 AI 模型与名录|—|—|站长`,
    "matrix",
  ),

  S(
    "readme-home",
    "首页",
    "Home",
    2,
    `
<figure class="shot">
  <img data-shot="home" alt="首页">
  <figcaption>首页的五个入口标签页</figcaption>
</figure>

<p>标题下面那一排标签，是进入站内内容的五条不同路径：</p>
<ul>
  <li><b>最新更新</b>——按收录时间倒序，最上面那条是全站最新的一份档案。</li>
  <li><b>编辑推荐</b>——编辑手动挑出来的条目，通常是内容比较完整、配图比较好的那些。</li>
  <li><b>热度</b>——按浏览与互动排序。</li>
  <li><b>地区植物名录</b>——按地方清单浏览，适合"我想看看本地都有什么"。</li>
  <li><b>主题标签</b>——按专题浏览，例如某场调研、某类用途、某种生境。</li>
</ul>
<p>顶部搜索框是<b>全文搜索</b>，中文名、拉丁学名、俗名、正文内容都能搜到。</p>
`,
  ),

  S(
    "readme-identify",
    "AI 识别",
    "Identify",
    2,
    `
<figure class="shot">
  <img data-shot="identify" alt="AI 识别页">
  <figcaption>识别页——中间的黑色圆钮是快门，左边是相册，右边是说明</figcaption>
</figure>

<h4>怎么用</h4>
<ol>
  <li><b>拍或选一张照片。</b>点中间的快门调用相机，或点左边的图标从相册选。
  照片尽量清楚、主体突出；一整片草丛的照片很难识别，一朵花的特写就容易得多。</li>
  <li><b>决定要不要开定位。</b>点「开启定位」会请求你的位置，用来把这条记录落到
  「身边物种地图」上。<b>不开也能识别</b>，只是这条记录不会出现在地图上。
  如果照片本身带 GPS 信息（多数手机默认会记），系统也会读取。</li>
  <li><b>等结果。</b>识别过程会实时显示进度。</li>
  <li><b>看判定结果。</b>如果结论是「疑似」，页面会建议你<b>补拍</b>——换一个器官
  （花、叶、果、整株、树皮）再来一张。补拍能显著提高可靠性，也会额外积累叶片。</li>
  <li><b>提交草稿。</b>识别完成后会自动生成一份中英双语的简介摘要卡草稿，进入编辑审核队列；
  通过后正式收录进站内档案。</li>
</ol>

<div class="callout warn">
<p>页面顶部那行绿字不是客套话：<b>AI 识别内容不能采纳为食用药用参考。</b></p>
</div>

<figure class="shot todo">
  <div class="ph">待补图</div>
  <figcaption>识别结果页（含置信度星级、名录标记、识别过程展开项）——
  该页面需登录后拍摄一次识别才能截到，待补</figcaption>
</figure>
`,
  ),

  S(
    "readme-index",
    "已收录档案检索",
    "Index",
    2,
    `
<figure class="shot">
  <img data-shot="plantsIndex" alt="已收录档案检索页">
  <figcaption>全部条目——顶部是名录与分类筛选器，下方是条目列表</figcaption>
</figure>

<p>这里是站内所有<b>已通过审核</b>的条目。筛选器可以叠加使用，例如
"蔷薇科 + GRIIS 有记录"或"内蒙古省级重点保护 + 主题标签：圣水草原的植被"。</p>

<ul>
  <li>条目名前带 <b>[方括号]</b> 的表示这是一份还在完善中的档案。</li>
  <li>带蓝色 <b>AI 识别</b> 小标的，表示这一条源自用户拍照识别后被采纳收录。</li>
  <li>每条都列出俗名 / 商品名、拉丁学名、英文俗名与科属，方便对照确认。</li>
  <li>底部的<b>回车搜索</b>框在当前筛选结果内再做一次搜索。</li>
</ul>

<figure class="shot">
  <img data-shot="plantDetail" alt="物种条目详情页">
  <figcaption>条目详情页——顶部名录标记行、科属题头、中英双语正文，
  以及右上角的「分享卡」与「分享」</figcaption>
</figure>

<p>详情页的正文分节编排：植物简介 → 关键特征 → 典型生境 → 植物人文 → 演化与生态 →
最新资讯 → 博物趣闻。并非每一条都齐全，取决于这份档案完善到了什么程度。</p>
`,
  ),

  S(
    "readme-explore",
    "身边物种地图",
    "Explorer",
    2,
    `
<p>地图上每一个标记，都是有人用手机拍照识别、并且带真实 GPS 坐标的一条物种记录。</p>

<figure class="shot" style="max-width:380px">
  <img data-shot="mapLegend" alt="地图图例">
  <figcaption>分布点图例</figcaption>
</figure>

<ul>
  <li><b>蓝点</b>=未采纳的记录，<b>绿点</b>=已被采纳的记录；
  <b>红点</b>=入侵物种，<b>橙点</b>=重点保护物种。后两类的颜色优先级更高，为的是让它们一眼可见。</li>
  <li>多个点重叠时会聚成一个圆圈，圈内数字是物种数；点开会在右侧展开物种卡片。</li>
  <li>同一个物种在别处的记录之间以<b>绿线</b>相连，可以看出它的分布范围。</li>
  <li>点击标记可以「导航到此地」或「加入路线」——用来规划一次实地踏查。</li>
  <li>左下角可在<b>平面 / 卫星</b>底图之间切换。</li>
</ul>

<div class="callout">
<p>首次进入会请求你的位置。<b>允许</b>之后可以按距离排序，看"离我最近的记录"；
拒绝也能用，只是展示全部记录、不按距离排。</p>
</div>
`,
  ),

  S(
    "readme-image-search",
    "植物搜图",
    "Image Search",
    2,
    `
<figure class="shot">
  <img data-shot="imageSearch" alt="植物搜图页">
  <figcaption>采集册 Plantae Index — 输入学名或俗名，跨库检索该植物的公开图像</figcaption>
</figure>

<p>输入学名或俗名（支持中文），系统会自动匹配该植物的各种名称作为关键词，
一次性去多个公开图像库检索：<b>iNaturalist · GBIF · Wikimedia Commons · Openverse · iDigBio</b>。</p>

<p>它主要是给编辑用的：给一个缺图的条目找一张合规、清楚的配图。右键可保存到本地、
复制图片 URL，或直接复制图片到剪贴板。</p>

<div class="callout warn">
<p>图像版权归各数据库与摄影者所有，仅供检索与研究参考。<b>用到条目里之前请自行确认授权条款。</b></p>
</div>
`,
  ),

  S(
    "readme-blog-projects",
    "博客与项目",
    "Blog & Projects",
    2,
    `
<figure class="shot">
  <img data-shot="blog" alt="博客页">
  <figcaption>博客 blogs — 编辑团队的随笔、田野观察与编辑手记，按作者归类</figcaption>
</figure>

<p><b>博客</b>放的是不适合塞进物种条目的那些内容：一次野外的经过、一个判断上的犹豫、
一段编辑过程中的思考。任何人都可以读和留言，撰写需要编辑权限。</p>

<figure class="shot">
  <img data-shot="projects" alt="项目页">
  <figcaption>项目驱动调研成果 — 可按时间范围、项目地点、主题、发起人四个维度筛选</figcaption>
</figure>

<p><b>项目</b>是调研活动的公开档案：一场调研的预告、参与方式、以及结束后的成果。
如果你所在的机构想发起一场调研，这里就是它最后呈现出来的样子。</p>
`,
  ),

  S(
    "readme-log",
    "Log · 社区日志",
    "Community Log",
    2,
    `
<p>Log 记录站内的两类事件：<b>创建记录</b>（新收录了什么）与<b>修改记录</b>（谁改了哪一段）。
可以按时间、按编辑者、按种名三种方式排列，也可以直接搜索。</p>

<ul>
  <li><b>登录后</b>才能看到记录内容；未登录时页面只显示一个登录入口。</li>
  <li>普通用户看到的是<b>自己</b>的记录；编辑与管理员能看到全站的。</li>
  <li>每条记录都标出是人工改的还是 AI 协作产生的，以及经由哪个入口
  （HTML 编辑器 / 条目表单 / 批量上传 / 地区目录编辑 / 标签管理 / 博客编辑器）。</li>
  <li>管理员可以<b>撤销</b>某一次改动，把那一块内容退回改动前的样子；撤销本身也会被记一条。</li>
</ul>

<figure class="shot todo">
  <div class="ph">待补图</div>
  <figcaption>登录后的修改记录列表（含来源标签与撤销操作）——需登录截图，待补</figcaption>
</figure>
`,
  ),

  S(
    "readme-profile",
    "我的主页",
    "Profile",
    2,
    `
<p>登录后可见。这里汇总你在站内的一切：</p>
<ul>
  <li><b>叶片统计</b>——识别 / 修文 / 换图 各多少铜叶，折算出多少银叶、金叶，已用掉多少。</li>
  <li><b>我的贡献</b>——你提交过的草稿、改过的条目、留过的言。</li>
  <li><b>通知</b>——你的草稿被采纳、被回复时会在这里提醒，导航栏上也会显示未读数。</li>
  <li><b>小P蛙模型设置</b>——可以用你自己的 API Key 驱动小P蛙，详见下面的
  <a href="#readme-models">模型配置</a>一节。</li>
</ul>

<figure class="shot todo">
  <div class="ph">待补图</div>
  <figcaption>个人主页（叶片统计与贡献列表）——需登录截图，待补</figcaption>
</figure>
`,
  ),

  S(
    "readme-editing",
    "添加 / 编辑内容",
    "Editing",
    2,
    `
<p>登录后导航栏会出现「添加/编辑内容」。编辑权限下可以做的事：</p>

<ul>
  <li><b>审核草稿</b>——把用户识别产生的草稿校对后正式收录，或退回。导航栏的
  「AI识别」旁会显示待审草稿数。</li>
  <li><b>新建 / 编辑条目</b>——表单填写科属学名等结构化字段，正文用富文本编辑器写，
  也可以直接编辑 HTML。</li>
  <li><b>替换配图</b>——条目里任何一张图都可以换：本地上传、粘贴、贴 URL，
  或用「植物搜图」找一张。</li>
  <li><b>维护地区名录与主题标签</b>——建立地方清单、给条目挂专题标签。</li>
  <li><b>撰写博客、发布项目</b>。</li>
  <li><b>批量上传</b>——一次导入多条。</li>
</ul>

<div class="callout">
<p>所有改动都会写进 Log，并且可被撤销。这就是为什么这个站敢把编辑权限开放给申请通过的任何人。</p>
</div>

<figure class="shot">
  <img data-shot="signup" alt="申请成为编辑">
  <figcaption>「申请成为编辑」——填写显示名、邮箱、密码与个人简述（姓名、专业、
  是否系统学过植物学），提交后由管理员人工审核</figcaption>
</figure>
`,
  ),

  S(
    "readme-xiaop",
    "小P蛙 · 站内 AI 助手",
    "XiaoP the Frog",
    2,
    `
<p>右下角那只蛙就是小P蛙。它是站内的 AI 助手，<b>登录后</b>可用。</p>

<ul>
  <li><b>陪你看当前这一页</b>——你在哪一页，它就读哪一页，可以直接问"这一段什么意思"
  "这两个物种怎么区分"。</li>
  <li><b>能改内容的只有两种页面</b>——物种条目详情页和草稿页。在这两页上，
  你可以让它改写某一段，它会给出修改并保存（改动照常留痕）。其它页面它只答不改
  ——这是有意为之，不做做不到的承诺。</li>
  <li><b>任务动态</b>——识别、生成草稿这类后台任务在跑的时候，进度会显示在它下面。</li>
  <li><b>可以换成你自己的大脑</b>——见下一节。</li>
</ul>
`,
  ),

  S(
    "readme-how",
    "工作原理：一张照片到一份档案",
    "How It Works",
    2,
    `
<p>这一节讲清楚从"按下快门"到"站内多出一份档案"，中间到底发生了什么。
识别结果页上有一个可以展开的<b>识别过程</b>，把下面这几步真实地列出来，
包括没跑成的那些——我们认为把过程摊开比给一个漂亮的数字更诚实。</p>

<h4>第一步：专业识别引擎</h4>
<p>照片先交给 <b>Pl@ntNet</b>（一个专门做植物识别的学术引擎）。它会给出候选物种
<b>和一个百分比分数</b>——这是整条链路上<b>唯一一个不是 AI 自评的客观数字</b>。</p>

<h4>第二步：视觉大模型识别</h4>
<p>同一张照片同时交给一个多模态视觉模型，由它给出物种判断，并自评一个置信档：
<b>高 / 中 / 低</b>三档。</p>
<div class="callout">
<p><b>为什么这里不给百分比？</b>因为模型只能自评三档，硬把它换算成"87%"是<b>假精度</b>——
那个小数点后的数字是编出来的，不比"高"更可靠。所以页面上如实写"模型只给档位，不给百分比"。</p>
</div>

<h4>第三步：综合可信度</h4>
<p>页面上那个星级，由上面两个信号合成，规则是公开的：</p>
<ul>
  <li><b>互相印证</b>：Pl@ntNet 的分数够高、并且和模型指向同一个物种 → 取两者均值。</li>
  <li><b>有效分歧</b>：Pl@ntNet 分数够高却指向<b>另一个</b>物种 → 扣分，
  而且<b>扣多少随它自己的把握程度放大</b>——刚过阈值几乎不扣，接近 100% 才扣满。</li>
  <li><b>低分不计</b>：Pl@ntNet 分数低于阈值 → 它自己都在猜，既不算印证也不算反证，直接忽略。</li>
  <li><b>无客观参照</b>：没跑成 Pl@ntNet → 只认模型的档位，并在页面上写明缺少客观参照。</li>
</ul>

<h4>第四步：二次自动复核</h4>
<p>如果第一轮结论是<b>疑似</b>，系统会自动再跑一次复核——由另一条独立配置的链路重新看这张照片，
结果是"确认原判"还是"纠正物种"都会写在识别过程里。复核确认的，可以跳过补拍。</p>

<h4>第五步：写草稿</h4>
<p>定种之后，生成一份<b>中英双语</b>的简介摘要卡草稿。这时系统同时做一件事：
按规范化学名去比对站内的各份名录（保护、CITES、GTS、GRIIS、地区名录），命中的自动挂到草稿上。</p>

<h4>第六步：进入人工审核</h4>
<p>草稿进入编辑队列。编辑校对文字、替换或补齐配图、必要时纠正物种，通过后正式收录。
<b>AI 只写初稿，署名与责任在人。</b></p>

<h4>更完整的两档</h4>
<ul>
  <li><b>进一步科普草稿</b>（消耗 1 片银叶）——在简介之上扩写成含多张配图的完整草稿。</li>
  <li><b>物种科普详页</b>（消耗 1 片金叶）——按站内的写作规范生成一份完整的公开档案，
  分节编排、中英双语、带资料出处。它会分多轮撰写，并联网检索该物种的研究进展与媒体报道。</li>
</ul>
`,
  ),

  S(
    "readme-models",
    "模型是怎么配置的",
    "Model Configuration",
    2,
    `
<p>先说一件事：<b>这一页不会写出任何具体的模型名称。</b>不是保密，是因为模型换得很勤——
写死在说明里，过两个月就是一条错误信息。站内其它面向读者的地方同样只写"AI 协作"，
真实的模型名只存在于站长的配置控制台和用量账单里。</p>

<h4>优先调用序列</h4>
<p>站内所有 AI 能力都不绑定单一模型，而是配置成一条<b>优先调用序列</b>：
序列 1 失败（超时、额度用尽、返回异常）就自动顺位给序列 2、序列 3。
这样某一家服务商出问题时，站点功能不会整体停摆。</p>

<p>每一项要填的是：<b>服务商 · 模型标识 · API Key · 接口地址</b>（多数情况下接口地址留空即可）。</p>

<h4>各条链路是分开配置的</h4>
<p>站长控制台里有若干条互相独立的链路，因为它们对模型的要求正好相反：</p>
<table>
  <thead><tr><th>链路</th><th>它在做什么</th><th>对模型的要求</th></tr></thead>
  <tbody>
    <tr><td>一线识别</td><td>看照片定种</td><td>必须支持视觉；要准</td></tr>
    <tr><td>疑似复核</td><td>对"疑似"的结论再看一遍</td><td>必须支持视觉；宁慢求准</td></tr>
    <tr><td>小P蛙</td><td>交互式问答与改稿</td><td>要跟手、要便宜，常带图</td></tr>
    <tr><td>科普详页撰写</td><td>一次性写完整档案</td><td>要写得深，慢一点没关系</td></tr>
    <tr><td>配图器官识别</td><td>判断一张图是花 / 叶 / 果 / 植株</td><td>机械的视觉打标签</td></tr>
  </tbody>
</table>

<div class="callout warn">
<p><b>一条踩过的坑，写在这里给后来的维护者：</b>凡是要看图的链路，每一项都必须选
<b>支持视觉的多模态模型</b>。给它配一个纯文本模型，调用会直接失败——而且失败的不只是
那一项功能，跟它共用配置的其它功能会一起废掉。</p>
</div>

<h4>你也可以用自己的模型</h4>
<p>注册用户可以在小P蛙的设置里填自己的 API Key，用自己的模型来驱动它。
这个 Key <b>只存在你这台设备的浏览器里，不会上传、不会保存到服务器</b>，
每次提问时随请求发给你选定的模型服务商。不填就用站点默认配置。</p>

<figure class="shot todo">
  <div class="ph">待补图</div>
  <figcaption>小P蛙的模型设置面板（优先调用序列）——需登录截图，待补</figcaption>
</figure>
`,
  ),

  S(
    "readme-content-policy",
    "内容从哪来、错了怎么办",
    "Sources & Corrections",
    2,
    `
<h4>内容来源</h4>
<ul>
  <li><b>照片</b>——绝大多数来自参与者本人实地拍摄。缺图的条目由编辑从公开图像库补，
  并遵守各库的授权条款。</li>
  <li><b>正文</b>——AI 生成初稿，编辑校对修改后发布。完整的科普详页在撰写时会联网检索
  该物种的研究进展与媒体报道，并在页尾列出名录与数据依据。</li>
  <li><b>名录数据</b>——来自国家 / 省级重点保护名录、IUCN、CITES、GTS、GRIIS 等公开名录，
  存在站内按学名匹配。</li>
</ul>

<h4>发现错了</h4>
<ol>
  <li><b>任何人</b>：在条目下留言指出，编辑会看到。</li>
  <li><b>编辑</b>：直接改。改动会记进 Log，署你的名。</li>
  <li><b>改错了</b>：管理员可以撤销任何一次改动，把内容退回改动前的样子。</li>
</ol>

<h4>我们承认的局限</h4>
<ul>
  <li>AI 会出错，尤其是相似种、幼苗、只有一个器官的照片。<b>标着"疑似"的就是没把握。</b></li>
  <li>配图缺失和配图错配是目前最主要的质量问题，正在持续补。</li>
  <li>名录是快照，不是实时的；权威判断请以官方发布为准。</li>
  <li><b>再说一次：不要拿这里的任何内容当作食用或药用的依据。</b></li>
</ul>
`,
  ),
];

export const DEFAULT_ABOUT: AboutDoc = {
  sections: DEFAULT_SECTIONS,
  updatedAt: null,
  updatedBy: null,
};

/**
 * 把库里读出来的任意形态收敛成一份规整的 AboutDoc。存过的旧数据缺字段、
 * 章节被删空、甚至整个值是字符串，都不该让页面白屏 —— 兜底回默认稿。
 */
export function readAboutDoc(raw: unknown): AboutDoc {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return DEFAULT_ABOUT;
    }
  }
  if (!v || typeof v !== "object") return DEFAULT_ABOUT;
  const obj = v as Partial<AboutDoc>;
  const list = Array.isArray(obj.sections) ? obj.sections : [];
  const sections = list
    .filter((s): s is AboutSection => !!s && typeof s === "object" && typeof s.id === "string")
    .map((s) => ({
      id: s.id,
      zh: typeof s.zh === "string" ? s.zh : s.id,
      en: typeof s.en === "string" ? s.en : "",
      level: s.level === 1 ? (1 as const) : (2 as const),
      kind: s.kind === "matrix" ? ("matrix" as const) : ("prose" as const),
      html: typeof s.html === "string" ? s.html : "",
    }));
  if (!sections.length) return DEFAULT_ABOUT;
  return {
    sections,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : null,
    updatedBy: typeof obj.updatedBy === "string" ? obj.updatedBy : null,
  };
}

/** 三栏对照表的一行；`group` 行只有标题。 */
export type MatrixRow =
  | { group: string }
  | { label: string; guest: string; user: string; editor: string };

/** 解析 kind="matrix" 的纯文本表。忍受多余空格与空行。 */
export function parseMatrix(text: string): MatrixRow[] {
  const out: MatrixRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      out.push({ group: line.slice(1).trim() });
      continue;
    }
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    out.push({ label: cells[0], guest: cells[1], user: cells[2], editor: cells[3] });
  }
  return out;
}
