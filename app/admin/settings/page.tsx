import Link from 'next/link';
import SettingsPage from '@/app/(dashboard)/settings/page';
export default function AdminSettingsPage() {
  return <><div className="mb-4 flex gap-3"><Link className="btn-secondary" href="/admin/backups">数据备份</Link><Link className="btn-secondary" href="/admin/logs">系统操作记录</Link></div><SettingsPage /></>;
}
