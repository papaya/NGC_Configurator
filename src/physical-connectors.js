import physicalConnectorCatalog from '../data/physical-connectors.json' with { type: 'json' };

export const BOARD_ART_WIDTH = 220;
export const BOARD_ART_HEIGHT = 163;

export function connectorsFor(definitionId) {
  return physicalConnectorCatalog[definitionId]?.connectors ?? [];
}

export function boardViewFor(definitionId) {
  return physicalConnectorCatalog[definitionId] ?? null;
}

export function connectorFor(definitionId, connectorId) {
  return connectorsFor(definitionId).find((connector) => connector.id === connectorId) ?? null;
}

const connectionRules = [
  {
    fromDefinition: 'core32f4',
    fromConnector: 'J8J9',
    toDefinition: 'din4',
    toConnector: 'J1',
    interface: 'DIN',
    role: 'chain',
    source: 'standard-modules/Core/README.md; standard-modules/DIN/README.md',
    reason: "Le Core J8J9/J9 alimente l'entrée J1 de la première DIN4.",
  },
  {
    fromDefinition: 'din4',
    fromConnector: 'J2',
    toDefinition: 'din4',
    toConnector: 'J1',
    interface: 'DIN',
    role: 'chain',
    source: 'standard-modules/DIN/README.md',
    reason: "La sortie de chaîne DIN J2 va vers l'entrée J1 de la DIN4 suivante.",
  },
  {
    fromDefinition: 'core32f4',
    fromConnector: 'J8J9',
    toDefinition: 'dout',
    toConnector: 'J1',
    interface: 'DOUT',
    role: 'chain',
    source: 'standard-modules/Core/README.md; standard-modules/DOUT/README.md',
    reason: "Le Core J8J9/J8 alimente l'entrée J1 de la première DOUT.",
  },
  {
    fromDefinition: 'dout',
    fromConnector: 'J2',
    toDefinition: 'dout',
    toConnector: 'J1',
    interface: 'DOUT',
    role: 'chain',
    source: 'standard-modules/DOUT/README.md',
    reason: "La sortie de chaîne DOUT J2 va vers l'entrée J1 de la DOUT suivante.",
  },
  ...['J3', 'J4', 'J5', 'J6'].map((connector) => ({
    fromDefinition: '8x-buttons',
    fromConnector: 'J1',
    toDefinition: 'din4',
    toConnector: connector,
    interface: 'DIN-control',
    role: 'frontend',
    source: 'custom-frontends/8x-buttons/README.md; standard-modules/DIN/README.md',
    reason:
      'J1 de la carte 8x-buttons porte les contacts des boutons; J3–J6 de la DIN portent les entrées numériques.',
  })),
  ...['keysw-4x2', 'pad-rgb'].flatMap((definition) =>
    ['J3', 'J4', 'J5', 'J6'].map((connector) => ({
      fromDefinition: definition,
      fromConnector: 'J1',
      toDefinition: 'din4',
      toConnector: connector,
      interface: 'DIN-control',
      role: 'frontend',
      source: `custom-frontends/${definition}/README.md; standard-modules/DIN/README.md`,
      reason:
        'Le connecteur IDC J1 du front-end porte huit contacts vers les entrées numériques DIN J3–J6.',
    }))
  ),
  ...['J11', 'J12', 'J13'].flatMap((frontendConnector) =>
    ['J3', 'J4', 'J5', 'J6'].map((connector) => ({
      fromDefinition: 'encoders-led-rgb',
      fromConnector: frontendConnector,
      toDefinition: 'din4',
      toConnector: connector,
      interface: 'DIN-control',
      role: 'frontend',
      source: 'custom-frontends/encoders-led-rgb/README.md; standard-modules/DIN/README.md',
      reason: `${frontendConnector} transporte un groupe de 8 signaux d’encodeurs vers les 8 entrées d’un port DIN J3–J6.`,
    }))
  ),
  ...['J3', 'J4', 'J5', 'J6'].map((connector) => ({
    fromDefinition: 'dout',
    fromConnector: connector,
    toDefinition: '8x-buttons',
    toConnector: 'J2',
    interface: 'DOUT-control',
    role: 'frontend',
    source: 'custom-frontends/8x-buttons/README.md; standard-modules/DOUT/README.md',
    reason:
      'J3–J6 de la DOUT portent les sorties; J2 de la carte 8x-buttons porte les anodes des LED.',
  })),
  ...[
    ['keysw-4x2', 'J2'],
    ['pad-rgb', 'J2'],
    ['encoders-led-rgb', 'J4'],
  ].map(([definition, input]) => ({
    fromDefinition: 'core32f4',
    fromConnector: 'J4B',
    toDefinition: definition,
    toConnector: input,
    interface: 'LED-data',
    role: 'led-chain',
    source: `standard-modules/Core/README.md; custom-frontends/${definition}/README.md`,
    reason: `La sortie WS2812 du Core J4B alimente l’entrée de données LED ${input} du front-end; l’alimentation LED doit être vérifiée séparément.`,
  })),
  ...[
    ['keysw-4x2', 'J3'],
    ['pad-rgb', 'J3'],
    ['encoders-led-rgb', 'J5'],
  ].flatMap(([fromDefinition, output]) =>
    [
      ['keysw-4x2', 'J2'],
      ['pad-rgb', 'J2'],
      ['encoders-led-rgb', 'J4'],
    ].map(([toDefinition, input]) => ({
      fromDefinition,
      fromConnector: output,
      toDefinition,
      toConnector: input,
      interface: 'LED-data',
      role: 'led-chain',
      source: `custom-frontends/${fromDefinition}/README.md; custom-frontends/${toDefinition}/README.md`,
      reason: `La sortie LED en cascade ${output} alimente l’entrée ${input} du front-end suivant.`,
    }))
  ),
];

