# 用户隔离与权限发布说明

## 实现范围

- Supabase Auth 继续负责注册、邮箱登录与会话；数据库 `profiles.role` 决定 `user/admin`（兼容历史 `customer` 普通用户），不接受注册元数据或请求体中的角色声明。
- 新注册用户固定为 `customer`。管理员登录经 `/admin` 进入原有首页 `/dashboard`，客户进入 `/accounts`。
- 客户菜单：账号管理、进度管理、同步管理。管理员菜单：首页、账号管理（三个平台）、进度管理、同步管理、数据统计、Excel导出、操作日志、用户管理、系统设置。Excel菜单定位到原账号页导出按钮，沿用当前页面的筛选和导出逻辑。
- 管理员可创建用户、编辑显示名称、切换角色、启用/停用用户、查看所有用户的业务账号和订单进度，并管理系统配置、备份与系统日志。停用保留用户及业务数据，立即阻止已有会话的数据访问。禁止禁用/降级自己，并在数据库内串行检查管理员变更。
- 普通用户的业务 API 按会话 `user_id` 过滤，不接受外部 `user_id` 指定查询范围；管理员使用同一业务 API 时不加当前用户限制，可查看、编辑、删除、同步、导出所有账号及进度。管理员修改他人账号、绑定或进度时保留原所有者，操作日志记录实际操作管理员。`/api/admin/*`、系统设置和备份仍只允许管理员访问。
- `accounts`、`progress`、`sport_world_accounts`、`sport_world_run_records`、`sport_world_sync_logs` 均增加非空 `user_id`、索引和行级权限。项目原有同步日志实际表名为 `sport_world_sync_logs`，没有另建或重命名为 `sync_logs`，以保留同步链路。
- 数据库触发器强制子记录与父账号归属一致，并禁止更换账号所有者。服务端定时任务写入进度/同步日志时仍保留账号所属用户。
- 学校、分类、跑步类型和人脸选项是共享配置：客户可读取、在账号录入时新增选项；只有管理员可以修改或删除共享选项，避免影响其他用户账号。
- 账号创建、编辑、软删除、密码加密、订单时间边界、人工进度覆盖及同步计算逻辑保持原有规则。账号唯一约束变为“用户 + 学校 + 登录账号”，允许不同客户独立录入同一平台账号。

## 本次权限修复升级

已执行用户隔离迁移的数据库，只需执行 `supabase/migrations/20260924020000_role_permission_fix.sql`，然后发布应用代码。该迁移允许 `user` 角色并兼容原有 `customer`，不改写业务记录、现有角色或数据归属，也不放宽普通用户 RLS。它继续限制角色变更为管理员专属操作，并禁止管理员降级或禁用自己。不要在已有 `user` 角色的数据库上重新执行旧版隔离迁移。

## 已有数据库迁移

在业务低峰暂时停止写入和定时同步，保留数据库备份。应用代码和数据库迁移需要同一发布窗口切换；旧代码不应继续用于新用户注册后的生产流量。

1. 确认此前的业务迁移已经执行，尤其 `20260924000000_order_progress_count.sql`。
2. 在 SQL Editor 检查现有角色：

   ```sql
   select id, email, role from public.profiles order by created_at;
   ```

   已有 `admin` 保持 `admin`，已有 `customer` 保持 `customer`。从无 `role` 字段的旧版升级时，现存 profile 按旧版管理员身份回填为 `admin`；之后注册的用户为 `customer`。不要批量把客户提升为管理员。

3. 执行 `supabase/migrations/20260924010000_user_isolation.sql`。迁移在一个事务中完成并可重复运行：
   - 保留全部原记录、密码密文、时间戳与业务计数。
   - 已有 `user_id` 不变；缺少归属时优先使用最早创建审计日志的操作者。
   - 没有可靠创建日志的旧账号归入最早的现有管理员。
   - 如果存在无主旧数据但没有管理员，迁移报错并回滚。先根据实际身份把原管理员的 profile 设置为 `admin`，再重试；不自动把任意客户提权。
   - 子表归属从账号继承；删除旧的宽松 RLS 策略并重新创建。
4. 接着执行 `supabase/migrations/20260924020000_role_permission_fix.sql`，并检查归属完整性：

   ```sql
   select user_id, count(*) from public.accounts group by user_id;
   select count(*) as mismatched_progress from public.progress p
   join public.accounts a on a.id = p.account_id where p.user_id <> a.user_id;
   select count(*) as mismatched_logs from public.sport_world_sync_logs l
   join public.accounts a on a.id = l.account_record_id where l.user_id <> a.user_id;
   ```

5. 构建、切换新代码后，以管理员和两个普通客户分别检查页面、自己的记录、跨用户 ID、同步及配置权限，再恢复定时任务。

老备份恢复时优先沿用当前账号所有者；快照明确指定的归属若与当前记录冲突，恢复拒绝执行。老快照中已不存在、又没有所有者的账号使用备份创建人（系统备份使用恢复管理员）作为归属。全量备份及恢复 API 和 Storage 仅允许管理员访问。

## 全新安装

执行完整 `supabase/schema.sql`，其中包含当前业务字段和隔离迁移。不要再执行旧迁移去覆盖新版 RLS。注册第一个账号后，由项目数据库所有者在 SQL Editor 精确设置该账号为管理员：

```sql
update public.profiles set role = 'admin', is_active = true
where id = '<已确认管理员的 auth.users UUID>'::uuid;
```

后续用户由注册或管理员后台创建；服务端 `SUPABASE_SERVICE_ROLE_KEY` 仅用于受保护的用户创建及定时任务，不可下发浏览器。

## 本地验证

```bash
npm run test:permissions
npm run test:business
npm run build
# 默认使用本机 Chrome；其他安装位置通过 TEST_CHROME_PATH 指定
npm run test:permissions:browser
```

权限测试使用真实嵌入式 PostgreSQL（PGlite）执行迁移、RLS 和触发器，同时用无 RLS 的 API 测试数据库单独验证 API 自身的过滤。覆盖未登录、跨用户读写/删、密码、同步、请求归属伪造、角色提权、管理员管理、停用后的旧会话、定时任务、旧备份、角色跳转与菜单。测试不连接生产 Supabase，也不调用真实运动世界接口。

浏览器检查以真实 Next 应用配合本地模拟 Auth/PostgREST 服务验证登录、菜单、用户创建/角色修改、跨租户拦截及停用；截图保存在被 Git 忽略的 `test-results/`。生产数据库迁移与应用发布需按以上步骤执行，本地测试不会自动发布或修改生产数据库。
