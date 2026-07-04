-- Seed: 贵州（2023） 省级重点保护野生植物名录. province=贵州. 56 taxa.
-- Source: 贵州省重点保护野生植物名录｜黔府发〔2023〕17号｜2023-11-28 发布｜省级重点保护野生植物；贵州省人民政府官方文件；附件表格内容与公开转录页交叉核对
DELETE FROM public.conservation_taxa t USING public.conservation_lists l
  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = '贵州';
DELETE FROM public.conservation_lists WHERE kind = 'protected' AND province = '贵州';
WITH new_list AS (
  INSERT INTO public.conservation_lists (kind, name, province, version, effective_date, source_url, source_note)
  VALUES ('protected', '贵州（2023）', '贵州', '2023', DATE '2023-11-28', 'https://www.guizhou.gov.cn/zwgk/zcfg/szfwj/qff/202312/t20231204_83177170.html', '贵州省重点保护野生植物名录｜黔府发〔2023〕17号｜2023-11-28 发布｜省级重点保护野生植物；贵州省人民政府官方文件；附件表格内容与公开转录页交叉核对')
  RETURNING id
)
INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)
SELECT nl.id, v.sci, v.norm, v.zh, '省级', v.rank, NULL::text[] FROM new_list nl, (VALUES
  ('Ganoderma sinense', 'ganoderma sinense', '紫芝', 'species'),
  ('Bryoxiphium norvegicum', 'bryoxiphium norvegicum', '虾藓', 'species'),
  ('Rhodobryum giganteum', 'rhodobryum giganteum', '暖地大叶藓', 'species'),
  ('Rhodobryum roseum', 'rhodobryum roseum', '大叶藓', 'species'),
  ('Psilotum nudum', 'psilotum nudum', '松叶蕨', 'species'),
  ('Asplenium delavayi', 'asplenium delavayi', '水鳖蕨', 'species'),
  ('Nothotsuga longibracteata', 'nothotsuga longibracteata', '长苞铁杉', 'species'),
  ('Tsuga chinensis', 'tsuga chinensis', '铁杉', 'species'),
  ('Juniperus squamata', 'juniperus squamata', '高山柏', 'species'),
  ('Cephalotaxus fortunei', 'cephalotaxus fortunei', '三尖杉', 'species'),
  ('Cephalotaxus latifolia', 'cephalotaxus latifolia', '宽叶粗榧', 'species'),
  ('Cephalotaxus sinensis', 'cephalotaxus sinensis', '粗榧', 'species'),
  ('Kadsura coccinea', 'kadsura coccinea', '黑老虎', 'species'),
  ('Manglietia glaucifolia', 'manglietia glaucifolia', '苍背木莲', 'species'),
  ('Manglietia insignis', 'manglietia insignis', '红花木莲', 'species'),
  ('Michelia angustioblonga', 'michelia angustioblonga', '狭叶含笑', 'species'),
  ('Michelia crassipes', 'michelia crassipes', '紫花含笑', 'species'),
  ('Michelia odora', 'michelia odora', '观光木', 'species'),
  ('Oyama sieboldii', 'oyama sieboldii', '天女花', 'species'),
  ('Parakmeria lotungensis', 'parakmeria lotungensis', '乐东拟单性木兰', 'species'),
  ('Syndiclis anlungensis', 'syndiclis anlungensis', '安龙油果樟', 'species'),
  ('Aristolochia tuberosa', 'aristolochia tuberosa', '背蛇生', 'species'),
  ('Arisaema decipiens', 'arisaema decipiens', '奇异南星', 'species'),
  ('Bletilla formosana', 'bletilla formosana', '小白及', 'species'),
  ('Bletilla ochracea', 'bletilla ochracea', '黄花白及', 'species'),
  ('Geodorum eulophioides', 'geodorum eulophioides', '贵州地宝兰', 'species'),
  ('Corybas fanjingshanensis', 'corybas fanjingshanensis', '梵净山铠兰', 'species'),
  ('Polygonatum cyrtonema', 'polygonatum cyrtonema', '多花黄精', 'species'),
  ('Tinospora sagittata', 'tinospora sagittata', '青牛胆', 'species'),
  ('Semiliquidambar cathayensis', 'semiliquidambar cathayensis', '半枫荷', 'species'),
  ('Sedum fanjingshanensis', 'sedum fanjingshanensis', '梵净山景天', 'species'),
  ('Cyclocarya paliurus', 'cyclocarya paliurus', '青钱柳', 'species'),
  ('Cleidiocarpon cavaleriei', 'cleidiocarpon cavaleriei', '蝴蝶果', 'species'),
  ('Lagerstroemia caudata', 'lagerstroemia caudata', '尾叶紫薇', 'species'),
  ('Lagerstroemia excelsa', 'lagerstroemia excelsa', '川黔紫薇', 'species'),
  ('Acer shihweii', 'acer shihweii', '平坝槭', 'species'),
  ('Amesiodendron chinense', 'amesiodendron chinense', '细子龙', 'species'),
  ('Dipteronia sinensis', 'dipteronia sinensis', '金钱槭', 'species'),
  ('Hibiscus labordei', 'hibiscus labordei', '贵州芙蓉', 'species'),
  ('Diplopanax stachyanthus', 'diplopanax stachyanthus', '马蹄参', 'species'),
  ('Impatiens chishuiensis', 'impatiens chishuiensis', '赤水凤仙花', 'species'),
  ('Diospyros cathayensis', 'diospyros cathayensis', '乌柿', 'species'),
  ('Primula fangingensis', 'primula fangingensis', '梵净报春', 'species'),
  ('Androsace medifissa', 'androsace medifissa', '梵净山点地梅', 'species'),
  ('Camellia anlungensis', 'camellia anlungensis', '安龙瘤果茶', 'species'),
  ('Camellia luteoflora', 'camellia luteoflora', '小黄花茶', 'species'),
  ('Camellia mairei var. lapidea', 'camellia mairei', '石果毛蕊山茶', 'species'),
  ('Camellia reticulata', 'camellia reticulata', '滇山茶', 'species'),
  ('Stewartia sinensis', 'stewartia sinensis', '紫茎', 'species'),
  ('Perkinsiodendron macgregprii', 'perkinsiodendron macgregprii', '银钟花', 'species'),
  ('Rehderodendron kweichowense', 'rehderodendron kweichowense', '贵州木瓜红', 'species'),
  ('Rehderodendron macrocarpum', 'rehderodendron macrocarpum', '木瓜红', 'species'),
  ('Rhododendron liboense', 'rhododendron liboense', '荔波杜鹃', 'species'),
  ('Ilex qianlingshanensis', 'ilex qianlingshanensis', '黔灵山冬青', 'species'),
  ('Codonopsis argentea', 'codonopsis argentea', '银背叶党参', 'species'),
  ('Bupleurum kweichowense', 'bupleurum kweichowense', '贵州柴胡', 'species')
) AS v(sci, norm, zh, rank);
