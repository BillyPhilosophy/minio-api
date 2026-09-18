# minio-api

NestJS + TypeScript 实现的 MinIO（S3 兼容）**预签名 URL 签发服务**。为多个网站项目统一签发上传 / 下载 / 删除的预签名 URL，后端只签名，**绝不中转文件流**。

## 特性

- 多项目隔离：每个项目一个 `x-api-key` + 全局桶白名单（联合类型，见 `src/presign/allowed-buckets.ts`）+ key 前缀（`<projectId>/`）双重隔离，互不越权
- 上传 key 自动生成 `<projectId>/<yyyy>/<mm>/<uuidv4><ext>`，或用户指定 key（强制加项目前缀 + 路径穿越清洗）
- `expiresIn` 自动 clamp 到 `[60, MAX_EXPIRES_IN]`
- Swagger 文档挂载在 `/docs`，健康检查 `/health`（无需鉴权）

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 容器内服务端口 | `3100` |
| `S3_ENDPOINT` | MinIO 地址，如 `http://minio:9000` | 必填 |
| `S3_REGION` | 区域 | `us-east-1` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO 凭据 | 必填 |
| `S3_FORCE_PATH_STYLE` | path-style 访问 | `true` |
| `PROJECTS_JSON` | 项目注册表 JSON | 必填 |
| `DEFAULT_EXPIRES_IN` | 签名默认有效期（秒） | `900` |
| `MAX_EXPIRES_IN` | 有效期上限（秒） | `3600` |

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

# 2. 构建并启动
docker compose up -d --build

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

浏览器直接对预签名 URL 发 `PUT` 上传属于跨域请求，**目标桶必须允许你的站点 Origin 与相关 Header**，否则浏览器拦截。用 `mc` 配置：

```bash
mc admin config set myminio api cors_allow_origin="*"
# 或者更推荐：给具体桶设置 CORS 规则
mc anonymous set-json cors.json myminio/audio
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
  "url": "http://minio:9000/audio/galaxy/2024/06/<uuid>.jpg?X-Amz-...",
  "bucket": "audio",
  "key": "galaxy/2024/06/<uuid>.jpg",
  "expiresIn": 900,
  "headers": { "Content-Type": "image/jpeg" },
  "publicUrl": null
}
```

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
