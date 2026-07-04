import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { ProjectEditor } from "@/components/project-editor";

export const Route = createFileRoute("/_authenticated/admin/projects/new")({
  component: NewProject,
});

function NewProject() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-8 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <p className="label text-vermilion mt-4 mb-2">New Project · 项目驱动调研成果</p>
        <ProjectEditor />
      </main>
      <SiteFooter />
    </div>
  );
}
