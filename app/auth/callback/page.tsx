'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/browser';

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/dashboard';
  return value;
}

export default function AuthCallbackPage() {
  const [message, setMessage] = useState('正在完成登录…');

  useEffect(() => {
    let active = true;

    async function completeLogin() {
      const url = new URL(window.location.href);
      const next = safeNextPath(url.searchParams.get('next'));
      const code = url.searchParams.get('code');
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const authError = url.searchParams.get('error_description') || hash.get('error_description');

      if (authError) throw new Error(authError);

      const supabase = createClient();
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) throw error;
      } else {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('登录链接无效或已过期');
      }

      window.history.replaceState(null, '', '/auth/callback');
      window.location.replace(next);
    }

    completeLogin().catch((error: unknown) => {
      window.history.replaceState(null, '', '/auth/callback');
      if (active) setMessage(error instanceof Error ? error.message : '登录失败，请重新登录');
      window.setTimeout(() => window.location.replace('/login'), 1800);
    });

    return () => { active = false; };
  }, []);

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6"><div className="card flex items-center gap-3 px-6 py-5 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /><span>{message}</span></div></main>;
}
