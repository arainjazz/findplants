import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

function readCachedSession(): Session | null {
  if (typeof window === "undefined") return null;
  const ownerSessionRaw = window.localStorage.getItem("owner-auth-session");
  if (ownerSessionRaw) {
    try {
      return JSON.parse(ownerSessionRaw);
    } catch {
      // ignore
    }
  }
  const url = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) return null;
  try {
    const ref = new URL(url).hostname.split(".")[0];
    const raw = window.localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.currentSession ?? parsed ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Always start with null/loading on both server and client first render
  // to avoid hydration mismatch. Cached session is restored in effect below.
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readCachedSession();
    if (cached) {
      setSession(cached);
      setLoading(false);
      // If it's the custom owner session, bypass Supabase listener to prevent it being cleared
      if (cached.user?.id === "owner-admin-id") {
        return;
      }
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut: async () => {
          window.localStorage.removeItem("owner-auth-session");
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
