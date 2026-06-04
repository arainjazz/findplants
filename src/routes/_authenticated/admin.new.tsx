import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { PlantEditor } from "@/components/plant-editor";

export const Route = createFileRoute("/_authenticated/admin/new")({
  component: NewPlant,
});

function NewPlant() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4">
          <p className="label text-vermilion mb-2">New Entry</p>
          <h1 className="font-display text-4xl font-bold">新建植物条目</h1>
        </div>
        <PlantEditor />
      </main>
      <SiteFooter />
    </div>
  );
}
