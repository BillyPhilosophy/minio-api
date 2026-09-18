# minio-api

NestJS + TypeScript 实现的 MinIO（S3 兼容）**预签名 URL 签发服务**。为多个网站项目统一签发上传 / 下载 / 删除的预签名 URL，后端只签名，**绝不中转文件流**。

## 特性

- 多项目隔离：每个项目一个 `x-api-key` + 全局桶白名单（联合类型，见 `src/presign/allowed-buckets.ts`）+ key 前缀（`<projectId>/`）双重隔离，互不越权
- 上传 key 自动生成 `<projectId>/<yyyy>/<mm>/<uuidv4><ext>`，或用户指定 key（强制加项目前缀 + 路径穿越清洗）
- `expiresIn` 自动 clamp 到 `[60, MAX_EXPIRES_IN]`
- 文件列举 `GET /v1/files`：项目前缀内列文件并附公开直链（ListObjectsV2 分页）；上传响应同时返回 `publicUrl` 直链
- 双 endpoint：`S3_ENDPOINT`（内网，真实 API 调用）与 `S3_PUBLIC_ENDPOINT`（公网，签名与直链）分离，适配 frp 穿透等内外网分离部署
- Swagger 文档挂载在 `/docs`，健康检查 `/health`（无需鉴权）

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 容器内服务端口 | `3100` |
| `S3_ENDPOINT` | MinIO **内网**地址（真实 API 调用，如文件列举），如 `http://minio:9000` | 必填 |
| `S3_PUBLIC_ENDPOINT` | MinIO **公网**地址（预签名 URL 的 host、直链拼接），如 `https://minio.example.com` | 缺省回退 `S3_ENDPOINT` |
| `S3_REGION` | 区域 | `us-east-1` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO 凭据 | 必填 |
| `S3_FORCE_PATH_STYLE` | path-style 访问 | `true` |
| `PROJECTS_JSON` | 项目注册表 JSON | 必填 |
| `DEFAULT_EXPIRES_IN` | 签名默认有效期（秒） | `900` |
| `MAX_EXPIRES_IN` | 有效期上限（秒） | `3600` |

> **内网 MinIO + 公网入口分离的部署**（如 frp 穿透）：`S3_ENDPOINT` 填容器网络可达的内网地址，`S3_PUBLIC_ENDPOINT` 填浏览器可达的公网地址。预签名是纯本地计算，后端无需能访问公网地址；但文件列举等真实调用必须能访问内网地址。

`PROJECTS_JSON` 示例：

```json
{
  "galaxy": { "apiKey": "gk_xxx..." },
  "blog":   { "apiKey": "bk_yyy..." }
}
```

启动时任何缺项 / 非法项都会直接抛错退出（fail-fast）。

桶白名单与项目无关，是全局的联合类型白名单。**新增桶：编辑 `src/presign/allowed-buckets.ts` 的 `ALLOWED_BUCKETS`**，追加字面量即可（当前仅 `'audio'`）。请求中的 `bucket` 为必填字段，不在白名单内一律 403。

## 部署步骤

```bash
# 1. 准备配置
cp .env.example .env
# 编辑 .env：填 MinIO 地址、凭据、PROJECTS_JSON（apiKey 用足够长的随机串）

# 2. 拉取镜像并启动（镜像由 CI 推送到 Docker Hub，见下文 CI/CD 一节）
docker compose pull
docker compose up -d

# 3. 验证
curl http://localhost:3100/health
# {"status":"ok","uptime":12.34}
```

服务端口映射：宿主 `3100` → 容器 `3100`（3100 未被占用）。

## 加入 1Panel 网络

`docker-compose.yml` 已声明使用 external 网络 `1panel-network`（1Panel 默认创建）。

- 若不存在，先手动创建：

```bash
docker network create 1panel-network
```

- MinIO 容器也必须加入同一网络，本服务才能用 `http://minio:9000` 之类的容器名访问它。如果 MinIO 是 1Panel 应用商店装的，通常已在该网络中；可用下面命令确认：

