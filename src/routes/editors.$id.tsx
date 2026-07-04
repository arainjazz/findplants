import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchEditorPublicFn } from "@/lib/identify-plant.functions";

export const Route = createFileRoute("/editors/$id")({
  component: EditorPublicPage,
});

function EditorPublicPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(fetchEditorPublicFn);
  const { data, isLoading } = useQuery({
    queryKey: ["editor-public", id],
    queryFn: () => fn({ data: { editorId: id } }),
  });

  const profile = data?.profile;
  const plants = data?.plants ?? [];
  const blogs = data?.blogs ?? [];
  const drafts = data?.drafts ?? [];
  const areas = data?.areas ?? "";
  const name = profile?.display_name || "编辑者";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <Link to="/" className="label hover:text-vermilion">← 返回首页</Link>

        {isLoading ? (
          <p className="text-ink-faint py-20 text-center">载入中…</p>
        ) : !profile ? (
          <p className="text-ink-faint py-20 text-center">未找到该编辑。</p>
        ) : (
          <>
            {/* Header */}
            <header className="mt-4 mb-10 flex items-center gap-5 border-b-2 border-ink pb-6">
              <div className="w-20 h-20 rounded-full overflow-hidden border border-rule bg-paper-deep flex items-center justify-center shrink-0">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-display text-3xl text-ink-faint">{name.slice(0, 1)}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="label text-vermilion mb-1">Contributor · 编辑主页</p>
                <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight">{name}</h1>
                <p className="text-xs text-ink-faint mt-1">
                  {profile.created_at ? `${new Date(profile.created_at).toLocaleDateString("zh-CN")} 加入` : ""}
                  {areas ? ` · 活动于 ${areas}` : ""}
                </p>
                {profile.bio && <p className="text-sm text-ink-soft mt-2 max-w-xl">{profile.bio}</p>}
              </div>
            </header>

            {/* Collected entries */}
            <WorksBlock title={<>被收录条目 · Collected<span className="ml-1 font-normal text-ink-faint">[{plants.length}]</span></>}>
              {plants.length === 0 ? (
                <Empty>暂无已收录条目。</Empty>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {plants.map((p: any) => (
                    <Link key={p.id} to="/plants/$slug" params={{ slug: p.slug }} className="group block border border-rule bg-paper-deep/30 overflow-hidden">
                      <div className="aspect-[4/3] overflow-hidden bg-paper-deep">
                        {p.cover_url && <img src={p.cover_url} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />}
                      </div>
                      <div className="p-2">
                        <p className="text-sm font-semibold truncate group-hover:text-vermilion">{p.title}</p>
                        {p.scientific_name && <p className="text-[10px] italic text-ink-faint truncate">{p.scientific_name}</p>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </WorksBlock>

            {/* Blog posts */}
            <WorksBlock title={<>编辑博文 · Posts<span className="ml-1 font-normal text-ink-faint">[{blogs.length}]</span></>}>
              {blogs.length === 0 ? (
                <Empty>暂无已发表博文。</Empty>
              ) : (
                <ul className="divide-y divide-rule border-y border-rule">
                  {blogs.map((b: any) => (
                    <li key={b.id}>
                      <Link to="/blog/$slug" params={{ slug: b.slug }} className="flex items-center gap-3 py-3 px-2 -mx-2 hover:bg-paper-deep/40 group">
                        <div className="w-14 h-14 shrink-0 border border-rule bg-paper-deep overflow-hidden flex items-center justify-center">
                          {b.cover_url ? (
                            <img src={b.cover_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="font-display text-xl text-ink-faint">{b.title?.slice(0, 1) || "文"}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-display text-lg font-semibold truncate group-hover:text-vermilion">{b.title}</p>
                          {b.subtitle && <p className="text-xs text-ink-faint truncate">{b.subtitle}</p>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </WorksBlock>

            {/* AI identifications */}
            <WorksBlock title={<>AI 识别 · Identifications<span className="ml-1 font-normal text-ink-faint">[{drafts.length}]</span></>}>
              {drafts.length === 0 ? (
                <Empty>暂无 AI 识别记录。</Empty>
              ) : (
                <ul className="divide-y divide-rule border-y border-rule">
                  {drafts.map((d: any) => (
                    <li key={d.id}>
                      <Link to="/drafts/$id" params={{ id: d.id }} className="flex items-center gap-3 py-3 px-2 -mx-2 hover:bg-paper-deep/40 group">
                        <div className="w-14 h-14 shrink-0 border border-rule bg-paper-deep overflow-hidden">
                          {d.photo_url && <img src={d.photo_url} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate group-hover:text-vermilion">[{d.title}]</p>
                          {d.scientific_name && <p className="text-[11px] italic text-ink-faint truncate">{d.scientific_name}</p>}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${d.status === "approved" ? "bg-leaf/15 text-leaf-deep" : d.status === "rejected" ? "bg-destructive/15 text-destructive" : "bg-ink/10 text-ink-soft"}`}>
                          {d.status === "approved" ? "已收录" : d.status === "rejected" ? "已驳回" : "待审核"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </WorksBlock>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function WorksBlock({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-display text-xl font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-faint text-sm py-6 text-center border border-dashed border-rule">{children}</p>;
}
