import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { isOwnerEmail } from "@/lib/leaves";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/usage-stats")({
  component: UsageStatsPage,
});

type TaskType = "quick_identify" | "enrich_draft" | "gold_page" | "chat";

interface UsageByModelTask {
  model: string;
  provider: string;
  task_type: TaskType | null;
  count: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface ModelGroup {
  model: string;
  provider: string;
  totalCount: number;
  totalTokens: number;
  tasks: {
    task_type: TaskType | null;
    count: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  }[];
}

const taskTypeLabels: Record<TaskType, string> = {
  quick_identify: "快速识别",
  enrich_draft: "银叶完整草稿",
  gold_page: "金叶详情页",
  chat: "小P对话",
};

const taskTypeColors: Record<TaskType, string> = {
  quick_identify: "text-blue-600",
  enrich_draft: "text-green-600",
  gold_page: "text-amber-600",
  chat: "text-purple-600",
};

function UsageStatsPage() {
  const { user } = useAuth();
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  const isOwner = isOwnerEmail(user?.email);

  const { data: usageStats = [], isLoading } = useQuery({
    queryKey: ["usage-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_usage_logs")
        .select("model, provider, task_type, total_tokens, prompt_tokens, completion_tokens");

      if (error) throw error;

      // Group by model + task_type
      const grouped = new Map<string, UsageByModelTask>();

      for (const row of data || []) {
        const key = `${row.model}|||${row.provider}|||${row.task_type || "unknown"}`;
        const existing = grouped.get(key);

        if (existing) {
          existing.count += 1;
          existing.total_tokens += row.total_tokens || 0;
          existing.prompt_tokens += row.prompt_tokens || 0;
          existing.completion_tokens += row.completion_tokens || 0;
        } else {
          grouped.set(key, {
            model: row.model,
            provider: row.provider,
            task_type: row.task_type as TaskType | null,
            count: 1,
            total_tokens: row.total_tokens || 0,
            prompt_tokens: row.prompt_tokens || 0,
            completion_tokens: row.completion_tokens || 0,
          });
        }
      }

      // Group by model
      const modelGroups = new Map<string, ModelGroup>();

      for (const stat of grouped.values()) {
        const modelKey = `${stat.model}|||${stat.provider}`;
        const existing = modelGroups.get(modelKey);

        if (existing) {
          existing.totalCount += stat.count;
          existing.totalTokens += stat.total_tokens;
          existing.tasks.push({
            task_type: stat.task_type,
            count: stat.count,
            total_tokens: stat.total_tokens,
            prompt_tokens: stat.prompt_tokens,
            completion_tokens: stat.completion_tokens,
          });
        } else {
          modelGroups.set(modelKey, {
            model: stat.model,
            provider: stat.provider,
            totalCount: stat.count,
            totalTokens: stat.total_tokens,
            tasks: [{
              task_type: stat.task_type,
              count: stat.count,
              total_tokens: stat.total_tokens,
              prompt_tokens: stat.prompt_tokens,
              completion_tokens: stat.completion_tokens,
            }],
          });
        }
      }

      // Sort by total tokens descending
      return Array.from(modelGroups.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    },
    enabled: !!user && isOwner,
  });

  const toggleModel = (modelKey: string) => {
    const next = new Set(expandedModels);
    if (next.has(modelKey)) {
      next.delete(modelKey);
    } else {
      next.add(modelKey);
    }
    setExpandedModels(next);
  };

  if (!user || !isOwner) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-50 to-leaf-light">
        <SiteHeader />
        <div className="container mx-auto px-4 py-12 text-center">
          <p className="text-lg text-stone-600">需要 owner 权限访问此页面</p>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const totalCalls = usageStats.reduce((sum, g) => sum + g.totalCount, 0);
  const totalTokens = usageStats.reduce((sum, g) => sum + g.totalTokens, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-leaf-light">
      <SiteHeader />
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-8 h-8 text-leaf-deep" />
          <h1 className="text-3xl font-bold text-stone-800">Token 使用统计</h1>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-stone-600">总调用次数</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-stone-800">{totalCalls.toLocaleString()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-stone-600">总 Token 消耗</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-stone-800">{totalTokens.toLocaleString()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-stone-600">模型数量</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-stone-800">{usageStats.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Model Groups Table */}
        <Card>
          <CardHeader>
            <CardTitle>按模型分组统计</CardTitle>
            <p className="text-sm text-stone-600 mt-1">点击模型行展开查看各任务类型详情</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-center py-8 text-stone-600">加载中...</p>
            ) : usageStats.length === 0 ? (
              <p className="text-center py-8 text-stone-600">暂无使用记录</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>服务商</TableHead>
                    <TableHead className="text-right">调用次数</TableHead>
                    <TableHead className="text-right">总 Token</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageStats.map((group) => {
                    const modelKey = `${group.model}|||${group.provider}`;
                    const isExpanded = expandedModels.has(modelKey);

                    return (
                      <>
                        <TableRow
                          key={modelKey}
                          className="cursor-pointer hover:bg-stone-50"
                          onClick={() => toggleModel(modelKey)}
                        >
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{group.model}</TableCell>
                          <TableCell className="text-stone-600">{group.provider}</TableCell>
                          <TableCell className="text-right font-semibold">{group.totalCount.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold">{group.totalTokens.toLocaleString()}</TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-stone-50 p-0">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-stone-100">
                                    <TableHead className="pl-16">任务类型</TableHead>
                                    <TableHead className="text-right">调用次数</TableHead>
                                    <TableHead className="text-right">Prompt Tokens</TableHead>
                                    <TableHead className="text-right">Completion Tokens</TableHead>
                                    <TableHead className="text-right">总 Tokens</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {group.tasks
                                    .sort((a, b) => b.total_tokens - a.total_tokens)
                                    .map((task, idx) => (
                                      <TableRow key={idx} className="border-stone-200">
                                        <TableCell className="pl-16">
                                          <span className={task.task_type ? taskTypeColors[task.task_type] : "text-stone-500"}>
                                            {task.task_type ? taskTypeLabels[task.task_type] : "未分类"}
                                          </span>
                                        </TableCell>
                                        <TableCell className="text-right">{task.count.toLocaleString()}</TableCell>
                                        <TableCell className="text-right text-stone-600">
                                          {task.prompt_tokens.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right text-stone-600">
                                          {task.completion_tokens.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                          {task.total_tokens.toLocaleString()}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
