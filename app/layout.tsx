import './globals.css';
import { Toaster } from 'sonner';

export const metadata = { title: '雪花运动', description: '科技不再是高高在上，而是服务于人民', icons: { icon: '/snowflake-sports-avatar.png' } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}<Toaster richColors position="top-right" /></body></html>;
}
