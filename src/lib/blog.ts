import { supabase } from "@/integrations/supabase/client";

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  cover_url: string | null;
  content_html: string;
  author_id: string;
  author_name: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export function slugifyBlog(title: string) {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, (m) =>
      encodeURIComponent(m).replace(/%/g, ""),
    )
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `post-${Date.now().toString(36)}`;
}

export async function fetchPublishedPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("published", true)
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as BlogPost[];
}

export async function fetchMyPosts(userId: string): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("author_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BlogPost[];
}

export async function fetchPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as BlogPost | null;
}

export async function fetchPostById(id: string): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as BlogPost | null;
}

export async function createPost(input: {
  title: string;
  subtitle?: string | null;
  cover_url?: string | null;
  content_html: string;
  publish: boolean;
  authorId: string;
  authorName: string;
}) {
  const slug = `${slugifyBlog(input.title || "untitled")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const { data, error } = await supabase
    .from("blog_posts")
    .insert({
      slug,
      title: input.title || "未命名草稿",
      subtitle: input.subtitle ?? null,
      cover_url: input.cover_url ?? null,
      content_html: input.content_html,
      author_id: input.authorId,
      author_name: input.authorName,
      published: input.publish,
      published_at: input.publish ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function updatePost(
  id: string,
  patch: Partial<Pick<BlogPost, "title" | "subtitle" | "cover_url" | "content_html" | "published">>,
) {
  const payload: Partial<BlogPost> = { ...patch };
  if (patch.published === true) payload.published_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("blog_posts")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function deletePost(id: string) {
  const { error } = await supabase.from("blog_posts").delete().eq("id", id);
  if (error) throw error;
}