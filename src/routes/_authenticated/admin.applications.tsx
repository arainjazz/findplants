import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  approveApplication,
  fetchApplications,
  isCurrentUserAdmin,
  rejectApplication,
  type EditorApplication,
} from "@/lib/edits";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/applications")({
  component: AdminApplicationsPage,
});

type Tab = "pending" | "approved" | "rejected" | "all";

function AdminApplicationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");

  const { data: isAdmin = false, isLoading: roleLoading } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ["editor-applications"],
    queryFn: () => fetchApplications(),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("editor_applications-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "editor_applications" },
        () => qc.invalidateQueries({ queryKey: ["editor-applications"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, isAdmin]);

  const filtered = useMemo(() => {
    if (tab === "all") return apps;
    return apps.filter((a) => a.status === tab);
  }, [apps, tab]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0 };
    for (const a of apps) c[a.status]++;
    return c;
  }, [apps]);

  if (roleLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 px-6 py-10 mx-auto max-w-5xl w-full">
          <p className="text-ink-faint">载入中…</p>
        </main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 px-6 py-10 mx-auto max-w-5xl w-full">
          <h1 className="font-display text-3xl font-bold mb-2">仅管理员可访问</h1>
          <p className="text-ink-faint">该页面用于审核新编辑申请。</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-6">
          <p className="label text-vermilion mb-2">Admissions · 编辑申请审核</p>
          <h1 className="font-display text-4xl font-bold">编辑申请</h1>
          <p className="text-ink-faint mt-2">审核新用户提交的编辑申请，通过后用户将获得编辑权限。</p>
        </div>

        <div className="flex border border-ink mb-6 w-fit">
          {(
            [
              ["pending", `待审核 (${counts.pending})`],
              ["approved", `已通过 (${counts.approved})`],
              ["rejected", `已拒绝 (${counts.rejected})`],
              ["all", "全部"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm ${tab === k ? "bg-ink text-background" : "hover:bg-paper-deep"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-ink-faint py-12 text-center">没有匹配的申请。</p>
        ) : (
          <ul className="space-y-4">
            {filtered.map((app) => (
              <ApplicationCard key={app.id} app={app} adminId={user!.id} />
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ApplicationCard({ app, adminId }: { app: EditorApplication; adminId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const onApprove = async () => {
    setBusy(true);
    try {
      await approveApplication(app, adminId);
      toast.success(`已通过 ${app.email} 的申请`);
      qc.invalidateQueries({ queryKey: ["editor-applications"] });
    } catch (e) {
      toast.error("操作失败：" + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (reason.trim().length < 5) {
      toast.error("请填写拒绝理由（至少 5 字）");
      return;
    }
    setBusy(true);
    try {
      await rejectApplication(app, adminId, reason.trim());
      toast.success("已拒绝该申请");
      setShowReject(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["editor-applications"] });
    } catch (e) {
      toast.error("操作失败：" + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge: Record<string, string> = {
    pending: "bg-paper-deep text-ink",
    approved: "bg-leaf/15 text-leaf-deep",
    rejected: "bg-destructive/15 text-destructive",
  };
  const statusLabel: Record<string, string> = {
    pending: "待审核",
    approved: "已通过",
    rejected: "已拒绝",
  };

  return (
    <li className="border border-rule p-4 bg-paper-deep/20">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <p className="font-display font-semibold">{app.email}</p>
          <p className="text-xs text-ink-faint">提交于 {new Date(app.created_at).toLocaleString("zh-CN")}</p>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusBadge[app.status]}`}>
          {statusLabel[app.status]}
        </span>
      </div>
      <div className="border border-rule bg-background p-3 text-sm whitespace-pre-wrap mb-3">
        {app.bio}
      </div>
      {app.status === "rejected" && app.reject_reason && (
        <p className="text-xs text-destructive mb-3">拒绝理由：{app.reject_reason}</p>
      )}
      {app.status === "pending" && (
        <>
          {showReject ? (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="请填写拒绝理由，将记录在该申请中。"
                className="w-full border border-ink px-3 py-2 bg-transparent text-sm focus:outline-none focus:border-vermilion"
              />
              <div className="flex gap-2">
                <button
                  onClick={onReject}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm bg-destructive text-background hover:opacity-90 disabled:opacity-60"
                >
                  确认拒绝
                </button>
                <button
                  onClick={() => { setShowReject(false); setReason(""); }}
                  className="px-3 py-1.5 text-sm border border-ink hover:bg-paper-deep"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={onApprove}
                disabled={busy}
                className="px-3 py-1.5 text-sm bg-ink text-background hover:bg-vermilion disabled:opacity-60"
              >
                允许
              </button>
              <button
                onClick={() => setShowReject(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive hover:bg-destructive hover:text-background disabled:opacity-60"
              >
                拒绝
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}