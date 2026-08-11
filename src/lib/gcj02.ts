/**
 * WGS-84 ↔ GCJ-02（「火星坐标」）互转。
 *
 * ## 为什么非有不可
 * 我们库里的 `capture_lat/lng` 来自照片 EXIF，是 **WGS-84**（GPS 原始基准）。
 * 而中国境内的地图服务（高德、腾讯、百度）一律收 **GCJ-02** —— 国家规定的加密偏移基准。
 * 把 WGS-84 直接塞进高德 regeo，返回的是**偏移 50–500 m 之外**那个地方的地名。
 *
 * 这件事在本项目里尤其致命：换国内地理编码的**唯一目的**就是把相距 80 m 的几份观测
 * 分开（猪毛蒿那 5 份）。偏移量比要分辨的距离还大一个量级 —— 不转换的话，换了高德
 * 不但没变准，还会理直气壮地给出错的 POI 名，比现在只到街道更糟。
 *
 * ## 算法
 * 业界通用的那套近似式（源自公开的 GCJ-02 偏移逆向）。境外坐标原样返回 ——
 * 偏移只在中国大陆施加，对境外点做转换反而会把正确坐标弄歪。
 * 逆变换用两次迭代逼近（一次约差 1–2 m，两次进到亚米级），够我们用。
 */

const A = 6378245.0; // 克拉索夫斯基椭球长半轴（GCJ-02 沿用这个，不是 WGS-84 的 6378137）
// 第一偏心率平方。原始常数写作 0.00669342162296594323，但 double 存不下那么多位，
// 这里直接写它实际被舍入成的值 —— 免得看着像高精度、其实编译器早就截断了（eslint 也会报）。
const EE = 0.006693421622965943;

/**
 * 是否在「需要偏移」的范围外。
 * 这是个粗矩形，不是国界 —— 官方偏移算法本身就按粗范围施加，边境上无所谓精确。
 */
function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** 偏移量（度）。GCJ = WGS + delta。 */
function delta(lat: number, lng: number): { dLat: number; dLng: number } {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { dLat, dLng };
}

/** WGS-84（EXIF / GPS）→ GCJ-02（高德、腾讯收的那个）。境外原样返回。 */
export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  const { dLat, dLng } = delta(lat, lng);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * GCJ-02 → WGS-84。两次迭代逼近 —— 偏移量本身是坐标的函数，没有解析逆。
 * 我们目前只用到正向（库里存 WGS-84、发给高德要 GCJ-02），逆向留着是为了
 * 万一哪天要把高德回的坐标存回库里，别再有人现推一遍。
 */
export function gcj02ToWgs84(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  let wgsLat = lat;
  let wgsLng = lng;
  for (let i = 0; i < 2; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLng);
    wgsLat += lat - g.lat;
    wgsLng += lng - g.lng;
  }
  return { lat: wgsLat, lng: wgsLng };
}
