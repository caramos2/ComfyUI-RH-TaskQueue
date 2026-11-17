# ComfyUI-RH-TaskQueue 实施设计

**版本：** 1.0（实施版）
**日期：** 2026-11-15
**上游蓝图：** `ComfyUI-RH-TaskQueue_技术蓝图.md` v1.0（主人提供）
**本轮范围：** Phase 0（探测）→ Phase 1（监控抽屉）→ Phase 2（托管队列）→ Phase 3（耗时档案）
**不含：** Phase 4（原生按钮接管）、Phase 5（多实例并发）

---

## 1. 环境基线（2026-11-15 实测，非推断）

| 项 | 实测值 | 证据 |
|---|---|---|
| ComfyUI 根目录 | `<ComfyUI>` | 目录实况 |
| 后端版本 | `comfyui_version.__version__ = "0.45.0"` | comfyui_version.py |
| 后端 git | `4d64a8bc0`（2026-11-11，FRONT-3775） | `git log -1` |
| 前端 | `comfyui-frontend-package 1.58.5` | site-packages dist-info |
| 工作流模板 | `comfyui-workflow-templates 0.11.106` | requirements.txt |
| Python | 3.12.10（standalone，内置于 `..\python\python.exe`） | 实测 |
| 启动器 | `.launcher\StableDiffusionWebUILauncher.exe` / `绘世启动器.exe` | 目录实况 |
| SDXL 权重 | `models\checkpoints\waiIllustriousSDXL_v160.safetensors`（6.6 GB） | 目录实况 |

### 1.1 数据源可用性（已逐条核对源码）

- **Jobs API 存在**：`server.py:913` `GET /api/jobs`、`server.py:1011` `GET /api/jobs/{job_id}`、`server.py:1063` `POST /api/jobs/{job_id}/cancel`、`server.py:1081` `POST /api/jobs/cancel`。
- **jobs 归一化**：`comfy_execution/jobs.py`，状态常量 `pending / in_progress / completed / failed / cancelled`。
- **WS 终态事件存在**：`execution.py:750` `execution_start`、`execution.py:832` `execution_success`、`execution.py:547` `execution_error`、`execution.py:707` `execution_interrupted`、`execution.py:778` `execution_cached`。
- **取消能力真实可用**：`POST /api/jobs/{job_id}/cancel` 对运行中任务走 interrupt、对待执行任务走 dequeue，幂等。
- **扩展 JS 加载**：`server.py:423` `GET /extensions` 递归收集 `web/extensions/**/*.js` 与每个 `WEB_DIRECTORY` 下的 `**/*.js`；`server.py:1354` 将各 WEB_DIRECTORY 挂到 `/extensions/<模块名>/`；`server.py:1390` `web.static('/', web_root)` 提供 `/scripts/api.js`。
- **前端 api 垫片**：`static/scripts/api.js` 导出 `api`（= `window.comfyAPI.api.api`），可 `import { api } from "/scripts/api.js"`。

### 1.2 对上游蓝图的校正（三处事实差异）

| # | 蓝图假设 | 实测事实 | 实施口径 |
|---|---|---|---|
| C1 | 运行中任务可从 API 拿到执行起始时刻 | `normalize_queue_item()` 对队列项**只给** `id/status/priority/create_time/outputs_count/previewable_outputs_count/workflow_id`，**没有** `execution_start_time` | 运行中实时耗时靠 WS 事件 + 本地时钟；终态以 `GET /api/jobs/{id}` 的后端权威时间校正 |
| C2 | `execution_start` 事件带 timestamp | `execution.py:750` payload 仅 `{ "prompt_id": prompt_id }`，**无时间戳** | 收到事件瞬间用 `Date.now()` 打点（误差 < 1s）；终态用后端时间替换 |
| C3 | `job_id` 与 `prompt_id` 可能是两回事 | `jobs.py` 中 `normalize_queue_item`/`normalize_history_item` 均以 `prompt_id` 作为 `id`，`get_job()` 直接用 prompt_id 查 history/queue | **本版本 job_id == prompt_id**，取消与详情查询直接用 prompt_id |

> 旧记忆条目「job_id 与 prompt_id 不是一回事」在本版本已被源码证伪，以本设计为准。

### 1.3 对上游蓝图的两处工程决策（偏离及理由）

