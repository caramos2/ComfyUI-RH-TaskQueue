/**
 * The Simplified Chinese language pack.
 *
 * Keys are flat on purpose: the plugin has no build step, so the lookup is a
 * plain object access and a missing key is easy to spot.
 *
 * The English pack must carry exactly the same keys - the test suite checks
 * that, so a half translated pack can never reach a release.
 */

export const zhCN = {
  'app.name': '任务队列',

  'drawer.tab': '任务队列',
  'drawer.title': '任务队列',
  'drawer.mode.connecting': '连接中',
  'drawer.mode.jobsApi': 'Jobs API 模式',
  'drawer.mode.legacy': 'Legacy 模式',
  'drawer.mode.cancellable': ' · 可取消',
  'drawer.mode.storeNotReady': '耗时库未就绪',

  'drawer.stat.running': '运行中',
  'drawer.stat.pending': '后端排队',
  'drawer.stat.queued': '本地排队',

  'drawer.control.limit': '预提交上限',
  'drawer.control.autoDispatch': '自动派发',
  'drawer.control.sound': '声音',
  'drawer.control.notify': '通知',
  'drawer.control.enqueue': '加入任务队列',
  'drawer.control.testSound': '测试音效',
  'drawer.control.hint':
    '预提交上限只控制提前交给 ComfyUI 的任务数量，不代表 GPU 并行数。',
  'drawer.control.language': '语言',

  'drawer.filter.all': '全部',
  'drawer.filter.running': '运行中',
  'drawer.filter.queued': '排队中',
  'drawer.filter.done': '已完成',
  'drawer.filter.failed': '失败',

  'drawer.empty.all': '暂无任务',
  'drawer.empty.filtered': '该分类下暂无任务',

  'language.option.auto': '跟随浏览器',
  'language.option.zh': '简体中文',
  'language.option.en': 'English',

  'card.status.pluginQueued': '插件排队',
  'card.status.backendPending': '后端待执行',
  'card.status.running': '运行中',
  'card.status.completed': '已完成',
  'card.status.failed': '失败',
  'card.status.cancelled': '已中止',
  'card.status.submitFailed': '提交失败',

  'card.untitled': '未命名工作流',
  'card.created': '创建 ',
  'card.reference': '上次耗时 {last} · 平均 {avg}（{count} 次）',
  'card.outputs': '输出 {count} 项',
  'card.error.unknown': '未知错误',
  'card.error.node': '节点 {type}',

  'card.action.cancel': '取消',
  'card.action.reveal': '打开文件夹',
  'card.action.revealTitle': '在文件管理器中定位该输出文件',
  'card.action.traceback': '查看堆栈',

  'timing.pluginQueued': '插件排队 ',
  'timing.backendWaiting': '后端等待 ',
  'timing.queuePosition': ' · 队列位置 ',
  'timing.running': '已运行 ',
  'timing.duration': '本次耗时 ',
  'timing.failed': '执行失败',
  'timing.failedWithDuration': '执行失败 · 耗时 ',
  'timing.cancelled': '已中止',
  'timing.cancelledWithDuration': '已中止 · 耗时 ',
  'timing.submitFailed': '提交失败',

  'run.label': '运行',
  'run.tipTitle': '插件运行（冻结参数）',
  'run.tipBody':
    '点击时把当前工作流参数冻结成一份快照，存进任务队列。\n' +
    '之后无论怎么改画布，排队中的任务仍按各自那次编辑的参数执行。\n\n' +
    '它走插件自己的队列：按抽屉里的「预提交上限」逐个派发，排队情况在抽屉里可见、可取消，刷新页面也不丢。\n' +
    '（原生「运行」是直接交给 ComfyUI 排队。）',
  'run.flash.queued': '已排队 {count}',
  'run.flash.submitted': '已提交',
  'run.flash.failed': '提交失败',
  'run.flash.queuedDefault': '已加入队列',

  'notify.successTitle': 'ComfyUI 任务已完成',
  'notify.successBody': '耗时 {duration} · 输出 {count} 项',
  'notify.failureTitle': 'ComfyUI 任务执行失败',
  'notify.failureBody': '耗时 {duration} · {message}',
  'notify.unknownError': '未知错误',

  'output.openFile': '打开文件',
  'output.textTruncated': '（文本已截断）',
  'output.textOutput': '文本输出',
  'output.unnamed': '未命名',
  'output.unknownType': '未知类型输出',

  'error.workflowUnreachable': '无法访问当前工作流',
  'error.workflowEmpty': '当前工作流为空，无法加入队列',
};
