import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addBank,
  addModule,
  appendAdvancedText,
  createProject,
  duplicateModule,
  removeBank,
  removeModule,
} from '../src/model.js';
import { generateFiles } from '../src/generator.js';
import { validateProject } from '../src/validate.js';
import { createGenerationDiff } from '../src/diff.js';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(
  await readFile(new URL('../data/modules.json', import.meta.url), 'utf8')
);

test('adds modules as physical instances and creates independent assignments per bank', () => {
  const project = createProject('Test');
  const buttons = catalog.find((module) => module.id === '8x-buttons');
  addModule(project, buttons);
  const bank = addBank(project);
  assert.equal(project.modules.length, 1);
  assert.equal(project.controls.length, 8);
  assert.notEqual(project.assignments[bank.id]['8x-buttons-1-btn-1'], undefined);
  project.assignments[bank.id]['8x-buttons-1-btn-1'].cc = 42;
  assert.equal(project.assignments['bank-1']['8x-buttons-1-btn-1'].cc, 1);
});

test('generates bank-scoped NGC events and only includes NGR when supplied', () => {
  const project = createProject('KSBOX Sample');
  addModule(
    project,
    catalog.find((module) => module.id === 'core32f4')
  );
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  project.controls.forEach((control, index) => {
    control.hwId = index + 1;
  });
  const result = generateFiles(project, catalog);
  assert.ok(result.files['KSBOX_Sample.NGC'].includes('#BANK\t1'));
  assert.ok(result.files['KSBOX_Sample.NGC'].includes('EVENT_BUTTON'));
  assert.ok(!Object.keys(result.files).some((name) => name.endsWith('.NGR')));
  project.advanced.ngr = 'if ^section == 1\n  set ^bank 1\nendif';
  assert.ok(generateFiles(project, catalog).files['KSBOX_Sample.NGR']);
});

test('does not generate labels for controls without generated events', () => {
  const project = createProject('Unassigned');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const result = generateFiles(project, catalog);
  assert.doesNotMatch(result.files['Unassigned.NGL'], /^LABEL /m);
  assert.doesNotMatch(result.files['Unassigned.NGC'], /^EVENT_BUTTON/m);
});

test('reports duplicate hardware assignments and invalid MIDI channels', () => {
  const project = createProject('Bad');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  project.controls[0].hwId = 1;
  project.controls[1].hwId = 2;
  project.controls[1].hwId = project.controls[0].hwId;
  project.assignments['bank-1'][project.controls[0].id].channel = 17;
  const issues = validateProject(project, catalog);
  assert.ok(
    issues.some((issue) => issue.severity === 'error' && issue.message.includes('channel'))
  );
  assert.ok(
    issues.some(
      (issue) => issue.severity === 'error' && issue.message.includes('utilisée plusieurs fois')
    )
  );
});

test('enforces MIDIbox NG hardware-id ranges by controller family', () => {
  const project = createProject('Hardware ranges');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const button = project.controls[0];
  button.hwId = 256;
  assert.ok(
    !validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('hw_id')
    )
  );
  button.hwId = 257;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('1 et 256')
    )
  );

  const encoders = addModule(
    project,
    catalog.find((module) => module.id === 'encoders-led-rgb')
  );
  const encoder = project.controls.find(
    (control) => control.moduleId === encoders.id && control.kind === 'encoder'
  );
  encoder.hwId = 129;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('1 et 128')
    )
  );
});

test('duplicates module controls with unique resources and copied bank assignments', () => {
  const project = createProject('Duplicate');
  const definition = catalog.find((module) => module.id === '8x-buttons');
  const source = addModule(project, definition);
  project.assignments['bank-1'][project.controls[0].id].cc = 64;
  const copy = duplicateModule(project, definition, source.id);
  assert.equal(project.modules.length, 2);
  assert.ok(project.controls.every((control) => control.hwId === null));
  assert.equal(project.assignments['bank-1'][project.controls[8].id].cc, 64);
  removeModule(project, source.id);
  const next = addModule(project, definition);
  assert.notEqual(next.id, copy.id);
});