| # | 蓝图写法 | 本实施 | 理由 |
|---|---|---|---|
| D1 | `web/styles.css` 独立 CSS 文件 | `web/ui/styles.js` 导出 CSS 模板字符串，运行时注入 Shadow Root 的 `<style>` | ComfyUI 扩展管线**只分发 .js**（`/extensions` 列表只收 .js），无 CSS 加载器；独立 .css 会 404 或产生未样式化闪烁 |
| D2 | 文件结构含 `backend/fingerprint.py` | 签名在前端计算（它才持有 API prompt），后端只做格式校验与存储 | 避免同一套归一化规则在两端重复实现而漂移 |

---

## 2. 架构与模块划分

```text
ComfyUI-RH-TaskQueue/
├── __init__.py                  # WEB_DIRECTORY + 路由注册（零节点）
├── backend/
│   ├── routes.py                # /rh_queue/* 五条路由
│   └── duration_store.py        # SQLite（stdlib sqlite3，WAL + 事务 + 锁）
├── web/
│   ├── rh_task_queue.js         # 唯一入口：app.registerExtension
│   ├── core/
│   │   ├── api_client.js        # fetch 封装：/api/jobs、/rh_queue/*
│   │   ├── task_model.js        # 统一 TaskRecord 归一化 + 状态机常量
│   │   ├── task_store.js        # IndexedDB 持久化（本地待派发任务）
│   │   ├── queue_manager.js     # 本地队列状态机 + FIFO 派发器 + leader 租约
│   │   ├── event_bridge.js      # WS 事件订阅 + prompt_id 去重
│   │   ├── fingerprint.js       # 归一化 + SHA-256（纯 JS，不依赖 secure context）
│   │   ├── notifier.js          # Web Audio 提示音 + Notification + 去重
│   │   └── settings.js          # localStorage 设置
│   ├── adapters/
│   │   ├── jobs_api.js          # 新版 /api/jobs 适配器
│   │   └── legacy_api.js        # /queue + /history 回退适配器
│   └── ui/
│       ├── drawer.js            # 右侧抽屉骨架 + 摘要栏 + 过滤栏
│       ├── task_card.js         # 单张任务卡
│       ├── output_preview.js    # 图片/视频/音频/3D/文本预览
│       └── styles.js            # CSS 模板字符串
├── data/                        # 运行时生成，已 .gitignore
├── docs/superpowers/{specs,plans}/
├── example_workflows/           # 零 GPU 自检工作流
├── README.md
└── .gitignore
```

**边界规则（每条单测可独立验证）：**

- `adapters/` 只负责把后端结构翻译成 `TaskRecord`，不认识 UI。
- `core/` 不认识 DOM；只产出状态与数据。
- `ui/` 不发网络请求；只渲染传入的数据。
- 只有 `web/rh_task_queue.js` 调用 `app.registerExtension`。其余 .js 均为纯 ES 模块、无 default 导出、无顶层副作用注册 —— 前端会把它们当模块导入但找不到 setup，故为 no-op。

---

## 3. 数据契约

### 3.1 统一 TaskRecord

```js
{
  id,                 // prompt_id（== job_id）
  status,             // PLUGIN_QUEUED | BACKEND_PENDING | RUNNING | COMPLETED | FAILED | CANCELLED | SUBMIT_FAILED
  origin,             // 'plugin' | 'backend'   （是否来自本插件本地队列）
  workflowName,
  workflowId,         // 后端 workflow_id（可空）
  createdAt,          // 插件侧创建时刻（ms）
  submittedAt,        // 实际提交到 ComfyUI 的时刻（ms）
  executionStartedAt, // 后端开始执行时刻（ms）
  executionEndedAt,   // 后端结束时刻（ms）
  queueWaitSeconds,   // executionStartedAt - submittedAt
  executionSeconds,   // executionEndedAt - executionStartedAt
  outputsCount,
  previewableOutputsCount,
  outputs,            // 完整输出（仅终态，从 /api/jobs/{id} 取）
  error,              // {node_id,node_type,exception_message,...}
  signature,          // 工作流指纹
  notified,           // 终态通知去重标记
}
```

### 3.2 插件自有 API（后端）

