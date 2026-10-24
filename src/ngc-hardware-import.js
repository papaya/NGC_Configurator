import { addModule } from './model.js';
import { connectPhysical, assessPhysicalConnection } from './physical-connectors.js';

const eventKinds = {
  EVENT_BUTTON: 'button',
  EVENT_ENC: 'encoder',
  EVENT_AINSER: 'analog',
};

function pairsIn(line) {
  return Object.fromEntries(
    [...line.matchAll(/([A-Za-z_]\w*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g)].map(
      ([, key, doubleQuoted, singleQuoted, bare]) => [key, doubleQuoted ?? singleQuoted ?? bare]
    )
  );
}

export function parseNgcHardware(text) {
  const events = [];
  const encoders = [];
  const ledEvents = [];
  for (const [index, rawLine] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const directive = line.match(/^(EVENT_[A-Z0-9_]+|ENC)\b/i)?.[1]?.toUpperCase();
    if (!directive) continue;
    const pairs = pairsIn(line);
    if (directive in eventKinds) {
      const hwId = Number(pairs.hw_id);
      if (Number.isInteger(hwId) && hwId > 0) {
        events.push({ directive, kind: eventKinds[directive], hwId, pairs, lineNumber: index + 1 });
      }
    } else if (directive === 'ENC') {
      const n = Number(pairs.n);
      const sr = Number(pairs.sr);
      if (Number.isInteger(n) && n > 0 && Number.isInteger(sr) && sr > 0) {
        encoders.push({
          n,
          sr,
          pins: pairs.pins ?? '',
          type: pairs.type ?? '',
          lineNumber: index + 1,
        });
      }
    } else if (directive === 'EVENT_RGBLED') {
      const id = Number(pairs.id);
      if (Number.isInteger(id) && id > 0) ledEvents.push({ id, lineNumber: index + 1 });
    }
  }
  return { events, encoders, ledEvents };
}

function moduleDefinition(catalog, definitionId) {
  return catalog.find((definition) => definition.id === definitionId);
}

function ensureModule(project, catalog, definitionId, importKey) {
  let module = project.modules.find((item) => item.ngcImportKey === importKey);
  if (module) return { module, created: false };
  module = project.modules.find((item) => item.definitionId === definitionId && !item.ngcImportKey);
  if (module) {
    module.ngcImportKey = importKey;
    module.ngcImportInferred = false;
    return { module, created: false };
  }
  const definition = moduleDefinition(catalog, definitionId);
  if (!definition) throw new Error(`La définition matérielle ${definitionId} manque au catalogue.`);
  module = addModule(project, definition);
  module.ngcImportKey = importKey;
  module.ngcImportInferred = true;
  return { module, created: true };
}

function endpoint(module, connectorId) {
  return { moduleId: module.id, connectorId };
}

function connectImported(
  project,
  catalog,
  fromModule,
  fromConnectorId,
  toModule,
  toConnectorId,
  interfaceName,
  address = null,
  warnings = []
) {
  const existing = project.connections.find(
    (connection) =>
      connection.fromModuleId === fromModule.id &&
      connection.fromConnectorId === fromConnectorId &&
      connection.toModuleId === toModule.id &&
      connection.toConnectorId === toConnectorId &&
      connection.interface === interfaceName
  );
  if (existing) {
    if (address) existing.ngcAddress = address;
    return existing;
  }
  const result = assessPhysicalConnection(
    project,
    catalog,
    endpoint(fromModule, fromConnectorId),
    endpoint(toModule, toConnectorId),
    interfaceName
  );
  if (!result.allowed) {
    warnings.push(
      `${fromModule.name} ${fromConnectorId} → ${toModule.name} ${toConnectorId} non raccordé : ${result.reason}`
    );
    return null;
  }
  const connection = connectPhysical(
    project,
    catalog,
    endpoint(fromModule, fromConnectorId),
    endpoint(toModule, toConnectorId),
    interfaceName
  );
  if (address) connection.ngcAddress = address;
  return connection;
}

function dinEndpoint(project, dinModules, shiftRegister) {
  const moduleIndex = Math.floor((shiftRegister - 1) / 4);
  const connectorOffset = (shiftRegister - 1) % 4;
  const module = dinModules[moduleIndex];
  return module
    ? {
        module,
        connectorId: `J${connectorOffset + 3}`,
        shiftRegister,
        firstHwId: (shiftRegister - 1) * 8 + 1,
        lastHwId: shiftRegister * 8,
      }
    : null;
}

function addAddressLink(
  project,
  catalog,
  sourceModule,
  sourceConnector,
  dinModules,
  shiftRegister,
  warnings
) {
  const target = dinEndpoint(project, dinModules, shiftRegister);
  if (!target) {
    warnings.push(
      `Aucune carte DIN ne couvre le shift register ${shiftRegister}; vérifiez les limites du matériel.`
    );
    return null;
  }
  return connectImported(
    project,
    catalog,
    sourceModule,
    sourceConnector,
    target.module,
    target.connectorId,
    'DIN-control',
    {
      shiftRegister,
      firstHwId: target.firstHwId,
      lastHwId: target.lastHwId,
    },
    warnings
  );
}

function addDinChain(project, catalog, core, dinModules, warnings) {
  dinModules.forEach((module, index) => {
    const firstShiftRegister = index * 4 + 1;
    module.ngcAddress = {
      firstShiftRegister,
      lastShiftRegister: firstShiftRegister + 3,
      firstHwId: (firstShiftRegister - 1) * 8 + 1,
      lastHwId: (firstShiftRegister + 3) * 8,
    };
    module.chainOrder = index + 1;
    const source = index === 0 ? core : dinModules[index - 1];
    const sourcePort = index === 0 ? 'J8J9' : 'J2';
    connectImported(
      project,
      catalog,
      source,
      sourcePort,
      module,
      'J1',
      'DIN',
      module.ngcAddress,
      warnings
    );
  });
}

function encoderBoardShiftRegister(configs, firstEncoder, lastEncoder) {
  const group = configs.filter((config) => config.n >= firstEncoder && config.n <= lastEncoder);
  if (!group.length) return null;
  const shiftRegisters = new Set(group.map((config) => config.sr));
  return shiftRegisters.size === 1 ? group[0].sr : null;
}

export function reconstructNgcHardware(project, catalog, ngcText) {
  const parsed = parseNgcHardware(ngcText);
  const warnings = [];
  const maxButtonShiftRegister = Math.max(
    0,
    ...parsed.events
      .filter((event) => event.kind === 'button' && event.hwId <= 256)
      .map((event) => Math.ceil(event.hwId / 8))
  );
  const maxEncoderShiftRegister = Math.max(0, ...parsed.encoders.map((config) => config.sr));
  const maxShiftRegister = Math.max(maxButtonShiftRegister, maxEncoderShiftRegister);
  const dinCount = Math.ceil(maxShiftRegister / 4);
  const invalidButtonIds = [
    ...new Set(
      parsed.events
        .filter((event) => event.kind === 'button' && event.hwId > 256)
        .map((event) => event.hwId)
    ),
  ];
  if (invalidButtonIds.length) {
    warnings.push(`hw_id bouton hors plage DIN 1–256 : ${invalidButtonIds.join(', ')}.`);
  }
  if (dinCount > 8) {
    warnings.push(
      `Le fichier demande ${dinCount} cartes DIN; la limite documentée est huit. La chaîne n’a pas été créée.`
    );
  }

  const hasEncoderEvents = parsed.events.some(
    (event) => event.kind === 'encoder' && event.hwId <= 128
  );
  const needsHardware = maxShiftRegister > 0 || parsed.encoders.length > 0 || hasEncoderEvents;
  if (!needsHardware) {
    return { parsed, created: [], warnings, changed: false };
  }

  const created = [];
  const ensure = (definitionId, key) => {
    const result = ensureModule(project, catalog, definitionId, key);
    if (result.created) created.push(result.module);
    return result.module;
  };
  const core = ensure('core32f4', 'ngc-core');
  const existingDin = project.modules
    .filter((module) => module.definitionId === 'din4')
    .sort(
      (a, b) =>
        (a.ngcAddress?.firstShiftRegister ?? (a.chainOrder ?? 1) * 4 - 3) -
        (b.ngcAddress?.firstShiftRegister ?? (b.chainOrder ?? 1) * 4 - 3)
    );
  const dinModules = [...existingDin];
  for (let index = 0; index < Math.min(dinCount, 8); index++) {
    if (dinModules[index]) continue;
    const module = ensure('din4', `ngc-din-${index + 1}`);
    dinModules[index] = module;
  }
  const activeDinModules = dinModules.slice(0, Math.min(dinCount, 8));
  if (activeDinModules.length) {
    activeDinModules.forEach((module, index) => {
      module.ngcImportKey ??= `ngc-din-${index + 1}`;
    });
    addDinChain(project, catalog, core, activeDinModules, warnings);
  }

  const encoderIds = new Set(parsed.encoders.map((config) => config.n));
  for (const event of parsed.events.filter((item) => item.kind === 'encoder')) {
    if (event.hwId <= 128) encoderIds.add(event.hwId);
  }
  const maxEncoder = Math.max(0, ...encoderIds);
  const encoderCount = Math.ceil(maxEncoder / 8);
  const encoderBoards = [];
  for (let index = 0; index < encoderCount; index++) {
    const module = ensure('encoders-led-rgb', `ngc-encoders-${index + 1}`);
    module.ngcAddress = { firstEncoder: index * 8 + 1, lastEncoder: index * 8 + 8 };
    encoderBoards.push(module);
  }
  if (
    parsed.events.some((event) => event.kind === 'encoder') &&
    parsed.encoders.length < encoderIds.size
  ) {
    warnings.push(
      'Des événements EVENT_ENC n’ont pas tous de directive ENC associée; leur shift register DIN ne peut pas être déduit.'
    );
  }

  if (activeDinModules.length) {
    for (let index = 0; index < encoderBoards.length; index++) {
      const board = encoderBoards[index];
      for (const [connectorId, startN, endN] of [
        ['J13', index * 8 + 1, index * 8 + 4],
        ['J12', index * 8 + 5, index * 8 + 8],
      ]) {
        const shiftRegister = encoderBoardShiftRegister(parsed.encoders, startN, endN);
        if (shiftRegister == null) {
          if (parsed.encoders.some((config) => config.n >= startN && config.n <= endN)) {
            warnings.push(
              `${board.name} ${connectorId} couvre plusieurs shift registers ou n’a pas de configuration ENC complète; liaison DIN non déduite.`
            );
          }
          continue;
        }
        addAddressLink(
          project,
          catalog,
          board,
          connectorId,
          activeDinModules,
          shiftRegister,
          warnings
        );
      }
    }
  }

  const buttonGroups = new Map();
  for (const event of parsed.events.filter((item) => item.kind === 'button' && item.hwId <= 256)) {
    const shiftRegister = Math.ceil(event.hwId / 8);
    const group = buttonGroups.get(shiftRegister) ?? [];
    group.push(event);
    buttonGroups.set(shiftRegister, group);
  }
  const buttonGroupsByShift = [...buttonGroups].sort(([a], [b]) => a - b);
  const usedButtonShiftRegisters = new Set();
  for (let index = 0; index < encoderBoards.length; index++) {
    const encoderStart = index * 8 + 1;
    const encoderEnd = encoderStart + 7;
    const configured = parsed.encoders.filter(
      (config) => config.n >= encoderStart && config.n <= encoderEnd
    );
    const buttonShiftRegister = configured.length
      ? Math.max(...configured.map((config) => config.sr)) + 1
      : null;
    if (buttonShiftRegister && buttonGroups.has(buttonShiftRegister)) {
      addAddressLink(
        project,
        catalog,
        encoderBoards[index],
        'J11',
        activeDinModules,
        buttonShiftRegister,
        warnings
      );
      usedButtonShiftRegisters.add(buttonShiftRegister);
      warnings.push(
        `hw_id ${(buttonShiftRegister - 1) * 8 + 1}–${buttonShiftRegister * 8} est associé à J11 par la convention observée; le NGC seul ne confirme pas le type physique du front-end.`
      );
    }
  }
  for (const [shiftRegister, events] of buttonGroupsByShift) {
    if (usedButtonShiftRegisters.has(shiftRegister)) continue;
    const keySwitchGroup = events.some(
      (event) => event.pairs.type === 'Meta' && /^RunSection:/i.test(event.pairs.meta ?? '')
    );
    const definitionId = keySwitchGroup ? 'keysw-4x2' : '8x-buttons';
    const importKey = `ngc-${keySwitchGroup ? 'keysw' : 'buttons'}-sr-${shiftRegister}`;
    const module = ensure(definitionId, importKey);
    module.ngcAddress = {
      shiftRegister,
      firstHwId: (shiftRegister - 1) * 8 + 1,
      lastHwId: shiftRegister * 8,
    };
    addAddressLink(project, catalog, module, 'J1', activeDinModules, shiftRegister, warnings);
  }

  const ledFrontends = [
    ...encoderBoards,
    ...project.modules.filter(
      (module) =>
        module.ngcImportKey?.startsWith('ngc-keysw-sr-') && !encoderBoards.includes(module)
    ),
  ];
  if (ledFrontends.length) {
    for (let index = 0; index < ledFrontends.length; index++) {
      const module = ledFrontends[index];
      const definitionId = module.definitionId;
      const input = definitionId === 'encoders-led-rgb' ? 'J4' : 'J2';
      const output = definitionId === 'encoders-led-rgb' ? 'J5' : 'J3';
      const source = index === 0 ? core : ledFrontends[index - 1];
      const sourceConnector =
        index === 0 ? 'J4B' : source.definitionId === 'encoders-led-rgb' ? 'J5' : 'J3';
      connectImported(
        project,
        catalog,
        source,
        sourceConnector,
        module,
        input,
        'LED-data',
        null,
        warnings
      );
      module.ledChainOrder = index + 1;
      module.ledChainOutput = output;
    }
  }

  if (parsed.events.some((event) => event.kind === 'analog')) {
    warnings.push(
      'EVENT_AINSER est conservé, mais l’affectation matérielle AINSER/SPI ne peut pas être déduite de ces seuls événements.'
    );
  }
  return {
    parsed,
    created,
    warnings,
    changed: created.length > 0 || parsed.events.length > 0 || parsed.encoders.length > 0,
  };
}
