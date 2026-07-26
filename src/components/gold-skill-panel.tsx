import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getGoldSkillFn, saveGoldSkillFn, clearGoldSkillFn } from "@/lib/identify-plant.functions";
import { suggestSkillMeta, GOLD_SKILL_MAX_CHARS } from "@/lib/gold-skill";

/**
 * 「金叶详页创作指导 Skill」控制台。
 *
 * 管理员把一整份 skill markdown（如 ccplants-v19 的 SKILL.md）粘进来 → 它被注入金叶详页的
 * 三轮撰稿 prompt → 版本号署在详页页尾。改完**全站立即生效、不需要部署**。
 *
 * 版面刻意跟 ModelQueueConsole 保持一致（同样的标题条 / 展开按钮 / 收起时的摘要行），
 * 因为它们并排出现在「配置 AI 模型」里，长得不一样反而让人以为是两套东西。
 */
export function GoldSkillPanel() {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [enabled, setEnabled] = useState(true);

  const getFn = useServerFn(getGoldSkillFn);
  const saveFn = useServerFn(saveGoldSkillFn);
  const clearFn = useServerFn(clearGoldSkillFn);

  const queryKey = ["gold-skill"];
  const { data: saved } = useQuery({ queryKey, queryFn: () => getFn({}), retry: false });

  // 首次拿到已存配置就灌进表单；之后不再覆盖，免得保存后把正在编辑的内容冲掉。
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !saved) return;
    seeded.current = true;
    setContent(saved.content ?? "");
    setName(saved.name ?? "");
    setVersion(saved.version ?? "");
    setEnabled(saved.enabled ?? true);
  }, [saved]);

  /** 粘贴时自动解析 name/version 预填 —— 只在对应输入框还空着时填，不覆盖手填的值。 */
  const onContentChange = (v: string) => {
    setContent(v);
    const g = suggestSkillMeta(v);
    if (!name.trim() && g.name) setName(g.name);
    if (!version.trim() && g.version) setVersion(g.version);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const c = content.trim();
      if (!c) throw new Error("请先粘贴 skill 正文。");
      if (c.length > GOLD_SKILL_MAX_CHARS)
        throw new Error(
          `正文 ${c.length} 字，超出上限 ${GOLD_SKILL_MAX_CHARS} 字。skill 每次生成会被发送 3 次，太长会显著推高 token 成本。`,
        );
      return await saveFn({
        data: { content: c, name: name.trim(), version: version.trim(), enabled },
      });
    },
    onSuccess: (r: { signature: string; chars: number }) => {
      qc.invalidateQueries({ queryKey });
      toast.success(
        `✅ 已保存创作指导${r.signature ? `「${r.signature}」` : ""}（${r.chars} 字），全站立即生效`,
      );
      setIsOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn({}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      seeded.current = false;
      setContent("");
      setName("");
      setVersion("");
      setEnabled(true);
      toast.success("已清除，金叶详页改回内置底版（页尾不再署版本号）");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sig = [name.trim(), version.trim()].filter(Boolean).join(" ");
  const chars = content.trim().length;
  const over = chars > GOLD_SKILL_MAX_CHARS;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-ink-faint">
          🍃 金叶详页 · 创作指导 Skill
        </span>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="text-[11px] border border-rule px-2.5 py-1 rounded-sm hover:border-ink transition-colors cursor-pointer"
        >
          {isOpen ? "收起" : "粘贴 / 编辑 Skill"}
        </button>
        {saved?.configured ? (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="text-[11px] text-ink-faint hover:text-ink underline underline-offset-2 cursor-pointer disabled:opacity-50"
          >
            恢复内置底版
          </button>
        ) : null}
      </div>

      {/* 收起时也能一眼看到当前生效的是哪一版 —— 这正是页尾署名的那个版本 */}
      <div className="text-[11px] text-ink-faint mb-2 leading-relaxed">
        {saved?.configured ? (
          <>
            当前生效：
            <b className="text-ink">{saved.signature || "（未命名版本）"}</b>
            {saved.enabled === false && (
              <span className="text-destructive">（已停用，走内置底版）</span>
            )}
            {saved.content ? ` · ${saved.content.length} 字` : ""}
            {saved.updatedAt
              ? ` · 更新于 ${new Date(saved.updatedAt).toLocaleString("zh-CN")}`
              : ""}
          </>
        ) : (
          <>
            当前生效：<b className="text-ink">内置底版</b>（premium-page.ts 里移植的
            ccplants-v19），页尾不署版本号。
          </>
        )}
      </div>

      {isOpen && (
        <div className="border border-rule rounded-md p-4 bg-paper/40 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-[11px] text-ink-faint leading-relaxed">
            把 skill 正文（markdown 原样）粘进来，它会注入金叶详页<b>三轮撰稿</b>的 prompt，
            <b>版本号署在详页页尾</b>，方便日后分辨哪些页是哪一版写的。
            <br />
            ⚠️ 两条硬边界：①
            <b>已核实事实（名录 / 保护级别 / 入侵状态）和反虚构协议的优先级永远高于本指导</b>
            ，skill 里写「要生动、要引经据典」也不能授权模型编造；② skill 每生成一页会被
            <b>发送 3 次</b>，字数直接乘 3 进 token 账单，别把整本工作流都贴进来 —— 只留
            <b>风格、结构、写作规则</b>那部分即可，需要工具（联网检索、下载图片、跑脚本）的
            步骤贴进来也不会执行。
          </p>

          <div className="flex gap-2 flex-wrap items-end">
            <label className="text-[11px] text-ink-soft">
              <div className="mb-1">Skill 名</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ccplants"
                className="w-40 text-xs px-2 py-1.5 rounded-sm border border-rule bg-paper"
              />
            </label>
            <label className="text-[11px] text-ink-soft">
              <div className="mb-1">版本号（署在页尾）</div>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v19"
                className="w-28 text-xs px-2 py-1.5 rounded-sm border border-rule bg-paper"
              />
            </label>
            <label className="text-[11px] text-ink-soft inline-flex items-center gap-1.5 pb-1.5">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="cursor-pointer"
              />
              启用（取消则保留内容但走内置底版）
            </label>
          </div>

          <div className="text-[11px] text-ink-faint">
            页尾将显示：
            <span className="font-mono text-ink">
              创作指导 · {sig || "（名与版本都空则整行不显示）"}
            </span>
          </div>

          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={
              "粘贴 SKILL.md 全文…\n（若带 YAML frontmatter，name / version 会自动解析预填）"
            }
            className="w-full text-[11px] font-mono leading-relaxed px-2.5 py-2 rounded-sm border border-rule bg-paper resize-y"
          />

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !content.trim() || over}
              className="text-[11px] px-3 py-1.5 rounded-sm bg-ink text-background hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            >
              {saveMutation.isPending ? "保存中…" : "保存，全站立即生效"}
            </button>
            <span
              className={`text-[11px] ${over ? "text-destructive font-semibold" : "text-ink-faint"}`}
            >
              {chars} / {GOLD_SKILL_MAX_CHARS} 字{over && " —— 超出上限，请精简后再保存"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
