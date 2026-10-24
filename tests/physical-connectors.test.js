import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addModule, createProject } from '../src/model.js';
import { validateProject } from '../src/validate.js';
import {
  assessPhysicalConnection,
  connectPhysical,
  connectorFor,
  connectorWorldPosition,
  connectorsFor,
  migrateLegacyConnections,
} from '../src/physical-connectors.js';

const catalog = JSON.parse(
  await readFile(new URL('../data/modules.json', import.meta.url), 'utf8')
);

function moduleInstance(project, definitionId) {
  return addModule(
    project,
    catalog.find((definition) => definition.id === definitionId)
  );
}

test('records exact silkscreen names and leaves undocumented connector positions unknown', () => {
  assert.equal(connectorFor('core32f4', 'J8J9').silkscreen, 'J8J9');
  assert.equal(connectorFor('core32f4', 'J8J9').type, 'IDC 2x05');
  assert.deepEqual(
    connectorsFor('din4').map((connector) => connector.silkscreen),
    ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']
  );
  assert.deepEqual(
    connectorsFor('dout').map((connector) => connector.silkscreen),
    ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']
  );
  assert.equal(connectorFor('din4', 'J3').pins, 10);
  assert.equal(connectorFor('ainser64', 'J2').position, null);
  assert.equal(connectorFor('ainser64', 'J2').pins, 10);
  assert.equal(connectorFor('core32f4', 'J4A').positionStatus, 'unknown');
});

test('accepts only documented Core-to-DIN and DIN chain connector pairs', () => {
  const project = createProject('DIN connections');
  const core = moduleInstance(project, 'core32f4');
  const firstDin = moduleInstance(project, 'din4');
  const secondDin = moduleInstance(project, 'din4');
  const firstWire = connectPhysical(
    project,
    catalog,
    { moduleId: firstDin.id, connectorId: 'J1' },
    { moduleId: core.id, connectorId: 'J8J9' },
    'DIN'
  );
  const secondWire = connectPhysical(
    project,
    catalog,
    { moduleId: firstDin.id, connectorId: 'J2' },
    { moduleId: secondDin.id, connectorId: 'J1' },
    'DIN'
  );
  assert.deepEqual(
    [
      firstWire.fromModuleId,
      firstWire.fromConnectorId,
      firstWire.toModuleId,
      firstWire.toConnectorId,
    ],
    [core.id, 'J8J9', firstDin.id, 'J1']
  );
  assert.equal(secondWire.role, 'chain');
  assert.equal(
    validateProject(project, catalog).some((issue) => issue.severity === 'error'),
    false
  );
});

test('accepts documented front-end connections with data-flow direction', () => {
  const project = createProject('Button front end');
  const buttons = moduleInstance(project, '8x-buttons');
  const din = moduleInstance(project, 'din4');
  const dout = moduleInstance(project, 'dout');
  const dinLink = connectPhysical(
    project,
    catalog,
    { moduleId: din.id, connectorId: 'J3' },
    { moduleId: buttons.id, connectorId: 'J1' },
    'DIN-control'
  );
  const doutLink = connectPhysical(
    project,
    catalog,
    { moduleId: buttons.id, connectorId: 'J2' },
    { moduleId: dout.id, connectorId: 'J3' },
    'DOUT-control'
  );
  assert.deepEqual(
    [dinLink.fromModuleId, dinLink.fromConnectorId, dinLink.toModuleId, dinLink.toConnectorId],
    [buttons.id, 'J1', din.id, 'J3']
  );
  assert.deepEqual(
    [doutLink.fromModuleId, doutLink.fromConnectorId, doutLink.toModuleId, doutLink.toConnectorId],
    [dout.id, 'J3', buttons.id, 'J2']
  );
});

