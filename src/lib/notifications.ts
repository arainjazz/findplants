import { supabase } from "@/integrations/supabase/client";

export type Notification = {
  id: string;
  type: "comment_on_work" | "reply_to_you";
  plant_id: string;
  plant_slug: string | null;
  plant_title: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};

/**
 * Notifications for an editor:
 *  - comment_on_work: someone commented on a plant entry they authored (works now)
 *  - reply_to_you: someone replied to one of their comments (needs the
 *    plant_comments.parent_id column — gracefully skipped until that migration)
 */
export async function fetchMyNotifications(userId: string): Promise<Notification[]> {
  const out: Notification[] = [];

  // Comments on entries I authored.
  const { data: myPlants } = await supabase.from("plants").select("id").eq("author_id", userId);
  const plantIds = (myPlants ?? []).map((p) => p.id);
  if (plantIds.length) {
    const { data: cmts } = await supabase
      .from("plant_comments")
      .select("id, plant_id, author_id, author_name, body, created_at")
      .in("plant_id", plantIds)
      .order("created_at", { ascending: false })
      .limit(50);
    for (const c of cmts ?? []) {
      if (c.author_id === userId) continue; // skip my own comments
      out.push({
        id: c.id,
        type: "comment_on_work",
        plant_id: c.plant_id,
        plant_slug: null,
        plant_title: null,
        author_name: c.author_name,
        body: c.body,
        created_at: c.created_at,
      });
    }
  }

  // Replies to my comments (requires parent_id column).
  try {
    const { data: mine } = await supabase.from("plant_comments").select("id").eq("author_id", userId);
    const myIds = (mine ?? []).map((c) => c.id);
    if (myIds.length) {
      // Cast to any: parent_id may not yet exist in the generated types/schema.
      const q = supabase.from("plant_comments") as unknown as {
        select: (s: string) => {
          in: (col: string, vals: string[]) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
            };
          };
        };
      };
      const { data: replies, error } = await q
        .select("id, plant_id, author_id, author_name, body, created_at, parent_id")
        .in("parent_id", myIds)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!error) {
        for (const r of replies ?? []) {
          if (r.author_id === userId) continue;
          out.push({
            id: String(r.id),
            type: "reply_to_you",
            plant_id: String(r.plant_id),
            plant_slug: null,
            plant_title: null,
            author_name: (r.author_name as string) ?? null,
            body: String(r.body),
            created_at: String(r.created_at),
          });
        }
      }
    }
  } catch {
    /* parent_id column not present yet — replies feature dormant */
  }

  const seen = new Set<string>();
  const deduped = out
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 50);

  // Attach plant slug/title for linking.
  const pids = Array.from(new Set(deduped.map((n) => n.plant_id)));
  if (pids.length) {
    const { data: plants } = await supabase.from("plants").select("id, slug, title").in("id", pids);
    const byId = new Map((plants ?? []).map((p) => [p.id, p]));
    for (const n of deduped) {
      const p = byId.get(n.plant_id);
      if (p) {
        n.plant_slug = p.slug;
        n.plant_title = p.title;
      }
    }
  }
  return deduped;
}

const seenKey = (uid: string) => `pp-notif-seen:${uid}`;

export function getLastSeen(uid: string): number {
  try {
    return Number(localStorage.getItem(seenKey(uid)) || 0);
  } catch {
    return 0;
  }
}

export function markNotificationsSeen(uid: string) {
  try {
    localStorage.setItem(seenKey(uid), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function countUnseen(notifs: Notification[], uid: string): number {
  const t = getLastSeen(uid);
  return notifs.filter((n) => +new Date(n.created_at) > t).length;
}