test('appends imported advanced text without replacing or duplicating identical blocks', () => {
  assert.equal(
    appendAdvancedText('EVENT_BUTTON id=1', 'EVENT_LED id=2'),
    'EVENT_BUTTON id=1\nEVENT_LED id=2'
  );
  assert.equal(
    appendAdvancedText('EVENT_BUTTON id=1\n', 'EVENT_LED id=2'),
    'EVENT_BUTTON id=1\nEVENT_LED id=2'
  );
  assert.equal(appendAdvancedText('same', 'same'), 'same');
});

test('shows a line diff between successive generated file sets', () => {
  const diff = createGenerationDiff(
    { 'Project.NGC': 'RESET_HW\nEVENT_BUTTON id=1', 'Old.NGL': 'LABEL old' },
    { 'Project.NGC': 'RESET_HW\nEVENT_BUTTON id=2', 'New.NGR': 'exit' }
  );
  assert.match(diff, /-EVENT_BUTTON id=1/);
  assert.match(diff, /\+EVENT_BUTTON id=2/);
  assert.match(diff, /diff -- Old\.NGL/);
  assert.match(diff, /diff -- New\.NGR/);
  assert.equal(
    createGenerationDiff({ same: 'line' }, { same: 'line' }),
    'Aucune différence avec la génération précédente.'
  );
});

test('prevents deleting a bank targeted by a Meta SetBank command', () => {
  const project = createProject('Bank reference');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const second = addBank(project);
  project.assignments['bank-1'][project.controls[0].id].eventType = 'Meta';
  project.assignments['bank-1'][project.controls[0].id].bankScoped = false;
  project.assignments['bank-1'][project.controls[0].id].meta = `SetBank:${second.order}`;
  assert.throws(() => removeBank(project, second.id), /référencée/);
  assert.equal(project.banks.length, 2);
  project.assignments['bank-1'][project.controls[0].id].meta = 'IncBank';
  removeBank(project, second.id);
  assert.equal(project.banks.length, 1);
  assert.equal(project.assignments[second.id], undefined);
});

test('allocates a fresh bank order after deleting a middle bank', () => {
  const project = createProject('Bank orders');
  const second = addBank(project);
  const third = addBank(project);
  removeBank(project, second.id);
  const fourth = addBank(project);
  assert.equal(third.order, 3);
  assert.equal(fourth.order, 4);
  assert.equal(fourth.name, 'Banque 4');
  assert.ok(
    !validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('ordre')
    )
  );
});