test('allows sourced keyswitch and encoder DIN ports even when board connector positions are unknown', () => {
  const project = createProject('Keyswitch and encoder inputs');
  const keyswitch = moduleInstance(project, 'keysw-4x2');
  const encoders = moduleInstance(project, 'encoders-led-rgb');
  const pads = moduleInstance(project, 'pad-rgb');
  const din = moduleInstance(project, 'din4');
  const keyLink = connectPhysical(
    project,
    catalog,
    { moduleId: keyswitch.id, connectorId: 'J1' },
    { moduleId: din.id, connectorId: 'J3' },
    'DIN-control'
  );
  const encoderLink = connectPhysical(
    project,
    catalog,
    { moduleId: encoders.id, connectorId: 'J11' },
    { moduleId: din.id, connectorId: 'J4' },
    'DIN-control'
  );
  const padLink = connectPhysical(
    project,
    catalog,
    { moduleId: pads.id, connectorId: 'J1' },
    { moduleId: din.id, connectorId: 'J5' },
    'DIN-control'
  );
  assert.equal(keyLink.endpointPositionsKnown, false);
  assert.equal(encoderLink.endpointPositionsKnown, false);
  assert.equal(padLink.endpointPositionsKnown, false);
  assert.deepEqual(
    [
      keyLink.fromConnectorId,
      keyLink.toConnectorId,
      encoderLink.fromConnectorId,
      encoderLink.toConnectorId,
      padLink.fromConnectorId,
      padLink.toConnectorId,
    ],
    ['J1', 'J3', 'J11', 'J4', 'J1', 'J5']
  );
  assert.equal(
    validateProject(project, catalog).some((issue) => issue.severity === 'error'),
    false
  );
});

test('refuses incompatible pairs and undocumented connections without mutating the project', () => {
  const project = createProject('Refused wires');
  const core = moduleInstance(project, 'core32f4');
  const dout = moduleInstance(project, 'dout');
  const ainser = moduleInstance(project, 'ainser64');
  const before = structuredClone(project.connections);
  const incompatible = assessPhysicalConnection(
    project,
    catalog,
    { moduleId: core.id, connectorId: 'J8J9' },
    { moduleId: dout.id, connectorId: 'J3' },
    'DOUT'
  );
  assert.equal(incompatible.allowed, false);
  assert.equal(incompatible.status, 'incompatible');
  assert.throws(
    () =>
      connectPhysical(
        project,
        catalog,
        { moduleId: core.id, connectorId: 'J8J9' },
        { moduleId: dout.id, connectorId: 'J3' },
        'DOUT'
      ),
    /interface DOUT n'est pas documentée/
  );
  const unknown = assessPhysicalConnection(
    project,
    catalog,
    { moduleId: core.id, connectorId: 'J19' },
    { moduleId: ainser.id, connectorId: 'J2' },
    'SPI/AIN'
  );
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.status, 'unknown');
  assert.match(unknown.reason, /Aucune règle sourcée/);
  assert.deepEqual(project.connections, before);
});

test('prevents reusing a DIN input port for a second front-end connector', () => {
  const project = createProject('DIN port collision');
  const encoders = moduleInstance(project, 'encoders-led-rgb');
  const din = moduleInstance(project, 'din4');
  connectPhysical(
    project,
    catalog,
    { moduleId: encoders.id, connectorId: 'J11' },
    { moduleId: din.id, connectorId: 'J3' },
    'DIN-control'
  );
  assert.throws(
    () =>
      connectPhysical(
        project,
        catalog,
        { moduleId: encoders.id, connectorId: 'J12' },
        { moduleId: din.id, connectorId: 'J3' },
        'DIN-control'
      ),
    /Un connecteur ne peut porter qu'une liaison/
  );
  assert.equal(project.connections.length, 1);
});

test('refuses reuse of an occupied connector and expansion beyond eight cards', () => {
  const project = createProject('Connector limits');
  const core = moduleInstance(project, 'core32f4');
  const firstDin = moduleInstance(project, 'din4');
  const secondDin = moduleInstance(project, 'din4');
  connectPhysical(
    project,
    catalog,
    { moduleId: core.id, connectorId: 'J8J9' },
    { moduleId: firstDin.id, connectorId: 'J1' },
    'DIN'
  );
  assert.throws(
    () =>
      connectPhysical(
        project,
        catalog,
        { moduleId: core.id, connectorId: 'J8J9' },
        { moduleId: secondDin.id, connectorId: 'J1' },
        'DIN'
      ),
    /Un connecteur ne peut porter qu'une liaison/
  );
  const dout = moduleInstance(project, 'dout');
  assert.throws(
    () =>
      connectPhysical(
        project,
        catalog,
        { moduleId: core.id, connectorId: 'J8J9' },
        { moduleId: dout.id, connectorId: 'J1' },
        'DOUT'
      ),
    /Un connecteur ne peut porter qu'une liaison/
  );

  const oversized = createProject('Oversized DIN chain');
  const largeCore = moduleInstance(oversized, 'core32f4');
  const dIN = Array.from({ length: 9 }, () => moduleInstance(oversized, 'din4'));
  const limit = assessPhysicalConnection(
    oversized,
    catalog,
    { moduleId: largeCore.id, connectorId: 'J8J9' },
    { moduleId: dIN[0].id, connectorId: 'J1' },
    'DIN'
  );
  assert.equal(limit.allowed, false);
  assert.match(limit.reason, /huit cartes/);
});

