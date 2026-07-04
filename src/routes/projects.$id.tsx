import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchProjectById } from "@/lib/projects";

export const Route = createFileRoute("/projects/$id")({
  component: ProjectDetail,
});

function ProjectDetail() {
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

  const dateLabel = project.project_date
    ? new Date(project.project_date).toLocaleDateString("zh-CN")
    : "";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-8 flex-1 w-full">
        <Link to="/projects" className="label hover:text-vermilion">← 项目驱动调研成果</Link>

        {project.cover_url && (
          <img src={project.cover_url} alt="" className="w-full max-h-[420px] object-cover mt-4 mb-8 border border-rule" />
        )}

        <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight mt-4 mb-4">{project.title}</h1>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint border-y border-rule py-3 mb-8">
          <span>🗓 {dateLabel}</span>
          <span>📍 {project.location}</span>
          <span>🏷 {project.theme}</span>
          <span>👤 {project.initiator}</span>
        </div>

        {project.summary && <p className="text-lg text-ink-soft mb-8">{project.summary}</p>}

        <article className="prose-project" dangerouslySetInnerHTML={{ __html: project.content_html }} />

        <style>{`
          .prose-project { font-size: 17px; line-height: 1.85; color: var(--ink); }
          .prose-project p { margin: 0 0 1em; }
          .prose-project h1 { font-family: var(--font-display); font-size: 2rem; margin: 1.6em 0 .5em; font-weight: 700; }
          .prose-project h2 { font-family: var(--font-display); font-size: 1.8rem; margin: 1.6em 0 .5em; font-weight: 600; }
          .prose-project h3 { font-family: var(--font-display); font-size: 1.3rem; margin: 1.3em 0 .4em; font-weight: 600; }
          .prose-project ul, .prose-project ol { margin: 0 0 1em 1.4em; }
          .prose-project ul { list-style: disc; } .prose-project ol { list-style: decimal; }
          .prose-project blockquote { border-left: 3px solid var(--vermilion); padding-left: 1em; margin: 1em 0; color: var(--ink-soft); font-style: italic; }
          .prose-project img { display: block; max-width: 100%; margin: 1.2em auto; border-radius: 6px; }
          .prose-project a { color: var(--vermilion); text-decoration: underline; }
          .prose-project pre { background: var(--paper-deep); padding: 1em; border-radius: 6px; overflow:auto; margin: 0 0 1em; }
          .prose-project table { border-collapse: collapse; margin: 0 0 1em; }
          .prose-project td, .prose-project th { border: 1px solid var(--rule); padding: 6px 10px; }
        `}</style>
      </main>
      <SiteFooter />
    </div>
  );
}