test('characterizes the local KSBOX reference files without rewriting them', async () => {
  const base = new URL('../NGC_NGR/All_in_V2/', import.meta.url);
  const ngc = await readFile(new URL('KSBOX.NGC', base), 'utf8');
  const ngr = await readFile(new URL('KSBOX.NGR', base), 'utf8');
  const ngl = await readFile(new URL('KSBOX.NGL', base), 'utf8');
  const eventCounts = Object.fromEntries(
    ['EVENT_BUTTON', 'EVENT_ENC', 'EVENT_AINSER', 'EVENT_RGBLED'].map((type) => [
      type,
      (ngc.match(new RegExp(`^${type}\\b`, 'gm')) ?? []).length,
    ])
  );
  assert.deepEqual(eventCounts, {
    EVENT_BUTTON: 144,
    EVENT_ENC: 128,
    EVENT_AINSER: 24,
    EVENT_RGBLED: 8,
  });
  assert.equal((ngc.match(/^#BANK\s+\d+/gm) ?? []).length, 8);
  assert.match(ngr, /exec_meta RunSection:8/);
  assert.match(ngr, /set \^bank 1/);
  assert.equal((ngl.match(/^LABEL /gm) ?? []).length, 8);
});

test('preserves raw advanced text in generated files', () => {
  const project = createProject('Raw');
  addModule(
    project,
    catalog.find((module) => module.id === 'core32f4')
  );
  project.advanced.ngc = '\nENC n=1 sr=1 pins=1:0 type=non_detented\n\n';
  project.advanced.ngr = '\nif ^section == 1\n  set ^bank 1\nendif';
  project.advanced.ngl = '\nLABEL custom "@(1:1:1)Test"\n';
  const files = generateFiles(project, catalog).files;
  assert.ok(files['Raw.NGC'].includes(project.advanced.ngc));
  assert.ok(files['Raw.NGR'].startsWith(project.advanced.ngr));
  assert.ok(files['Raw.NGL'].startsWith(project.advanced.ngl));
});

test('warns when a DIN expansion board is not connected into the declared chain', () => {
  const project = createProject('DIN chain');
  addModule(
    project,
    catalog.find((module) => module.id === 'core32f4')
  );
  addModule(
    project,
    catalog.find((module) => module.id === 'din4')
  );
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'warning' && issue.message.includes('chaîne DIN')
    )
  );
  project.connections.push({
    from: 'core32f4-1',
    to: 'din4-1',
    bus: 'DIN',
    role: 'chain',
    fromPort: 'J9',
    toPort: 'J1',
  });
  assert.ok(
    !validateProject(project, catalog).some((issue) => issue.message.includes('pas raccordées'))
  );
});

test('validates documented Core32F4 to DOUT output chains', () => {
  const project = createProject('DOUT chain');
  addModule(
    project,
    catalog.find((module) => module.id === 'core32f4')
  );
  addModule(
    project,
    catalog.find((module) => module.id === 'dout')
  );
  addModule(
    project,
    catalog.find((module) => module.id === 'dout')
  );
  project.connections.push(
    { from: 'core32f4-1', to: 'dout-1', bus: 'DOUT', role: 'chain', fromPort: 'J8', toPort: 'J1' },
    { from: 'dout-1', to: 'dout-2', bus: 'DOUT', role: 'chain', fromPort: 'J2', toPort: 'J1' }
  );
  assert.ok(
    !validateProject(project, catalog).some((issue) => issue.message.includes('chaîne DOUT'))
  );
  project.connections[1].fromPort = 'J1';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('port de sortie')
    )
  );
});

test('enforces the documented 32-shift-register DIN and DOUT expansion limit', () => {
  for (const definitionId of ['din4', 'dout']) {
    const project = createProject(`${definitionId} capacity`);
    for (let index = 0; index < 9; index++) {
      addModule(
        project,
        catalog.find((module) => module.id === definitionId)
      );
    }
    assert.ok(
      validateProject(project, catalog).some(
        (issue) => issue.severity === 'error' && issue.message.includes('8 cartes de 4 registres')
      )
    );
  }
});

test('keeps the checked-in sample project outputs synchronized with the generator', async () => {
  const project = JSON.parse(
    await readFile(new URL('../examples/KSBOX-inspired.project.json', import.meta.url), 'utf8')
  );
  const result = generateFiles(project, catalog);
  for (const [name, content] of Object.entries(result.files)) {
    assert.equal(
      await readFile(new URL(`../examples/generated/${name}`, import.meta.url), 'utf8'),
      content
    );
  }
});

test('emits structured encoder declarations, analog/button events and stable event ids', () => {
  const project = createProject('Structured');
  addModule(
    project,
    catalog.find((module) => module.id === 'encoders-led-rgb')
  );
  const encoder = project.controls.find((control) => control.kind === 'encoder');
  encoder.hwId = 1;
  encoder.encoderConfig = { n: 1, sr: 1, pins: '1:0', type: 'non_detented' };
  const analogModule = addModule(
    project,
    catalog.find((module) => module.id === '8x-pots')
  );
  const analog = project.controls.find((control) => control.moduleId === analogModule.id);
  analog.hwId = 1;
  const button = project.controls.find((control) => control.kind === 'button');
  button.hwId = 1;
  const ngc = generateFiles(project, catalog).files['Structured.NGC'];
  assert.match(ngc, /^ENC\tn=1\tsr=1\tpins=1:0\ttype=non_detented$/m);
  assert.match(ngc, /EVENT_ENC\tid=1\thw_id=1/);
  assert.match(ngc, /EVENT_BUTTON\tid=2\thw_id=1/);
  assert.match(ngc, /EVENT_AINSER\tid=3\thw_id=1/);
  assert.equal(generateFiles(project, catalog).files['Structured.NGC'], ngc);
});

