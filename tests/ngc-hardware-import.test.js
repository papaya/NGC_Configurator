import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject } from '../src/model.js';
import { reconstructNgcHardware, parseNgcHardware } from '../src/ngc-hardware-import.js';
import { validateProject } from '../src/validate.js';

const catalog = JSON.parse(
  await readFile(new URL('../data/modules.json', import.meta.url), 'utf8')
);

test('parses tab-separated NGC addresses and encoder shift-register declarations', () => {
  const parsed = parseNgcHardware(
    [
      '# EVENT_BUTTON id=999 hw_id=99',
      'EVENT_BUTTON\tid=\t4\thw_id=\t29\ttype=Meta\tmeta=RunSection:1',
      'ENC\tn=\t1\tsr=\t3\tpins=1:0\ttype=non_detented',
      'EVENT_RGBLED\tid=\t257\tdimmed=1\trange=0:10',
    ].join('\n')
  );
  assert.deepEqual(
    parsed.events.map((event) => [event.directive, event.hwId, event.pairs.meta]),
    [['EVENT_BUTTON', 29, 'RunSection:1']]
  );
  assert.deepEqual(parsed.encoders, [
    { n: 1, sr: 3, pins: '1:0', type: 'non_detented', lineNumber: 3 },
  ]);
  assert.deepEqual(parsed.ledEvents, [{ id: 257, lineNumber: 4 }]);
});

test('reconstructs KSBOX Core, DIN address ranges, encoder ports and LED chain', async () => {
  const ngc = await readFile(new URL('../NGC_NGR/All_in_V2/KSBOX.NGC', import.meta.url), 'utf8');
  const project = createProject('Imported KSBOX');
  const result = reconstructNgcHardware(project, catalog, ngc);

  assert.deepEqual(project.modules.map((module) => module.definitionId).sort(), [
    'core32f4',
    'din4',
    'din4',
    'encoders-led-rgb',
    'encoders-led-rgb',
    'keysw-4x2',
    'keysw-4x2',
  ]);
  const dinModules = project.modules
    .filter((module) => module.definitionId === 'din4')
    .sort((a, b) => a.ngcAddress.firstShiftRegister - b.ngcAddress.firstShiftRegister);
  assert.deepEqual(
    dinModules.map((module) => [
      module.ngcAddress.firstShiftRegister,
      module.ngcAddress.lastShiftRegister,
      module.ngcAddress.firstHwId,
      module.ngcAddress.lastHwId,
    ]),
    [
      [1, 4, 1, 32],
      [5, 8, 33, 64],
    ]
  );
  const links = project.connections;
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN' &&
        link.fromConnectorId === 'J8J9' &&
        link.toModuleId === dinModules[0].id
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN' &&
        link.fromConnectorId === 'J2' &&
        link.toModuleId === dinModules[1].id
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN-control' &&
        link.fromConnectorId === 'J13' &&
        link.toConnectorId === 'J3' &&
        link.ngcAddress?.shiftRegister === 1
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN-control' &&
        link.fromConnectorId === 'J12' &&
        link.toConnectorId === 'J4' &&
        link.ngcAddress?.shiftRegister === 6
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'LED-data' &&
        link.fromConnectorId === 'J4B' &&
        link.toConnectorId === 'J4'
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'LED-data' &&
        link.fromConnectorId === 'J5' &&
        link.toConnectorId === 'J4'
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN-control' &&
        link.fromConnectorId === 'J11' &&
        link.ngcAddress?.firstHwId === 17 &&
        link.ngcAddress?.shiftRegister === 3
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN-control' &&
        link.fromConnectorId === 'J11' &&
        link.ngcAddress?.firstHwId === 49 &&
        link.ngcAddress?.shiftRegister === 7
    )
  );
  assert.ok(
    links.some(
      (link) =>
        link.interface === 'DIN-control' &&
        link.fromConnectorId === 'J1' &&
        link.ngcAddress?.shiftRegister === 4
    )
  );
  assert.ok(result.warnings.some((warning) => warning.includes('EVENT_AINSER')));
  assert.equal(
    validateProject(project, catalog).some((issue) => issue.severity === 'error'),
    false
  );
});

test('reimporting the same NGC does not duplicate imported modules or links', async () => {
  const ngc = await readFile(new URL('../NGC_NGR/All_in_V2/KSBOX.NGC', import.meta.url), 'utf8');
  const project = createProject('Repeat import');
  reconstructNgcHardware(project, catalog, ngc);
  const counts = [project.modules.length, project.connections.length];
  reconstructNgcHardware(project, catalog, ngc);
  assert.deepEqual([project.modules.length, project.connections.length], counts);
});

test('creates a keyswitch with its DIN and LED connections when bank events identify its hardware group', () => {
  const project = createProject('Imported key bank');
  const result = reconstructNgcHardware(
    project,
    catalog,
    [
      'EVENT_BUTTON id=100 hw_id=9 type=Meta meta=RunSection:1',
      'EVENT_BUTTON id=101 hw_id=10 type=CC chn=1 cc=2',
      'EVENT_BUTTON id=102 hw_id=11 type=Meta meta=RunSection:3',
    ].join('\n')
  );
  const keyswitch = project.modules.find((module) => module.definitionId === 'keysw-4x2');
  assert.ok(keyswitch);
  assert.ok(
    project.connections.some(
      (link) =>
        link.fromModuleId === keyswitch.id &&
        link.fromConnectorId === 'J1' &&
        link.interface === 'DIN-control' &&
        link.ngcAddress?.shiftRegister === 2
    )
  );
  assert.ok(
    project.connections.some(
      (link) =>
        link.fromConnectorId === 'J4B' &&
        link.toModuleId === keyswitch.id &&
        link.toConnectorId === 'J2' &&
        link.interface === 'LED-data'
    )
  );
  assert.equal(result.warnings.length, 0);
});

test('reports incomplete encoder wiring rather than inventing an ENC shift-register mapping', () => {
  const project = createProject('Incomplete encoder map');
  const result = reconstructNgcHardware(
    project,
    catalog,
    'EVENT_ENC id=1 hw_id=1 type=CC chn=1 cc=1'
  );
  assert.ok(project.modules.some((module) => module.definitionId === 'encoders-led-rgb'));
  assert.ok(project.modules.some((module) => module.definitionId === 'core32f4'));
  assert.ok(result.warnings.some((warning) => warning.includes('directive ENC associée')));
  assert.equal(
    project.connections.some((link) => link.interface === 'DIN-control'),
    false
  );
});
