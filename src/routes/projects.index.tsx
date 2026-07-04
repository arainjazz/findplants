import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchPublishedProjects, projectCoverUrl, projectYear, type Project } from "@/lib/projects";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "项目驱动调研成果 · Plantspedia" },
      { name: "description", content: "由项目驱动的实地调研成果，可按时间、地点、主题、发起人检索。" },
    ],
  }),
  component: ProjectsPage,
});

function uniqSorted(values: (string | null | undefined)[], desc = false): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (s) set.add(s);
  }
  const arr = [...set].sort((a, b) => a.localeCompare(b, "zh"));
  return desc ? arr.reverse() : arr;
}

function ProjectsPage() {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["published-projects"],
    queryFn: fetchPublishedProjects,
  });

  const [year, setYear] = useState("");
  const [location, setLocation] = useState("");
  const [theme, setTheme] = useState("");
  const [initiator, setInitiator] = useState("");

  const years = useMemo(() => uniqSorted(projects.map(projectYear), true), [projects]);
  const locations = useMemo(() => uniqSorted(projects.map((p) => p.location)), [projects]);
  const themes = useMemo(() => uniqSorted(projects.map((p) => p.theme)), [projects]);
  const initiators = useMemo(() => uniqSorted(projects.map((p) => p.initiator)), [projects]);

  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          (!year || projectYear(p) === year) &&
          (!location || p.location === location) &&
          (!theme || p.theme === theme) &&
          (!initiator || p.initiator === initiator),
      ),
    [projects, year, location, theme, initiator],
  );

  const anyFilter = year || location || theme || initiator;
  const clearAll = () => {
    setYear("");
    setLocation("");
    setTheme("");
    setInitiator("");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <section className="border-b-2 border-ink pb-5 mb-8">
          <h1 className="font-display text-3xl md:text-5xl font-bold">项目驱动调研成果</h1>
          <p className="label mt-2 text-ink-faint">Project-Driven Research Findings · 按时间 / 地点 / 主题 / 发起人检索</p>
        </section>

        <div className="grid md:grid-cols-[220px_1fr] gap-8">
          {/* Left filter rail */}
          <aside className="md:sticky md:top-20 self-start space-y-4">
            <div className="flex items-center justify-between">
              <p className="label text-vermilion">筛选</p>
              {anyFilter && (
                <button onClick={clearAll} className="text-[11px] text-ink-faint hover:text-vermilion">清除</button>
              )}
            </div>
            <FilterSelect label="时间范围" value={year} onChange={setYear} options={years} render={(y) => `${y} 年`} />
            <FilterSelect label="项目地点" value={location} onChange={setLocation} options={locations} />
            <FilterSelect label="主题" value={theme} onChange={setTheme} options={themes} />
            <FilterSelect label="发起人" value={initiator} onChange={setInitiator} options={initiators} />
            <p className="text-[11px] text-ink-faint pt-2">共 {filtered.length} 项</p>
          </aside>

          {/* Results */}
          <section>
            {isLoading ? (
              <p className="text-ink-faint">载入中…</p>
            ) : projects.length === 0 ? (
              <div className="border border-dashed border-rule py-20 text-center text-ink-faint">
                还没有发布的调研成果。编辑可在「管理 → + 编辑项目」创建。
              </div>
            ) : filtered.length === 0 ? (
              <div className="border border-dashed border-rule py-20 text-center text-ink-faint">
                没有符合筛选条件的项目。<button onClick={clearAll} className="underline hover:text-vermilion">清除筛选</button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-6">
                {filtered.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  render?: (v: string) => string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-ink-faint block mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm bg-background border border-rule rounded-lg px-2 py-1.5 outline-none focus:border-vermilion cursor-pointer"
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o} value={o}>{render ? render(o) : o}</option>
        ))}
      </select>
    </label>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const cover = projectCoverUrl(p);
  const dateLabel = p.project_date ? new Date(p.project_date).toLocaleDateString("zh-CN") : "";
  return (
    <Link to="/projects/$id" params={{ id: p.id }} className="group block border border-rule hover:border-ink transition-colors">
      <div className="aspect-[16/10] overflow-hidden bg-paper-deep border-b border-rule">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-leaf-deep/30 font-display text-5xl">❦</div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-display text-xl font-semibold leading-snug group-hover:text-vermilion transition-colors line-clamp-2">{p.title}</h3>
        {p.summary && <p className="text-sm text-ink-soft mt-1 line-clamp-2">{p.summary}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-faint mt-3">
          <span>🗓 {dateLabel}</span>
          <span>📍 {p.location}</span>
          <span>🏷 {p.theme}</span>
          <span>👤 {p.initiator}</span>
        </div>
      </div>
    </Link>
  );
}
