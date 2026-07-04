import { useEffect, useRef, useState } from "react";
import { XiaoPLogo } from "@/components/xiaop-logo";
import { searchPlantImages, type PlantImgHit } from "@/components/html-doc-editor";
import { XiaoPUserSettings } from "@/components/xiaop-user-settings";
import { getUserModel, type XiaoPUserModel } from "@/lib/xiaop-user-model";
import { toast } from "sonner";

type ChatMsg = {
  id: string;
  role: "user" | "agent";
  text: string;
  canEdit?: boolean;
  editInstruction?: string;
  imageEdit?: boolean;
  imageQuery?: string;
  showImages?: boolean;
  refGroups?: { query: string; images?: PlantImgHit[]; loading: boolean }[];
  applying?: boolean;
  applied?: boolean;
};

export type AgentAskResult = {
  reply: string;
  canEdit: boolean;
  editInstruction: string;
  imageEdit?: boolean;
  imageQuery?: string;
  showImages?: boolean;
  imageQueries?: string[];
};
export type AgentHistory = { role: "assistant" | "user"; text: string }[];

const uid = () => Math.random().toString(36).slice(2);
const chatStore = (key?: string) => `xiaop-chat:${key}`;
const HIDE_KEY = "xiaop-launcher-hidden";

/** Restore a page's saved conversation (sessionStorage). Transient flags are not
 *  persisted, so nothing comes back mid-"applying". */
