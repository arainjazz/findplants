import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchPostBySlug, blogCoverUrl } from "@/lib/blog";
import { ShareButton } from "@/components/share-button";
import { BlogComments } from "@/components/blog-comments";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    return fetchPostBySlug(params.slug);
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.title} · Plantspedia` : "Plantspedia · 全民植物志" },
      { name: "description", content: loaderData?.subtitle || "阅读植物科普文章、社区动态与科学探索。" },
      { property: "og:image", content: loaderData?.cover_url || "/default-og-image.jpg" },
      { property: "og:type", content: "article" },
    ],
  }),
  component: BlogDetail,
});

function BlogDetail() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const loaderData = Route.useLoaderData();
  const { data: post, isLoading } = useQuery({
    queryKey: ["blog-post-slug", slug],
    queryFn: () => fetchPostBySlug(slug),
    initialData: loaderData,
  });

  if (isLoading)
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 flex-1 text-ink-faint">载入中…</main>
        <SiteFooter />
      </div>
    );
  if (!post) throw notFound();

  const canEdit = user && (user.id === post.author_id);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-8 flex-1 w-full">
        <div className="flex items-center justify-between mb-4">
          <Link to="/blog" className="label hover:text-vermilion">← 编辑博客</Link>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link
                to="/admin/blog/edit/$id"
                params={{ id: post.id }}
                className="text-xs border border-ink/40 px-3 py-1.5 hover:bg-ink hover:text-background transition-colors"
              >
                编辑
              </Link>
            )}
            <ShareButton title={post.title} summary={post.subtitle} />
          </div>
        </div>

        {blogCoverUrl(post) && (
          <img
            src={blogCoverUrl(post)!}
            alt=""
            className="w-full max-h-[420px] object-cover mb-8 border border-rule"
          />
        )}

        <article>
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight mb-3">
            {post.title}
          </h1>
          {post.subtitle && (
            <p className="text-lg text-ink-soft mb-4">{post.subtitle}</p>
          )}
          <p className="label text-ink-faint mb-8 border-b border-rule pb-4">
            {post.author_name ?? "编辑"} ·{" "}
            {post.published_at
              ? new Date(post.published_at).toLocaleDateString("zh-CN")
              : "草稿"}
          </p>
          <div
            className="prose-plant"
            dangerouslySetInnerHTML={{ __html: post.content_html }}
          />
        </article>

        <style>{`
          .prose-plant { font-size: 17px; line-height: 1.85; color: var(--ink); }
          .prose-plant p { margin: 0 0 1em; }
          .prose-plant h2 { font-family: var(--font-display); font-size: 1.8rem; margin: 1.6em 0 .5em; font-weight: 600; }
          .prose-plant h3 { font-family: var(--font-display); font-size: 1.3rem; margin: 1.3em 0 .4em; font-weight: 600; }
          .prose-plant ul, .prose-plant ol { margin: 0 0 1em 1.4em; }
          .prose-plant ul { list-style: disc; } .prose-plant ol { list-style: decimal; }
          .prose-plant blockquote { border-left: 3px solid var(--vermilion); padding-left: 1em; margin: 1em 0; color: var(--ink-soft); font-style: italic; }
          .prose-plant img { display: block; max-width: 100%; margin: 1.2em auto; }
          .prose-plant a { color: var(--vermilion); text-decoration: underline; }
        `}</style>

        <BlogComments postId={post.id} postAuthorId={post.author_id} />
      </main>
      <SiteFooter />
    </div>
  );
}