test('generates global RunSection Meta events and distinguishes them from bank selection', () => {
  const project = createProject('Bank scripts');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const button = project.controls[0];
  button.hwId = 29;
  const assignment = project.assignments['bank-1'][button.id];
  Object.assign(assignment, {
    eventType: 'Meta',
    bankScoped: false,
    buttonMode: 'OnOnly',
    meta: 'RunSection:2',
  });
  addBank(project);
  const ngc = generateFiles(project, catalog).files['Bank_scripts.NGC'];
  assert.match(
    ngc,
    /EVENT_BUTTON\tid=1\thw_id=29\ttype=Meta\tbutton_mode=OnOnly\tmeta=RunSection:2/
  );
  assert.doesNotMatch(ngc, /#BANK\t1/);
  assignment.buttonMode = 'OnOff';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('mode documenté')
    )
  );
  assignment.buttonMode = 'OnOnly';
  assignment.meta = 'SetBank:8';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' &&
        issue.message.includes('SetBank référence une banque inexistante')
    )
  );
  assignment.meta = 'RunSection:8';
  assert.ok(
    !validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('RunSection')
    )
  );
});

test('generates documented bank-selection Meta commands without button-only parameters', () => {
  const project = createProject('Bank selection');
  addModule(
    project,
    catalog.find((module) => module.id === 'encoders-led-rgb')
  );
  const encoder = project.controls.find((control) => control.kind === 'encoder');
  encoder.hwId = 1;
  const assignment = project.assignments['bank-1'][encoder.id];
  Object.assign(assignment, { eventType: 'Meta', bankScoped: false, meta: 'IncBank' });
  const result = generateFiles(project, catalog);
  const line = result.files['Bank_selection.NGC']
    .split('\n')
    .find((value) => value.startsWith('EVENT_ENC'));
  assert.match(line, /type=Meta\tmeta=IncBank/);
  assert.doesNotMatch(line, /button_mode=/);
  assert.ok(!result.issues.some((issue) => issue.severity === 'error'));
  assignment.meta = 'SetBank:2';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('banque inexistante')
    )
  );
  addBank(project);
  assignment.meta = 'SetBank:2';
  assert.ok(
    !validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('SetBank référence')
    )
  );
});

test('generates the documented NoteOn button event form and rejects invalid keys', () => {
  const project = createProject('Note button');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const button = project.controls[0];
  button.hwId = 1;
  Object.assign(project.assignments['bank-1'][button.id], { messageType: 'NoteOn', key: 36 });
  const result = generateFiles(project, catalog);
  assert.match(
    result.files['Note_button.NGC'],
    /EVENT_BUTTON\tid=1\thw_id=1\ttype=NoteOn\tchn=1\tkey=36\trange=0:127\tbank=1\tbutton_mode=Toggle/
  );
  project.assignments['bank-1'][button.id].key = 128;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('key doit être un entier')
    )
  );
  project.assignments['bank-1'][button.id].messageType = 'PitchBend';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' &&
        issue.message.includes('message MIDI structuré non pris en charge')
    )
  );
});

test('validates and emits the documented button modes', () => {
  const project = createProject('Button modes');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const button = project.controls[0];
  button.hwId = 1;
  const assignment = project.assignments['bank-1'][button.id];
  for (const mode of ['OnOff', 'OnOnly', 'Toggle']) {
    assignment.buttonMode = mode;
    const result = generateFiles(project, catalog);
    assert.match(result.files['Button_modes.NGC'], new RegExp(`button_mode=${mode}`));
    assert.ok(!result.issues.some((issue) => issue.severity === 'error'));
  }
  assignment.buttonMode = 'Unsupported';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('button_mode')
    )
  );
});

