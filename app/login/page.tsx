import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,_#e7e5ff,_transparent_40%),#f6f8fc] p-6"><div className="w-full max-w-md"><div className="mb-8 text-center"><img src="/snowflake-sports-avatar.png" alt="雪花运动" className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover shadow-soft" /><h1 className="text-2xl font-bold tracking-tight">雪花运动</h1><p className="mt-2 text-sm text-slate-500">科技不再是高高在上，而是服务于人民</p></div><LoginForm /></div></main>;
}
