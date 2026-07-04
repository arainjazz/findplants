import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { ProjectEditor } from "@/components/project-editor";
import { fetchProjectById } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/admin/projects/edit/$id")({
  component: EditProject,
});

function EditProject() {
  const { id } = Route.useParams();
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => fetchProjectById(id),
  });

  if (isLoading)
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 flex-1 text-ink-faint">载入中…</main>
        <SiteFooter />
      </div>
    );
  if (!project) throw notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-8 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <p className="label text-vermilion mt-4 mb-2">
          Edit Project · {project.published ? "已发布" : "草稿"}
        </p>
        <ProjectEditor initial={project} />
      </main>
      <SiteFooter />
    </div>
  );
}