```bash
docker network inspect 1panel-network | grep -A2 minio
```

- 若 MinIO 不在该网络，将其接入：

```bash
docker network connect 1panel-network <minio容器名>
```

## MinIO 桶 CORS 配置（浏览器直传必做）

浏览器直接对预签名 URL 发 `PUT` 上传属于跨域请求，**MinIO 必须允许你的站点 Origin**，否则浏览器拦截。

MinIO 全局 API 的 CORS 默认值就是 `*`（允许所有来源），多数情况**开箱即用、无需配置**。要收紧到你的站点，二选一：

```bash
# 方式一（推荐）：全局环境变量，改完重启 MinIO 容器
MINIO_API_CORS_ALLOW_ORIGIN=https://your-site.example.com

# 方式二：按桶配置（S3 API，用 aws CLI）
aws --endpoint-url http://127.0.0.1:9000 s3api put-bucket-cors \
  --bucket audio --cors-configuration file://cors.json
```

`cors.json`（可直接复制）：

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-site.example.com"],
      "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

说明：

- `AllowedOrigins` 填你前端站点 origin（开发期可临时用 `*`），不要长期裸奔 `*`
- `AllowedHeaders` 必须覆盖 `Content-Type`（用 `*` 最省事），上传时前端会带它
- 预签名 URL 的 Host 是 MinIO 自身，浏览器 Origin 是你的站点，二者不同域所以必然走 CORS

## API 一览

所有 `/v1/*` 接口都需要请求头 `x-api-key: <项目apiKey>`；`/health`、`/docs` 不需要。

### 上传预签名 `POST /v1/presign/upload`

```bash
curl -X POST http://localhost:3100/v1/presign/upload \
  -H 'x-api-key: gk_xxx...' \
  -H 'Content-Type: application/json' \
  -d '{"filename":"photo.JPG","contentType":"image/jpeg","bucket":"audio","expiresIn":900}'
```

响应：

```json
{
  "method": "PUT",
  "url": "https://minio.example.com/audio/galaxy/2024/06/<uuid>.jpg?X-Amz-...",
  "bucket": "audio",
  "key": "galaxy/2024/06/<uuid>.jpg",
  "expiresIn": 900,
  "headers": { "Content-Type": "image/jpeg" },
  "publicUrl": "https://minio.example.com/audio/galaxy/2024/06/<uuid>.jpg"
}
```

`publicUrl` 是公开直链（由 `S3_PUBLIC_ENDPOINT` 拼接），**桶开匿名读后可永久直接访问**（`mc anonymous set download myminio/audio`），前端上传完存下来即可；未开匿名读的桶访问它会 403，请继续用预签名下载。

也可以直接指定 key（会自动强制加上 `<projectId>/` 前缀，并拒绝 `..`、`/` 开头等路径穿越）：

```bash
curl -X POST http://localhost:3100/v1/presign/upload \
  -H 'x-api-key: gk_xxx...' \
  -H 'Content-Type: application/json' \
  -d '{"key":"avatars/pic.png","contentType":"image/png","bucket":"audio"}'
```

### 下载预签名 `POST /v1/presign/download`

```bash
curl -X POST http://localhost:3100/v1/presign/download \
  -H 'x-api-key: gk_xxx...' \
  -H 'Content-Type: application/json' \
  -d '{"key":"galaxy/2024/06/<uuid>.jpg","bucket":"audio","downloadName":"照片.jpg"}'
```

响应 `{ "method": "GET", "url", "bucket", "key", "expiresIn" }`。`key` 必须以本项目前缀开头，否则 403。

### 删除预签名 `POST /v1/presign/delete`

```bash
curl -X POST http://localhost:3100/v1/presign/delete \
  -H 'x-api-key: gk_xxx...' \
  -H 'Content-Type: application/json' \
  -d '{"key":"galaxy/2024/06/<uuid>.jpg","bucket":"audio"}'
```

响应 `{ "method": "DELETE", "url", "bucket", "key", "expiresIn" }`。同样校验项目前缀。

