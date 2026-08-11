/**
 * place-from-amap 的离线断言。用的全是 probe_amap_raw 打回来的**真实**响应片段，
 * 不是我编的形状 —— 这一层踩过的坑（空数组、住宅名外溢、多个 AOI 叠在一起）
 * 都在下面各占一条。
 *
 *   node --experimental-strip-types scratch/test_place_from_amap.mjs
 */
import { placeFromAmapRegeo } from "../src/lib/place-from-amap.ts";

const KBS = { province: "内蒙古自治区", city: "鄂尔多斯市", district: "康巴什区", township: "哈巴格希街道" };

const cases = [
  [
    "住宅小区 → 退回街道级（不能写和悦云锦）",
    {
      addressComponent: KBS,
      aois: [{ name: "和悦云锦", type: "120302", distance: "0" }],
      pois: [
        { name: "和悦云锦", type: "商务住宅;住宅区;住宅小区", distance: "177.828" },
        { name: "和悦云锦12栋", type: "地名地址信息;门牌信息;楼栋号", distance: "41.0428" },
      ],
    },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道",
  ],
  [
    "沾着小区名的非住宅 POI 也要拦（和悦云锦接待中心）",
    {
      addressComponent: KBS,
      aois: [{ name: "和悦云锦", type: "120302", distance: "0" }],
      pois: [
        { name: "和悦云锦", type: "商务住宅;住宅区;住宅小区", distance: "203.047" },
        { name: "和悦云锦接待中心", type: "生活服务;生活服务场所;生活服务场所", distance: "30.3462" },
      ],
    },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道",
  ],
  [
    "三个住宅 AOI 叠在一起，仍不能漏；产业园区 POI 可用",
    {
      addressComponent: { ...KBS, township: "鄂尔多斯市康巴什产业园" },
      aois: [
        { name: "悦和城", type: "120302", distance: "0" },
        { name: "康巴什北区公租房", type: "120000", distance: "0" },
        { name: "万和城", type: "120302", distance: "0" },
      ],
      pois: [
        { name: "悦和城", type: "商务住宅;住宅区;住宅小区", distance: "117.49" },
        { name: "鄂尔多斯国家高新技术产业开发区", type: "商务住宅;产业园区;产业园区", distance: "118.026" },
        { name: "百姓饭店(悦和城店)", type: "餐饮服务;中餐厅;中餐厅", distance: "119.82" },
      ],
    },
    "内蒙古自治区鄂尔多斯市康巴什区康巴什产业园·鄂尔多斯国家高新技术产业开发区",
  ],
  [
    "景区 AOI 照常保留",
    {
      addressComponent: { province: "内蒙古自治区", city: "鄂尔多斯市", district: "伊金霍洛旗", township: "伊金霍洛镇" },
      aois: [{ name: "圣水草原", type: "110200", distance: "17.3424" }],
      pois: [
        { name: "圣水草原", type: "风景名胜;风景名胜;风景名胜", distance: "72.5137" },
        { name: "圣水草原(入口)", type: "通行设施;临街院门;临街院正门", distance: "21.3988" },
      ],
    },
    "内蒙古自治区鄂尔多斯市伊金霍洛旗伊金霍洛镇·圣水草原",
  ],
  [
    "没有 AOI 时，院门不算地点，退到景区本体（消掉『(入口)』那种分身）",
    {
      addressComponent: { province: "内蒙古自治区", city: "鄂尔多斯市", district: "伊金霍洛旗", township: "伊金霍洛镇" },
      aois: [],
      pois: [
        { name: "圣水草原(入口)", type: "通行设施;临街院门;临街院正门", distance: "21.3988" },
        { name: "圣水草原", type: "风景名胜;风景名胜;风景名胜", distance: "72.5137" },
      ],
    },
    "内蒙古自治区鄂尔多斯市伊金霍洛旗伊金霍洛镇·圣水草原",
  ],
  [
    "整片都是住宅 → 只剩街道（东莞那种）",
    {
      addressComponent: { province: "广东省", city: "东莞市", district: [], township: "凤岗镇" },
      aois: [],
      pois: [
        { name: "忠和楼", type: "商务住宅;住宅区;住宅小区", distance: "115.995" },
        { name: "嘉奥楼", type: "商务住宅;住宅区;住宅区", distance: "163.839" },
      ],
    },
    "广东省东莞市凤岗镇",
  ],
  [
    "POI 太远（>150m）不采用",
    {
      addressComponent: KBS,
      aois: [],
      pois: [{ name: "某某公园", type: "风景名胜;公园广场;公园", distance: "480" }],
    },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道",
  ],
  [
    "distance 缺失不能当 0",
    {
      addressComponent: KBS,
      aois: [],
      pois: [{ name: "不知多远的地方", type: "风景名胜;公园广场;公园", distance: [] }],
    },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道",
  ],
  [
    "直辖市：city 为空数组，别拼出空洞",
    { addressComponent: { province: "北京市", city: [], district: "海淀区", township: "中关村街道" }, aois: [], pois: [] },
    "北京市海淀区中关村街道",
  ],
  [
    "商户不算地点：拉面馆/诊所退回街道级",
    {
      addressComponent: { ...KBS, township: "青春山街道" },
      aois: [],
      pois: [
        { name: "隆升源美味牛肉拉面(珠江店)", type: "餐饮服务;中餐厅;中餐厅", distance: "30" },
        { name: "海川口腔", type: "医疗保健服务;专科医院;口腔医院", distance: "50" },
        { name: "鄂尔多斯森凯威酒店", type: "住宿服务;宾馆酒店;宾馆酒店", distance: "60" },
      ],
    },
    "内蒙古自治区鄂尔多斯市康巴什区青春山街道",
  ],
  [
    "高速服务区要留（路边采集全靠它）",
    {
      addressComponent: { province: "湖南省", city: "衡阳市", district: "衡阳县", township: "杉桥镇" },
      aois: [],
      pois: [{ name: "高真寺服务区(许广高速广州方向)", type: "交通设施服务;服务区;服务区", distance: "40" }],
    },
    "湖南省衡阳市衡阳县杉桥镇·高真寺服务区(许广高速广州方向)",
  ],
  [
    "湿地公园要留",
    {
      addressComponent: { province: "广东省", city: "深圳市", district: "南山区", township: "沙河街道" },
      aois: [{ name: "广东深圳华侨城国家湿地公园", type: "110101", distance: "0" }],
      pois: [],
    },
    "广东省深圳市南山区沙河街道·广东深圳华侨城国家湿地公园",
  ],
  [
    "机构不是地点：办公室退回街道级（真·漏网的那份假蒿）",
    {
      addressComponent: { province: "广东省", city: "深圳市", district: "龙岗区", township: "龙城街道" },
      aois: [],
      pois: [
        { name: "龙岗区龙城工业园安全文明小区办公室", type: "地名地址信息;普通地名;普通地名", distance: "40" },
      ],
    },
    "广东省深圳市龙岗区龙城街道",
  ],
  [
    "培训机构是生意，不算校园",
    {
      addressComponent: { province: "广东省", city: "东莞市", district: [], township: "凤岗镇" },
      aois: [],
      pois: [{ name: "厚德教育", type: "科教文化服务;培训机构;培训机构", distance: "35" }],
    },
    "广东省东莞市凤岗镇",
  ],
  [
    "真学校照常保留",
    {
      addressComponent: { ...KBS, township: "青春山街道" },
      aois: [],
      pois: [{ name: "康巴什第二中学", type: "科教文化服务;学校;中学", distance: "60" }],
    },
    "内蒙古自治区鄂尔多斯市康巴什区青春山街道·康巴什第二中学",
  ],
  ["空对象", {}, ""],
  ["null", null, ""],
];

let bad = 0;
for (const [name, input, want] of cases) {
  const got = placeFromAmapRegeo(input);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}\n     → ${JSON.stringify(got)}${ok ? "" : `\n     期望 ${JSON.stringify(want)}`}`);
}
console.log(bad ? `\n❌ ${bad} 条不符` : `\n✅ ${cases.length} 条全部通过`);
process.exit(bad ? 1 : 0);
