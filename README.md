# ComfyUI-RH-TaskQueue

给 ComfyUI 加一个 RunningHub 风格的**右侧任务抽屉**：统一查看任务、真实执行耗时、输出结果预览、完成提醒，以及一个插件托管的提交队列和**工作流耗时档案**。

> 设计依据：`docs/superpowers/specs/2026-11-15-rh-taskqueue-design.md`
> 实施计划：`docs/superpowers/plans/2026-11-15-rh-taskqueue-phase1-3.md`

---

## 先说清楚三件事

1. **「预提交上限」不是 GPU 并行数。**
   单个标准 ComfyUI 实例只有一个 `prompt_worker`，队列里可以有很多任务，但它们是**顺序执行**的。
   这个上限控制的是「插件提前交给 ComfyUI 多少个任务」，超出部分留在插件自己的「本地排队」列表里。
   真正的并行需要多实例，那不在本版范围内。

2. **提交时间 ≠ 执行时间。**
   任务从插件队列释放出去只是**提交**给 ComfyUI；真正开始执行是后端确认之后的事。
   卡片上的「后端等待」和「已运行」是两个独立计时，不会混在一起。

3. **不劫持原生按钮。**
   原生 Queue Prompt 按钮行为完全不变，`app.queuePrompt` 没有被包装。
   插件用自己的「加入任务队列」入口提交冻结的工作流快照。

---

## 安装

本机已装在：

```text
C:\Users\prett\Desktop\gamehole\ComfyUI-WorkFisher-V2\ComfyUI\custom_nodes\ComfyUI-RH-TaskQueue
```

该目录是一个**目录联接（junction）**，指向源码仓库：

```text
C:\Users\prett\Desktop\minimax code work\ComfyUI-RH-TaskQueue
```

所以：**改源码仓库 = 立刻生效**，刷一下浏览器页面就行，不需要复制文件。
重启 ComfyUI 才会加载 Python 后端改动。

### 手动安装到别的机器

把整个仓库复制到 `<ComfyUI>/custom_nodes/ComfyUI-RH-TaskQueue` 即可。
**零第三方依赖**：后端只用 Python 标准库（`sqlite3` + aiohttp 路由），前端只用浏览器原生 API。

---

## 用法

启动 ComfyUI 后，页面右侧会出现一条竖排的**「任务队列」**开关，点开就是抽屉。

| 区域 | 内容 |
|---|---|
| 顶部徽标 | 数据源模式：`Jobs API 模式` / `Legacy 模式`，以及是否支持取消 |
| 摘要三数 | **运行中** / **后端排队** / **本地排队** —— 三个独立数字，不混算 |
| 控制区 | 预提交上限（1-8，默认 1）、自动派发、声音、通知、**加入任务队列**、测试音效 |
| 过滤栏 | 全部 / 运行中 / 排队中 / 已完成 / 失败 |

「加入任务队列」会**冻结当前工作流快照**再入队，所以之后继续改画布也不会影响已排队的任务。

任务卡上会显示：状态徽标、工作流名、创建时间、耗时（按状态用不同措辞）、
上次参考耗时、输出数量、失败原因，以及取消 / 移除 / 查看堆栈等操作。

---

## 输出预览

任务结束后按媒体类型分别渲染：

| 类型 | 呈现 |
|---|---|
| 图片 | 缩略图网格，点击开原图 |
| 视频 | 播放器 |
| 音频 | 播放器 |
| 3D | 文件名 + 打开/下载入口 |
| 文本 | 折叠预览（正文直接显示 + 文件链接） |
| 未知 | 保留条目，显示文件名与下载入口，**不静默丢弃** |

所有媒体地址都走 ComfyUI 自己的 `/view?filename=&subfolder=&type=`，插件不拼磁盘路径，也不接受任意本地路径。

---

## 工作流耗时档案

- 签名：`SHA256(canonical_json(normalized_api_prompt))`，版本号 `signature_version = 1`。
- 归一化会**递归剔除** `seed` / `noise_seed`，所以换个随机种子不会产生新记录；
  改模型、改 steps、改分辨率、改提示词则会。
