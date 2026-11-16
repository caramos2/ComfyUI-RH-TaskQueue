/**
 * Working out what a task actually was.
 *
 * ComfyUI's Jobs API does not carry a workflow name. The graph it stores has
 * an id but no title - the title lives in the frontend's own workflow store.
 * The backend's workflow_id is exactly that graph id, so the plugin can look
 * the title up in the frontend and fall back to a description built from the
 * prompt itself.
 */

const CHECKPOINT_HINTS = [
  'CheckpointLoader',
  'CheckpointLoaderSimple',
  'UNETLoader',
  'LoraLoader',
];

const MODEL_KEYS = ['ckpt_name', 'unet_name', 'model_name', 'lora_name'];

/** Pull the graph id out of a workflow payload (object or JSON string). */
export function extractGraphId(workflow) {
  if (!workflow) return null;
  let value = workflow;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id === 'string' && value.id) return value.id;
  if (value.extra && typeof value.extra === 'object') {
    if (typeof value.extra.id === 'string' && value.extra.id) return value.extra.id;
  }
  return null;
}

/** Human title for a workflow file (its filename without the extension). */
export function titleFromWorkflowFile(workflow) {
  if (!workflow) return null;
  let filename = workflow.filename || null;
  if (!filename && typeof workflow.path === 'string') {
    filename = workflow.path.split('/').pop() || null;
  }
  if (!filename) return null;
  const title = String(filename).replace(/\.json$/i, '').trim();
  return title || null;
}

/**
 * Index the frontend's workflow store: graph id -> workflow title.
 *
 * The backend reports workflow_id = extra_pnginfo.workflow.id, which is the
 * same id the frontend stores on the workflow's graph content.
 */
export function buildTitleIndex(app) {
  const index = new Map();
  const svc = app && app.extensionManager && app.extensionManager.workflow;
  if (!svc) return index;
  const list = Array.isArray(svc.workflows) ? svc.workflows.slice() : [];
  if (svc.activeWorkflow) list.push(svc.activeWorkflow);
  for (const workflow of list) {
    if (!workflow) continue;
    const title = titleFromWorkflowFile(workflow);
    if (!title) continue;
    const id = extractGraphId(workflow.content);
    if (id && !index.has(id)) index.set(id, title);
    if (typeof workflow.path === 'string' && workflow.path && !index.has(workflow.path)) {
      index.set(workflow.path, title);
    }
  }
  return index;
}

/** Look a title up by graph id. */
export function lookupTitle(index, workflowId) {
  if (!index || !workflowId) return null;
  return index.get(workflowId) || null;
}

/**
 * Describe a prompt when no title is known.
 *
 * The checkpoint plus the main node types still tell the user what the task
 * actually was, which is more useful than "unnamed workflow".
 */
export function describePrompt(prompt) {
  if (!prompt || typeof prompt !== 'object') return null;
  const classes = [];
  let model = null;
  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.class_type === 'string' && !classes.includes(node.class_type)) {
      classes.push(node.class_type);
    }
    if (!model) {
      const inputs = node.inputs || {};
      for (const key of MODEL_KEYS) {
        if (typeof inputs[key] === 'string' && inputs[key]) {
          model = inputs[key];
          break;
        }
      }
    }
  }
  if (!classes.length) return null;
  const main = classes.filter((name) => !CHECKPOINT_HINTS.includes(name));
  const label = (main.length ? main : classes).slice(0, 2).join(' + ');
  if (model) {
    const short = String(model).replace(/\.[a-z0-9]+$/i, '');
    return short + ' · ' + label;
  }
  return label;
}
