import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { BlogEditor } from "@/components/blog-editor";

export const Route = createFileRoute("/_authenticated/admin/blog/new")({
  component: NewBlog,
});

function NewBlog() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-8 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <p className="label text-vermilion mt-4 mb-2">New Blog · 编辑博客</p>
        <BlogEditor />
      </main>
      <SiteFooter />
    </div>
  );
}