- 只有**成功**的执行才计入样本；失败与中止不计。
- 每个 `prompt_id` 只记一次（后端有幂等表保护），刷新页面不会重复累加。
- 卡片上的「上次耗时 / 平均耗时（N 次）」是**历史参考**，不是剩余时间预测。
  硬件负载、缓存、模型状态、参数变化都会影响实际时长。

后端存储：`data/duration_history.sqlite3`（SQLite + WAL，事务写入，已 gitignore）。

---

## 插件自带 API

| 路由 | 方法 | 作用 |
|---|---|---|
| `/rh_queue/health` | GET | 版本、耗时库状态、能力探测（Jobs API / Legacy / 取消）、当前模式 |
| `/rh_queue/estimate` | POST | 按签名查上次耗时、平均耗时、样本数、更新时间 |
| `/rh_queue/record` | POST | 写入一次成功执行耗时（按 prompt_id 幂等） |
| `/rh_queue/history` | GET | 分页查询耗时记录 |
| `/rh_queue/history/{signature}` | DELETE | 删除某条耗时记录 |

**后端不存任务状态、不做队列、不存输出** —— 那些一律来自 ComfyUI 原生 API。

---

## 已知边界

- 浏览器完全关闭后不会派发插件队列，也不会弹系统通知（浏览器限制）。
  真正的后台常驻通知需要桌面伴随进程，不在本版范围。
- 多标签页同时打开时，只有一个标签页负责派发（localStorage 租约 + BroadcastChannel 广播），
  其余标签页只读同步。
- ComfyUI 自身的历史保留策略仍然生效；插件只存耗时摘要，不承担输出归档。
- 后端不支持按作业取消的旧版本里，「取消」按钮会如实报告无法取消，不假装成功。

---

## 开发与自检

```powershell
# 后端单测
& "C:\Users\prett\Desktop\gamehole\ComfyUI-WorkFisher-V2\python\python.exe" -m pytest tests -v

# 前端纯逻辑单测
node --test tests/js

# 端到端（需要 ComfyUI 在 8188 上跑着）
node tests/verify/verify_duration.mjs
```

零 GPU 自检工作流：`example_workflows/zerogpu-selftest.api.json`（`String Literal` → `SaveText`，不碰显卡）。
最小 SDXL 自检工作流：`example_workflows/min-sdxl-512.api.json`（512×512 / 4 步）。

---

## 目录结构

```text
ComfyUI-RH-TaskQueue/
├── __init__.py                  # WEB_DIRECTORY + 后端路由注册（零节点）
├── backend/
│   ├── routes.py                # /rh_queue/* 五条路由
│   ├── duration_store.py        # SQLite（WAL + 事务 + 幂等表）
│   └── fingerprint.py           # 签名格式校验
├── web/
│   ├── rh_task_queue.js         # 唯一扩展入口
│   ├── core/                    # api_client / task_model / task_store /
│   │                            # queue_manager / event_bridge /
│   │                            # fingerprint / notifier / settings
│   ├── adapters/                # jobs_api / legacy_api
│   └── ui/                      # drawer / task_card / output_preview / styles
├── tests/                       # pytest + node:test + 端到端脚本
├── example_workflows/
└── docs/superpowers/            # 设计文档与实施计划
```

**只有 `web/rh_task_queue.js` 调用 `app.registerExtension`**，其余都是纯 ES 模块，
不会���前端误当成第二个扩展入口。

---

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 抽屉没出现 | 看 ComfyUI 启动日志有没有 `[ComfyUI-RH-TaskQueue] registered /rh_queue/* routes`；没有说明后端注册失败，前端仍会加载但耗时库不可用 |
| 抽屉显示「耗时库未就绪」 | `/rh_queue/health` 没通，检查插件目录是否在 `custom_nodes` 下、是否需要重启 ComfyUI |
| 顶部显示「Legacy 模式」 | 该 ComfyUI 没有 `/api/jobs`，插件自动退回 `/queue` + `/history` |
| 任务一直「插件排队」 | 预提交上限被占满，或队列处于暂停；检查「自动派发」勾选状态 |
| 没有提示音 | 浏览器自动播放限制，必须先点一次「测试音效」或手动勾选「声音」解锁 AudioContext |
| 没有桌面通知 | 需要手动勾选「通知」并授权；被拒绝后不会重复弹窗 |
