# RunPaceFlow Admin

独立的 RunPaceFlow 配置管理 UI，用来把主应用的环境变量集中到一个可部署的管理服务里。

## 能做什么

- 按分组管理 RunPaceFlow 的数据库、同步源、AI、地图、运动目标配置
- 使用 Turso/libSQL 或本地 SQLite 存储配置
- 对密钥类配置做 AES-GCM 加密后入库
- 提供网页管理、`.env` 导入、`.env` 导出和 Bearer token 导出接口
- 可独立部署到服务器，和主 RunPaceFlow 应用解耦

## 本地启动

```bash
cp .env.example .env.local
bun install
bun run dev
```

默认地址是 `http://localhost:3030`。

## 服务器部署

```bash
cp .env.example .env
docker compose -f docker-compose.example.yml up -d --build
```

配置中心自身需要这些变量：

- `ADMIN_PASSWORD`: 登录密码
- `ADMIN_SESSION_SECRET`: 会话签名密钥
- `SETTINGS_ENCRYPTION_KEY`: 配置加密密钥
- `CONFIG_EXPORT_TOKEN`: 服务端导出 `.env` 使用的 Bearer token
- `CONFIG_DATABASE_URL`: 配置中心数据库地址，可复用 RunPaceFlow 的 Turso/libSQL
- `CONFIG_DATABASE_AUTH_TOKEN`: Turso/libSQL 鉴权 token

如果没有设置 `CONFIG_DATABASE_URL`，应用会回退读取 `DATABASE_URL`。本地也支持 `file:./data/admin.db`。

## 给主应用导出配置

服务器上可以用导出接口生成主应用 `.env`：

```bash
curl -fsSL \
  -H "Authorization: Bearer $CONFIG_EXPORT_TOKEN" \
  https://your-admin-domain.example.com/api/settings/export \
  > .env.production
```

也可以在网页里导入或导出 `.env` 文本。
