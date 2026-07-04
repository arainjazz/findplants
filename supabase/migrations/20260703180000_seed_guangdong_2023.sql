-- Seed: 广东（2023） 省级重点保护野生植物名录. province=广东. 39 taxa.
-- Source: 广东省重点保护野生植物名录｜粤府函〔2023〕30号｜2023-03-17 发布｜省级重点保护野生植物；广东省人民政府官方文件及附件
DELETE FROM public.conservation_taxa t USING public.conservation_lists l
  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = '广东';
DELETE FROM public.conservation_lists WHERE kind = 'protected' AND province = '广东';
WITH new_list AS (
  INSERT INTO public.conservation_lists (kind, name, province, version, effective_date, source_url, source_note)
  VALUES ('protected', '广东（2023）', '广东', '2023', DATE '2023-03-17', 'https://www.gd.gov.cn/xxts/content/post_4142096.html', '广东省重点保护野生植物名录｜粤府函〔2023〕30号｜2023-03-17 发布｜省级重点保护野生植物；广东省人民政府官方文件及附件')
  RETURNING id
)
INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)
SELECT nl.id, v.sci, v.norm, v.zh, '省级', v.rank, NULL::text[] FROM new_list nl, (VALUES
  ('Dipteris chinensis', 'dipteris chinensis', '中华双扇蕨', 'species'),
  ('Nothotsuga longibracteata', 'nothotsuga longibracteata', '长苞铁杉', 'species'),
  ('Nageia fleuryi', 'nageia fleuryi', '长叶竹柏', 'species'),
  ('Cephalotaxus latifolia', 'cephalotaxus latifolia', '宽叶粗榧', 'species'),
  ('Nymphaea tetragona', 'nymphaea tetragona', '睡莲', 'species'),
  ('Asarum magnificum var. dinghuense', 'asarum magnificum', '鼎湖细辛', 'species'),
  ('Manglietia longipedunculata', 'manglietia longipedunculata', '长梗木莲', 'species'),
  ('Michelia odora', 'michelia odora', '观光木', 'species'),
  ('Parakmeria lotungensis', 'parakmeria lotungensis', '乐东拟单性木兰', 'species'),
  ('Cinnamomum micranthum', 'cinnamomum micranthum', '沉水樟', 'species'),
  ('Nepenthes mirabilis', 'nepenthes mirabilis', '猪笼草', 'species'),
  ('Bulbophyllum ambrosia', 'bulbophyllum ambrosia', '芳香石豆兰', 'species'),
  ('Bulbophyllum bicolor', 'bulbophyllum bicolor', '二色卷瓣兰', 'species'),
  ('Bulbophyllum kwangtungense', 'bulbophyllum kwangtungense', '广东石豆兰', 'species'),
  ('Bulbophyllum odoratissimum', 'bulbophyllum odoratissimum', '密花石豆兰', 'species'),
  ('Calanthe lechangensis', 'calanthe lechangensis', '乐昌虾脊兰', 'species'),
  ('Pholidota cantonensis', 'pholidota cantonensis', '细叶石仙桃', 'species'),
  ('Pholidota chinensis', 'pholidota chinensis', '石仙桃', 'species'),
  ('Vanda fuscoviridis', 'vanda fuscoviridis', '广东万代兰', 'species'),
  ('Orchidantha chinensis', 'orchidantha chinensis', '兰花蕉', 'species'),
  ('Alpinia conghuaensis', 'alpinia conghuaensis', '从化山姜', 'species'),
  ('Hornstedtia hainanensis', 'hornstedtia hainanensis', '大豆蔻', 'species'),
  ('Semiliquidambar cathayensis', 'semiliquidambar cathayensis', '半枫荷', 'species'),
  ('Itea yangchunensis', 'itea yangchunensis', '阳春鼠刺', 'species'),
  ('Vitis ruyuanensis', 'vitis ruyuanensis', '乳源葡萄', 'species'),
  ('Aganope dinghuensis', 'aganope dinghuensis', '鼎湖双束鱼藤', 'species'),
  ('Antiaris toxicaria', 'antiaris toxicaria', '见血封喉', 'species'),
  ('Begonia fimbristipula', 'begonia fimbristipula', '紫背天葵', 'species'),
  ('Lagerstroemia fordii', 'lagerstroemia fordii', '广东紫薇', 'species'),
  ('Diospyros danxiaensis', 'diospyros danxiaensis', '丹霞柿', 'species'),
  ('Diospyros vaccinioides', 'diospyros vaccinioides', '小果柿', 'species'),
  ('Ardisia kteniophylla', 'ardisia kteniophylla', '走马胎', 'species'),
  ('Primula kwangtungensis', 'primula kwangtungensis', '广东报春', 'species'),
  ('Camellia granthamiana', 'camellia granthamiana', '大苞白山茶', 'species'),
  ('Halesia macgregorii', 'halesia macgregorii', '银钟花', 'species'),
  ('Rhododendron datiandingense', 'rhododendron datiandingense', '大田顶杜鹃', 'species'),
  ('Nauclea officinalis', 'nauclea officinalis', '乌檀', 'species'),
  ('Caryopteris alternifolia', 'caryopteris alternifolia', '潮州莸', 'species'),
  ('Ilex xiaojinensis', 'ilex xiaojinensis', '小金冬青', 'species')
) AS v(sci, norm, zh, rank);