| 路由 | 方法 | 请求 | 响应 |
|---|---|---|---|
| `/rh_queue/health` | GET | - | `{version, db:{ok,path}, caps:{jobs_api,legacy_api,cancel_api}, mode}` |
| `/rh_queue/estimate` | POST | `{signature, signature_version}` | `{found, last_duration, avg_duration, sample_count, updated_at}` |
| `/rh_queue/record` | POST | `{signature, signature_version, duration, prompt_id}` | `{ok, last_duration, avg_duration, sample_count}` |
| `/rh_queue/history` | GET | `?limit=&offset=` | `{records:[...], total}` |
| `/rh_queue/history/{signature}` | DELETE | - | `{ok, deleted}` |

后端**不**保存任务状态、不做队列、不存输出 —— 只存耗时样本。

### 3.3 耗时库表结构

```sql
CREATE TABLE IF NOT EXISTS workflow_duration_history (
    signature        TEXT PRIMARY KEY,
    signature_version INTEGER NOT NULL,
    last_duration    REAL NOT NULL,
    avg_duration     REAL NOT NULL,
    sample_count     INTEGER NOT NULL DEFAULT 1,
    last_prompt_id   TEXT,
    updated_at       REAL NOT NULL
);
```

更新规则：成功执行才记录；`last_duration` = 最近一次成功耗时；`avg_duration` = 算术均值；WAL 开启；写操作包在 `BEGIN IMMEDIATE` 事务 + 线程锁内。

---

## 4. 状态机与计时（对应蓝图 §5，按 C1/C2 校正）

```text
CREATED ──> PLUGIN_QUEUED ──(提交成功)──> BACKEND_PENDING ──(execution_start)──> RUNNING
                                                                                        ├─> COMPLETED
                                                                                        ├─> FAILED
                                                                                        └─> CANCELLED
提交失败 ──> SUBMIT_FAILED
```

**计时铁律：**

1. `submittedAt`（提交时刻）**永远不是** `executionStartedAt`（开始执行时刻）。
2. 运行中实时耗时 = `now - executionStartedAt`，其中 `executionStartedAt` 取自 WS `execution_start` 事件到达瞬间的本地时钟。
3. 终态后，用 `GET /api/jobs/{id}` 返回的 `execution_start_time` / `execution_end_time`（后端 ms epoch，权威）**覆盖**前端估算值。
4. 排队等待 = `executionStartedAt - submittedAt`；后端排队任务额外显示队列位置（按 `create_time` 升序自算索引+1）。
5. 状态无法确认时保留上次状态并显示「同步中」，**不得**擅自判为完成。
6. 通知/音效按 `prompt_id` 去重，事件与轮询同时发现完成时只触发一次。

**轮询节奏：** 抽屉打开且有活动任务时 2.5s；抽屉关闭时 10s；无活动任务时停止轮询；WS 重连后立即全量校准一次。

---

## 5. 插件托管队列（Phase 2）

- 「加入任务队列」按钮在抽屉内，点击时用 `app.graphToPrompt()` **冻结快照**（prompt + extraData + workflow 元信息），写入 IndexedDB，状态 `PLUGIN_QUEUED`。
- 派发条件：`已提交未完成任务数 < 预提交上限`（默认 1，范围 1-8）且队列未暂停。
- 派发时用**低层** `api.queuePrompt(prompt, extraData)`（POST `/prompt`）提交，取 `prompt_id` 关联，转 `BACKEND_PENDING`。**不劫持** `app.queuePrompt`，原生 Queue Prompt 按钮完全不动。
- 队列位置、暂停/恢复、删除待执行项均在前端完成。
- **Leader 租约**：多标签页同时打开时，用 localStorage 心跳 + BroadcastChannel 选举一个 leader 负责派发，其余标签页只读同步，避免重复提交。
- 页面刷新：本地待派发任务从 IndexedDB 恢复；已提交任务由 `/api/jobs` 重建。

---

## 6. 工作流指纹（Phase 3）

```
signature_version = 1
signature = SHA256( canonical_json( normalize(api_prompt) ) )
```

归一化：递归排序 JSON 键；递归剔除 `seed`、`noise_seed`；保留模型名、提示词、分辨率、steps、CFG、batch_size、采样器、节点类型与连接关系；不纳入 prompt_id / client_id / 提交时间。

**SHA-256 纯 JS 实现**（约 60 行），不用 `crypto.subtle` —— 后者仅在 secure context 可用，本机若经局域网 IP 以 http 访问会失效。

