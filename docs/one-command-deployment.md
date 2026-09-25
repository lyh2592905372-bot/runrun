# 本地一键部署与回滚

这套脚本直接通过 SSH/SCP 同步本地文件，不使用 GitHub，不执行 `git push`。只发布代码，不执行 SQL、Supabase migration、数据备份恢复或数据库初始化。适用于已有的 Linux + Node.js 20–22（推荐 22）+ PM2 生产应用。

## 第一次配置

### 1. 本地使用 Bash

Windows 请在 **Git Bash** 中运行命令，本机已安装在 `D:\Git\bin\bash.exe`。打开 Git Bash 后：

```bash
cd /d/平台收集页
```

macOS/Linux 直接使用 Bash。需要 `ssh`、`scp`、`tar` 和本地 npm。在 PowerShell 中运行时，需要先把 Git 的 `bin` 目录加入当前会话 PATH：

```powershell
$env:Path = "D:\Git\bin;" + $env:Path
```

### 2. 建立 SSH KEY 登录

在 Git Bash 中执行；已有专用密钥时可直接使用。密钥可以设置口令，再由 `ssh-agent` 保存解锁状态，不把服务器密码或私钥放入项目：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/runflow_deploy -C runflow-deploy
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/runflow_deploy
```

把公钥安装到服务器账户（替换端口、账户、IP；这一步可能需要输入一次服务器密码）：

```bash
ssh-copy-id -i ~/.ssh/runflow_deploy.pub -p 22 用户名@服务器IP
```

如果没有 `ssh-copy-id`，在服务器终端把 **`.pub` 公钥的一整行**追加到该账户的 `~/.ssh/authorized_keys`，并设置 `~/.ssh` 权限 `700`、`authorized_keys` 权限 `600`。

在本机 `~/.ssh/config` 添加（不要写密码）：

```sshconfig
Host runflow-server
    HostName 服务器IP
    User 服务器用户名
    Port 22
    IdentityFile ~/.ssh/runflow_deploy
    IdentitiesOnly yes
