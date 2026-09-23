export const ACCOUNT_PLATFORMS = [
  { slug: 'sport-world', name: '运动世界' },
  { slug: 'flash-campus', name: '闪动校园' },
  { slug: 'alipay-sunshine', name: '支付宝阳光跑' },
] as const;

export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]['name'];

export function accountPlatformFromPathname(pathname: string): AccountPlatform {
  return ACCOUNT_PLATFORMS.find((platform) => pathname === `/accounts/${platform.slug}`)?.name || '运动世界';
}
