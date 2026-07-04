-- Seed: 四川（2024） 省级重点保护野生植物名录. province=四川. 19 taxa.
-- Source: 四川省重点保护野生植物名录｜川府发〔2024〕14号｜2024-08-05 发布｜省级重点保护野生植物；四川省人民政府官方文件
DELETE FROM public.conservation_taxa t USING public.conservation_lists l
  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = '四川';
DELETE FROM public.conservation_lists WHERE kind = 'protected' AND province = '四川';
WITH new_list AS (
  INSERT INTO public.conservation_lists (kind, name, province, version, effective_date, source_url, source_note)
  VALUES ('protected', '四川（2024）', '四川', '2024', DATE '2024-08-05', 'https://www.sc.gov.cn/10462/zfwjts/2024/8/9/76ae89dbca9648e39fc28013d3edce18/files/%E5%B7%9D%E5%BA%9C%E5%8F%9114%E5%8F%B7%E5%85%AC%E5%BC%80%E7%89%88.pdf', '四川省重点保护野生植物名录｜川府发〔2024〕14号｜2024-08-05 发布｜省级重点保护野生植物；四川省人民政府官方文件')
  RETURNING id
)
INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)
SELECT nl.id, v.sci, v.norm, v.zh, '省级', v.rank, NULL::text[] FROM new_list nl, (VALUES
  ('Juniperus erectopatens (W.C.Cheng & L.K.Fu) R.P.Adams', 'juniperus erectopatens', '松潘圆柏', 'species'),
  ('Picea likiangensis var. montigena (Mast.) Cheng ex Chen', 'picea likiangensis', '康定云杉', 'species'),
  ('Yulania dawsoniana (Rehder & E. H. Wilson) D. L. Fu', 'yulania dawsoniana', '康定木兰', 'species'),
  ('Machilus salicoides S. K. Lee', 'machilus salicoides', '华蓥润楠', 'species'),
  ('Lilium matangense J. M. Xu', 'lilium matangense', '马塘百合', 'species'),
  ('Lilium xanthellum F. T. Wang & Tang', 'lilium xanthellum', '乡城百合', 'species'),
  ('Holcoglossum omeiense Z. H. Tsi ex X. H. Jin & S. C. Chen', 'holcoglossum omeiense', '峨眉槽舌兰', 'species'),
  ('Heteropolygonatum pendulum (Z. G. Liu & X. H. Hu) M. N. Tamura & Ogisu', 'heteropolygonatum pendulum', '垂茎异黄精', 'species'),
  ('Yushania cava T. P. Yi', 'yushania cava', '空柄玉山竹', 'species'),
  ('Corydalis acropteryx Fedde', 'corydalis acropteryx', '松潘黄堇', 'species'),
  ('Urophysa rockii Ulbr.', 'urophysa rockii', '距瓣尾囊草', 'species'),
  ('Euonymus aquifolium Loesener & Rehder', 'euonymus aquifolium', '尖齿卫矛', 'species'),
  ('Acer sutchuenense Franch.', 'acer sutchuenense', '四川槭', 'species'),
  ('Abelmoschus muliensis Feng', 'abelmoschus muliensis', '木里秋葵', 'species'),
  ('Camellia luteoflora Y. K. Li ex Hung T. Chang & F. A. Zeng', 'camellia luteoflora', '小黄花茶', 'species'),
  ('Rhododendron adenosum Davidian', 'rhododendron adenosum', '枯鲁杜鹃', 'species'),
  ('Rhododendron nymphaeoides W. K. Hu', 'rhododendron nymphaeoides', '睡莲叶杜鹃', 'species'),
  ('Aucuba chinensis Benth. subsp. omeiensis (Fang) Fang et Soong', 'aucuba chinensis', '峨眉桃叶珊瑚', 'species'),
  ('Gmelina szechwanensis K. Yao', 'gmelina szechwanensis', '四川石梓', 'species')
) AS v(sci, norm, zh, rank);
