import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfigurationImport, prepareConfigurationImport } from '../src/config-import.js';

function file(name, content) {
  return {
    name,
    async text() {
      return content;
    },
  };
}

test('imports NGC directives with a UTF-8 BOM and preserves existing advanced content', async () => {
  const imported = await prepareConfigurationImport([
    file('controller.NGC', '\uFEFFEVENT_BUTTON id=12 hw_id=1 type=CC chn=1 cc=20'),
  ]);
  const advanced = mergeConfigurationImport({ ngc: 'RESET_HW', ngr: '', ngl: '' }, imported);
  assert.equal(advanced.ngc, 'RESET_HW\nEVENT_BUTTON id=12 hw_id=1 type=CC chn=1 cc=20');
});

test('does not discard files when multiple inputs share an extension', async () => {
  const imported = await prepareConfigurationImport([
    file('buttons.NGC', 'EVENT_BUTTON id=1'),
    file('keys.NGC', 'EVENT_BUTTON id=2'),
    file('labels.NGL', 'LABEL std_btn 1 "Button"'),
  ]);
  assert.equal(imported.ngc, 'EVENT_BUTTON id=1\nEVENT_BUTTON id=2');
  assert.equal(imported.ngl, 'LABEL std_btn 1 "Button"');
});

test('rejects unsupported or empty files before the project is changed', async () => {
  await assert.rejects(
    prepareConfigurationImport([file('config.txt', 'EVENT_BUTTON id=1')]),
    /n’est pas un fichier/
  );
  await assert.rejects(prepareConfigurationImport([file('empty.NGC', ' \n')]), /est vide/);
});

test('does not duplicate identical previously imported blocks', async () => {
  const imported = await prepareConfigurationImport([file('config.ngc', 'EVENT_BUTTON id=1')]);
  assert.equal(
    mergeConfigurationImport({ ngc: 'EVENT_BUTTON id=1', ngr: '', ngl: '' }, imported).ngc,
    'EVENT_BUTTON id=1'
  );
});

test('does not duplicate a previously imported block inside other advanced directives', async () => {
  const imported = await prepareConfigurationImport([
    file('config.ngc', 'EVENT_BUTTON id=1\nEVENT_BUTTON id=2'),
  ]);
  const existing = 'RESET_HW\nEVENT_BUTTON id=1\nEVENT_BUTTON id=2\nEVENT_ENC id=3';
  assert.equal(mergeConfigurationImport({ ngc: existing }, imported).ngc, existing);
});