---

## 7. 通知与音效

- 提示音：Web Audio 合成（双音阶上行），首次由用户手势解锁 AudioContext；音量默认 30%；提供「测试音效」按钮。
- 浏览器通知：默认关闭；仅在用户主动勾选时调 `Notification.requestPermission()`；拒绝后只提示不再反复弹窗。
- 终态触发以 API 校准为准（WS 终态事件只触发一次核验）。

---

## 8. 输出预览

任务终态后 `GET /api/jobs/{id}` 取 `outputs`（结构 `{node_id: {media_type: [items]}}`），按 media_type 分派：

| 类型 | 呈现 |
|---|---|
| images | 缩略图网格，点击开原图 |
| video | `<video>` 播放器 |
| audio | `<audio controls>` |
| 3d | 文件名 + 打开/下载入口（不内嵌 3D 预览） |
| text | 折叠预览；优先读 `preview_output.content`，否则经 `/view` 取文本 |
| 未知 | 保留条目，显示文件名与下载入口，不静默丢弃 |

媒体 URL 一律用 `/view?filename=&subfolder=&type=` 构造，**不拼接磁盘路径**，插件 API 不接受任意本地路径。

---

## 9. 安装与运行

- 仓库位置：`<repo>`（git init，`data/` 进 .gitignore）。
- 安装位置：`<ComfyUI>\custom_nodes\ComfyUI-RH-TaskQueue`。
- 依赖：**零第三方依赖**（后端只用 stdlib sqlite3/aiohttp 路由；前端只用浏览器原生 API）。
- 启用后新增路由前缀 `/rh_queue/`，前端在 UI 右侧出现可收起抽屉。

---

## 10. 验证计划（低 GPU 优先）

| 步骤 | 手段 | GPU |
|---|---|---|
| V1 | 启动 ComfyUI → `GET /rh_queue/health` 返回 200 且 db.ok=true | 无 |
| V2 | `GET /api/jobs` 返回 `{jobs, pagination}` 结构 | 无 |
| V3 | 提交 **SaveText 单节点**工作流（无模型）→ 观察 pending→in_progress→completed 状态流、输出计数、耗时记录落库 | **零** |
| V4 | 同一工作流再提交一次 → `estimate` 返回 sample_count=2、avg 正确 | **零** |
| V5 | 改签名（改 text 内容）→ `estimate` 未命中 | **零** |
| V6 | 提交 512×512 / 4 steps 的 SDXL 单图工作流 → 验证图片输出预览与缩略图 | 极小（主人已认可） |
| V7 | 浏览器打开 8188 → 抽屉渲染、摘要栏三数正确、卡片状态/计时正确（截图留证） | 无 |
| V8 | 取消测试：提交长任务后调 `POST /api/jobs/{id}/cancel` → 状态转 cancelled | 无 |
| V9 | 托管队列：连加 3 个任务，预提交上限=1 → 只释放 1 个，终态后再释放下一个 | 无 |
| V10 | 刷新页面 → 本地队列与后端任务状态均恢复 | 无 |

验证结束后停掉我起的 ComfyUI 实例，把 8188 端口交回主人的启动器。

---

## 11. 明确不做（本轮边界）

- 不改 ComfyUI 核心源码（`execution.py` / `main.py` / `server.py`）。
- 不劫持原生 `app.queuePrompt`，不改原生 Queue Prompt 按钮行为（Phase 4）。
- 不做多实例调度（Phase 5）。
- 不实现 ComfyUI 自身的任务状态数据库，不复制输出文件。
- 不承诺单实例 GPU 并行；「预提交上限」明确标注为**预提交量**，不是并行数。

---

## 12. 风险

| 风险 | 处置 |
|---|---|
| 前端把子目录 .js 当扩展入口导入 | 子模块无 default 导出、无 registerExtension 副作用，导入为 no-op |
| 多标签页重复派发 | leader 租约（localStorage 心跳 + BroadcastChannel） |
| WS 事件丢失 | 2.5s/10s 轮询 + 重连后全量校准 |
| 页面关闭后无通知 | 明确在 UI 与 README 标注浏览器限制 |
| 后端历史被清理 | 插件只存耗时摘要，不承担输出归档 |
| 局域网 http 访问下 crypto.subtle 不可用 | 纯 JS SHA-256 |
