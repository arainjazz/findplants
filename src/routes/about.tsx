import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { RichEditor } from "@/components/rich-editor";
import { compressImage, extForMime } from "@/lib/image-compress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isOwnerEmail } from "@/lib/leaves";
import { getAboutFn, saveAboutFn, resetAboutFn } from "@/lib/about.functions";
import {
  DEFAULT_ABOUT,
  parseMatrix,
  resolveShots,
  type AboutDoc,
  type AboutSection,
} from "@/lib/about-content";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "关于本站 · 使用指南 · Plantspedia" },
      {
        name: "description",
        content:
          "Plantspedia 是一个由社区共同创建和维护的植物百科与参与式植物科考平台。这里说明我们在做什么、为什么做，以及站内每个页面怎么用。",
      },
    ],
  }),
  component: AboutPage,
});

// ─── 正文样式 ────────────────────────────────────────────────────────────────
// 正文是站长可编辑的 HTML，所以样式必须挂在**元素选择器**上（.about-prose p、
// .about-prose ul…），而不是靠写正文时手动加 class —— 站长在富文本编辑器里敲出来的
// 标签是不带 class 的。Tailwind 的 typography 插件没装，这里自己写一份最小的。
const PROSE_CSS = `
.about-prose{color:hsl(var(--ink,0 0% 12%));line-height:1.9;font-size:15px}
.about-prose > *:first-child{margin-top:0}
.about-prose p{margin:0 0 1em}
.about-prose p.lead{font-size:17px;line-height:1.85}
.about-prose b,.about-prose strong{font-weight:600}
.about-prose a{color:var(--vermilion-hex,#c1440e);text-decoration:underline;text-underline-offset:2px}
.about-prose a:hover{opacity:.75}
.about-prose h4{font-size:15px;font-weight:700;margin:1.9em 0 .7em;padding-left:.6em;border-left:3px solid var(--vermilion-hex,#c1440e)}
.about-prose ul,.about-prose ol{margin:0 0 1.1em;padding-left:1.35em}
.about-prose ul{list-style:disc}
.about-prose ol{list-style:decimal}
.about-prose li{margin:.4em 0}
.about-prose li::marker{color:var(--vermilion-hex,#c1440e)}
.about-prose table{width:100%;border-collapse:collapse;margin:0 0 1.3em;font-size:13.5px}
.about-prose th,.about-prose td{border:1px solid rgba(0,0,0,.14);padding:.55em .7em;text-align:left;vertical-align:top}
.about-prose thead th{background:rgba(0,0,0,.045);font-weight:600;white-space:nowrap}
.about-prose figure.shot{margin:1.5em 0;border:1px solid rgba(0,0,0,.14);background:rgba(0,0,0,.02);padding:10px}
.about-prose figure.shot img{display:block;width:100%;height:auto;border:1px solid rgba(0,0,0,.08)}
.about-prose figcaption{margin-top:.6em;font-size:12px;line-height:1.65;color:rgba(0,0,0,.55)}
.about-prose figure.shot.todo .ph{display:flex;align-items:center;justify-content:center;height:130px;
  border:1.5px dashed rgba(0,0,0,.28);color:rgba(0,0,0,.42);font-size:12.5px;letter-spacing:.08em;background:rgba(0,0,0,.02)}
.about-prose .callout{margin:1.3em 0;padding:.85em 1em;border-left:3px solid var(--vermilion-hex,#c1440e);
  background:rgba(0,0,0,.035);font-size:14px}
.about-prose .callout > *:last-child{margin-bottom:0}
.about-prose .callout.warn{border-left-color:#b3600f;background:rgba(221,131,36,.09)}
@media (max-width:640px){
  .about-prose{font-size:14.5px}
  .about-prose table{display:block;overflow-x:auto}
}
`;

// ─── 目录 ────────────────────────────────────────────────────────────────────

