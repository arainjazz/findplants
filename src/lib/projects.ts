import { supabase } from "@/integrations/supabase/client";

export type Project = {
  id: string;
  title: string;
  /** ISO date (YYYY-MM-DD). 项目时间 — required, drives the 时间范围 filter. */
  project_date: string;
  location: string;
  theme: string;
  initiator: string;
  summary: string | null;
  content_html: string;
  cover_url: string | null;
  author_id: string;
  author_name: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/** First <img> src in the body — used as a fallback cover on cards. */
export function projectCoverUrl(p: Pick<Project, "cover_url" | "content_html">): string | null {
  if (p.cover_url) return p.cover_url;
  const m = (p.content_html || "").match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Year label for the 时间范围 filter, derived from project_date. */
export function projectYear(p: Pick<Project, "project_date">): string {
  return (p.project_date || "").slice(0, 4);
}

export async function fetchPublishedProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("published", true)
    .order("project_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function fetchMyProjects(userId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("author_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function fetchProjectById(id: string): Promise<Project | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Project | null;
}

export async function createProject(input: {
  title: string;
  project_date: string;
  location: string;
  theme: string;
  initiator: string;
  summary?: string | null;
  content_html: string;
  cover_url?: string | null;
  publish: boolean;
  authorId: string;
  authorName: string;
}): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: input.title || "未命名项目",
      project_date: input.project_date,
      location: input.location,
      theme: input.theme,
      initiator: input.initiator,
      summary: input.summary ?? null,
      content_html: input.content_html,
      cover_url: input.cover_url ?? null,
      author_id: input.authorId,
      author_name: input.authorName,
      published: input.publish,
      published_at: input.publish ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "title"
      | "project_date"
      | "location"
      | "theme"
      | "initiator"
      | "summary"
      | "content_html"
      | "cover_url"
      | "published"
    >
  >,
): Promise<Project> {
  const payload = {
    ...patch,
    ...(patch.published === true ? { published_at: new Date().toISOString() } : {}),
  };
  const { data, error } = await supabase.from("projects").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data as Project;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
