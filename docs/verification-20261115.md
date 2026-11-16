# 验证报告 · ComfyUI-RH-TaskQueue

**日期：** 2026-11-15
**环境：** ComfyUI `0.45.0`（git `4d64a8bc0`，2026-11-11 master）/ 前端 `comfyui-frontend-package 1.58.5` / Python 3.12.10
**安装：** `.../ComfyUI-WorkFisher-V2/ComfyUI/custom_nodes/ComfyUI-RH-TaskQueue`（联接至源码仓库）
**截图：** `docs/screenshots/drawer-runtime.png`（抽屉运行态，含摘要三数 / 筛选栏 / 已完成卡片 / 文本输出正文）

---

## 自动化测试

| 套件 | 命令 | 结果 |
|---|---|---|
| 后端耗时库 | `pytest tests -v` | **9 passed** |
| 前端纯逻辑 | `node --test tests/js` | **24 passed** |
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

> **教训**：V7–V10 全部通过调试钩子**程序化驱动 DOM** 验证，**一次真实鼠标点击都没做过**，所以整块 UI 的命中测试从没被覆盖。指针事件类缺陷只能靠真实输入派发发现，读 DOM 状态是看不出来的。
>
> 另一个教训：**验证脚本本身必须可重复运行**。`verify_duration.mjs` 第一次跑全绿，第二次跑就 500 —— 撞的是它自己写死的 `prompt_id`。重跑一次全量验证，才把 B11 这个后端边界缺陷逼出来。

---

## 未验证 / 已知未覆盖

- 浏览器通知的**实际弹出**未做系统级验证（自动化环境无法确认系统通知横幅）；音效逻辑单测通过，"测试音效"按钮会在用户手势内解锁 AudioContext。
- 多标签页 leader 租约的**竞争切换**未做双标签实测（当前是单标签验证）。
- Legacy（`/queue`+`/history`）适配器只做了代码级实现，本机 ComfyUI 0.45.0 有 Jobs API，未触发回退路径。
- 「加入任务队列」按钮**未做真实点击**（会真实提交主人当前画布上的工作流并消耗 GPU）；其可点性由 V11 中面板计算值为 `pointer-events: auto` 间接覆盖。
- 真实多实例并行（Phase 5）不在本轮范围。
