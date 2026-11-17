# ComfyUI-RH-TaskQueue 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本机 ComfyUI 0.45.0 + 前端 1.58.5 上交付一个零依赖插件：右侧任务抽屉（运行/后端排队/本地排队三段分离、真实执行耗时、完整输出预览、音效+桌面通知）、插件托管 FIFO 队列（预提交上限）、工作流耗时档案（指纹 + SQLite）。

**Architecture:** 后端 Python 只做「耗时样本库」+ 5 条 `/rh_queue/*` 路由；任务状态一律来自 ComfyUI 原生 Jobs API 与 WebSocket，不另造状态库。前端为无构建步骤的原生 ES 模块：`adapters` 把后端结构翻成统一 `TaskRecord`，`core` 持有状态机与派发器（不认识 DOM），`ui` 只渲染（不发请求）。只有入口 `web/rh_task_queue.js` 调用 `app.registerExtension`。

**Tech Stack:** Python 3.12（stdlib sqlite3 + aiohttp 路由）/ 原生 ES Module 前端 / IndexedDB / Web Audio / Notification / node:test + pytest。

## Global Constraints

- 零第三方依赖：后端只用 stdlib `sqlite3`/`aiohttp`；前端只用浏览器原生 API。
- 不修改 ComfyUI 核心源码（`execution.py` / `main.py` / `server.py`）。
- 不劫持 `app.queuePrompt`；原生 Queue Prompt 按钮行为保持不变。
- 插件源码仓库在 `<repo>`；安装副本在 `<ComfyUI>\custom_nodes\ComfyUI-RH-TaskQueue`。
- 「预提交上限」默认 1，范围 1-8；**不得**描述为单实例 GPU 并行数。
- 提交时刻 ≠ 执行起始时刻，二者必须分别记录（设计 §4 铁律）。
- 后端时间戳为 ms epoch；前端时间戳统一 ms。
- 所有输出媒体 URL 用 `/view?filename=&subfolder=&type=` 构造，禁止拼磁盘路径。
- 子模块 .js 不得有 default 导出、不得调用 `app.registerExtension`（避免被前端当扩展入口重复执行）。
- 本机 `python.exe` = `<python>\python.exe`（测试与运行均用它）。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `__init__.py` | 声明 `WEB_DIRECTORY="./web"`、空节点映射、注册后端路由 |
| `backend/routes.py` | 5 条 `/rh_queue/*` aiohttp 路由 |
| `backend/duration_store.py` | SQLite 建表/读写/迁移，WAL + 事务 + 线程锁 |
| `backend/fingerprint.py` | 签名格式校验（64 位 hex + version） |
| `web/rh_task_queue.js` | 唯一扩展入口，装配所有模块 |
| `web/core/api_client.js` | fetch 封装，插件 API + Jobs API |
| `web/core/task_model.js` | `TaskRecord` 归一化与状态常量 |
| `web/core/task_store.js` | IndexedDB 持久化本地待派发任务 |
| `web/core/queue_manager.js` | 本地队列状态机 + FIFO 派发 + leader 租约 |
| `web/core/event_bridge.js` | WS 订阅 + prompt_id 去重 + 重连校准 |
| `web/core/fingerprint.js` | 归一化 + 纯 JS SHA-256 |
| `web/core/notifier.js` | Web Audio 提示音 + Notification |
| `web/core/settings.js` | localStorage 设置读写 |
| `web/adapters/jobs_api.js` | `/api/jobs` 适配器 |
| `web/adapters/legacy_api.js` | `/queue` + `/history` 回退适配器 |
| `web/ui/styles.js` | CSS 模板字符串（注入 Shadow Root） |
| `web/ui/drawer.js` | 抽屉骨架 / 摘要栏 / 过滤栏 / 设置 |
| `web/ui/task_card.js` | 单张任务卡渲染 |
| `web/ui/output_preview.js` | 图片/视频/音频/3D/文本预览 |
| `tests/test_duration_store.py` | 后端耗时库单测 |
| `tests/js/*.test.mjs` | 前端纯逻辑单测（node:test） |
| `example_workflows/` | 零 GPU 自检工作流 + 最小 SDXL 工作流 |

---

### Task 1: 仓库骨架 + 后端耗时库

**Files:**
- Create: `backend/duration_store.py`
- Create: `backend/fingerprint.py`
- Create: `tests/test_duration_store.py`
- Create: `.gitignore`

