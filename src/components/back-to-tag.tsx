import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchTagBySlug } from "@/lib/tags";

// ─── 「← 返回 #标签 名单」──────────────────────────────────────────────────────
//
// 读者从标签名单点进一条条目/草稿时，链接上带着 `?from=<tagSlug>`；这条退路让他看完
// 一条能接着回名单看下一条。
//
// 🔴 **标签名必须回库里查，不能拿 slug 硬凑**（2026-08-09 用户报：退路上写着
// 「← 返回 #59-3-6-0-4-88-89-58-9-79-84-6-48-8-2 名单」）。`slugifyTag` 对中文名的做法是
// **先 encodeURIComponent、再把 `%` 全删掉**，得到的是一串数字与横杠 —— 这个变换
// **不可逆**，`decodeURIComponent` 解不回来（它连 `%` 都找不到，原样吐回那串数字）。
// 从前两处退路都只有这一条 decode 兜底，于是所有中文专题标签的退路都在显示乱码。
//
// 那条 decode 兜底本身仍要留着：**特征词**那条路（AI 自动标注的词，tags 表里没有行）
// 的「slug」就是标签名本身 URL-encode 出来的，decode 回来正是它的名字。
// 所以顺序是：查库拿真名 → 查不到再 decode。
export function BackToTagLink({
  from,
  className = "label text-emerald-700 hover:text-vermilion whitespace-nowrap",
  /** 页面上已经知道的标签名（例如卡签里那一枚）。给了就不必再查一次库。 */
  knownLabel,
}: {
  from: string | null | undefined;
  className?: string;
  knownLabel?: string | null;
}) {
  const slug = from || "";
  const { data: tag, isLoading } = useQuery({
    queryKey: ["tag-by-slug", slug],
    queryFn: () => fetchTagBySlug(slug),
    enabled: !!slug && !knownLabel,
    staleTime: 10 * 60 * 1000,
  });

  if (!slug) return null;

  const decoded = (() => {
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  })();
  const label = knownLabel || tag?.name || (isLoading ? null : decoded);

  return (
    <Link to="/tags/$slug" params={{ slug }} className={className}>
      {/* 名字还没查回来时**不显示 `#` 加一串 slug** —— 那一瞬间读者看到的就是乱码，
          与修掉的那个 bug 是同一个观感。先给一句说得通的话，查到了再换成真名。 */}
      {label ? `← 返回 #${label} 名单` : "← 返回标签名单"}
    </Link>
  );
}
