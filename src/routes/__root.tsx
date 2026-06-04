import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="label mb-2">404 · Specimen not found</p>
        <h1 className="text-5xl font-display font-bold mb-4">未收录此条目</h1>
        <p className="text-ink-faint mb-6">这页可能尚未编纂，或已被移除。</p>
        <Link to="/" className="inline-block border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors">回到首页</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="label mb-2">Error</p>
        <h1 className="text-3xl font-display font-bold mb-3">页面加载出错</h1>
        <p className="text-ink-faint text-sm mb-5">{error.message}</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors"
          >重试</button>
          <a href="/" className="border border-ink/40 px-4 py-2 hover:bg-paper-deep transition-colors">回首页</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Plantspedia · 协作植物志" },
      { name: "description", content: "Plantspedia 是一个由社区共同编纂的植物科普图鉴，收录每一种值得记住的草木。" },
      { property: "og:title", content: "Plantspedia · 协作植物志" },
      { property: "og:description", content: "Plantspedia 是一个由社区共同编纂的植物科普图鉴，收录每一种值得记住的草木。" },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Plantspedia · 协作植物志" },
      { name: "twitter:description", content: "Plantspedia 是一个由社区共同编纂的植物科普图鉴，收录每一种值得记住的草木。" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/zNVdOZo7vJdDgkRC9D3hxVC775I2/social-images/social-1778659443463-油松插画.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/zNVdOZo7vJdDgkRC9D3hxVC775I2/social-images/social-1778659443463-油松插画.webp" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=EB+Garamond:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600;700&family=Cormorant+SC:wght@500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