test('generates RGBLED declarations, event fields and bank-specific NGR HSV', () => {
  const project = createProject('LED');
  addModule(
    project,
    catalog.find((item) => item.id === '8x-buttons')
  );
  const control = project.controls[0];
  control.hwId = 1;
  project.ledEvents.push({ id: 257, dimmed: 1, rangeMin: 0, rangeMax: 10 });
  Object.assign(project.assignments['bank-1'][control.id].led, {
    forwardId: 50,
    pattern: 1,
    eventHsv: [60, 100, 10],
    scriptTargetId: 257,
    hsv: [250, 100, 10],
  });
  const result = generateFiles(project, catalog);
  assert.match(result.files['LED.NGC'], /EVENT_RGBLED\tid=257\tdimmed=1\trange=0:10/);
  assert.match(result.files['LED.NGC'], /fwd_id=RGBLED:50/);
  assert.match(result.files['LED.NGC'], /rgbled_pattern=1/);
  assert.match(result.files['LED.NGC'], /hsv=60:100:10/);
  assert.match(
    result.files['LED.NGR'],
    /if \^section == 1\n {2}set_hsv RGBLED:257 250:100:10\n {2}set \^bank 1\n {2}exit\nendif/
  );
  project.assignments['bank-1'][control.id].led.pattern = 2;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('rgbled_pattern 0 et 1')
    )
  );
  project.assignments['bank-1'][control.id].led.pattern = 1;
  project.advanced.ngr = 'if ^section == 1\n  set ^bank 1\nendif';
  assert.ok(
    generateFiles(project, catalog).issues.some(
      (issue) => issue.severity === 'error' && issue.message.includes('existe à la fois')
    )
  );
  project.advanced.ngr = '';
  project.assignments['bank-1'][control.id].led.scriptTargetId = 999;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' && issue.message.includes("ne déclare l'identifiant 999")
    )
  );
  project.ledEvents[0].id = 4096;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' &&
        issue.message.includes('EVENT_RGBLED doit être compris entre 1 et 4095')
    )
  );
});

test('removeModule supprime le module, ses contrôles, ses connexions et ses affectations', () => {
  const project = createProject('Cleanup');
  const buttons = catalog.find((module) => module.id === '8x-buttons');
  const module = addModule(project, buttons);
  const controlId = project.controls[0].id;
  project.assignments['bank-1'][controlId].cc = 42;
  project.connections.push({
    id: 'wire-1',
    fromModuleId: module.id,
    fromConnectorId: 'J1',
    toModuleId: 'core32f4-1',
    toConnectorId: 'J8J9',
    interface: 'DIN',
    role: 'chain',
  });
  removeModule(project, module.id);
  assert.equal(project.modules.length, 0);
  assert.equal(project.controls.length, 0);
  assert.equal(project.connections.length, 0);
  assert.equal(project.assignments['bank-1'][controlId], undefined);
});

test('removeBank interdit la suppression de la dernière banque', () => {
  const project = createProject('Last bank');
  assert.throws(() => removeBank(project, 'bank-1'), /au moins une banque/);
  assert.equal(project.banks.length, 1);
});

test("removeBank interdit la suppression d'une banque ciblée par SetBank", () => {
  const project = createProject('SetBank ref');
  const buttons = catalog.find((module) => module.id === '8x-buttons');
  addModule(project, buttons);
  const controlId = project.controls[0].id;
  project.assignments['bank-1'][controlId] = {
    eventId: 1,
    channel: 1,
    cc: 1,
    valueMin: 0,
    valueMax: 127,
    buttonMode: 'Toggle',
    label: 'test',
    eventType: 'Meta',
    bankScoped: false,
    meta: 'SetBank:2',
  };
  const bank = addBank(project);
  bank.order = 2;
  assert.throws(() => removeBank(project, bank.id), /référencée par un événement Meta SetBank/);
  assert.equal(project.banks.length, 2);
});

test('duplicateModule respecte la limite maxInstances du module', () => {
  const project = createProject('Core limit');
  const core = catalog.find((module) => module.id === 'core32f4');
  addModule(project, core);
  assert.throws(() => addModule(project, core), /limité à 1 instance/);
});