**Interfaces:**
- Produces: `DurationStore(db_path) -> {get(signature), record(signature, duration, prompt_id, signature_version=1), list(limit, offset), delete(signature), count(), health()}`
- Produces: `is_valid_signature(sig) -> bool`；`is_valid_version(v) -> bool`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_duration_store.py
import os, tempfile, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.duration_store import DurationStore
from backend.fingerprint import is_valid_signature

def test_record_then_get():
    with tempfile.TemporaryDirectory() as d:
        s = DurationStore(os.path.join(d, "h.sqlite3"))
        s.record("a" * 64, 12.5, "pid-1")
        r = s.get("a" * 64)
        assert r is not None
        assert r["last_duration"] == 12.5
        assert r["sample_count"] == 1
        assert abs(r["avg_duration"] - 12.5) < 1e-9

def test_average_updates_on_second_record():
    with tempfile.TemporaryDirectory() as d:
        s = DurationStore(os.path.join(d, "h.sqlite3"))
        s.record("b" * 64, 10.0, "p1")
        s.record("b" * 64, 20.0, "p2")
        r = s.get("b" * 64)
        assert r["last_duration"] == 20.0
        assert r["sample_count"] == 2
        assert abs(r["avg_duration"] - 15.0) < 1e-9

def test_missing_signature_returns_none():
    with tempfile.TemporaryDirectory() as d:
        s = DurationStore(os.path.join(d, "h.sqlite3"))
        assert s.get("c" * 64) is None

def test_invalid_signature_rejected():
    with tempfile.TemporaryDirectory() as d:
        s = DurationStore(os.path.join(d, "h.sqlite3"))
        try:
            s.record("not-hex", 1.0, "p")
        except ValueError:
            return
        raise AssertionError("expected ValueError")

def test_signature_validator():
    assert is_valid_signature("a" * 64)
    assert not is_valid_signature("A" * 64)   # 必须小写
    assert not is_valid_signature("a" * 63)

def test_delete_and_list():
    with tempfile.TemporaryDirectory() as d:
        s = DurationStore(os.path.join(d, "h.sqlite3"))
        s.record("d" * 64, 1.0, "p1")
        s.record("e" * 64, 2.0, "p2")
        assert s.count() == 2
        assert s.delete("d" * 64)
        assert s.count() == 1
        assert len(s.list(limit=10, offset=0)["records"]) == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `& $PY -m pytest tests/test_duration_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend'`

- [ ] **Step 3: 实现 `backend/duration_store.py`**

要点：`sqlite3.connect(path, check_same_thread=False)`；`PRAGMA journal_mode=WAL`；`PRAGMA busy_timeout=5000`；每次操作包 `with self._lock, self._conn:`；建表用 `CREATE TABLE IF NOT EXISTS`；`record()` 用 `INSERT ... ON CONFLICT(signature) DO UPDATE SET` 计算新均值 `((avg*n)+d)/(n+1)`；`get()` 返回 dict 或 None；`list()` 按 `updated_at DESC`；`delete()` 返回是否真的删了；非法签名抛 `ValueError`。

- [ ] **Step 4: 实现 `backend/fingerprint.py`**

`is_valid_signature(s)`：str、长度 64、全部 `[0-9a-f]`。`is_valid_version(v)`：int 且 `>= 1`。

- [ ] **Step 5: 写 `.gitignore`**

```
data/
*.sqlite3
*.sqlite3-wal
*.sqlite3-shm
__pycache__/
*.pyc
.pytest_cache/
node_modules/
```

- [ ] **Step 6: 运行测试确认通过**

Run: `& $PY -m pytest tests/test_duration_store.py -v`
Expected: PASS — 6 passed

- [ ] **Step 7: Commit**

```bash
git add .gitignore backend tests
git commit -m "feat(backend): duration history store with sqlite wal + fingerprint validation"
```

---

### Task 2: 后端路由 + 插件注册

**Files:**
- Create: `backend/routes.py`
- Create: `__init__.py`

**Interfaces:**
- Consumes: `DurationStore`、`is_valid_signature`
- Produces: `register_routes(routes, store) -> None`，挂 5 条路由

- [ ] **Step 1: 实现 `backend/routes.py`**