test('persists connector endpoints through movement and rotation', () => {
  const project = createProject('Wiring layout');
  const core = moduleInstance(project, 'core32f4');
  const din = moduleInstance(project, 'din4');
  const wire = connectPhysical(
    project,
    catalog,
    { moduleId: core.id, connectorId: 'J8J9' },
    { moduleId: din.id, connectorId: 'J1' },
    'DIN'
  );
  const saved = JSON.parse(JSON.stringify(project));
  const before = connectorWorldPosition(din, connectorFor('din4', 'J1'));
  din.wiringLayout = { x: 420, y: 170 };
  din.rotation = 90;
  const after = connectorWorldPosition(din, connectorFor('din4', 'J1'));
  assert.notDeepEqual(after, before);
  assert.deepEqual(
    [
      saved.connections[0].fromModuleId,
      saved.connections[0].fromConnectorId,
      saved.connections[0].toModuleId,
      saved.connections[0].toConnectorId,
    ],
    [wire.fromModuleId, wire.fromConnectorId, wire.toModuleId, wire.toConnectorId]
  );
  assert.equal(
    validateProject(saved, catalog).some((issue) => issue.severity === 'error'),
    false
  );
});

test('validation rejects an imported physical link with a forbidden direction', () => {
  const project = createProject('Invalid imported cable');
  const core = moduleInstance(project, 'core32f4');
  const din = moduleInstance(project, 'din4');
  project.connections.push({
    id: 'bad-direction',
    fromModuleId: din.id,
    fromConnectorId: 'J1',
    toModuleId: core.id,
    toConnectorId: 'J8J9',
    interface: 'DIN',
    role: 'chain',
    compatibility: 'documented',
  });

  test('validation rejects imported links with unknown endpoints and unsupported board rotation', () => {
    const project = createProject('Unknown imported cable');
    const core = moduleInstance(project, 'core32f4');
    const din = moduleInstance(project, 'din4');
    din.rotation = 45;
    project.connections.push({
      id: 'unknown-endpoint',
      fromModuleId: core.id,
      fromConnectorId: 'J8J9',
      toModuleId: din.id,
      toConnectorId: 'J99',
      interface: 'DIN',
      role: 'chain',
    });
    const errors = validateProject(project, catalog).filter((issue) => issue.severity === 'error');
    assert.ok(errors.some((issue) => issue.message.includes('compatibilité inconnue')));
    assert.ok(errors.some((issue) => issue.message.includes('orientation du plan')));
  });
  assert.ok(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'error' && issue.message.includes('sens de liaison documenté')
    )
  );
});

test('migrates exact legacy chain endpoints and flags unsupported legacy endpoints', () => {
  const project = createProject('Legacy project');
  const core = moduleInstance(project, 'core32f4');
  const din = moduleInstance(project, 'din4');
  const ainser = moduleInstance(project, 'ainser64');
  project.connections.push(
    { from: core.id, to: din.id, bus: 'DIN', role: 'chain', fromPort: 'J9', toPort: 'J1' },
    { from: core.id, to: ainser.id, bus: 'SPI', role: 'peripheral', fromPort: 'J19', toPort: 'J2' }
  );
  migrateLegacyConnections(project, catalog);
  assert.equal(project.connections[0].fromConnectorId, 'J8J9');
  assert.equal(project.connections[0].interface, 'DIN');
  assert.equal(project.connections[1].needsReconfiguration, true);
  assert.equal(
    validateProject(project, catalog).some(
      (issue) => issue.severity === 'warning' && issue.message.includes('à reconfigurer')
    ),
    true
  );
});