function loadChat(key?: string): ChatMsg[] {
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(chatStore(key));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveChat(key: string | undefined, messages: ChatMsg[]) {
  if (!key || typeof window === "undefined") return;
  try {
    if (!messages.length) {
      window.sessionStorage.removeItem(chatStore(key));
      return;
    }
    const slim = messages.map(({ applying: _applying, ...m }) => m);
    window.sessionStorage.setItem(chatStore(key), JSON.stringify(slim));
  } catch {
    /* quota / serialization issues are non-fatal — chat just won't persist */
  }
}

/**
 * 小P蛙 (Plantspedia AI agent) — a reusable chat panel. The host page supplies
 * `ask` (chat → reply + optional edit instruction) and `apply` (commit an agreed
 * edit). An optional `scopes` list lets the editor focus the conversation on one
 * part of the page (annotation); otherwise it concerns the whole content.
 */
export function XiaoPAgentPanel({
  greetingTitle,
  canApply,
  scopes,
  ask,
  apply,
  onImageReplace,
  storageKey,
}: {
  greetingTitle?: string | null;
  canApply: boolean;
  scopes?: { label: string; value: string }[];
  ask: (question: string, history: AgentHistory, scope?: string) => Promise<AgentAskResult>;
  apply: (instruction: string, scope?: string) => Promise<void>;
  onImageReplace?: (query: string, instruction: string) => void;
  /** Persist this page's conversation under this key so it survives leaving and
   *  re-entering the page (per-page memory). Omit to keep chat ephemeral. */
  storageKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadChat(storageKey));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [scope, setScope] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [userModel, setUserModelState] = useState<XiaoPUserModel | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Bumped on every send/stop; an in-flight reply whose seq no longer matches
  // is discarded — that's all the 停止 button needs to do.
  const seqRef = useRef(0);

  // Launcher hide-to-tab (mobile swipe). null = logo shown; "left"/"right" =
  // collapsed to a file-folder-style tab docked on that edge.
  const [hiddenSide, setHiddenSide] = useState<null | "left" | "right">(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(HIDE_KEY);
    return v === "left" || v === "right" ? v : null;
  });
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const didSwipe = useRef(false);
  const setHidden = (side: null | "left" | "right") => {
    setHiddenSide(side);
    try {
      if (side) window.localStorage.setItem(HIDE_KEY, side);
      else window.localStorage.removeItem(HIDE_KEY);
    } catch {
      /* localStorage unavailable — non-fatal, state still lives in memory */
    }
  };
  const onSwipeStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
    didSwipe.current = false;
  };
  const readSwipe = (e: React.TouchEvent): "left" | "right" | null => {
    const s = swipeStart.current;
    swipeStart.current = null;
    if (!s) return null;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
    return null;
  };
  // Launcher: swipe → hide the logo to a side tab; tap → open chat.
  const onLauncherTouchEnd = (e: React.TouchEvent) => {
    const dir = readSwipe(e);
    if (dir) {
      didSwipe.current = true;
      setHidden(dir);
    }
  };
  // Side tab: swipe → open the chat straight away; tap → restore the logo.
  const onTabTouchEnd = (e: React.TouchEvent) => {
    const dir = readSwipe(e);
    if (dir) {
      didSwipe.current = true;
      setHidden(null);
      setOpen(true);
    }
  };

  // Reflect the user's own model (localStorage) in the footer; re-read when opened.
  useEffect(() => {
    if (open) setUserModelState(getUserModel());
  }, [open]);

  // Per-page memory: persist this conversation so it's still here when the user
  // leaves the page and comes back (the component unmounts on route change).
  useEffect(() => {
    saveChat(storageKey, messages);
  }, [messages, storageKey]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  // On desktop, push the page content left while the panel is open so the docked
  // panel sits in the freed right gutter instead of overlapping the text. On
  // narrow screens it stays an overlay (no room to reflow).
  const PANEL_W = 384;
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const prev = document.body.style.paddingRight;
    document.body.style.paddingRight = `${PANEL_W}px`;
    document.body.style.transition = "padding-right 0.2s ease";
    return () => {
      document.body.style.paddingRight = prev;
    };
  }, [open]);

  /** 停止：丢弃当前进行中的回复/改写结果，恢复输入。 */
  const stop = () => {
    seqRef.current++;
    setSending(false);
    setMessages((prev) => {
      const wasApplying = prev.some((m) => m.applying);
      const out = prev.map((m) => (m.applying ? { ...m, applying: false } : m));
      out.push({
        id: uid(),
        role: "agent" as const,
        text: wasApplying
          ? "（已停止等待。注意：若服务器端改写恰好已完成，修改仍可能被保存——可到页面底部「修改记录」查看并撤销。）"
          : "（已停止本次回复）",
      });
      return out;
    });
  };

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    const mySeq = ++seqRef.current;
    const userMsg: ChatMsg = { id: uid(), role: "user", text: q };
    const history: AgentHistory = messages.map((m) => ({
      role: m.role === "agent" ? "assistant" : "user",
      text: m.text,
    }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      const res = await ask(q, history.slice(-24), scope || undefined);
      if (seqRef.current !== mySeq) return; // stopped — discard this reply
      const agentId = uid();
      // Dedup queries case-insensitively so the same species isn't shown twice.
      const rawQ = res.imageQueries && res.imageQueries.length
        ? res.imageQueries
        : res.imageQuery
          ? [res.imageQuery]
          : [];
      const seenQ = new Set<string>();
      const queries = rawQ
        .map((s) => s.trim())
        .filter((s) => {
          const k = s.toLowerCase();
          if (!s || seenQ.has(k)) return false;
          seenQ.add(k);
          return true;
        })
        .slice(0, 4);
      const wantImages = !!res.showImages && queries.length > 0;
      setMessages((prev) => [
        ...prev,
        {
          id: agentId,
          role: "agent",
          text: res.reply || "（小P蛙没有给出回复）",
          canEdit: res.canEdit && (!!res.editInstruction || !!res.imageEdit),
          editInstruction: res.editInstruction,
          imageEdit: res.imageEdit,
          imageQuery: res.imageQuery,
          showImages: res.showImages,
          refGroups: wantImages ? queries.map((query) => ({ query, loading: true })) : undefined,
        },
      ]);
      if (wantImages) void fetchRefImages(agentId, queries);
    } catch (e) {
      if (seqRef.current !== mySeq) return; // stopped — swallow the late error
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "agent", text: "出错了：" + (e instanceof Error ? e.message : "请稍后再试") },
      ]);
    } finally {
      if (seqRef.current === mySeq) setSending(false);
    }
  };

  const fetchRefImages = async (msgId: string, queries: string[]) => {
    await Promise.all(
      queries.map(async (query) => {
        let imgs: PlantImgHit[] = [];
        try {
          const raw = await searchPlantImages(query, 8);
          const seen = new Set<string>();
          imgs = raw.filter((im) => {
            if (!im.full || seen.has(im.full)) return false;
            seen.add(im.full);
            return true;
          });
        } catch {
          imgs = [];
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  refGroups: (m.refGroups ?? []).map((g) =>
                    g.query === query ? { ...g, images: imgs, loading: false } : g,
                  ),
                }
              : m,
          ),
        );
      }),
    );
  };

  const doApply = async (msg: ChatMsg) => {
    if (!msg.editInstruction) return;
    const mySeq = ++seqRef.current;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, applying: true } : m)));
    try {
      await apply(msg.editInstruction, scope || undefined);
      if (seqRef.current !== mySeq) return; // stopped — result discarded by host
      toast.success("小P蛙已采纳修改并保存。");
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, applying: false, applied: true } : m)),
      );
    } catch (e) {
      if (seqRef.current !== mySeq) return;
      toast.error(e instanceof Error ? e.message : "修改失败，请重试");
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, applying: false } : m)));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const scopeLabel = scopes?.find((s) => s.value === scope)?.label;
  const busy = sending || messages.some((m) => m.applying);

  return (
    <>
      {/* Launcher — logo + caption, right side. Swipe left/right (mobile) to
          collapse it to a side tab so it stops covering the article. */}
      {!open && !hiddenSide && (
        <button
          onClick={() => {
            if (didSwipe.current) {
              didSwipe.current = false;
              return;
            }
            setOpen(true);
          }}
          onTouchStart={onSwipeStart}
          onTouchEnd={onLauncherTouchEnd}
          title="小P蛙 · Plantspedia AI agent（左右滑动可收到侧边）"
          className="fixed bottom-24 right-3 md:bottom-8 md:right-6 z-40 flex flex-col items-center gap-1 group animate-in fade-in slide-in-from-right-2 touch-pan-y"
        >
          <XiaoPLogo className="w-10 h-10 md:w-20 md:h-20 drop-shadow-lg group-hover:scale-105 group-active:scale-95 transition-transform" />
          <span className="flex flex-col items-center text-center font-semibold text-leaf-deep bg-paper/90 border border-leaf/30 rounded-lg px-2 py-0.5 leading-tight whitespace-nowrap shadow-sm">
            <span className="text-[10px]">小P蛙</span>
            <span className="text-[9px] font-normal text-ink-soft">Plantspedia AI Agent</span>
          </span>
        </button>
      )}

      {/* Collapsed side tab — after swiping the launcher aside. Tap restores the
          logo; swiping the tab opens the chat straight away. */}
      {!open && hiddenSide && (
        <button
          onClick={() => {
            if (didSwipe.current) {
              didSwipe.current = false;
              return;
            }
            setHidden(null);
          }}
          onTouchStart={onSwipeStart}
          onTouchEnd={onTabTouchEnd}
          title="唤出小P蛙（点击展开图标，滑动直接对话）"
          className={`fixed top-1/2 -translate-y-1/2 z-40 bg-leaf/90 text-background shadow-lg py-3 px-1 animate-in fade-in ${
            hiddenSide === "left"
              ? "left-0 rounded-r-xl slide-in-from-left-2"
              : "right-0 rounded-l-xl slide-in-from-right-2"
          }`}
        >
          <span className="[writing-mode:vertical-rl] text-[11px] font-semibold tracking-wide">唤出小P蛙</span>
        </button>
      )}

      {/* Dim backdrop — mobile only (bottom sheet). Tap to dismiss. On desktop the
          panel docks in a freed right gutter, so no backdrop is used. */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Chat panel. Desktop: docked to the right edge as a side conversation.
          Mobile: a bottom sheet (ChatGPT-style) so it never overlaps the body. */}
      {open && (
        <div
          className="fixed z-50 flex flex-col bg-paper shadow-2xl overflow-hidden
            inset-x-0 bottom-0 top-auto h-[85dvh] max-h-[85dvh] rounded-t-2xl border-t border-rule
            [animation:xiaopSheetIn_0.28s_ease-out]
            md:[animation:xiaopDockIn_0.3s_ease-out]
            md:inset-x-auto md:top-16 md:right-0 md:bottom-0 md:h-auto md:max-h-none md:w-[370px] md:max-w-[90vw]
            md:rounded-none md:border-t-0 md:border-l"
        >
          {/* Mobile drag handle */}
          <div className="md:hidden pt-2 pb-1 flex justify-center shrink-0">
            <span className="w-10 h-1 rounded-full bg-ink/15" />
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 md:py-3 border-b border-rule/60 bg-leaf/8 shrink-0">
            <XiaoPLogo className="w-9 h-9 md:w-10 md:h-10 shrink-0" />
            <div className="leading-tight min-w-0">
              <p className="text-sm font-bold truncate">
                {showSettings ? "小P蛙 · 模型设置" : "小P蛙 · Plantspedia AI agent"}
              </p>
              <p className="text-[10px] text-ink-faint truncate">
                {showSettings ? "配置你自己的大模型（需支持视觉）" : "有疑问？问问我，也能帮你改"}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              title="收起对话"
              className="ml-auto shrink-0 flex flex-col items-center gap-0.5 text-ink-soft hover:text-ink cursor-pointer"
            >
              <span className="w-8 h-8 rounded-md border border-rule/70 hover:bg-ink/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </span>
              <span className="text-[9px] leading-none md:hidden">收起对话</span>
            </button>
          </div>

          {/* Per-user model settings view (swaps out the chat body) */}
          {showSettings ? (
            <XiaoPUserSettings onClose={() => setShowSettings(false)} onSaved={setUserModelState} />
          ) : (
          <>
          {/* Scope (annotation) selector */}
          {scopes && scopes.length > 0 && (
            <div className="px-3 py-2 border-b border-rule/40 bg-paper-deep/30 shrink-0">
              <label className="text-[10px] text-ink-faint block mb-1">讨论范围（标注）</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="w-full text-xs bg-background border border-rule/70 rounded-lg px-2 py-1.5 outline-none focus:border-leaf cursor-pointer"
              >
                <option value="">整页 · 全文</option>
                {scopes.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-xs text-ink-faint leading-relaxed bg-paper-deep/30 border border-rule/40 rounded-xl p-3">
                我是你的博物小助理，
                {userModel ? (
                  <>当前使用你配置的「<span className="text-leaf-deep font-medium">{userModel.model}</span>」作为我的大脑</>
                ) : (
                  "默认使用 Gemini 2.5 Flash 来作为我的大脑"
                )}
                ，如果你发现内容什么问题我可以帮你调查，帮你修改（修改前会让你点「采纳并保存」）。如果你想使用你自己的智能模型，可以点击右下方的齿轮图标进行配置。准确的换图操作请在输入框的下方进行。
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-ink text-background px-3 py-2 text-sm whitespace-pre-wrap"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm bg-paper-deep/50 border border-rule/50 px-3 py-2 text-sm whitespace-pre-wrap"
                  }
                >
                  <p className="leading-relaxed">{m.text}</p>
                  {m.role === "agent" && m.refGroups && m.refGroups.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {dedupGroups(m.refGroups).map((g) => (
                        <div key={g.query}>
                          <p className="text-[11px] font-semibold text-ink-soft italic mb-1">{g.query}</p>
                          {g.loading ? (
                            <p className="text-[11px] text-ink-faint">正在联网搜索参考照片…</p>
                          ) : g.images && g.images.length > 0 ? (
                            <div className="grid grid-cols-3 gap-1.5">
                              {g.images.map((img, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setPreview(img.full)}
                                  title={`${img.title}${img.credit ? " · " + img.credit : ""}（点击预览）`}
                                  className="block aspect-square overflow-hidden rounded-lg border border-rule/60 bg-paper-deep/30 cursor-zoom-in"
                                >
                                  <img src={img.thumb} alt={img.title} loading="lazy" className="w-full h-full object-cover" />
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-ink-faint">没搜到，换个搜索词（拉丁名）试试。</p>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-ink-faint">
                        参考照片来自 iNaturalist / GBIF / 维基共享，点击在本页预览，仅供比对鉴定。
                      </p>
                    </div>
                  )}
                  {m.role === "agent" && m.canEdit && (
                    <div className="mt-2 pt-2 border-t border-rule/40">
                      <p className="text-[11px] text-ink-faint mb-1.5">
                        {m.imageEdit ? "建议换图：" : "建议修改："}{m.editInstruction}
                      </p>
                      {canApply ? (
                        m.applied ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-leaf-deep font-semibold">
                            <CheckIcon className="w-3.5 h-3.5" /> 已采纳并保存
                          </span>
                        ) : m.imageEdit && onImageReplace ? (
                          <button
                            onClick={() => onImageReplace(m.imageQuery || "", m.editInstruction || "")}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold border border-leaf text-leaf-deep px-2.5 py-1 rounded-full hover:bg-leaf hover:text-background transition-colors cursor-pointer"
                          >
                            <SearchIcon className="w-3.5 h-3.5" /> 搜图并替换配图
                          </button>
                        ) : (
                          <button
                            onClick={() => doApply(m)}
                            disabled={m.applying}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold border border-leaf text-leaf-deep px-2.5 py-1 rounded-full hover:bg-leaf hover:text-background transition-colors cursor-pointer disabled:opacity-60"
                          >
                            {m.applying ? (
                              <>
                                <span className="w-3 h-3 rounded-full border-2 border-leaf/30 border-t-leaf animate-spin" />
                                修改中…
                              </>
                            ) : (
                              <>
                                <CheckIcon className="w-3.5 h-3.5" /> 采纳并保存
                              </>
                            )}
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] text-ink-faint">登录为编辑后可一键应用</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-paper-deep/50 border border-rule/50 px-3 py-2.5">
                  <span className="flex gap-1">
                    <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
                  </span>
                </div>
              </div>
            )}
          </div>

          <div
            className="border-t border-rule/60 p-2.5 shrink-0 bg-paper"
            style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
          >
            {scopeLabel && (
              <p className="text-[10px] text-leaf-deep mb-1.5">正在针对：{scopeLabel}</p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="向小P蛙描述疑问或想改的地方…"
                /* 16px on mobile stops iOS Safari from auto-zooming (and widening
                   the sheet) on focus; back to text-sm from md up. */
                className="flex-1 resize-none max-h-28 text-base md:text-sm bg-background border border-rule/70 rounded-xl px-3 py-2 outline-none focus:border-leaf placeholder:text-ink-faint"
              />
              {busy ? (
                <button
                  onClick={stop}
                  title="停止"
                  className="w-9 h-9 shrink-0 rounded-full bg-vermilion text-background flex items-center justify-center hover:opacity-85 transition-opacity cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!input.trim()}
                  title="发送"
                  className="w-9 h-9 shrink-0 rounded-full bg-leaf text-background flex items-center justify-center hover:bg-leaf-deep transition-colors cursor-pointer disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
                  </svg>
                </button>
              )}
            </div>
            {/* Current model + quick actions (bottom row) */}
            <div className="flex items-center justify-between gap-2 mt-1.5 px-0.5">
              <span className="text-[10px] text-ink-faint truncate">
                {userModel ? (
                  <>模型：<span className="text-leaf-deep font-medium">{userModel.model}</span>（我的）</>
                ) : (
                  <>模型：站点默认</>
                )}
              </span>
              <span className="flex items-center gap-3 md:gap-2.5 shrink-0">
                {canApply && onImageReplace && (
                  <button
                    type="button"
                    onClick={() => onImageReplace("", "编辑手动发起：更换页面配图")}
                    title="点选页面里的一张配图，搜图或本地上传后直接替换"
                    className="inline-flex items-center gap-1.5 md:gap-1 text-sm md:text-[10px] text-ink-soft hover:text-leaf-deep cursor-pointer py-1"
                  >
                    <ImageIcon className="w-5 h-5 md:w-3.5 md:h-3.5" /> 换配图
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  title="配置小P蛙使用的大模型（你自己的 API Key）"
                  className="inline-flex items-center gap-1.5 md:gap-1 text-sm md:text-[10px] text-ink-soft hover:text-leaf-deep cursor-pointer py-1"
                >
                  <GearIcon className="w-5 h-5 md:w-3.5 md:h-3.5" /> 模型设置
                </button>
              </span>
            </div>
          </div>
          </>
          )}
        </div>
      )}

      {/* In-page image preview (lightbox). Click anywhere / the image to close;
          the chat panel stays open underneath. */}
      {preview && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-150"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-label="图片预览"
        >
          <img
            src={preview}
            alt="预览"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={() => setPreview(null)}
          />
          <button
            type="button"
            onClick={() => setPreview(null)}
            aria-label="关闭预览"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-background/90 text-ink flex items-center justify-center shadow-lg cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

/** Dedup images across a message's reference groups by full URL, cap each group
 *  to 6 — fixes "different species showing the same photo" / duplicates. */
function dedupGroups(
  groups: { query: string; images?: PlantImgHit[]; loading: boolean }[],
): { query: string; images?: PlantImgHit[]; loading: boolean }[] {
  const seen = new Set<string>();
  return groups.map((g) => {
    if (g.loading) return g;
    const imgs = (g.images ?? []).filter((im) => {
      if (!im.full || seen.has(im.full)) return false;
      seen.add(im.full);
      return true;
    });
    return { ...g, images: imgs.slice(0, 6) };
  });
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce" style={{ animationDelay: delay }} />
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
