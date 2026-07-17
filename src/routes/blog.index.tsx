import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchPublishedPosts, blogCoverUrl } from "@/lib/blog";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "博客 blogs · Plantspedia" },
      { name: "description", content: "编辑团队的随笔、田野观察与编辑手记。" },
    ],
  }),
  component: BlogList,
});

function BlogList() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["blog-posts"],
    queryFn: fetchPublishedPosts,
  });

  // 按编辑姓名归类：每位编辑一组，组内保持 fetchPublishedPosts 的时间倒序。作者多的排前面，
  // 同数量按姓名排，这样列表顺序不会因为发文时间抖动。
  const byAuthor = new Map<string, typeof posts>();
  for (const p of posts) {
    const name = p.author_name?.trim() || "编辑";
    const g = byAuthor.get(name);
    if (g) g.push(p);
    else byAuthor.set(name, [p]);
  }
  const groups = [...byAuthor.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "zh-CN"),
  );

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-8">
          <p className="label text-vermilion mb-2">Editors' Notebook</p>
          <h1 className="font-display text-5xl font-bold">博客 blogs</h1>
          <p className="text-ink-faint mt-2">来自编辑团队的田野观察与随笔</p>
        </div>
        {isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : posts.length === 0 ? (
          <p className="text-ink-faint py-20 text-center border border-dashed border-rule">
            尚未发布博客。
          </p>
        ) : (
          groups.map(([author, items]) => (
            <section key={author} className="mb-10">
              <div className="flex items-baseline gap-3 border-b border-ink pb-2 mb-2">
                <h2 className="font-display text-2xl font-bold">{author}</h2>
                <span className="text-sm text-ink-faint">{items.length} 篇</span>
              </div>
              <ul className="divide-y divide-rule">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/blog/$slug"
                      params={{ slug: p.slug }}
                      className="grid md:grid-cols-[140px_1fr] gap-6 py-6 hover:bg-paper-deep/40 transition-colors group"
                    >
                      {blogCoverUrl(p) ? (
                        <img
                          src={blogCoverUrl(p)!}
                          alt=""
                          className="w-full md:w-[140px] h-[100px] object-cover border border-rule"
                          loading="lazy"
                        />
                      ) : (
                        <div className="hidden md:block w-[140px] h-[100px] bg-paper-deep border border-rule" />
                      )}
                      <div>
                        <h2 className="font-display text-2xl font-semibold group-hover:text-vermilion transition-colors">
                          {p.title}
                        </h2>
                        {p.subtitle && <p className="text-ink-soft mt-1">{p.subtitle}</p>}
                        {/* 作者已是分组标题，条目里只留日期，避免同一个名字重复一遍 */}
                        <p className="label mt-3 text-ink-faint">
                          {p.published_at
                            ? new Date(p.published_at).toLocaleDateString("zh-CN")
                            : ""}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