### 文件列表 `GET /v1/files`

列举本项目前缀（`<projectId>/`）下的文件并附公开直链，ListObjectsV2 分页：

```bash
curl 'http://localhost:3100/v1/files?bucket=audio&prefix=2024/06/&limit=100' \
  -H 'x-api-key: gk_xxx...'
```

- `bucket` 必填，白名单校验；`prefix` 可选，无论传什么都会被强制限定在 `<projectId>/` 之内（传 `blog/x` 会被拉回 `galaxy/blog/x/`，无法越权）
- `limit` 1-1000，默认 100；响应带 `nextCursor` 时把它作为下一次请求的 `cursor` 翻页

响应：

```json
{
  "bucket": "audio",
  "prefix": "galaxy/",
  "count": 1,
  "nextCursor": null,
  "items": [
    {
      "key": "galaxy/2024/06/<uuid>.jpg",
      "size": 5249906,
      "lastModified": "2024-06-09T08:00:00.000Z",
      "url": "https://minio.example.com/audio/galaxy/2024/06/<uuid>.jpg"
    }
  ]
}
```

`url` 是公开直链，桶开匿名读后可直接访问；未开匿名读的桶请继续用预签名下载。

### 错误格式

统一为 Nest 默认格式：

```json
{ "statusCode": 403, "message": "桶 \"x\" 不在白名单内", "error": "Forbidden" }
```

- `401`：`x-api-key` 缺失 / 无效
- `403`：bucket 不在白名单 / key 前缀不属于该项目
- `400`：参数校验失败（含路径穿越、filename/key 均缺等）

## 浏览器 fetch 直传示例

```html
<script type="module">
  const API = 'http://localhost:3100';
  const API_KEY = 'gk_xxx...';

  async function uploadFile(file) {
    // 1. 向 minio-api 申请预签名 URL
    const res = await fetch(`${API}/v1/presign/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        bucket: 'audio',
      }),
    });
    if (!res.ok) throw new Error(`presign failed: ${res.status}`);
    const { url, headers, key } = await res.json();

    // 2. 浏览器直接 PUT 到 MinIO（不经过后端中转）
    const put = await fetch(url, {
      method: 'PUT',
      headers, // 必须带上返回的 Content-Type
      body: file,
    });
    if (!put.ok) throw new Error(`upload failed: ${put.status}`);

    console.log('uploaded:', key);
    return key;
  }

  document.querySelector('#file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadFile(file).catch(console.error);
  });
</script>
<input id="file" type="file" />
```

> 注意：`Content-Type` 没有签入签名（MinIO 兼容性），但前端应按响应中的 `headers` 原样携带，保证桶侧与后续读取的一致性；同时桶 CORS 需放行该 header（见上文）。

## 本地开发

```bash
npm ci
cp .env.example .env   # 并 export 或用 dotenv
set -a; . .env; set +a
npm run start:dev

npm run build   # strict 编译
npm run lint
npm test        # presign.service 单测
```

## CI/CD

仓库内置 `.github/workflows/docker.yml`：push 到 `main` 分支（或手动 `workflow_dispatch` 触发）时，GitHub Actions 会构建 `linux/amd64` + `linux/arm64` 双架构镜像（树莓派 arm64 与开发机 amd64 都可用）并推送到 Docker Hub，tag 为 `latest` 与 `<commit sha>`，构建缓存走 `type=gha`。

使用前需在 GitHub 仓库 **Settings → Secrets and variables → Actions** 配置两个 secret：

| Secret | 说明 |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名（也决定镜像名 `<username>/minio-api`） |
| `DOCKERHUB_TOKEN` | Docker Hub Access Token（ hub.docker.com → Account Settings → Security 生成，勿用登录密码） |

> **安全红线**：GitHub secrets 仅供 workflow **构建期推送镜像**使用；MinIO 的 `S3_ACCESS_KEY` / `S3_SECRET_KEY` 是**运行时凭据**，只放在服务器的 `.env` 里，绝不进 GitHub（不入仓库、不进 secrets、不进 workflow）。