function Toc({
  sections,
  activeId,
  onJump,
}: {
  sections: AboutSection[];
  activeId: string;
  onJump: (id: string) => void;
}) {
  return (
    <nav aria-label="目录">
      {sections.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            onClick={() => onJump(s.id)}
            className={[
              "block w-full text-left transition-colors cursor-pointer",
              s.level === 1
                ? "mt-4 first:mt-0 pt-3 border-t border-ink/25 text-[13px] font-semibold"
                : "pl-3 py-[3px] text-[12.5px] leading-snug",
              active ? "text-vermilion font-semibold" : "text-ink-soft hover:text-ink",
            ].join(" ")}
          >
            {s.level === 1 ? (
              <span className="flex flex-col">
                <span className="uppercase tracking-[0.14em] text-[10px] text-vermilion">
                  {s.en}
                </span>
                <span>{s.zh}</span>
              </span>
            ) : (
              <span
                className={active ? "border-l-2 border-vermilion -ml-3 pl-[10px] block" : "block"}
              >
                {s.zh}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ─── 三栏权限对照 ────────────────────────────────────────────────────────────
// 用户 2026-07-31 指定：访客 / 注册用户 / 编辑 三栏。
// 桌面端是一张三列表；窄屏塌成一行一卡（三列并排会挤到读不了）。

const ROLE_COLS = [
  { key: "guest" as const, zh: "访客", en: "Visitor", note: "未登录" },
  { key: "user" as const, zh: "注册用户", en: "Member", note: "登录即可" },
  { key: "editor" as const, zh: "编辑", en: "Editor", note: "审核通过" },
];

function Cell({ v }: { v: string }) {
  if (v === "✓")
    return (
      <span className="text-[#2d6a4f] font-semibold" title="可以">
        ✓
      </span>
    );
  if (v === "—" || v === "-")
    return (
      <span className="text-ink-faint/60" title="不可以">
        —
      </span>
    );
  return <span className="text-[11px] text-[#8a6410]">{v}</span>;
}

function PermissionMatrix({ text }: { text: string }) {
  const rows = useMemo(() => parseMatrix(text), [text]);
  return (
    <div>
      {/* 桌面：三列对照表 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className="text-left font-normal p-0" />
              {ROLE_COLS.map((c) => (
                <th
                  key={c.key}
                  className="w-[15%] min-w-[92px] border-b-2 border-ink/70 pb-2 px-2 text-center align-bottom"
                >
                  <div className="text-[10px] uppercase tracking-[0.14em] text-vermilion">
                    {c.en}
                  </div>
                  <div className="font-semibold">{c.zh}</div>
                  <div className="text-[10.5px] text-ink-faint font-normal">{c.note}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              "group" in r ? (
                <tr key={`g${i}`}>
                  <td
                    colSpan={4}
                    className="pt-5 pb-1.5 text-[11px] uppercase tracking-[0.16em] text-vermilion font-semibold"
                  >
                    {r.group}
                  </td>
                </tr>
              ) : (
                <tr key={`r${i}`} className="border-b border-ink/12">
                  <td className="py-[7px] pr-3">{r.label}</td>
                  {ROLE_COLS.map((c) => (
                    <td key={c.key} className="py-[7px] px-2 text-center">
                      <Cell v={r[c.key]} />
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* 窄屏：一行一卡 */}
      <div className="sm:hidden space-y-1">
        {rows.map((r, i) =>
          "group" in r ? (
            <div
              key={`g${i}`}
              className="pt-4 pb-1 text-[11px] uppercase tracking-[0.16em] text-vermilion font-semibold"
            >
              {r.group}
            </div>
          ) : (
            <div key={`r${i}`} className="border-b border-ink/12 py-2">
              <div className="text-[13.5px] mb-1">{r.label}</div>
              <div className="flex gap-4 text-[12px]">
                {ROLE_COLS.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-1.5">
                    <span className="text-ink-faint">{c.zh}</span>
                    <Cell v={r[c.key]} />
                  </span>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// ─── 单个章节 ────────────────────────────────────────────────────────────────

function SectionBody({ section }: { section: AboutSection }) {
  if (section.kind === "matrix") return <PermissionMatrix text={section.html} />;
  return (
    <div
      className="about-prose"
      // 正文只有站长写得了（写入走 saveAboutFn 的 owner 闸门），与站内条目正文
      // 同样的信任模型。
      dangerouslySetInnerHTML={{ __html: resolveShots(section.html) }}
    />
  );
}

/**
 * 上传一张截图到 `plant-images`，返回公开 URL。与 RichEditor 里的上传走同一个桶、
 * 同一套压缩，只是这里不经过 TipTap（原因见 SectionEditor 顶部那段注释）。
 */
async function uploadShot(file: File, userId: string): Promise<string> {
  let body: Blob | File = file;
  try {
    body = await compressImage(file);
  } catch (err) {
    console.error("[About] 压缩失败，改传原图:", err);
  }
  const ext = extForMime(body.type, file.name.split(".").pop() || "jpg");
  const path = `${userId}/about/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("plant-images").upload(path, body, {
    cacheControl: "3600",
    upsert: false,
    contentType: body.type,
  });
  if (error) throw error;
  return supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
}

/**
 * 逐节编辑器。
 *
 * 🔴 **正文默认走 HTML 源码，不是富文本**。RichEditor 是 TipTap（StarterKit + Image + Link），
 * 它的 schema 里**没有** `<figure>` / `<figcaption>` / `<div class="callout">` 这些节点 ——
 * 一旦用富文本打开再保存，整页的图注框、提示框、`class` 全会被悄悄抹平，正文塌成一堆裸段落，
 * 而且**不可逆**（存回 site_config 就覆盖了）。富文本仍留着，但要手动切、并且当面警告。
 *
 * 「插入截图」按钮因此不走 TipTap：上传后直接往源码光标处塞一段 figure 片段。
 * 用户要做的「在网站上补充截图」正是这条路径。
 */
function SectionEditor({
  section,
  onSave,
  onCancel,
  saving,
}: {
  section: AboutSection;
  onSave: (html: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { user } = useAuth();
  const [html, setHtml] = useState(section.html);
  // prose 也默认 true —— 见上面的说明。
  const [rawMode, setRawMode] = useState(true);
  const [uploading, setUploading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * 插入后光标该落在哪。**不能在 setHtml 之后直接 setSelectionRange** —— 那一下跑在 React
   * 把新 value 提交进 DOM 之前，改的是旧内容的光标，随后 React 一换 value 光标就弹到末尾。
   * 记成 state、等 value 落定后在 effect 里再设。
   */
  const [caret, setCaret] = useState<number | null>(null);
  useEffect(() => {
    if (caret == null || !taRef.current) return;
    taRef.current.focus();
    taRef.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret, html]);

  /** 把一段 HTML 插到 textarea 光标处（没有光标就追加到末尾）。 */
  const insertAtCursor = (snippet: string) => {
    const ta = taRef.current;
    if (!ta) {
      setHtml((h) => `${h}\n\n${snippet}`);
      return;
    }
    const { selectionStart: a, selectionEnd: b } = ta;
    setHtml((h) => `${h.slice(0, a)}${snippet}${h.slice(b)}`);
    setCaret(a + snippet.length);
  };

  const pickShot = async (file: File | undefined) => {
    if (!file || !user) return;
    setUploading(true);
    try {
      const url = await uploadShot(file, user.id);
      insertAtCursor(
        `\n<figure class="shot">\n  <img src="${url}" alt="">\n  <figcaption>图注：写清这张图在讲什么</figcaption>\n</figure>\n`,
      );
      toast.success("截图已上传并插入，记得改图注再保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="border border-vermilion/60 bg-paper-deep/30 p-3">
      <div className="flex flex-wrap items-center gap-3 mb-2 text-[11.5px]">
        <span className="text-vermilion font-semibold">编辑中 · {section.zh}</span>
        {section.kind === "prose" && rawMode && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickShot(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !user}
              className="border border-ink/40 px-2 py-0.5 hover:bg-ink hover:text-background transition-colors cursor-pointer disabled:opacity-50"
            >
              {uploading ? "上传中…" : "插入截图"}
            </button>
            <button
              onClick={() =>
                insertAtCursor(
                  `\n<figure class="shot todo">\n  <div class="ph">待补图</div>\n  <figcaption>说明这里该放什么图</figcaption>\n</figure>\n`,
                )
              }
              className="text-ink-faint hover:text-ink underline underline-offset-2 cursor-pointer"
            >
              插入占位框
            </button>
          </>
        )}
        {section.kind === "prose" && (
          <button
            onClick={() => {
              if (
                rawMode &&
                !confirm(
                  "富文本编辑器认不得 figure / figcaption / callout 这些结构，" +
                    "用它保存会把本节的图注框和提示框抹平，且无法撤销。\n\n" +
                    "只有纯文字段落的小改动才建议用它。确定要切过去吗？",
                )
              )
                return;
              setRawMode((v) => !v);
            }}
            className="text-ink-faint hover:text-ink underline underline-offset-2 cursor-pointer"
          >
            {rawMode ? "切到富文本（会丢版式）" : "切回 HTML 源码"}
          </button>
        )}
        <span className="ml-auto text-ink-faint">{html.length} 字符</span>
      </div>

      {section.kind === "matrix" ? (
        <>
          <p className="text-[11px] text-ink-faint mb-1.5 leading-relaxed">
            一行一条：<code>条目|访客|注册用户|编辑</code>，用 <code>✓</code> / <code>—</code>{" "}
            或任意说明文字；以 <code>#</code> 开头的行是分组小标题。
          </p>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="w-full h-72 border border-ink/30 bg-background p-2 text-[12.5px] font-mono leading-relaxed focus:outline-none focus:border-vermilion"
          />
        </>
      ) : rawMode ? (
        <textarea
          ref={taRef}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          spellCheck={false}
          className="w-full h-96 border border-ink/30 bg-background p-2 text-[12.5px] font-mono leading-relaxed focus:outline-none focus:border-vermilion"
        />
      ) : (
        <RichEditor value={html} onChange={setHtml} />
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onSave(html)}
          disabled={saving}
          className="rounded border border-ink px-3 py-1 text-[12.5px] hover:bg-ink hover:text-background transition-colors disabled:opacity-50 cursor-pointer"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-[12.5px] text-ink-faint hover:text-ink underline underline-offset-2 cursor-pointer"
        >
          取消
        </button>
        {section.kind === "prose" && (
          <span className="text-[11px] text-ink-faint">
            随站发布的截图写作 <code>&lt;img data-shot="…"&gt;</code>，勿改成 /assets/…
            哈希路径（下次发版就 404）；自己传的图是完整 URL，不受影响
          </span>
        )}
      </div>
    </div>
  );
}

// ─── 页面 ────────────────────────────────────────────────────────────────────

function AboutPage() {
  const { user } = useAuth();
  const isOwner = isOwnerEmail(user?.email);
  const qc = useQueryClient();

  const getAbout = useServerFn(getAboutFn);
  const saveAbout = useServerFn(saveAboutFn);
  const resetAbout = useServerFn(resetAboutFn);

  const { data: doc = DEFAULT_ABOUT } = useQuery<AboutDoc>({
    queryKey: ["about-doc"],
    queryFn: () => getAbout(),
    staleTime: 60_000,
  });
  const sections = doc.sections;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const [tocOpen, setTocOpen] = useState(false);

  // 滚动高亮：取「已滚过页面上沿一小段」的最后一个章节。用 scroll 而不是
  // IntersectionObserver —— 章节高度差距很大，交叉比例阈值在这里不好使。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      const probe = 140; // 约等于吸顶导航的高度 + 一点余量
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= probe) current = s.id;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  const jump = useCallback((id: string) => {
    setTocOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top: y, behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
  }, []);

  // 带 #… 进来时滚到位。等一拍，让正文先渲染出来，否则量到的位置是错的。
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (jumpedRef.current || typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (!hash || !sections.some((s) => s.id === hash)) return;
    jumpedRef.current = true;
    const t = setTimeout(() => jump(hash), 60);
    return () => clearTimeout(t);
  }, [sections, jump]);

  const persist = async (next: AboutSection[]) => {
    setSaving(true);
    try {
      await saveAbout({ data: { sections: next } });
      await qc.invalidateQueries({ queryKey: ["about-doc"] });
      setEditingId(null);
      toast.success("已保存，立即生效");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveSection = (id: string, html: string) =>
    persist(sections.map((s) => (s.id === id ? { ...s, html } : s)));

  const doReset = async () => {
    if (!confirm("整页退回随站发布的初稿？你保存过的修改会被清空，且无法撤销。")) return;
    setSaving(true);
    try {
      await resetAbout({ data: undefined });
      await qc.invalidateQueries({ queryKey: ["about-doc"] });
      setEditingId(null);
      toast.success("已退回初稿");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <style dangerouslySetInnerHTML={{ __html: PROSE_CSS }} />

      <main className="flex-1 mx-auto w-full max-w-[min(100vw-2rem,1800px)] px-4 md:px-6 py-8">
        {/* 题头 */}
        <header className="border-b-2 border-ink pb-5 mb-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-vermilion">
            About &amp; Readme · Plantspedia
          </p>
          <h1 className="text-3xl md:text-4xl font-bold mt-1.5">关于本站 · 使用指南</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-3xl leading-relaxed">
            这个站在做什么、为什么做，以及每一个页面怎么用。左侧目录可以直接跳到任意一节。
          </p>
          {isOwner && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11.5px]">
              <span className="px-2 py-0.5 border border-vermilion/60 text-vermilion">
                站长模式 · 每节右上角可编辑
              </span>
              <button
                onClick={doReset}
                disabled={saving}
                className="text-ink-faint hover:text-vermilion underline underline-offset-2 cursor-pointer disabled:opacity-50"
              >
                整页退回初稿
              </button>
              {doc.updatedAt && (
                <span className="text-ink-faint">
                  上次保存：{new Date(doc.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                </span>
              )}
            </div>
          )}
        </header>

        {/* 窄屏目录：折叠 */}
        <div className="lg:hidden mb-5">
          <button
            onClick={() => setTocOpen((v) => !v)}
            className="w-full border border-ink/40 px-3 py-2 text-sm flex items-center justify-between cursor-pointer"
          >
            <span>目录 · Contents</span>
            <span className="text-ink-faint text-xs">{tocOpen ? "收起" : "展开"}</span>
          </button>
          {tocOpen && (
            <div className="border border-t-0 border-ink/40 px-3 py-3 max-h-[60vh] overflow-y-auto">
              <Toc sections={sections} activeId={activeId} onJump={jump} />
            </div>
          )}
        </div>

        <div className="flex gap-8">
          {/* 左侧目录 —— 吸顶。top 与导航栏高度对齐。 */}
          <aside className="hidden lg:block w-56 shrink-0">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-ink-faint mb-2">Contents</p>
              <Toc sections={sections} activeId={activeId} onJump={jump} />
            </div>
          </aside>

          {/* 正文 */}
          <div className="flex-1 min-w-0 max-w-3xl">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24 mb-10">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p
                      className={`uppercase tracking-[0.18em] text-vermilion ${
                        s.level === 1 ? "text-[11px]" : "text-[10px]"
                      }`}
                    >
                      {s.en}
                    </p>
                    <h2
                      className={
                        s.level === 1
                          ? "text-2xl md:text-3xl font-bold border-b border-ink/70 pb-2 mt-0.5"
                          : "text-lg md:text-xl font-semibold mt-0.5"
                      }
                    >
                      {s.zh}
                    </h2>
                  </div>
                  {isOwner && editingId !== s.id && (
                    <button
                      onClick={() => setEditingId(s.id)}
                      className="shrink-0 mt-1 text-[11.5px] border border-ink/40 px-2 py-0.5 hover:bg-ink hover:text-background transition-colors cursor-pointer"
                    >
                      编辑
                    </button>
                  )}
                </div>

                {editingId === s.id ? (
                  <SectionEditor
                    section={s}
                    saving={saving}
                    onSave={(html) => saveSection(s.id, html)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <SectionBody section={s} />
                )}
              </section>
            ))}

            <p className="text-[11.5px] text-ink-faint border-t border-ink/20 pt-4">
              这一页本身也在持续修订。发现说明与实际不符，欢迎来信{" "}
              <a
                href="mailto:arainjazz@163.com"
                className="underline underline-offset-2 hover:text-vermilion"
              >
                arainjazz@163.com
              </a>
              。
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
