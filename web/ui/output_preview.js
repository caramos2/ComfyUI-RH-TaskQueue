/**
 * Output previews.
 *
 * The Jobs API returns the full output map as { node_id: { media_type: [items] } }.
 * Every media type is rendered with its own affordance, and anything the
 * plugin does not recognise is still shown as a downloadable entry - outputs
 * are never silently dropped.
 *
 * Media URLs are always built through ComfyUI's own /view endpoint; the
 * plugin never assembles a disk path.
 */

import { serverUrl } from '../core/api_client.js';
import { i18n as sharedI18n } from '../core/i18n.js';

const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.log'];

function isTextFile(filename) {
  const lower = String(filename || '').toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** URL for one output file, served by ComfyUI itself. */
export function buildViewUrl(item) {
  const filename = (item && item.filename) || '';
  const subfolder = (item && item.subfolder) || '';
  const type = (item && item.type) || 'output';
  return (
    serverUrl('/view') +
    '?filename=' + encodeURIComponent(filename) +
    '&subfolder=' + encodeURIComponent(subfolder) +
    '&type=' + encodeURIComponent(type)
  );
}

function normalizeItem(raw, mediaType) {
  if (raw && typeof raw === 'object') {
    return Object.assign({}, raw, { mediaType: raw.mediaType || mediaType });
  }
  if (typeof raw === 'string') {
    // Under the "text" media type a bare string IS the text content, not
    // a file name. Other media types carry file names.
    if (mediaType === 'text') return { mediaType, text: raw };
    return { filename: raw, subfolder: '', type: 'output', mediaType };
  }
  return { mediaType, raw };
}

/** Flatten the output map into a flat list of renderable entries. */
export function collectOutputItems(record) {
  const entries = [];
  const outputs = record && record.outputs;
  if (!outputs || typeof outputs !== 'object') return entries;
  for (const [nodeId, nodeOutputs] of Object.entries(outputs)) {
    if (!nodeOutputs || typeof nodeOutputs !== 'object') continue;
    for (const [mediaType, list] of Object.entries(nodeOutputs)) {
      if (mediaType === 'animated' || !Array.isArray(list)) continue;
      for (const raw of list) {
        entries.push({ nodeId, mediaType, item: normalizeItem(raw, mediaType) });
      }
    }
  }
  return entries;
}

function linkElement(item, label, t) {
  const link = document.createElement('a');
  link.className = 'rh-tq-file';
  link.href = buildViewUrl(item);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = label || item.filename || t('output.openFile');
  return link;
}

/**
 * The first output file of a task, used by the "open folder" action.
 */
export function findFirstOutputFile(record) {
  for (const entry of collectOutputItems(record)) {
    const item = entry.item || {};
    if (item.filename) {
      return {
        filename: item.filename,
        subfolder: item.subfolder || '',
        type: item.type || 'output',
      };
    }
  }
  const preview = record && record.previewOutput;
  if (preview && preview.filename) {
    return {
      filename: preview.filename,
      subfolder: preview.subfolder || '',
      type: preview.type || 'output',
    };
  }
  return null;
}

/**
 * Render the output section of a task card.
 * Returns null when the task has no outputs at all.
 */
export function renderOutputPreview(record, i18n) {
  const translator = i18n || sharedI18n;
  const t = (key, params) => translator.t(key, params);
  const entries = collectOutputItems(record);
  const container = document.createElement('div');
  container.className = 'rh-tq-outputs';

  if (!entries.length) {
    const preview = record && record.previewOutput;
    if (preview && preview.content) {
      const box = document.createElement('div');
      box.className = 'rh-tq-text';
      box.textContent = preview.content;
      if (preview.truncated) {
        const note = document.createElement('div');
        note.className = 'rh-tq-sig';
        note.textContent = t('output.textTruncated');
        box.appendChild(note);
      }
      container.appendChild(box);
      return container;
    }
    if (preview && preview.filename) {
      container.appendChild(linkElement(preview, preview.filename, t));
      return container;
    }
    return null;
  }

  const thumbs = document.createElement('div');
  thumbs.className = 'rh-tq-thumbs';
  const others = document.createElement('div');

  for (const entry of entries) {
    const { item, mediaType } = entry;
    const type = item.mediaType || mediaType || '';

    if (type === 'images' || type === 'image') {
      const img = document.createElement('img');
      img.className = 'rh-tq-thumb';
      img.src = buildViewUrl(item);
      img.alt = item.filename || 'output';
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        window.open(buildViewUrl(item), '_blank', 'noopener');
      });
      thumbs.appendChild(img);
      continue;
    }

    if (type === 'video') {
      const video = document.createElement('video');
      video.className = 'rh-tq-media';
      video.controls = true;
      video.preload = 'metadata';
      video.src = buildViewUrl(item);
      others.appendChild(video);
      continue;
    }

    if (type === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = buildViewUrl(item);
      audio.style.width = '100%';
      others.appendChild(audio);
      continue;
    }

    if (type === 'text' || isTextFile(item.filename)) {
      const content =
        item.text !== undefined && item.text !== null ? item.text : item.content;
      if (content !== undefined && content !== null) {
        const box = document.createElement('div');
        box.className = 'rh-tq-text';
        box.textContent = String(content);
        others.appendChild(box);
      }
      if (item.filename) {
        others.appendChild(linkElement(item, item.filename || t('output.textOutput'), t));
      }
      continue;
    }

    if (type === '3d') {
      others.appendChild(linkElement(item, '3D: ' + (item.filename || t('output.unnamed')), t));
      continue;
    }

    // Unknown media type: keep the entry, never drop it.
    others.appendChild(
      linkElement(
        item,
        (item.filename || t('output.unknownType')) + (item.format ? ' (' + item.format + ')' : ''),
        t,
      ),
    );
  }

  if (thumbs.childElementCount) container.appendChild(thumbs);
  if (others.childElementCount) container.appendChild(others);
  return container.childElementCount ? container : null;
}