test('addBank convertit une affectation Meta globale en CC et copie les affectations existantes', () => {
  const project = createProject('New bank');
  const buttons = catalog.find((module) => module.id === '8x-buttons');
  addModule(project, buttons);
  const controlId = project.controls[0].id;
  project.assignments['bank-1'][controlId] = {
    eventId: 10,
    channel: 1,
    cc: 5,
    valueMin: 0,
    valueMax: 127,
    buttonMode: 'Toggle',
    label: 'Global',
    eventType: 'Meta',
    bankScoped: false,
    meta: 'RunSection:1',
  };
  const bank = addBank(project);
  const copy = project.assignments[bank.id][controlId];
  assert.equal(copy.eventType, 'CC');
  assert.equal(copy.bankScoped, true);
  assert.equal(copy.buttonMode, 'Toggle');
  assert.equal(copy.meta, undefined);
  assert.equal(copy.channel, 1);
  assert.equal(copy.cc, 5);
});

test('rejette un hw_id en doublon entre contrôles de même famille', () => {
  const project = createProject('Dup hwId');
  const buttons = catalog.find((module) => module.id === '8x-buttons');
  addModule(project, buttons);
  project.controls[0].hwId = 7;
  project.controls[1].hwId = 7;
  const issues = validateProject(project, catalog);
  assert.ok(
    issues.some(
      (issue) => issue.severity === 'error' && issue.message.includes('utilisée plusieurs fois')
    )
  );
});

test('rejette un label NGL en conflit avec le bloc avancé', () => {
  const project = createProject('Label conflict');
  const buttons = catalog.find((module) => module.id === '8x-buttons');
  addModule(project, buttons);
  project.controls[0].hwId = 1;
  project.advanced.ngl = 'LABEL mb_8x_buttons_1_btn_1_b1 "Advanced"';
  const issues = validateProject(project, catalog);
  assert.ok(
    issues.some((issue) => issue.severity === 'error' && issue.message.includes('Conflit de label'))
  );
});

test('rejects encoder duplicates, NGL conflicts, duplicate LED resources and invalid event ids', () => {
  const project = createProject('Conflicts');
  addModule(
    project,
    catalog.find((module) => module.id === 'encoders-led-rgb')
  );
  const [first, second] = project.controls.filter((control) => control.kind === 'encoder');
  first.hwId = 1;
  first.encoderConfig = { n: 1, sr: 1, pins: '1:0', type: 'non_detented' };
  second.hwId = 2;
  second.encoderConfig = { n: 1, sr: 1, pins: '3:2', type: 'non_detented' };
  const firstLabel = `mb_${first.id.replace(/[^a-zA-Z0-9_]/g, '_')}_b1`;
  project.advanced.ngl = `LABEL ${firstLabel} "conflict"`;
  project.assignments['bank-1'][first.id].eventId = 100;
  project.assignments['bank-1'][second.id].eventId = 100;
  const issues = validateProject(project, catalog);
  assert.ok(
    issues.some(
      (issue) =>
        issue.severity === 'error' && issue.message.includes('ENC n=1 définie plusieurs fois')
    )
  );
  assert.ok(
    issues.some((issue) => issue.severity === 'error' && issue.message.includes('Conflit de label'))
  );
  assert.ok(
    issues.some((issue) => issue.severity === 'error' && issue.message.includes('dupliqué : 100'))
  );
  second.encoderConfig.type = 'detented3';
  second.encoderConfig.pins = '2:4';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('Déclaration ENC invalide')
    )
  );
  second.encoderConfig.pins = '2:3';
  second.encoderConfig.sr = 17;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('Déclaration ENC invalide')
    )
  );
  second.physical = structuredClone(first.physical);
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' &&
        issue.message.includes('Signal physique utilisé plusieurs fois')
    )
  );
});