```

首次手动连接，并核对服务器指纹。部署脚本使用严格主机校验，不自动接受未知主机：

```bash
ssh runflow-server
# 退出服务器后，再确认无需输入密码：
ssh -o BatchMode=yes runflow-server true
```

### 3. 填写项目根目录 `.deploy.config`

```ini
SERVER_HOST=runflow-server
SERVER_USER=服务器用户名
SERVER_PORT=22
SERVER_PATH=/var/www/runflow
PM2_NAME=runflow
PRESERVE_PATHS=
```

`SERVER_HOST` 也可以直接填 IP；此时请让 `~/.ssh/config` 的 Host 匹配该 IP，或使用默认 SSH 密钥。配置值不加引号、不写行尾注释。SSH 的连接端口以 `SERVER_PORT` 为准。此文件已加入忽略规则，也不会打包上传。

### 4. 服务器前提

- 已有 `/var/www/runflow`，且它是实际目录；已配置生产 `.env.production` 和 PM2 应用 `runflow`。这套工具用于更新已有服务，不负责初始化数据库、创建 PM2 应用、安装系统浏览器或更改 Nginx。
- `SERVER_USER` 使用应用目录所有者（本项目通常为 `runflow`）或 root。root 登录时，npm 和 PM2 自动以目录所有者运行，避免操作错误的 PM2 实例。
- SSH 非交互会话能找到 `node`、`npm`、`pm2`、`curl`、GNU `tar`、`flock`（Ubuntu 的 util-linux）等命令。root 代应用用户运行时还需要 `sudo`。
- 应用用户需要读写应用目录；执行账户需要写其父目录及备份目录。若使用 `runflow` 直接部署，可由管理员一次性创建备份目录并授予该账户 `/var/www` 的所需权限（例如使用 ACL），不要开放全员写入。
- 默认备份位置为 `/var/www/backup/`；自定义 `SERVER_PATH` 时备份在其父目录的 `backup/` 下。应用用户需要遍历备份根目录的权限。
- PM2 应用的 cwd 必须是 `SERVER_PATH`，监听地址保持现有 `127.0.0.1:3000`；脚本用只读的 `GET /login` 检查 HTTP 2xx。不同端口/健康地址需调整服务器执行脚本。
- 磁盘空间需容纳当前版本、新构建、完整备份快照及保留的旧运行目录。备份包含 `node_modules` 和 `.next`，并保留服务器原有文件权限，不自动清理。

## 日常更新

修改本地代码完成并验证后，在项目根目录运行：

```bash
npm run deploy
```

流程：

1. 检查 SSH KEY 连接，取得本地和服务器并发锁。
2. 打包为 `deploy-package.tar.gz`。排除 `node_modules`、`.git`、所有 `.env*`、`.next`、`dist`、`out`、缓存、日志、历史归档、部署配置/临时目录、私钥、常见本地数据目录。
3. SCP 上传到 `/tmp/runflow-deploy-<唯一编号>.tar.gz`，避免不同发布相互覆盖。
4. 进入服务器现有应用目录，检查 PM2 与 HTTP；备份到 `/var/www/backup/runflow_年月日_时间_唯一编号/snapshot/`。
5. 在相邻临时目录解压新代码，保留服务器环境文件、`.npmrc`、ecosystem 配置，执行 `npm install --include=dev --no-audit --no-fund` 与 `npm run build`。旧应用此时继续运行。
6. 构建成功且配置未变后，把完整旧目录移到此次备份的 `live/`，把新目录切换到 `/var/www/runflow`。旧代码从活动目录整体移出，不在运行目录里先清空代码。
7. 执行 `pm2 restart runflow`；连续检查 PM2 online、进程存在、cwd 正确和 HTTP 响应，再执行 `pm2 status`、`pm2 save`。
8. 成功后标记此备份可回滚，并清理 `/tmp` 上传包。本地压缩包保留。

脚本不使用 `--update-env`，也不上传本地 `.env`。切换前会比较环境文件，发现构建期间配置变化则停止发布。PM2 restart 期间可能有短暂中断，这不是零停机蓝绿部署。

## 数据与服务器配置

默认保留全部根目录 `.env*`、`.npmrc`、`ecosystem.config.cjs/js`。运行数据默认保留 `data`、`uploads`、`storage`、`logs`、`public/uploads`，新版本通过符号链接继续使用原数据位置，包含部署后新增的数据。Supabase 数据库与 Storage 独立于这些代码目录，脚本不操作它们。

其他服务器专用文件/目录必须在第一次部署前填写 `PRESERVE_PATHS`，逗号分隔、项目相对路径、不含空格，例如 `certificates,public/customer-files`。不要填写业务代码目录，不要填写重叠的父子路径。项目不自动识别任意自定义数据路径。

**备份目录内的 `live/` 可能仍被用户文件链接引用，不能直接批量删除备份。** 脚本保留所有备份和失败现场；清理前先确认当前数据链接指向并迁移需要长期保存的数据。备份中可能包含生产配置，沿用服务器文件权限，不应对外提供 Web 访问。

## 失败与回滚

- 安装/构建/解压失败：运行目录不变。
- 切换后的 PM2 重启、HTTP 检查或 `pm2 save` 失败：输出 `pm2 status` 与 `pm2 logs runflow --lines 100 --nostream`，自动移回原目录并重启、检查和保存旧进程；命令返回非零退出码。
- 恢复操作本身遇到权限、磁盘或 PM2 故障时，会明确报错并显示原版本位置，保留现场。无法保证服务器断电、进程被 SIGKILL、磁盘损坏时自动恢复；旧目录仍在备份的 `live/`，可人工恢复。
- 本地中断时尝试清理上传包；服务器锁由 `flock` 在进程退出后释放。机器强制关闭遗留本地 `.deploy-local.lock` 时，确认没有部署进程后再移除该空目录及其中的临时压缩包。

手动恢复最近一次**成功部署前**的版本：

```bash
npm run rollback
```

自动选择最新完成备份中的 `live/`，先备份当前版本，在临时目录恢复旧代码与依赖，使用**当前服务器环境配置重新构建**，成功后切换并重启、检查、保存 PM2。即使当前网站不健康，也允许尝试回滚。回滚不恢复数据库或旧用户文件；回滚失败也会尝试恢复回滚前的目录。每次成功回滚同样保留当前版本备份，再执行一次会恢复到回滚前版本。

## 验证

```bash
bash deploy/test-deployment.sh
```

使用隔离临时目录和模拟 SSH、PM2、npm、HTTP、flock，验证部署、回滚、配置/数据保留、构建/安装/重启/健康检查/保存失败恢复及打包排除规则。不连接生产服务器。在 Windows 上不能证明 Linux 权限和真实 PM2/网络行为；第一次真实部署仍以脚本的服务器检查结果为准。
