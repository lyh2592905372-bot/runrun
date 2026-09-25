// Old snapshots predate tenancy. Existing owners always win; never default an
// existing customer's account to the administrator performing the restore.
export function restoreAccountOwners<T extends { id: string; user_id?: string | null }>(
  accounts: T[], existing: { id: string; user_id: string }[], fallbackOwner: string,
) {
  const owners = new Map(existing.map(a => [a.id, a.user_id]));
  return accounts.map(account => {
    const currentOwner = owners.get(account.id);
    if (currentOwner && account.user_id && currentOwner !== account.user_id) throw new Error('备份中的账号归属与当前数据不一致，恢复已取消');
    return { ...account, user_id: currentOwner || account.user_id || fallbackOwner };
  });
}