test('detects a generated event id that collides with imported advanced NGC', () => {
  const project = createProject('NGC conflict');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  project.controls[0].hwId = 1;
  project.advanced.ngc = 'EVENT_BUTTON id=1 hw_id=99 type=CC chn=1 cc=1 range=0:127';
  const generated = generateFiles(project, catalog).files['NGC_conflict.NGC'];
  assert.match(generated, /EVENT_BUTTON\tid=2\thw_id=1/);
  project.assignments['bank-1'][project.controls[0].id].eventId = 1;
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' && issue.message.includes("Conflit d'identifiant d'événement 1")
    )
  );
});

test('detects advanced NGC bank and hardware conflicts with generated events', () => {
  const project = createProject('Manual overlap');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  project.controls[0].hwId = 1;
  project.advanced.ngc =
    '#BANK 1\nEVENT_BUTTON id=900 hw_id=1 type=CC chn=1 cc=1 range=0:127 bank=1';
  const issues = validateProject(project, catalog);
  assert.ok(
    issues.some(
      (issue) => issue.severity === 'error' && issue.message.includes('bloc #BANK 1 avancé')
    )
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.severity === 'error' &&
        issue.message.includes('déjà utilisé par un événement NGC avancé')
    )
  );
});

test('adding a bank does not copy a global Meta assignment into a bank-scoped mapping', () => {
  const project = createProject('Global Meta');
  addModule(
    project,
    catalog.find((module) => module.id === '8x-buttons')
  );
  const button = project.controls[0];
  const assignment = project.assignments['bank-1'][button.id];
  Object.assign(assignment, { eventType: 'Meta', bankScoped: false, meta: 'RunSection:1' });
  const bank = addBank(project);
  assert.equal(project.assignments[bank.id][button.id].eventType, 'CC');
  assert.equal(project.assignments[bank.id][button.id].bankScoped, true);
  assert.equal(project.assignments[bank.id][button.id].buttonMode, 'Toggle');
});

test('records the hardware signals documented for key and pad front ends', () => {
  for (const definitionId of ['keysw-4x2', 'pad-rgb']) {
    const project = createProject(definitionId);
    addModule(
      project,
      catalog.find((module) => module.id === definitionId)
    );
    assert.deepEqual(
      project.controls.slice(0, 8).map((control) => control.physical),
      Array.from({ length: 8 }, (_, index) => ({
        connectors: ['J1'],
        signals: [`J1-D${index}`],
      }))
    );
  }
});

test('validates physical connector existence, bus compatibility and DIN chain direction', () => {
  const project = createProject('Ports');
  addModule(
    project,
    catalog.find((module) => module.id === 'core32f4')
  );
  addModule(
    project,
    catalog.find((module) => module.id === 'din4')
  );
  project.connections.push({
    from: 'core32f4-1',
    to: 'din4-1',
    bus: 'DIN',
    role: 'chain',
    fromPort: 'J19',
    toPort: 'J1',
  });
  const issues = validateProject(project, catalog);
  assert.ok(
    issues.some(
      (issue) => issue.severity === 'error' && issue.message.includes('ne porte pas le bus DIN')
    )
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.severity === 'error' && issue.message.includes("port de sortie vers un port d'entrée")
    )
  );
  project.connections[0].fromPort = 'NOPE';
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('Connecteur source inconnu')
    )
  );
});

test('requires the documented SPI path between Core and AINSER64', () => {
  const project = createProject('AIN bus');
  addModule(
    project,
    catalog.find((module) => module.id === 'core32f4')
  );
  addModule(
    project,
    catalog.find((module) => module.id === 'ainser64')
  );
  project.connections.push({
    from: 'core32f4-1',
    to: 'ainser64-1',
    bus: 'AIN',
    role: 'peripheral',
    fromPort: 'J19',
    toPort: 'J6-J13',
  });
  assert.ok(
    validateProject(project, catalog).some(
      (issue) =>
        issue.severity === 'error' &&
        issue.message.includes('Aucun connecteur source documenté ne porte le bus AIN')
    )
  );
  project.connections[0] = {
    from: 'core32f4-1',
    to: 'ainser64-1',
    bus: 'SPI',
    role: 'peripheral',
    fromPort: 'J19',
    toPort: 'J2',
  };
  assert.ok(!validateProject(project, catalog).some((issue) => issue.severity === 'error'));
});
