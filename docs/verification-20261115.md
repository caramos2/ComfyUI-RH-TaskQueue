# 验证报告 · ComfyUI-RH-TaskQueue

**日期：** 2026-11-15
**环境：** ComfyUI `0.45.0`（git `4d64a8bc0`，2026-11-11 master）/ 前端 `comfyui-frontend-package 1.58.5` / Python 3.12.10
**安装：** `.../ComfyUI-WorkFisher-V2/ComfyUI/custom_nodes/ComfyUI-RH-TaskQueue`（联接至源码仓库）
**截图：** `docs/screenshots/drawer-runtime.png`（抽屉运行态，含摘要三数 / 筛选栏 / 已完成卡片 / 文本输出正文）

---

## 自动化测试

| 套件 | 命令 | 结果 |
|---|---|---|
| 后端耗时库 | `pytest tests -v` | **12 passed** |
| 前端纯逻辑 | `node --test tests/js` | **38 passed** |
| 语法检查 | `node --check` 全量 web/*.js | **0 failures** |
| 端到端（指纹→耗时库） | `node tests/verify/verify_duration.mjs` | **11 passed / 0 failed** |

---

## 逐项验证

| # | 项目 | 方法 | 期望 | 实测 | 结论 |
|---|---|---|---|---|---|
| V1 | 插件后端注册 | `GET /rh_queue/health` | 200，`db.ok=true` | `version 1.0.0`、`db.ok=true`、`caps.jobs_api/legacy_api/cancel_api` 全 true、`mode=jobs_api` | ✅ |
| V2 | Jobs API 结构 | `GET /api/jobs?limit=1` | `{jobs, pagination}` | `{"jobs":[],"pagination":{offset,limit,total,has_more}}` | ✅ |
| V3 | 零 GPU 任务状态流 | POST `/prompt`（`String Literal`→`SaveText`） | pending→in_progress→completed | 14ms 完成，`execution_start_time`/`execution_end_time` 齐全，`outputs_count=1` | ✅ |
| V4 | 指纹稳定性 + 样本累积 | 同一工作流多次执行 | 同一签名，样本数递增 | 签名 `55fe5055ec87…` 累积 **n=8**，avg=0.140s | ✅ |
| V5 | 指纹区分度 | 改 text 值 / 改 steps | 签名变化 | 换 text → 签名变；只改 seed → 签名不变 | ✅ |
| V6 | 图片输出 | 最小 SDXL（512×512/4 步） | outputs 含 images | 9.83s 完成，产出 512×512 PNG，抽屉内渲染出缩略图 | ✅ |
| V7 | 抽屉 UI | 浏览器实测 + 截图 | 抽屉/摘要/卡片/缩略图正常 | 抽屉宽 380px，模式徽标「Jobs API 模式 · 可取消」，摘要三数分列，输出缩略图与文本正文均渲染 | ✅ |
| V8 | 取消 | `POST /api/jobs/{id}/cancel` | 状态转 cancelled | 运行中任务 → `{"cancelled":true}` → `cancelled`，且**不计入耗时样本** | ✅ |
| V9 | 预提交上限 + FIFO | 连入 3 任务，上限=1 | 一次只放行 1 个，终态后放行下一个 | 时间线：`inFlight` **始终 ≤ 1**，严格 1→2→3 派发，t=1.6s 与 t=2.6s 各释放一个名额 | ✅ |
| V10 | 刷新恢复 | 刷新页面 | 本地队列与后端任务都恢复 | IndexedDB 中的 2 个待派发任务刷新后仍在，排队计时跨刷新继续（01:11→01:17） | ✅ |
| V11 | **真实点击交互**（补测） | 浏览器**真实鼠标点击**（非调试钩子） | 标签能开合抽屉、面板内控件可点 | 标签点击：`isOpen` false→true、面板 `left` 811→415（滑入视口）；筛选按钮真实点击后 `is-active` 移到「已完成」；× 真实点击关闭抽屉（`isOpen`→false）；`elementFromPoint(标签中心)` 由画布变为 `DIV.rh-tq-host` | ✅ |
| V12 | 后端幂等边界（补测） | 同 `prompt_id` 重复上报，且耗时行已被删 | 不应 500，应重新计入样本 | HTTP 实测：record → 删 history 行 → 同 `prompt_id` 再 record，返回 **200** `{"ok":true,…,"sample_count":1}`（修复前是 HTTP 500 `TypeError: 'NoneType' object is not subscriptable`）；`verify_duration.mjs` 连跑两次均 11 passed | ✅ |
| V13 | **工作流名**（B12） | 后端标题映射 + 页面实测 | 卡片显示真实中文标题 | `GET /rh_queue/workflow_titles` → 64 条 id→标题映射；`16522802-…` → 「sd系列集成工作流」、`19d11da3-…` → 「flux klein多图参考」；页面卡片实测显示「**sd系列集成工作流**」 | ✅ |
| V14 | **运行中计时**（B13） | 页面内提交任务 + 两次采样 | 「已运行」随时间走动 | WS `execution_start` 到达并带**服务端权威 timestamp**（1794822138389）；t1 卡片「已运行 **00:09**」，5 秒后「已运行 **00:14**」；结束后「本次耗时 00:25」并入耗时库 | ✅ |
| V15 | **取消同步**（B14） | **真实点击**排队卡片的「取消」 | 后端真的取消掉 | 点击后卡片「已中止」；`GET /api/jobs/{id}` → **404**；`/api/jobs` 列表中已消失；跨 3 轮同步卡片保持「已中止」，不回退也不卡死 | ✅ |
| V16 | **预览无损**（主人确认项） | 字节级比对磁盘文件与 `/view` | 两者字节完全一致 | 磁盘 PNG 1,690,881B / sha `d6a8db3c…`；插件用的 `/view?filename=…&type=output` 返回 1,690,881B / sha **完全相同**；加 `&preview` 才是 145,364B 的 webp 降质版（插件不使用） | ✅ |
| V17 | **打开文件夹**（新功能） | **真实点击**卡片「打开文件夹」 | 请求打到后端并定位文件 | 真实点击 → `POST /rh_queue/reveal` → **200**；后端 `explorer /select,` 定位到输出文件；路径穿越请求 → **400** | ✅ |
| V18 | 取消卡片文案 | 从未启动就被取消的任务 | 不显示「耗时 --:--」 | 卡片显示「已中止」（无耗时字段），符合「它根本没跑过」的事实 | ✅ |

---

## 过程中发现并修掉的缺陷

| # | 症状 | 根因 | 修复 |
|---|---|---|---|
| B1 | 任务完成后名额不释放，后续任务永远卡在「插件排队」 | `onTaskFinished` 只在状态为空时改状态，而 `BACKEND_PENDING` 是真值 | 改为 `markFinished(promptId, status)`，显式写入终态 |
| B2 | 刷新后 8 秒内不派发 | 标签页刷新后租约仍属旧 tabId，要等 8s TTL 过期才能接管 | 监听 `pagehide`/`beforeunload` 主动释放租约，接管变为即时 |
| B3 | 抽屉留下永久「插件排队」幽灵卡 | 任务提交后 id 从 `local-…` 换成 prompt_id，控制器没清理旧 id | 同步时清理队列已不再持有的插件任务记录 |
| B4 | 提交失败的任务直接消失 | catch 里把记录从 Map 删了，用户看不到失败原因 | 保留记录并标记 `SUBMIT_FAILED`，卡片显示错误 |
| B5 | 工作流名显示成 UUID | `workflowName` 回落用了 `workflow_id` | 名称与 id 分开，缺名时显示「未命名工作流」 |
| B6 | 「上次参考耗时」整列为空 | 抽屉按 `record.id` 查估计表，而估计表按 **signature** 存；且 `refreshEstimates` 跳过了终态任务 | 统一按 signature 查，且不再跳过终态任务 |
| B7 | 文本输出被当成文件名渲染成坏链接 | `outputs[node].text` 是裸字符串数组，不是文件名 | 裸字符串按文本正文渲染，文件项才走 `/view` |
| B8 | 刷新后历史任务被重复记样本 | 重建视图时会再次上报同一批 job | 后端新增 `recorded_prompts` 幂等表，按 prompt_id 去重 |
| B9 | 详情里的 `workflow.prompt` 被合并丢弃 | `mergeRecord` 的字段白名单漏了 `workflow` | 白名单补上，指纹才能从 job 详情重算 |
| B10 | **整个抽屉对真实鼠标点击完全无响应**（主人实测反馈：点右侧「任务队列」拉不开） | 宿主 `drawer.js` 设有 `pointer-events: none`（本意是不遮挡 ComfyUI 自身 UI），但 `pointer-events` 是**继承属性**，shadow root 内没有任何一处重新打开它 ⇒ 标签与面板内所有控件的计算值都是 `none`，`elementFromPoint(标签中心)` 直接命中背后的画布，点击被画布吃掉 | 标签与「打开态」面板显式 `pointer-events: auto`，「关闭态」面板保持 `none`；新增 `tests/js/styles.test.mjs` 3 项回归断言 |
| B11 | `/rh_queue/record` 偶发 **HTTP 500** | `record()` 的幂等分支在「`prompt_id` 已记录、但耗时行已被删除」时返回 `None`，路由随后直接下标访问 `record["last_duration"]` → TypeError | 幂等分支改为「耗时行仍在才提前返回，行已删则继续写入样本」；路由再加一层防御，缺行返回 200 而非 500；自检脚本改用**每次运行唯一**的 `prompt_id`（此前写死 `selftest-1/2`，第二次跑必然撞库） |
| B12 | 卡片全是「未命名工作流」（主人实测反馈） | `/api/jobs` **不返回任何名字字段**（只有 `id/status/priority/create_time/execution_*/outputs_count/preview_output/workflow_id`）；前端图 JSON 自身也没有 name/title（实测 keys：`id/revision/last_node_id/…/extra/version/seed_widgets`） | 三级回落：① 前端 active workflow / 工作流库的文件名 → ② **后端扫 `user/default/workflows` 建 id→标题映射**（`GET /rh_queue/workflow_titles`，60s 缓存；文件顶层 `id` 即后端 `workflow_id`）→ ③ `describePrompt`（ckpt 名 + 主要节点类型）兜底 |
| B13 | **运行中任务时间停在 `--:--`**（主人实测反馈） | 两个独立成因：① 服务端 `execution_start` 是**定向事件**——`execution.py` 里 `broadcast=False`，只发给「提交该任务的 client_id」。此前用 PowerShell 以 `client_id=rh-timer-probe` 提交，那个 id **没有对应 socket**，事件被静默丢弃，前端永远收不到；② 插件兜底 `restoreRunningStart` 只在「记录由非 running 变成 running」时才补起始时刻，**首次见到就是 running 的任务永远拿不到起始时刻** | ① 直接采用事件自带的**服务端权威 timestamp**（`add_message` 每次都盖 `int(time.time()*1000)`），本地时钟仅作兜底；② 兜底改为「首次见到 running 就按当下打点」，抽成纯函数 `resolveRunningStart` + 4 项单测；③ 终态任务不被迟到的开始事件回退成 running |
| B14 | **排队中点「取消」不同步**（主人实测反馈） | ComfyUI `cancel_job()` 对 pending 任务走 `dequeue`：**从不进 history**。于是该作业从 `/api/jobs` 列表消失、`GET /api/jobs/{id}` 返 404，后端再也不会汇报它 → 插件下次同步看不到它 → 卡片永久卡在「后端待执行」 | API 返回 `cancelled===true` 时**立即**本地标 CANCELLED，并调 `queueManager.markFinished` 释放预提交名额；`PLUGIN_QUEUED` 的「取消」= 从插件队列移除；文案上未跑过的任务不再显示「耗时 --:--」 |

> **教训**：V7–V10 全部通过调试钩子**程序化驱动 DOM** 验证，**一次真实鼠标点击都没做过**，所以整块 UI 的命中测试从没被覆盖。指针事件类缺陷只能靠真实输入派发发现，读 DOM 状态是看不出来的。
>
> 另一个教训：**验证脚本本身必须可重复运行**。`verify_duration.mjs` 第一次跑全绿，第二次跑就 500 —— 撞的是它自己写死的 `prompt_id`。重跑一次全量验证，才把 B11 这个后端边界缺陷逼出来。
>
> **第三条教训（本轮最贵的一条）：验证请求的「身份」必须和服务端路由方式对齐。** B13 卡了两轮，根因不在插件而在验证方法：ComfyUI 的 `execution_start` 是发给「提交该任务的 client_id」那个 socket 的定向事件，而我一直用 PowerShell 以一个**没有 socket 的假 client_id` 提交任务 ⇒ 事件被服务端静默丢弃 ⇒ 插件当然收不到。** 换成「从页面自身提交」（同一个 client_id）后，事件立刻到位、计时当场走动。**排查「事件收不到」时，先问「这条消息在服务端是广播还是定向？目标身份是谁？我发起的请求用的那个身份吗？」**
>
> 第四条：ComfyUI 的**取消语义**是「移出队列、且不进历史」。所以「取消成功」的判据不能是「后端还会汇报它」——恰恰相反，成功之后后端就**永远不再提它**。插件必须在 API 返回 `cancelled===true` 的当下就自己落终态。

---

## 未验证 / 已知未覆盖

- 浏览器通知的**实际弹出**未做系统级验证（自动化环境无法确认系统通知横幅）；音效逻辑单测通过，"测试音效"按钮会在用户手势内解锁 AudioContext。
- 多标签页 leader 租约的**竞争切换**未做双标签实测（当前是单标签验证）。
- Legacy（`/queue`+`/history`）适配器只做了代码级实现，本机 ComfyUI 0.45.0 有 Jobs API，未触发回退路径。
- 「加入任务队列」按钮**未做真实点击**（会真实提交主人当前画布上的工作流并消耗 GPU）；其可点性由 V11 中面板计算值为 `pointer-events: auto` 间接覆盖。
- 真实多实例并行（Phase 5）不在本轮范围。
