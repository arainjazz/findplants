import { ModelQueueConsole } from "@/components/model-queue-console";
import {
  getUserSequence,
  setUserSequence,
  clearUserModel,
  getUserModel,
  type XiaoPUserModel,
} from "@/lib/xiaop-user-model";

/**
 * In-panel settings view for the user's OWN 小P蛙 model (API key). Saved to the
 * browser (localStorage) and forwarded on each ask/apply — no login/DB needed.
 * Unset → 小P蛙 falls back to the site default (admin config or Gemini).
 *
 * 配置机制与三个管理员控制台完全一致（共用 <ModelQueueConsole>），只是存储换成
 * 浏览器本地：一个「优先调用序列」，序列 1 失败自动顺位给 2、3…。
 */
export function XiaoPUserSettings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (m: XiaoPUserModel | null) => void;
}) {
  return (
    <div className="space-y-3">
      <ModelQueueConsole
        storage={{
          load: getUserSequence,
          save: setUserSequence,
          clear: clearUserModel,
        }}
        title="我的 小P蛙 模型"
        openLabel="配置我的模型"
        clearLabel="改回站点默认"
        defaultOpen
        onSaved={() => {
          // 父级只关心「现在用的是哪套」——回传序列 1 即可。
          onSaved(getUserModel());
          onClose();
        }}
        intro={
          <p className="text-[11px] text-ink-faint leading-relaxed">
            用你自己的 API Key 驱动 小P蛙。Key <b>只存在这台设备的浏览器里</b>，
            不会上传保存；每次提问时随请求发给模型服务商。不填则使用站点默认模型。
            <br />
            小P蛙要<b>看照片</b>，所以每一项都必须选<b>支持视觉的多模态模型</b>，
            纯文本模型看不到图。
          </p>
        }
      />
      <button
        onClick={onClose}
        className="text-[11px] text-ink-faint hover:text-ink underline underline-offset-2 cursor-pointer"
      >
        返回对话
      </button>
    </div>
  );
}
