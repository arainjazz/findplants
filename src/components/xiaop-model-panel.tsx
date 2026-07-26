import { XiaoPLogo } from "@/components/xiaop-logo";
import { useAuth } from "@/hooks/use-auth";
import { isOwnerEmail } from "@/lib/leaves";
import { ModelQueueConsole } from "@/components/model-queue-console";

/**
 * 小P蛙的模型控制台。配置机制与「AI 模型」「疑似复核」两个控制台完全一致 ——
 * 共用 <ModelQueueConsole>，只是存到 site_config 的另一个 key。
 */
export function XiaoPModelPanel() {
  const { user } = useAuth();
  if (!isOwnerEmail(user?.email)) return null;

  return (
    <ModelQueueConsole
      consoleId="xiaop"
      visionProbe
      title="管理员 · 小P蛙 模型控制台"
      titleIcon={<XiaoPLogo className="w-3.5 h-4" />}
      intro={
        <p className="text-[11px] text-ink-faint leading-relaxed">
          小P蛙对话 / 改写用的模型，与识别一线模型互相独立。未配置时回退到 .env 里的 Gemini。
        </p>
      }
    />
  );
}
