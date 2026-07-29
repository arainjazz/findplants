import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // 🔑 **必须显式指定位置**。sonner 默认就是右下角 —— 而右下角现在常驻着小P蛙
      // （浮标 + 进度条 + 名牌，全站每页都有）。用户 2026-07-29 报的
      // 「白条仍然对颜色进度条造成遮挡」，遮挡物就是这里飘出来的 toast，
      // 不是小P蛙自己的白名牌。挪到顶部居中，两者从此不再抢同一块地方。
      position="top-center"
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