function ruleFor(first, second, interfaceName) {
  return connectionRules.find(
    (rule) =>
      rule.interface === interfaceName &&
      rule.fromDefinition === first.definitionId &&
      rule.fromConnector === first.connectorId &&
      rule.toDefinition === second.definitionId &&
      rule.toConnector === second.connectorId
  );
}

export function assessPhysicalConnection(
  project,
  catalog,
  first,
  second,
  interfaceName,
  ignoreConnectionId = null
) {
  const firstModule = project.modules.find((module) => module.id === first?.moduleId);
  const secondModule = project.modules.find((module) => module.id === second?.moduleId);
  if (!firstModule || !secondModule) {
    return {
      allowed: false,
      status: 'incompatible',
      reason: "Une des cartes n'existe pas dans ce projet.",
    };
  }
  if (firstModule.id === secondModule.id) {
    return {
      allowed: false,
      status: 'incompatible',
      reason: 'Une liaison doit relier deux cartes distinctes.',
    };
  }
  const firstDefinition = catalog.find((definition) => definition.id === firstModule.definitionId);
  const secondDefinition = catalog.find(
    (definition) => definition.id === secondModule.definitionId
  );
  const firstConnector = connectorFor(firstModule.definitionId, first.connectorId);
  const secondConnector = connectorFor(secondModule.definitionId, second.connectorId);
  if (!firstDefinition || !secondDefinition || !firstConnector || !secondConnector) {
    return {
      allowed: false,
      status: 'unknown',
      reason: 'Définition ou connecteur non documenté; compatibilité inconnue.',
    };
  }
  const supportsInterface = (connector) =>
    interfaceName === 'LED-data'
      ? connector.interfaces.some((item) => ['WS2812', 'SK6812'].includes(item))
      : connector.interfaces.includes(interfaceName);
  if (!supportsInterface(firstConnector) || !supportsInterface(secondConnector)) {
    return {
      allowed: false,
      status: 'incompatible',
      reason: `L'interface ${interfaceName} n'est pas documentée sur les deux connecteurs.`,
    };
  }
  const firstEndpoint = { ...first, definitionId: firstModule.definitionId };
  const secondEndpoint = { ...second, definitionId: secondModule.definitionId };
  const rule =
    ruleFor(firstEndpoint, secondEndpoint, interfaceName) ??
    ruleFor(secondEndpoint, firstEndpoint, interfaceName);
  if (!rule) {
    return {
      allowed: false,
      status: 'unknown',
      reason: `Aucune règle sourcée n'autorise ${firstDefinition.name} ${firstConnector.silkscreen} ↔ ${secondDefinition.name} ${secondConnector.silkscreen} (${interfaceName}).`,
    };
  }
  const from =
    rule.fromDefinition === firstModule.definitionId && rule.fromConnector === firstConnector.id
      ? first
      : second;
  const to = from === first ? second : first;
  const fromModule = project.modules.find((module) => module.id === from.moduleId);
  const toModule = project.modules.find((module) => module.id === to.moduleId);
  const occupied = project.connections.some(
    (connection) =>
      connection.id !== ignoreConnectionId &&
      ((connection.fromModuleId === from.moduleId &&
        connection.fromConnectorId === from.connectorId) ||
        (connection.toModuleId === from.moduleId &&
          connection.toConnectorId === from.connectorId) ||
        (connection.fromModuleId === to.moduleId &&
          connection.fromConnectorId === to.connectorId) ||
        (connection.toModuleId === to.moduleId && connection.toConnectorId === to.connectorId))
  );
  if (occupied) {
    return {
      allowed: false,
      status: 'incompatible',
      reason:
        "Un connecteur ne peut porter qu'une liaison dans ce modèle; aucun répartiteur documenté n'est décrit.",
    };
  }
  if (rule.role === 'chain' && ['din4', 'dout'].includes(toModule.definitionId)) {
    const count = project.modules.filter(
      (module) => module.definitionId === toModule.definitionId
    ).length;
    if (count > 8) {
      return {
        allowed: false,
        status: 'incompatible',
        reason: "La limite documentée est de huit cartes d'expansion par chaîne (32 registres).",
      };
    }
  }
  return {
    allowed: true,
    status: 'validated',
    reason: rule.reason,
    source: rule.source,
    endpointPositionsKnown: Boolean(firstConnector.position && secondConnector.position),
    connection: {
      fromModuleId: fromModule.id,
      fromConnectorId: from.connectorId,
      toModuleId: toModule.id,
      toConnectorId: to.connectorId,
      interface: interfaceName,
      role: rule.role,
      compatibility: 'documented',
      endpointPositionsKnown: Boolean(firstConnector.position && secondConnector.position),
    },
  };
}

