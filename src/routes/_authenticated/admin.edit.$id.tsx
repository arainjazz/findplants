import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { PlantEditor } from "@/components/plant-editor";
import { supabase } from "@/integrations/supabase/client";
import type { Plant } from "@/lib/plants";

export const Route = createFileRoute("/_authenticated/admin/edit/$id")({
  component: EditPlant,
});

function EditPlant() {
  const { id } = Route.useParams();
  const { data: plant, isLoading } = useQuery({
    queryKey: ["plant-by-id", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("plants").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Plant | null;
    },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-[min(100vw-2rem,1800px)] px-4 md:px-6 py-10 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4">
          <p className="label text-vermilion mb-2">Edit Entry</p>
          <h1 className="font-display text-4xl font-bold">编辑：{plant?.title ?? "…"}</h1>
        </div>
        {isLoading ? <p className="text-ink-faint">载入中…</p> : !plant ? (() => { throw notFound(); })() : <PlantEditor initial={plant} />}
      </main>
      <SiteFooter />
    </div>
  );
}
