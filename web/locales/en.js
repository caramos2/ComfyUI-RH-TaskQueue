/**
 * The English language pack.
 *
 * It carries exactly the same keys as the Chinese pack - the test suite
 * compares both key lists, so a missing translation fails the build instead
 * of showing up as an empty label in the UI.
 */

export const en = {
  'app.name': 'Task Queue',

  'drawer.tab': 'Task Queue',
  'drawer.title': 'Task Queue',
  'drawer.mode.connecting': 'Connecting',
  'drawer.mode.jobsApi': 'Jobs API mode',
  'drawer.mode.legacy': 'Legacy mode',
  'drawer.mode.cancellable': ' · cancellable',
  'drawer.mode.storeNotReady': 'Duration store not ready',

  'drawer.stat.running': 'Running',
  'drawer.stat.pending': 'Backend queue',
  'drawer.stat.queued': 'Plugin queue',

  'drawer.control.limit': 'Pre-submit limit',
  'drawer.control.autoDispatch': 'Auto dispatch',
  'drawer.control.sound': 'Sound',
  'drawer.control.notify': 'Notifications',
  'drawer.control.enqueue': 'Add to task queue',
  'drawer.control.testSound': 'Test sound',
  'drawer.control.hint':
    'The pre-submit limit only controls how many tasks are handed to ComfyUI early. It is not a GPU parallelism setting.',
  'drawer.control.language': 'Language',

  'drawer.filter.all': 'All',
  'drawer.filter.running': 'Running',
  'drawer.filter.queued': 'Queued',
  'drawer.filter.done': 'Done',
  'drawer.filter.failed': 'Failed',

  'drawer.empty.all': 'No tasks yet',
  'drawer.empty.filtered': 'No tasks in this filter',

  'language.option.auto': 'Follow browser',
  'language.option.zh': '简体中文',
  'language.option.en': 'English',

  'card.status.pluginQueued': 'Plugin queued',
  'card.status.backendPending': 'Waiting in backend',
  'card.status.running': 'Running',
  'card.status.completed': 'Completed',
  'card.status.failed': 'Failed',
  'card.status.cancelled': 'Cancelled',
  'card.status.submitFailed': 'Submit failed',

  'card.untitled': 'Untitled workflow',
  'card.created': 'Created ',
  'card.reference': 'Last {last} · average {avg} ({count} runs)',
  'card.outputs': '{count} output(s)',
  'card.error.unknown': 'Unknown error',
  'card.error.node': 'Node {type}',

  'card.action.cancel': 'Cancel',
  'card.action.reveal': 'Open folder',
  'card.action.revealTitle': 'Locate this output file in the file manager',
  'card.action.traceback': 'Show traceback',

  'timing.pluginQueued': 'Plugin queue ',
  'timing.backendWaiting': 'Backend queue ',
  'timing.queuePosition': ' · position ',
  'timing.running': 'Running for ',
  'timing.duration': 'Duration ',
  'timing.failed': 'Failed',
  'timing.failedWithDuration': 'Failed · duration ',
  'timing.cancelled': 'Cancelled',
  'timing.cancelledWithDuration': 'Cancelled · duration ',
  'timing.submitFailed': 'Submit failed',

  'run.label': 'Run',
  'run.tipTitle': 'Plugin run (frozen parameters)',
  'run.tipBody':
    'Pressing it freezes the current workflow parameters into a snapshot and stores that snapshot in the task queue.\n' +
    'Editing the canvas afterwards does not change what a queued task runs with: every queued task keeps the parameters of its own edit.\n\n' +
    'It uses the plugin\'s own queue: tasks are dispatched one by one according to the "Pre-submit limit" in the drawer, where the queue is visible and cancellable, and a page reload does not lose it.\n' +
    '(ComfyUI\'s own "Run" button hands the workflow straight to ComfyUI\'s queue.)',
  'run.flash.queued': 'Queued {count}',
  'run.flash.submitted': 'Submitted',
  'run.flash.failed': 'Submit failed',
  'run.flash.queuedDefault': 'Added to queue',

  'notify.successTitle': 'ComfyUI task finished',
  'notify.successBody': 'Took {duration} · {count} output(s)',
  'notify.failureTitle': 'ComfyUI task failed',
  'notify.failureBody': 'Took {duration} · {message}',
  'notify.unknownError': 'Unknown error',

  'output.openFile': 'Open file',
  'output.textTruncated': '(text truncated)',
  'output.textOutput': 'Text output',
  'output.unnamed': 'unnamed',
  'output.unknownType': 'Unknown output type',

  'error.workflowUnreachable': 'Cannot read the current workflow',
  'error.workflowEmpty': 'The current workflow is empty, cannot add it to the queue',
};
