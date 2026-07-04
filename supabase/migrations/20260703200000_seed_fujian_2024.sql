-- Seed: 福建（2024） 省级重点保护野生植物名录. province=福建. 38 taxa.
-- Source: 福建省重点保护野生植物名录｜福建省林业局、福建省农业农村厅公告｜2024-01-29 发布｜省级重点保护野生植物；福建省林业局官方公告及正文表格
DELETE FROM public.conservation_taxa t USING public.conservation_lists l
  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = '福建';
DELETE FROM public.conservation_lists WHERE kind = 'protected' AND province = '福建';
WITH new_list AS (
  INSERT INTO public.conservation_lists (kind, name, province, version, effective_date, source_url, source_note)
  VALUES ('protected', '福建（2024）', '福建', '2024', DATE '2024-01-29', 'https://lyj.fujian.gov.cn/zwgk/zygl/202402/t20240204_6392090.htm', '福建省重点保护野生植物名录｜福建省林业局、福建省农业农村厅公告｜2024-01-29 发布｜省级重点保护野生植物；福建省林业局官方公告及正文表格')
  RETURNING id
)
INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)
SELECT nl.id, v.sci, v.norm, v.zh, '省级', v.rank, NULL::text[] FROM new_list nl, (VALUES
  ('Sceptridium japonicum', 'sceptridium japonicum', '华东阴地蕨', 'species'),
  ('Sceptridium ternatum', 'sceptridium ternatum', '阴地蕨', 'species'),
  ('Lomagramma sorbifolia', 'lomagramma sorbifolia', '网藤蕨', 'species'),
  ('Cephalotaxus latifolia', 'cephalotaxus latifolia', '宽叶粗榧', 'species'),
  ('Cephalotaxus sinensis', 'cephalotaxus sinensis', '粗榧', 'species'),
  ('Nymphaea tetragona', 'nymphaea tetragona', '睡莲', 'species'),
  ('Michelia compressa', 'michelia compressa', '台湾含笑', 'species'),
  ('Michelia fujianensis', 'michelia fujianensis', '福建含笑', 'species'),
  ('Oyama sieboldii', 'oyama sieboldii', '天女花', 'species'),
  ('Parakmeria lotungenesis', 'parakmeria lotungenesis', '乐东拟单性木兰', 'species'),
  ('Yulania cylindrica', 'yulania cylindrica', '黄山玉兰', 'species'),
  ('Machilus minkweiensis', 'machilus minkweiensis', '闽桂润楠', 'species'),
  ('Semiliquidambar caudata', 'semiliquidambar caudata', '长尾半枫荷', 'species'),
  ('Semiliquidambar chingii', 'semiliquidambar chingii', '细柄半枫荷', 'species'),
  ('Distylium chungii', 'distylium chungii', '闽粤蚊母树', 'species'),
  ('Hamamelis mollis', 'hamamelis mollis', '金缕梅', 'species'),
  ('Maddenia fujianensis', 'maddenia fujianensis', '福建假稠李', 'species'),
  ('Hibiscus hamabo', 'hibiscus hamabo', '海滨木槿', 'species'),
  ('Elaeagnus grijsii', 'elaeagnus grijsii', '多毛羊奶子', 'species'),
  ('Cyclobalanopsis yonganensis', 'cyclobalanopsis yonganensis', '永安青冈', 'species'),
  ('Lithocarpus yongfuensis', 'lithocarpus yongfuensis', '永福柯', 'species'),
  ('Quercus elevaticostata', 'quercus elevaticostata', '突脉青冈', 'species'),
  ('Juglans mandshurica', 'juglans mandshurica', '胡桃楸', 'species'),
  ('Ixonanthes reticulata', 'ixonanthes reticulata', '黏木', 'species'),
  ('Lagerstroemia limii', 'lagerstroemia limii', '福建紫薇', 'species'),
  ('Syzygium album', 'syzygium album', '白果蒲桃', 'species'),
  ('Tapiscia sinensis', 'tapiscia sinensis', '瘿椒树', 'species'),
  ('Toxicodendron oligophyllum', 'toxicodendron oligophyllum', '少叶漆', 'species'),
  ('Schoepfia chinensis', 'schoepfia chinensis', '华南青皮木', 'species'),
  ('Hydrangea chungii', 'hydrangea chungii', '福建绣球', 'species'),
  ('Polyspora axillaris', 'polyspora axillaris', '大头茶', 'species'),
  ('Symplocos fukienensis', 'symplocos fukienensis', '福建山矾', 'species'),
  ('Perkinsiodendron macgregorii', 'perkinsiodendron macgregorii', '银钟花', 'species'),
  ('Actinidia callosa var. henryi', 'actinidia callosa', '京梨猕猴桃', 'species'),
  ('Actinidia fulvicoma', 'actinidia fulvicoma', '黄毛猕猴桃', 'species'),
  ('Pyrola calliantha', 'pyrola calliantha', '鹿蹄草', 'species'),
  ('Rhododendron wuyishanicum', 'rhododendron wuyishanicum', '武夷杜鹃', 'species'),
  ('Trapella sinensis', 'trapella sinensis', '茶菱', 'species')
) AS v(sci, norm, zh, rank);
