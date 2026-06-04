import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { RegionPicker } from "@/components/region-picker";
import { useAuth } from "@/hooks/use-auth";
import { parseCatalogText, createCatalog } from "@/lib/catalogs";
import { fillChineseNames } from "@/lib/catalog-ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/catalogs/new")({
  component: NewCatalog,
});

function NewCatalog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const aiFill = useServerFn(fillChineseNames);

  const [region, setRegion] = useState({ province: "", city: "", county: "" });
  const [pasted, setPasted] = useState("");
  const [source, setSource] = useState("");
  const [contributor, setContributor] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!user) return;
    if (!region.province) return toast.error("请至少选择省份");
    if (!source.trim()) return toast.error("请填写目录来源");
    if (!contributor.trim()) return toast.error("请填写添加者姓名");
    const entries = parseCatalogText(pasted);
    if (entries.length === 0) return toast.error("目录内容为空");
    if (entries.some((e) => !/[A-Za-z]/.test(e.scientific_name))) {
      return toast.error("每行必须包含植物学名（拉丁名）");
    }
    setBusy(true);
    try {
      // Try to fill missing Chinese names via AI (non-fatal if it fails)
      let final = entries;
      let aiUsed = false;
      try {
        const out = await aiFill({ data: { entries } });
        if (out?.entries) { final = out.entries; aiUsed = true; }
      } catch {
        // ignore
      }
      const cat = await createCatalog(
        {
          province: region.province,
          city: region.city || null,
          county: region.county || null,
          source: source.trim(),
          contributor_name: contributor.trim(),
          entries: final,
        },
        user.id,
        contributor.trim(),
        aiUsed
          ? "ai:google/gemini-3-flash-preview@lovable-ai+catalog_editor"
          : "catalog_editor",
      );
      toast.success(`已创建目录，共 ${final.length} 条`);
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      navigate({ to: "/admin/catalogs/$id", params: { id: cat.id } });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4">
          <p className="label text-vermilion mb-2">Regional Catalog</p>
          <h1 className="font-display text-4xl font-bold">+ 新建地区植物目录</h1>
          <p className="text-ink-faint mt-2 text-sm">
            支持中华人民共和国（含港澳台）的省 / 市 / 县。其他编辑可向你创建的目录补充条目，但只有你和管理员可以删除整个目录或他人补充的条目。
          </p>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="label mb-2">① 地区</h2>
            <RegionPicker
              province={region.province}
              city={region.city}
              county={region.county}
              onChange={setRegion}
            />
          </section>

          <section>
            <h2 className="label mb-2">② 粘贴目录内容</h2>
            <p className="text-xs text-ink-faint mb-2">
              每行一个条目，必须包含植物学名（拉丁名）。如：
              <code className="ml-1">花蔺 Butomus umbellatus</code> 或
              <code className="ml-1">Butomus umbellatus L.</code>。缺少中文名时将由 AI 自动补全。
            </p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={12}
              className="w-full border border-ink p-3 bg-transparent font-mono text-sm focus:outline-none focus:border-vermilion"
              placeholder={"花蔺  Butomus umbellatus\nNymphaea tetragona  睡莲\n..."}
            />
          </section>

          <section>
            <h2 className="label mb-2">③ 来源</h2>
            <p className="text-xs text-ink-faint mb-2">书籍：书名 + 作者；网站：网站名称 + 目录页链接</p>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full border border-ink px-3 py-2 bg-transparent text-sm focus:outline-none focus:border-vermilion"
              placeholder="例：《中国植物志》第八卷 · 编者 ××"
            />
          </section>

          <section>
            <h2 className="label mb-2">④ 添加者姓名</h2>
            <p className="text-xs text-ink-faint mb-2">若代表某机构，请注明所代表的机构名称</p>
            <input
              value={contributor}
              onChange={(e) => setContributor(e.target.value)}
              className="w-full border border-ink px-3 py-2 bg-transparent text-sm focus:outline-none focus:border-vermilion"
              placeholder="例：王某某（××大学植物学系）"
            />
          </section>

          <div className="flex justify-end gap-2 pt-2 border-t border-rule">
            <button
              type="button"
              onClick={() => navigate({ to: "/admin" })}
              className="border border-ink px-4 py-2 text-sm hover:bg-paper-deep"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSubmit}
              className="bg-ink text-background px-5 py-2 text-sm hover:bg-vermilion disabled:opacity-60"
            >
              {busy ? "提交中…" : "✓ 确认提交"}
            </button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}