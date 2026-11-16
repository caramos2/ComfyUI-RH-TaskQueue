/**
 * The jobs API has no workflow name, so the plugin resolves one itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTitleIndex,
  describePrompt,
  extractGraphId,
  lookupTitle,
  titleFromWorkflowFile,
} from '../../web/core/workflow_name.js';

test('the graph id is read from the workflow payload', () => {
  assert.equal(extractGraphId({ id: 'abc' }), 'abc');
  assert.equal(extractGraphId({ id: 'abc', extra: { id: 'zzz' } }), 'abc');
  assert.equal(extractGraphId(JSON.stringify({ id: 'abc' })), 'abc');
  assert.equal(extractGraphId(null), null);
  assert.equal(extractGraphId('not json'), null);
});

test('the title comes from the workflow filename', () => {
  assert.equal(titleFromWorkflowFile({ filename: 'My Flow.json' }), 'My Flow');
  assert.equal(titleFromWorkflowFile({ path: 'workflows/Other.json' }), 'Other');
  assert.equal(titleFromWorkflowFile(null), null);
});

test('the frontend workflow store is indexed by graph id', () => {
  const app = {
    extensionManager: {
      workflow: {
        workflows: [
          { filename: 'Alpha.json', content: { id: 'id-a' } },
          { filename: 'Beta.json', content: { id: 'id-b' } },
        ],
        activeWorkflow: { filename: 'Gamma.json', content: { id: 'id-g' } },
      },
    },
  };
  const index = buildTitleIndex(app);
  assert.equal(lookupTitle(index, 'id-a'), 'Alpha');
  assert.equal(lookupTitle(index, 'id-b'), 'Beta');
  assert.equal(lookupTitle(index, 'id-g'), 'Gamma');
  assert.equal(lookupTitle(index, 'missing'), null);
  assert.equal(buildTitleIndex(null).size, 0);
});

test('a prompt without a title still describes the workflow', () => {
  const prompt = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'waiIllustriousSDXL_v160.safetensors' },
    },
    '2': { class_type: 'KSampler', inputs: {} },
    '3': { class_type: 'VAEDecode', inputs: {} },
  };
  const name = describePrompt(prompt);
  assert.match(name, /waiIllustriousSDXL_v160/);
  assert.match(name, /KSampler/);
});

test('a prompt without a checkpoint is described by its node types', () => {
  const prompt = {
    '1': { class_type: 'MultiTextTabs', inputs: {} },
    '2': { class_type: 'SaveText', inputs: {} },
  };
  assert.equal(describePrompt(prompt), 'MultiTextTabs + SaveText');
  assert.equal(describePrompt(null), null);
  assert.equal(describePrompt({}), null);
});
