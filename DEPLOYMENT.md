# 雪花运动生产部署

本文只记录部署结构和操作命令，不包含任何密码、Token、Cookie 或密钥值。

## 本地一键更新（推荐）

配置根目录 `.deploy.config` 和 SSH KEY 后，在 Git Bash / Bash 中执行 `npm run deploy`；恢复最近一次备份执行 `npm run rollback`。完整首次配置、权限要求、故障恢复和数据保留说明见 [一键部署指南](docs/one-command-deployment.md)。新脚本使用 `/var/www/backup/runflow_年月日_时间_唯一编号/`；下文历史手工流程中的 `/var/backups/runflow/` 不参与自动回滚。新流程不运行数据库迁移或数据恢复。

## 生产信息

- 生产域名：`https://xuehuayd.top`
- 服务器系统：Ubuntu 24.04.2 LTS
- Node.js：22.23.2
- 宝塔 Nginx：1.20.2（由 `bt-nginx-runflow.service` 管理）
- 应用目录：`/var/www/runflow`
- PM2 应用名：`runflow`
- 应用监听：`127.0.0.1:3000`
- 公网入口：宝塔 Nginx `80/443` → `127.0.0.1:3000`
- 数据服务：Supabase Auth、PostgreSQL、Storage
- 自动备份：systemd timer 每分钟检查一次，由应用内开关、频率和计划时间决定是否执行

初次生产部署日期：2026-09-20。

## 生产环境变量

生产变量位于 `/var/www/runflow/.env.production`，权限必须为 `600`：

```text
NEXT_PUBLIC_SUPABASE_URL=<服务器中配置>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<服务器中配置>
SUPABASE_SERVICE_ROLE_KEY=<服务器中配置>
NEXT_PUBLIC_APP_URL=https://xuehuayd.top
CRON_SECRET=<服务器中配置>
SPORT_WORLD_CREDENTIAL_KEY=<独立随机密钥>
SPORT_WORLD_PROVIDER=official
SPORT_WORLD_OFFICIAL_BASE_URL=https://run.gxapp.iydsj.com
SPORT_WORLD_API_TIMEOUT_MS=15000
# 留空时自动使用 playwright-core 安装的 Chromium；使用系统浏览器时填写其绝对路径
SPORT_WORLD_CHROMIUM_PATH=
SPORT_WORLD_GEETEST_CAPTCHA_ID=3b02ad39bd099fd3a8336d9347a189ab
SPORT_WORLD_GEETEST_MAX_RETRIES=3
SPORT_WORLD_GEETEST_TIMEOUT_MS=30000
```

该文件由 `.gitignore` 排除，禁止提交或复制到公开日志。`SPORT_WORLD_CREDENTIAL_KEY` 用于解密已保存的账号密码，首次设置后必须跨发布保持不变。

如需改用已授权的组织内部只读代理，设置 `SPORT_WORLD_PROVIDER=proxy`，并补充 `SPORT_WORLD_LOGIN_URL`、`SPORT_WORLD_PROGRESS_URL`、`SPORT_WORLD_HISTORY_URL`；`SPORT_WORLD_VALIDATE_URL` 可选。代理配置不完整时同步会返回服务不可用，不会进入同步锁。

## DNS 与 HTTPS

 DNSPod 使用根域名 `@` 和 `www` 的 A 记录指向 VPS 公网 IPv4，不修改 MX、TXT 等无关记录。宝塔站点记录为 `xuehuayd.top`，项目目录为 `/var/www/runflow`，反向代理配置位于 `/www/server/panel/vhost/nginx/xuehuayd.top.conf`。证书由 Certbot 管理并供宝塔 Nginx 使用：

```bash
sudo certbot renew --dry-run
systemctl status certbot.timer
```

宝塔面板入口为 `http://103.117.139.225:8888/a28c0728`。宝塔 Nginx 使用 `bt-nginx-runflow.service` 自启动，`/etc/init.d/nginx` 的 `configtest`、`reload` 可用于面板兼容操作。原系统 Nginx 服务已禁用但配置保留在 `/etc/nginx/sites-enabled/runflow`，仅作为回滚备用。

## 常用运维命令

```bash
cd /var/www/runflow
npm ci
npm run build
pm2 restart runflow --update-env
pm2 status
pm2 logs runflow --lines 100
/etc/init.d/nginx configtest
/etc/init.d/nginx reload
systemctl status bt-nginx-runflow.service
```

必须先完成新版本构建，再重启 PM2；构建失败时保持旧进程运行。

## 自动备份

`runflow-backup.timer` 每分钟调用一次生产站点的备份 API；API 会读取“数据与备份”页面保存的开关、频率和下一次执行时间，未启用或未到期时直接跳过。密钥只从 root 可读的环境文件加载，不硬编码到脚本或 unit 文件中。

## 运动世界自动同步

先执行 `supabase/migrations/20260921_sport_world_sync.sql`，确认 `SPORT_WORLD_CREDENTIAL_KEY` 和 `SPORT_WORLD_PROVIDER` 已写入生产环境文件，再安装并启用同步定时器：

```bash
sudo cp deploy/runflow-sport-world.service /etc/systemd/system/
sudo cp deploy/runflow-sport-world.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now runflow-sport-world.timer
systemctl status runflow-sport-world.timer
journalctl -u runflow-sport-world.service --since today
```

定时器每 30 分钟调用 `/api/cron/sport-world`，每批最多并发两个已开启 `sync_enabled` 的账号。内置客户端只读取本人学期进度和跑步记录。登录所需 GeeTest v4 由服务端 Chromium 完成，并在进程内限制为单并发；设备确认、短信验证或验证重试耗尽时会停止并标记为 `need_verify`。

Ubuntu 服务器首次部署需安装 Chromium 运行依赖，并以 `runflow` 用户下载与 `playwright-core` 版本匹配的浏览器：

```bash
cd /var/www/runflow
sudo node node_modules/playwright-core/cli.js install-deps chromium
sudo -u runflow -H node node_modules/playwright-core/cli.js install chromium
sudo -u runflow -H node -e "const { chromium } = require('playwright-core'); console.log(chromium.executablePath())"
```

```bash
systemctl status runflow-backup.timer
journalctl -u runflow-backup.service --since today
sudo systemctl start runflow-backup.service
```

## 日志

```bash
pm2 logs runflow --lines 100
sudo journalctl -u nginx --since today
sudo tail -n 100 /var/log/nginx/error.log
journalctl -u runflow-backup.service --since today
```

## 回滚

每次升级前将当前代码目录打包到 `/var/backups/runflow/`，排除 `node_modules`、`.next` 和环境文件。回滚时保留当前失败版本，恢复最近一次代码备份，重新安装依赖和构建，构建成功后再重启 `runflow`。数据库和 Storage 使用 Supabase 的独立备份策略；恢复业务快照前必须再次确认，避免覆盖生产数据。

## 安全检查

```bash
ss -lntp
curl -I https://xuehuayd.top/.env.production
curl -I https://xuehuayd.top/.git/
```

Node.js 必须只监听 `127.0.0.1:3000`；敏感路径必须返回 `404` 或 `403`。防火墙仅开放实际 SSH 端口及 `80/443`。如需回滚 Nginx，先停止 `bt-nginx-runflow.service`，再启用并启动 `nginx.service`，确认 `nginx -t` 后恢复流量。
