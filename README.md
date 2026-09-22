# 雪花运动 · 学校账号与跑步进度管理

一个可直接部署到公网的 SaaS 后台，使用 Next.js App Router、TypeScript、Tailwind CSS 和 Supabase（Auth + PostgreSQL + RLS + Storage）。用于管理学校、账号、订单、跑步进度、操作审计、Excel 导出和 JSON 数据备份。

## 快速开始

```bash
npm install
copy .env.example .env.local # macOS/Linux 使用 cp
npm run dev
```

打开 `http://localhost:3000`。登录页支持邮箱注册，注册用户默认身份为普通顾客。

## 环境变量

参见 `.env.example`：

* `NEXT_PUBLIC_SUPABASE_URL`：Supabase Project URL
* `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase anon/public key
* `SUPABASE_SERVICE_ROLE_KEY`：服务端加密密钥来源（绝不要暴露给浏览器）
* `NEXT_PUBLIC_APP_URL`：部署后的站点 URL，用于密码重置回调
* `CRON_SECRET`：生产定时器调用自动备份接口的 Bearer 密钥

## Supabase 初始化

1. 创建 Supabase 项目，在 SQL Editor 中完整运行 `supabase/schema.sql`。
2. 在 Storage 创建私有 bucket `backups`，并按 SQL 文件末尾注释增加仅允许用户访问自己文件夹的 Storage policy。
3. 在 Authentication → URL Configuration 中将 Site URL 设置为生产域名，并保留生产与本地开发 Redirect URLs。
4. 在 Authentication → Users 中创建管理员账号。

RLS 已覆盖所有业务表；密码使用服务端 AES-256-GCM 加密后写入 `encrypted_password`，查看密码会写入 `operation_logs`，日志不会保存明文密码。

## 功能模块

* 登录鉴权：Supabase Auth + Next.js Proxy，未登录自动跳转 `/login`
* 首页：账号、学校、订单、公里、已跑/剩余次数统计；即将完成和最近完成任务
* 账号管理：分类/学校级联筛选、跑步类型、是否人脸、备注、下单时间、软删除、加密密码查看、Excel 导出
* 进度管理：移动端卡片、进度条、`[-] / 输入 / [+]` 快速编辑，阻止超过下单次数
* 操作记录：新增/编辑/删除/查看密码/修改进度/备份/恢复的审计日志
* 数据与备份：JSON 快照上传 Supabase Storage、自动备份开关、自定义日期时间、历史列表、强确认恢复
* 设置：账号分类、学校、跑步类型和是否人脸选项的级联 CRUD
* 运动世界自动同步：服务端保存加密凭据，优先复用 Token，分页读取学期跑步记录并自动计算有效次数和公里数

## 运动世界自动同步

新增迁移为 `supabase/migrations/20260921_sport_world_sync.sql`，在 Supabase SQL Editor 中执行，或纳入现有发布迁移流程。旧账号和历史进度不会被删除。

生产环境必须设置 `SPORT_WORLD_CREDENTIAL_KEY`（随机、长期保存且跨发布保持不变的服务端密钥）。默认的 `SPORT_WORLD_PROVIDER=official` 使用内置官方只读客户端，不需要再配置 `SPORT_WORLD_LOGIN_URL`。如需切换到已授权的组织内部代理，设置 `SPORT_WORLD_PROVIDER=proxy`，并同时配置登录、学期进度和历史记录地址；Token 校验地址可选。所有外部请求在服务端发起，并使用 `SPORT_WORLD_API_TIMEOUT_MS` 超时；接口协议变化会记录为 `DATA_PARSE_ERROR`。

管理员在账号编辑弹窗填写运动世界账号和密码后点击“立即同步”。密码和 Token 仅以 AES-256-GCM 密文存储，浏览器 API 只会收到绑定状态和同步结果。已有有效 Token 会优先使用；Token 过期才会使用已保存密码重新认证。官方登录要求 GeeTest v4 时，服务端使用 Chromium 完成登录验证，再调用 `geevalidate` 和登录接口；最多尝试 3 次，失败后停止同步并标记“需要验证”。短信验证、设备确认或其他交互式风控仍需在运动世界校园 App 内完成。

启用自动同步：先在账号的 `sport_world_accounts.sync_enabled` 字段开启（账号列表的“自动/手动”按钮或 `PATCH /api/accounts/:id/sport-world-settings`），再由服务器定时器以 `Authorization: Bearer $CRON_SECRET` 调用 `POST /api/cron/sport-world`。VPS 可直接安装 `deploy/runflow-sport-world.service` 和 `deploy/runflow-sport-world.timer`（每 30 分钟），也可以使用现有调度器。任务每批最多并发 2 个账号，推荐每 15–30 分钟执行一次。关闭自动同步只需将该字段设为 `false`。同步失败不会清空上一次成功的进度。

内置客户端只调用登录验证、登录状态、学期汇总和本人跑步记录接口。自定义接口地址必须是你已获授权使用的组织内部只读代理；项目不会实现模拟跑步、伪造 GPS、提交或修改运动记录。

服务器需安装 Chromium/Chrome。默认会自动查找常见安装路径，也可设置 `SPORT_WORLD_CHROMIUM_PATH`；GeeTest 的 Captcha ID、最大重试次数和单次超时可通过 `SPORT_WORLD_GEETEST_CAPTCHA_ID`、`SPORT_WORLD_GEETEST_MAX_RETRIES`、`SPORT_WORLD_GEETEST_TIMEOUT_MS` 调整。验证实现参考的 MIT 开源项目见 `THIRD_PARTY_NOTICES.md`。

## VPS 生产部署

生产环境使用 Ubuntu、Node.js 22、PM2、Nginx 和 Certbot，完整结构、更新、日志、备份与回滚命令见 `DEPLOYMENT.md`。

VPS 的 `runflow-backup.timer` 每分钟调用一次受 `CRON_SECRET` 保护的 `/api/cron/backup`；接口会根据应用内设置的自动备份开关、频率和日期时间决定是否创建全量 JSON 快照。“立即备份”适合发布前手动留档。

## 质量检查

```bash
npm run build
```

应用不依赖 LocalStorage 作为数据库；浏览器仅保留 Supabase 会话 Cookie。所有关键读写都经过 Supabase RLS 和服务端 API 路由。