路由与语义见设计 §3.2。`/rh_queue/health` 返回 `{version, db:{ok,path,count}, caps:{jobs_api,legacy_api,cancel_api}, mode}`；其中 `caps` 由插件自身探测 ComfyUI 路由表（检查 `PromptServer.instance.app.router` 中是否存在 `/api/jobs`）得到，实现方式：直接尝试 `GET /api/jobs?limit=1` 不合适（会阻塞事件循环），故改为在 health 中读取 `server.PromptServer.instance.app.router.routes()` 的资源路径集合做判断。

**注意**：`/api/jobs?limit=1` 不该在 health 里做——只读路由表即可。路由表判定通过 `PromptServer.instance.app.router.named_resources()` 拿不到全部 path，改用遍历 `app.router.routes()` 取 `route.resource.canonical`。

- [ ] **Step 2: 实现 `__init__.py`**

```python
import os
WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
```
并在 import 时调用 `register_routes(PromptServer.instance.routes, store)`，用 try/except 包住，失败只 log 不阻断 ComfyUI 启动。store 路径 = `os.path.join(os.path.dirname(__file__), "data")`。

- [ ] **Step 3: 静态自检**

Run: `& $PY -c "import ast,pathlib;[ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in ['backend/routes.py','backend/duration_store.py','__init__.py']];print('AST OK')"`
Expected: `AST OK`

- [ ] **Step 4: Commit**

```bash
git add backend __init__.py
git commit -m "feat(backend): rh_queue routes and plugin registration"
```

---

### Task 3: 前端指纹（归一化 + 纯 JS SHA-256）

**Files:**
- Create: `web/core/fingerprint.js`
- Create: `tests/js/fingerprint.test.mjs`

**Interfaces:**
- Produces: `normalizePrompt(prompt) -> object`、`canonicalJson(value) -> string`、`sha256Hex(str) -> string`、`computeSignature(prompt) -> {signature, signature_version}`

- [ ] **Step 1: 写失败测试**（node:test）

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePrompt, canonicalJson, sha256Hex, computeSignature } from '../../web/core/fingerprint.js'

test('canonical json sorts keys recursively', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
})

test('seed and noise_seed are removed recursively', () => {
  const n = normalizePrompt({ '1': { inputs: { seed: 42, noise_seed: 7, steps: 20 } }, '2': { inputs: { seed: 9 } } })
  assert.equal(n['1'].inputs.seed, undefined)
  assert.equal(n['1'].inputs.noise_seed, undefined)
  assert.equal(n['2'].inputs.seed, undefined)
  assert.equal(n['1'].inputs.steps, 20)
})

