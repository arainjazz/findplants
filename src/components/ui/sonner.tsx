import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // 🔑 **必须显式指定位置**，而且这个位置被两边夹着：
      //   · sonner 默认的**右下角**常驻着小P蛙（浮标 + 进度条 + 名牌，全站每页都有）；
      //   · 2026-07-29 为躲开它挪到了 `top-center` —— 结果压住了**吸顶导航栏**，
      //     用户 2026-07-31 报「白色提示框遮挡阅读和遮挡导航按钮」，就是这一下。
      // 左下角是全站唯一两头都不占的角：导航在顶，小P蛙在右下。
      position="bottom-left"
      // 桌面端收窄 + 顶住左边，保证它**永远伸不到右下角**去盖小P蛙。
      style={{ "--width": "min(360px, calc(100vw - 5.5rem))" } as React.CSSProperties}
      // 📱 移动端另算：sonner 在 max-width:600px 下会强制 `width:100%`（见它自己的
      // styles，`--width` 在那儿不起作用），所以横向躲不开 —— 只能**纵向**抬过去。
      // 实测 375×812 下小P蛙浮标占据距底 96–170px，故抬到 11.5rem(184px) 之上。
      mobileOffset={{ bottom: "11.5rem", left: "0.75rem", right: "0.75rem" }}
      offset={{ bottom: "1.25rem", left: "1.25rem" }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