export function connectPhysical(project, catalog, first, second, interfaceName) {
  const result = assessPhysicalConnection(project, catalog, first, second, interfaceName);
  if (!result.allowed)
    throw new Error(`${result.reason}${result.source ? ` Source : ${result.source}.` : ''}`);
  project.connections.push({
    id: `wire-${Date.now()}-${project.connections.length + 1}`,
    ...result.connection,
  });
  return project.connections.at(-1);
}

export function migrateLegacyConnections(project, catalog) {
  project.connections = (project.connections ?? []).map((connection) => {
    if (connection.fromModuleId || connection.toModuleId || connection.needsReconfiguration)
      return connection;
    const firstModule = project.modules.find((module) => module.id === connection.from);
    const secondModule = project.modules.find((module) => module.id === connection.to);
    const connectorAliases = {
      core32f4: { J9: 'J8J9', J8: 'J8J9' },
    };
    const first = {
      moduleId: connection.from,
      connectorId:
        connectorAliases[firstModule?.definitionId]?.[connection.fromPort] ?? connection.fromPort,
    };
    const second = {
      moduleId: connection.to,
      connectorId:
        connectorAliases[secondModule?.definitionId]?.[connection.toPort] ?? connection.toPort,
    };
    const firstDefinitionId = firstModule?.definitionId;
    const secondDefinitionId = secondModule?.definitionId;
    const sharedInterface = connectorFor(firstDefinitionId, first.connectorId)?.interfaces.find(
      (item) => connectorFor(secondDefinitionId, second.connectorId)?.interfaces.includes(item)
    );
    const interfaceName = sharedInterface ?? connection.bus;
    const result = assessPhysicalConnection(project, catalog, first, second, interfaceName);
    if (!result.allowed) {
      return {
        ...connection,
        needsReconfiguration: true,
        reconfigurationReason: result.reason,
      };
    }
    return {
      id: `migrated-${connection.from}-${connection.fromPort}-${connection.to}-${connection.toPort}`,
      ...result.connection,
      migrationSource: 'project-v1',
    };
  });
}

export function connectorWorldPosition(module, connector) {
  if (!connector?.position) return null;
  const x = connector.position.x;
  const y = connector.position.y;
  const rotation = (((module.rotation ?? 0) % 360) + 360) % 360;
  let localX;
  let localY;
  if (rotation === 90) {
    localX = BOARD_ART_HEIGHT * (1 - y);
    localY = BOARD_ART_WIDTH * x;
  } else if (rotation === 180) {
    localX = BOARD_ART_WIDTH * (1 - x);
    localY = BOARD_ART_HEIGHT * (1 - y);
  } else if (rotation === 270) {
    localX = BOARD_ART_HEIGHT * y;
    localY = BOARD_ART_WIDTH * (1 - x);
  } else {
    localX = BOARD_ART_WIDTH * x;
    localY = BOARD_ART_HEIGHT * y;
  }
  return {
    x: (Number(module.wiringLayout?.x) || 0) + localX,
    y: (Number(module.wiringLayout?.y) || 0) + localY,
  };
}