test('sha256 matches known vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

test('signature is stable across key order', () => {
  const a = computeSignature({ '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } } })
  const b = computeSignature({ '1': { inputs: { steps: 20, seed: 1 }, class_type: 'KSampler' } })
  assert.equal(a.signature, b.signature)
  assert.equal(a.signature_version, 1)
})

test('signature changes when steps change', () => {
  const a = computeSignature({ '1': { class_type: 'KSampler', inputs: { steps: 20 } } })
  const b = computeSignature({ '1': { class_type: 'KSampler', inputs: { steps: 30 } } })
  assert.notEqual(a.signature, b.signature)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/js/fingerprint.test.mjs`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 实现 `web/core/fingerprint.js`**

纯 JS SHA-256（标准实现，UTF-8 编码）。`canonicalJson` 递归排序键、数组保序。`normalizePrompt` 深拷贝并递归剔除 `seed`/`noise_seed` 键（大小写不敏感）。`computeSignature` = `sha256Hex(canonicalJson(normalizePrompt(prompt)))`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/js/fingerprint.test.mjs`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add web/core/fingerprint.js tests/js
git commit -m "feat(core): workflow fingerprint with canonical json and pure-js sha256"
```

---

### Task 4: 前端 TaskRecord 归一化

**Files:**
- Create: `web/core/task_model.js`
- Create: `tests/js/task_model.test.mjs`

**Interfaces:**
- Produces: `STATUS` 常量对象、`fromJobsApi(job, opts) -> TaskRecord`、`mergeRecord(a, b) -> TaskRecord`、`formatDuration(seconds) -> 'MM:SS'`、`computeTiming(record) -> {queueWaitSeconds, executionSeconds}`

- [ ] **Step 1: 写失败测试**

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS, fromJobsApi, mergeRecord, formatDuration, computeTiming } from '../../web/core/task_model.js'

test('backend pending job maps to BACKEND_PENDING', () => {
  const r = fromJobsApi({ id: 'p1', status: 'pending', create_time: 1700000000000 })
  assert.equal(r.status, STATUS.BACKEND_PENDING)
  assert.equal(r.id, 'p1')
})

test('in_progress maps to RUNNING and never fabricates a start time', () => {
  const r = fromJobsApi({ id: 'p2', status: 'in_progress', create_time: 1700000000000 })
  assert.equal(r.status, STATUS.RUNNING)
  assert.equal(r.executionStartedAt, null)
})

test('completed job keeps backend authoritative times', () => {
  const r = fromJobsApi({
    id: 'p3', status: 'completed', create_time: 1700000000000,
    execution_start_time: 1700000001000, execution_end_time: 1700000009000,
    outputs_count: 3, previewable_outputs_count: 2
  })
  assert.equal(r.status, STATUS.COMPLETED)
  assert.equal(r.executionSeconds, 8)
  assert.equal(r.outputsCount, 3)
})

test('interrupted job maps to CANCELLED', () => {
  const r = fromJobsApi({ id: 'p4', status: 'cancelled' })
  assert.equal(r.status, STATUS.CANCELLED)
})

test('merge prefers non-null newer fields', () => {
  const a = { id: 'p5', status: STATUS.RUNNING, executionStartedAt: null, outputsCount: 0 }
  const b = { id: 'p5', status: STATUS.COMPLETED, executionStartedAt: 111, outputsCount: 2 }
  const m = mergeRecord(a, b)
  assert.equal(m.status, STATUS.COMPLETED)
  assert.equal(m.executionStartedAt, 111)
  assert.equal(m.outputsCount, 2)
})

test('formatDuration renders mm:ss', () => {
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(65), '01:05')
  assert.equal(formatDuration(3600), '60:00')
})

test('computeTiming separates queue wait from execution', () => {
  const t = computeTiming({ submittedAt: 1000, executionStartedAt: 3000, executionEndedAt: 9000 })
  assert.equal(t.queueWaitSeconds, 2)
  assert.equal(t.executionSeconds, 6)
})
```

- [ ] **Step 2: 运行确认失败** → Run: `node --test tests/js/task_model.test.mjs`

- [ ] **Step 3: 实现 `web/core/task_model.js`

映射：`pending→BACKEND_PENDING`、`in_progress→RUNNING`、`completed→COMPLETED`、`failed→FAILED`、`cancelled→CANCELLED`。**关键约束**：`in_progress` 时 `executionStartedAt` 必须为 `null`（后端不给），绝不用 `create_time` 冒充。`mergeRecord` 逐字段取「新值非 null 则用新值」，但 `status` 按状态机单向推进（终态不可被回退到非终态）。

- [ ] **Step 4: 运行确认通过** → Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add web/core/task_model.js tests/js/task_model.test.mjs
git commit -m "feat(core): unified task record normalization and timing split"
```

---

### Task 5: API 客户端 + 两个适配器

**Files:**
- Create: `web/core/api_client.js`
- Create: `web/adapters/jobs_api.js`
- Create: `web/adapters/legacy_api.js`

**Interfaces:**
- Produces: `apiClient.fetchJobs({status, limit, offset, sortBy, sortOrder})`、`apiClient.fetchJob(id)`、`apiClient.cancelJob(id)`、`apiClient.health()`、`apiClient.estimate(sig)`、`apiClient.recordDuration(payload)`
- Produces: `jobsApi.supported() -> Promise<bool>`、`jobsApi.list(opts) -> TaskRecord[]`、`jobsApi.detail(id) -> TaskRecord`
- Produces: `legacyApi.supported() -> Promise<bool>`、`legacyApi.list(opts) -> TaskRecord[]`、`legacyApi.detail(id) -> TaskRecord`

- [ ] **Step 1: 实现 `web/core/api_client.js`

```javascript
import { api } from '/scripts/api.js'
```
统一 `base = api.apiURL('/')`。所有 fetch 带 `credentials: 'same-origin'`。错误统一抛 `Error(`[rh_queue] ${path} failed: ${status}`)`。

- [ ] **Step 2: 实现 `web/adapters/jobs_api.js`

`list()` 调 `GET /api/jobs?limit=&offset=&status=&sort_by=created_at&sort_order=desc`，把 `jobs[]` 逐个 `fromJobsApi`。`detail(id)` 调 `GET /api/jobs/{id}` 后 `fromJobsApi(..., {includeOutputs:true})`。

- [ ] **Step 3: 实现 `web/adapters/legacy_api.js`

`GET /queue` → `{queue_running:[...], queue_pending:[...]}`，tuple 下标 1 是 prompt_id、3 是 extra_data；`GET /history?max_items=N` 取已完成项，`GET /history/{id}` 取单项并读 `outputs`。全部转成同一个 `TaskRecord`。

- [ ] **Step 4: 人工核对**

`GET /api/jobs` 实际返回结构已在 Task 11 复核；此处只保证两适配器输出形状一致。

- [ ] **Step 5: Commit**

```bash
git add web/core/api_client.js web/adapters
git commit -m "feat(api): jobs api adapter with legacy queue/history fallback"
```

---

### Task 6: IndexedDB 任务存储 + 设置

**Files:**
- Create: `web/core/task_store.js`
- Create: `web/core/settings.js`

**Interfaces:**
- Produces: `taskStore.open()`、`taskStore.putLocal(record)`、`taskStore.listLocal()`、`taskStore.deleteLocal(id)`、`taskStore.clearLocal()`
- Produces: `settings.load()`、`settings.save(patch)`、`settings.get(key)`、`settings.set(key, value)`

**Defaults:** `preSubmitLimit:1`、`paused:false`、`soundEnabled:true`、`soundVolume:0.3`、`notifyEnabled:false`、`notifyOnFailure:true`、`filter:'all'`、`drawerOpen:false`。

- [ ] **Step 1: 实现 `web/core/task_store.js`

DB 名 `rh-taskqueue`，版本 1，object store `local_tasks`（keyPath `id`）。IndexedDB 不可用时降级到内存 Map（不抛错）。

- [ ] **Step 2: 实现 `web/core/settings.js`

localStorage key `rh_taskqueue_settings`，读写包 try/catch（隐私模式下 localStorage 可能抛）。

- [ ] **Step 3: Commit**

```bash
git add web/core/task_store.js web/core/settings.js
git commit -m "feat(core): indexeddb local task store and settings persistence"
```

---

### Task 7: 托管队列与 FIFO 派发器

**Files:**
- Create: `web/core/queue_manager.js`

**Interfaces:**
- Produces: `QueueManager` 类：`constructor({apiClient, taskStore, settings, onChange})`、`enqueue(snapshot) -> record`、`start()`、`stop()`、`pause()`、`resume()`、`remove(id)`、`getLocalTasks()`、`markSubmitted(id, promptId)`、`releaseSlot(promptId)`

- [ ] **Step 1: 实现核心逻辑**

派发判定：`inFlightCount() < settings.preSubmitLimit && !settings.paused`。`inFlightCount` = 状态属于 `BACKEND_PENDING|RUNNING` 的任务数。取最早 `PLUGIN_QUEUED`（按 `createdAt` 升序）提交，用 `api.queuePrompt(snapshot.prompt, snapshot.extraData)`（低层 API，不碰 `app.queuePrompt`），取 `prompt_id`；失败置 `SUBMIT_FAILED`。

**关键**：`markSubmitted` 只更新状态与 `submittedAt`，**不设置** `executionStartedAt`。

- [ ] **Step 2: 实现 leader 租约**

localStorage key `rh_taskqueue_leader`，值为 `{id, ts}`；每 5s 心跳刷新 ts；其他标签页读到不同 id 且 ts 在 8s 内 ⇒ 本标签不是 leader，不派发。通过 BroadcastChannel `rh-taskqueue` 广播 `{type:'state-changed'}` 让其他标签页刷新。

- [ ] **Step 3: Commit**

```bash
git add web/core/queue_manager.js
git commit -m "feat(core): plugin managed fifo queue with presubmit limit and leader lease"
```

---

### Task 8: WebSocket 桥 + 通知器

**Files:**
- Create: `web/core/event_bridge.js`
- Create: `web/core/notifier.js`

**Interfaces:**
- Produces: `EventBridge({apiClient, onEvent})`：`start()`、`stop()`、`attach(app)`、`handleEvent(type, data)`
- Produces: `Notifier` 类：`unlock()`、`playChime()`、`notifySuccess(record)`、`notifyFailure(record)`、`setVolume(v)`、`isNotified(id) -> bool`、`markNotified(id)`

- [ ] **Step 1: 实现 `web/core/event_bridge.js`

用 `api.addEventListener(type, handler)` 订阅 `execution_start` / `execution_success` / `execution_error` / `execution_interrupted`。收到 `execution_start` 时记录 `executionStartedAt = Date.now()`（payload 无时间戳，见设计 C2），**不是** `create_time`。收到终态事件时只标「待核验」，由轮询/API 确认后才触发通知（设计 §4 铁律 5）。

- [ ] **Step 2: 实现 `web/core/notifier.js`

Web Audio 合成双音阶（880Hz → 1174Hz，各 0.12s）。`unlock()` 必须在用户手势里调用（创建并 resume AudioContext）。Notification 仅在 `notifyEnabled` 且 `Notification.permission === 'granted'` 时发送。`isNotified` 集合保证同一 prompt_id 只响一次。

- [ ] **Step 3: Commit**

```bash
git add web/core/event_bridge.js web/core/notifier.js
git commit -m "feat(core): websocket event bridge and audio/notification notifier"
```

---

### Task 9: 抽屉 UI

**Files:**
- Create: `web/ui/styles.js`
- Create: `web/ui/drawer.js`
- Create: `web/ui/task_card.js`
- Create: `web/ui/output_preview.js`

**Interfaces:**
- Produces: `Drawer` 类：`constructor({root, settings, onAction})`、`mount()`、`render(records, stats)`、`setFilter(f)`、`destroy()`
- Produces: `renderTaskCard(record, {onAction, notifier}) -> HTMLElement`
- Produces: `renderOutputPreview(outputs, record) -> HTMLElement`、`buildViewUrl(item) -> string`

- [ ] **Step 1: 实现 `web/ui/styles.js`

导出 `export const CSS = `...``（带 `.rh-tq-` 前缀命名空间）。Shadow DOM 隔离。

- [ ] **Step 2: 实现 `web/ui/drawer.js`

右侧固定竖向开关 + 可拖动宽度（360-420px）抽屉。顶部摘要三个独立数字：运行中 / 后端待执行 / 本地排队。过滤栏：全部/运行中/排队中/已完成/失败。

- [ ] **Step 3: 实现 `web/ui/task_card.js`

卡片显示：状态徽标、创建时间、工作流名、耗时（按状态显示不同措辞）、上次参考耗时、输出数量、错误摘要（可展开）、操作按钮（查看结果/取消/移除）。

**文案要求**：`PLUGIN_QUEUED` 显示「插件排队 MM:SS」；`BACKEND_PENDING` 显示「后端等待 MM:SS」+ 队列位置；`RUNNING` 显示「已运行 MM:SS」；终态显示「本次耗时 MM:SS」。

- [ ] **Step 4: 实现 `web/ui/output_preview.js`

遍历 `outputs`（结构 `{node_id: {media_type: [items]}}`）。`images→<img>`、`video→<video controls>`、`audio→<audio controls>`、`3d→文件名+链接`、`text→折叠文本`、未知类型保留条目。`buildViewUrl(item)` = `/view?filename=&subfolder=&type=`（全部 encodeURIComponent）。

- [ ] **Step 5: Commit**

```bash
git add web/ui
git commit -m "feat(ui): right side task drawer with summary, filters and output previews"
```

---

### Task 10: 入口装配

**Files:**
- Create: `web/rh_task_queue.js`

- [ ] **Step 1: 实现入口**

```javascript
import { app } from '/scripts/app.js'
```
调用 `app.registerExtension({ name: 'ComfyUI-RH-TaskQueue', setup(app) { ... } })`。setup 内：建 API 客户端、适配器探测（先试 `/api/jobs`，失败退 `/queue`+`/history`）、建 QueueManager、EventBridge、Notifier、Drawer，注入 `app.graphToPrompt` 快照用的「加入队列」按钮到抽屉顶部。

**不得**替换 `app.queuePrompt`。

- [ ] **Step 2: 静态自检**

用 node 解析所有 web 下 .js 确认语法合法（排除依赖 `/scripts/*` 的运行时 import，用 `node --check` 逐文件）。

Run: `node --check web/rh_task_queue.js` 等

- [ ] **Step 3: Commit**

```bash
git add web/rh_task_queue.js
git commit -m "feat: extension entry wiring drawer, queue manager and event bridge"
```

---

### Task 11: 安装 + 零 GPU 验证（V1-V5, V8-V10）

**Files:**
- Create: `example_workflows/zerogpu-save-text.json`
- Create: `docs/verification-20261115.md`

- [ ] **Step 1: 安装到 custom_nodes**

在 `<ComfyUI>\custom_nodes` 下创建指向工作区的目录联接（`New-Item -ItemType Junction`），使改一处即生效，避免复制漂移。

- [ ] **Step 2: 启动 ComfyUI**

用 `..\python\python.exe -s ComfyUI\main.py --windows-standalone-build --port 8188`，cwd = 启动器根目录。以后台任务启动，日志写到 `<tools>\rh-taskqueue-comfy.log`（**不得**写进共享工作区）。

- [ ] **Step 3: V1 health**

Run: `Invoke-RestMethod http://127.0.0.1:8188/rh_queue/health | ConvertTo-Json`
Expected: `db.ok=true`，`caps.jobs_api=true`

- [ ] **Step 4: V2 jobs 结构**

Run: `Invoke-RestMethod 'http://127.0.0.1:8188/api/jobs?limit=1' | ConvertTo-Json`
Expected: 含 `jobs` 与 `pagination` 两字段

- [ ] **Step 5: V3 零 GPU 任务**

POST `/prompt`，body 为 SaveText 单节点图（`{"1": {"class_type": "SaveText", "inputs": {"text": "rh-queue-selftest"}}}`）。随后轮询 `/api/jobs/{prompt_id}`，期望经历 `pending → in_progress → completed`，且 `outputs_count>=1`。

- [ ] **Step 6: V4 二次提交验证样本数**

同签名再提交一次 → `POST /rh_queue/estimate` 应返回 `sample_count=2`、avg 为两次均值。

- [ ] **Step 7: V5 改签名不命中**

把 text 改成别的值再提交 → 新签名 `found=false`。

- [ ] **Step 8: V8 取消**

提交一个长任务（SDXL 或长步数）→ `POST /api/jobs/{id}/cancel` → 状态应转 `cancelled`。

- [ ] **Step 9: V10 刷新恢复**

前端 IndexedDB 里的本地任务在刷新后仍在。

- [ ] **Step 10: 记录验证结果到 `docs/verification-20261115.md`**

每项写：命令、期望、实际、结论。

- [ ] **Step 11: Commit**

```bash
git add example_workflows docs
git commit -m "test: zero-gpu verification of jobs api, duration store and cancel"
```

---

### Task 12: 最小 SDXL 验证 + 浏览器 UI 验证（V6-V7）

**Files:**
- Create: `example_workflows/min-sdxl-512.json`
- Create: `docs/screenshots/`

- [ ] **Step 1: 准备最小 SDXL 工作流**

512×512、steps=4、cfg=4、euler、a 仅 1 batch，checkpoint = `waiIllustriousSDXL_v160.safetensors`。

- [ ] **Step 2: V6 提交并核验图片输出**

→ `/api/jobs/{id}` 的 `outputs` 应含 `images` 媒体类型条目，`/view?filename=...` 能取到图片字节。

- [ ] **Step 3: V7 浏览器验证**

加载 `browser-use:control-in-app-browser` 技能 → 打开 `http://127.0.0.1:8188` → 打开抽屉 → 截图核对：摘要三数、卡片状态与计时、缩略图渲染、过滤栏切换。截图存 `docs/screenshots/`。

- [ ] **Step 4: Commit**

```bash
git add example_workflows docs/screenshots
git commit -m "test: minimal sdxl output preview and browser ui verification"
```

---

### Task 13: 收尾

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README**

安装位置、启用步骤、路由清单、UI 说明、预提交上限语义（**不是**并行数）、浏览器限制（页面关闭无通知）、本地队列行为、耗时档案用法、故障排查（drawer 不出现 → 看启动日志里 `rh_queue` 路由是否注册）。

- [ ] **Step 2: 停掉 ComfyUI，释放 8188**

关闭我启动的进程，确认 `netstat -ano | findstr :8188` 无输出，把启停权交回主人启动器。

- [ ] **Step 3: 最终回归**

Run: `& $PY -m pytest tests -v` + `node --test tests/js`
Expected: 全部 PASS

- [ ] **Step 4: 回读核验产物**

`Test-Path` + 文件大小确认所有交付文件真实在盘上。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: readme with install, routes, semantics and troubleshooting"
```
