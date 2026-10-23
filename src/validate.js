import { planNgcEvents } from "./ngc-events.js";
import { assessPhysicalConnection } from "./physical-connectors.js";

const midiRanges = {
  channel: [1, 16],
  cc: [0, 127],
  valueMin: [0, 127],
  valueMax: [0, 127]
};

const hardwareIdRanges = {
  button: [1, 256],
  encoder: [1, 128],
  analog: [1, 128]
};

function parsePairs(line) {
  const pairs = {};
  for (const match of line.matchAll(/([A-Za-z_]\w*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g)) {
    pairs[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return pairs;
}

function validateInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateProject(project, catalog) {
  const issues = [];
  const add = (severity, message, target = "Projet") => issues.push({ severity, message, target });
  const modules = project.modules ?? [];
  const controls = project.controls ?? [];
  const banks = project.banks ?? [];
  const orderedBanks = [...banks].sort((a, b) => a.order - b.order);
  const connections = (project.connections ?? []).map(connection => connection.fromModuleId ? ({
    ...connection,
    from: connection.fromModuleId,
    to: connection.toModuleId,
    fromPort: connection.fromConnectorId,
    toPort: connection.toConnectorId,
    bus: connection.interface,
    physical: true
  }) : connection);
  const assignments = project.assignments ?? {};
  const definitions = new Map(catalog.map(definition => [definition.id, definition]));
  const advancedNgc = project.advanced?.ngc ?? "";
  const manualEventIds = new Set();
  for (const line of advancedNgc.split(/\r?\n/)) {
    if (!/^\s*EVENT_\w+\b/.test(line)) continue;
    const id = Number(parsePairs(line).id);
    if (!Number.isInteger(id)) continue;
    if (manualEventIds.has(id)) add("error", `Identifiant d'événement avancé dupliqué : ${id}.`, "NGC avancé");
    manualEventIds.add(id);
  }

  if (!project.metadata?.name?.trim()) add("error", "Le nom du projet est requis.");
  if (!banks.length) add("error", "Le projet doit contenir au moins une banque.");

  const instances = new Map();
  for (const module of modules) {
    if (instances.has(module.id)) add("error", `Identifiant d'instance dupliqué : ${module.id}.`, module.name);
    instances.set(module.id, module);
    if (module.rotation != null && ![0, 90, 180, 270].includes(module.rotation)) {
      add("error", "L'orientation du plan de câblage doit être 0, 90, 180 ou 270 degrés.", module.name);
    }
    if (module.wiringLayout &&
        (![module.wiringLayout.x, module.wiringLayout.y].every(Number.isFinite) ||
         module.wiringLayout.x < 0 || module.wiringLayout.y < 0)) {
      add("error", "La position de la carte dans le plan de câblage doit utiliser des coordonnées finies et positives.", module.name);
    }
    const definition = definitions.get(module.definitionId);
    if (!definition) add("error", `Définition matérielle introuvable : ${module.definitionId}.`, module.name);
    else if (definition.status !== "Documenté") {
      add("warning", `Statut matériel : ${definition.status}. Vérifiez les sources avant câblage.`, module.name);
    }
  }

  const coreCount = modules.filter(module => module.definitionId === "core32f4").length;
  if (coreCount !== 1) add("warning", "Un seul Core32F4 documenté est attendu pour le diagramme matériel.");
  for (const definition of catalog) {
    if (definition.maxInstances != null &&
        modules.filter(module => module.definitionId === definition.id).length > definition.maxInstances) {
      add("error", `${definition.name} dépasse sa limite documentée de ${definition.maxInstances} instance(s).`);
    }
  }

  const controlIds = new Set();
  const resourceKeys = new Set();
  const encoderControls = [];
  for (const control of controls) {
    if (controlIds.has(control.id)) add("error", `Identifiant de contrôle dupliqué : ${control.id}.`, control.name);
    controlIds.add(control.id);
    const parent = instances.get(control.moduleId);
    const definition = definitions.get(parent?.definitionId);
    if (!parent) add("error", "Le contrôle référence un module absent.", control.name);
    if (!["encoder", "button", "analog"].includes(control.kind)) {
      add("warning", `Type de contrôle non pris en charge par le générateur : ${control.kind}.`, control.name);
    }
    const hwIdRange = hardwareIdRanges[control.kind];
    if (!Number.isInteger(control.hwId)) add("warning", "Aucun hw_id manuel : l'événement ne sera pas généré.", control.name);
    else if (hwIdRange && !validateInteger(control.hwId, ...hwIdRange)) {
      add("error", `hw_id doit être entre ${hwIdRange[0]} et ${hwIdRange[1]} pour un contrôle ${control.kind}.`, control.name);
    } else {
      add("warning", "Le hw_id est manuel ; sa correspondance avec le registre matériel n'est pas vérifiable automatiquement.", control.name);
    }
    if (control.hwIdSource === "suggested") {
      add("warning", "Le hw_id est proposé ; confirmez-le avec le câblage et la configuration de registres réelle.", control.name);
    }
    if (!control.physical) {
      add("warning", "Aucune ressource physique documentée n'est liée à ce contrôle.", control.name);
    } else {
      for (const connector of control.physical.connectors ?? []) {
        for (const signal of control.physical.signals ?? []) {
          const key = `${control.moduleId}:${connector}:${signal}`;
          if (resourceKeys.has(key)) add("error", `Signal physique utilisé plusieurs fois : ${connector}/${signal}.`, control.name);
          resourceKeys.add(key);
        }
      }
      const expected = (definition?.controls ?? []).some(template =>
        template.kind === control.kind && template.resources?.some(resource =>
          (resource.connectors ?? []).some(connector => control.physical.connectors?.includes(connector)) &&
          (resource.signals ?? []).some(signal => control.physical.signals?.includes(signal))
        )
      );
      if (!expected) add("warning", "Le signal physique n'est pas décrit dans la définition de ce module.", control.name);
    }
    if (control.kind === "encoder") encoderControls.push(control);

    for (const bank of banks) {
      const assignment = assignments[bank.id]?.[control.id];
      if (!assignment) continue;
      if (assignment.eventId != null && !validateInteger(assignment.eventId, 1, 4095)) {
        add("error", "L'identifiant d'événement doit être compris entre 1 et 4095.", `${control.name} · ${bank.name}`);
      }
      if (!["CC", "Meta"].includes(assignment.eventType ?? "CC")) {
        add("error", `Type d'événement non pris en charge : ${assignment.eventType}.`, `${control.name} · ${bank.name}`);
      }
      if ((assignment.eventType ?? "CC") === "Meta") {
        if (assignment.bankScoped !== false) add("error", "Un événement Meta de commande de banque doit être global, hors des blocs #BANK.", `${control.name} · ${bank.name}`);
        if (control.kind === "button" && (assignment.buttonMode ?? "OnOnly") !== "OnOnly") {
          add("error", "Le mode documenté pour un bouton Meta est OnOnly.", `${control.name} · ${bank.name}`);
        }
        const meta = assignment.meta ?? "";
        const setBank = meta.match(/^SetBank:([1-9]\d*)$/);
        const runSection = /^RunSection:[1-9]\d*$/.test(meta);
        const bankStepper = ["IncBank", "DecBank", "CycleBank"].includes(meta);
        if (!setBank && !runSection && !bankStepper) {
          add("error", "Meta doit utiliser RunSection:n, SetBank:n, IncBank, DecBank ou CycleBank.", `${control.name} · ${bank.name}`);
        } else if (setBank && !banks.some(item => item.order === Number(setBank[1]))) {
          add("error", "SetBank référence une banque inexistante.", `${control.name} · ${bank.name}`);
        }
        if (assignment.bankScoped === false && bank.id !== orderedBanks[0]?.id) {
          add("error", "Un événement global doit être configuré dans la première banque ordonnée.", `${control.name} · ${bank.name}`);
        }
      } else {
        const messageType = assignment.messageType ?? "CC";
        if (!["CC", "NoteOn"].includes(messageType)) {
          add("error", `Type de message MIDI structuré non pris en charge : ${messageType}.`, `${control.name} · ${bank.name}`);
        }
        if (messageType === "NoteOn" && control.kind !== "button") {
          add("error", "Le générateur structuré ne prend en charge NoteOn que pour les boutons.", `${control.name} · ${bank.name}`);
        }
        if (messageType === "NoteOn" && !validateInteger(assignment.key ?? 60, 0, 127)) {
          add("error", "key doit être un entier compris entre 0 et 127 pour NoteOn.", `${control.name} · ${bank.name}`);
        }
        if (messageType === "CC" && !validateInteger(assignment.cc, 0, 127)) {
          add("error", "cc doit être un entier compris entre 0 et 127.", `${control.name} · ${bank.name}`);
        }
        if (control.kind === "button" && !["OnOff", "OnOnly", "Toggle"].includes(assignment.buttonMode ?? "Toggle")) {
          add("error", "button_mode doit être OnOff, OnOnly ou Toggle.", `${control.name} · ${bank.name}`);
        }
        for (const field of ["channel", "valueMin", "valueMax"]) {
          if (!validateInteger(assignment[field], ...midiRanges[field])) {
            add("error", `${field} doit être un entier entre ${midiRanges[field][0]} et ${midiRanges[field][1]}.`, `${control.name} · ${bank.name}`);
          }
        }
        if (assignment.valueMin > assignment.valueMax) {
          add("error", "La valeur minimale dépasse la valeur maximale.", `${control.name} · ${bank.name}`);
        }
      }
      const led = assignment.led;
      if (led?.forwardId != null && (!Number.isSafeInteger(led.forwardId) || led.forwardId < 0)) {
        add("error", "forwardId RGBLED doit être un entier positif ou nul.", `${control.name} · ${bank.name}`);
      }
      if (led?.pattern != null && ![0, 1].includes(led.pattern)) {
        add("error", "Seuls les rgbled_pattern 0 et 1 observés sont pris en charge.", `${control.name} · ${bank.name}`);
      }
      if (led?.hsv != null) {
        if (!Array.isArray(led.hsv) || led.hsv.length !== 3 ||
            !validateInteger(led.hsv[0], 0, 359) ||
            !validateInteger(led.hsv[1], 0, 100) ||
            !validateInteger(led.hsv[2], 0, 100)) {
          add("error", "HSV doit contenir trois entiers H:0–359, S:0–100, V:0–100.", `${control.name} · ${bank.name}`);
        }
        if (led?.eventHsv != null &&
            (!Array.isArray(led.eventHsv) || led.eventHsv.length !== 3 ||
             !validateInteger(led.eventHsv[0], 0, 359) ||
             !validateInteger(led.eventHsv[1], 0, 100) ||
             !validateInteger(led.eventHsv[2], 0, 100))) {
          add("error", "hsv d'événement doit contenir trois entiers H:0–359, S:0–100, V:0–100.", `${control.name} · ${bank.name}`);
        }
        if (assignment.eventId != null && (!Number.isSafeInteger(assignment.eventId) || assignment.eventId < 1)) {
          add("error", "L'identifiant d'événement doit être un entier positif sûr.", `${control.name} · ${bank.name}`);
        }
        if (!Number.isSafeInteger(led.scriptTargetId) || led.scriptTargetId < 1) {
          add("error", "Une cible d'événement RGBLED est requise pour générer set_hsv.", `${control.name} · ${bank.name}`);
        }
      }
    }
  }

  const names = new Set();
  const bankOrders = new Set();
  for (const bank of banks) {
    const bankName = String(bank.name ?? "").trim();
    if (!bankName) add("error", "Le nom de la banque est requis.", bank.id);
    if (names.has(bankName.toLowerCase())) add("error", `Nom de banque dupliqué : ${bank.name}.`, bank.name);
    names.add(bankName.toLowerCase());
    if (!validateInteger(bank.order, 1, 65535) || bankOrders.has(bank.order)) {
      add("error", `Ordre de banque invalide ou dupliqué : ${bank.order}.`, bank.name);
    }
    bankOrders.add(bank.order);
    for (const control of controls) {
      if (!assignments[bank.id]?.[control.id]) {
        add("warning", "Aucune affectation dans cette banque.", `${control.name} · ${bank.name}`);
      }
    }
  }

  const seenHardware = new Set();
  for (const control of controls) {
    if (!Number.isInteger(control.hwId)) continue;
    const key = `${control.kind}:${control.hwId}`;
    if (seenHardware.has(key)) add("error", `Ressource matérielle ${control.kind}/${control.hwId} utilisée plusieurs fois.`, control.name);
    seenHardware.add(key);
  }

  const ledIds = new Set();
  for (const led of project.ledEvents ?? []) {
    if (!validateInteger(led.id, 1, 4095)) add("error", "L'identifiant EVENT_RGBLED doit être compris entre 1 et 4095.", `LED ${led.id}`);
    if (ledIds.has(led.id)) add("error", `Identifiant EVENT_RGBLED dupliqué : ${led.id}.`, `LED ${led.id}`);
    ledIds.add(led.id);
    if (manualEventIds.has(led.id)) add("error", `Conflit d'identifiant EVENT_RGBLED ${led.id} avec une directive NGC avancée.`, `LED ${led.id}`);
    if (!validateInteger(led.dimmed, 0, 127) ||
        !validateInteger(led.rangeMin, 0, 127) ||
        !validateInteger(led.rangeMax, 0, 127) ||
        led.rangeMin > led.rangeMax) {
      add("error", "dimmed/range EVENT_RGBLED doit utiliser des valeurs comprises entre 0 et 127.", `LED ${led.id}`);
    }
  }
  for (const bank of banks) {
    const ledValues = new Map();
    for (const control of controls) {
      const led = assignments[bank.id]?.[control.id]?.led;
      if (!led?.hsv || led.scriptTargetId == null) continue;
      if (!ledIds.has(led.scriptTargetId)) {
        add("error", `Aucun EVENT_RGBLED ne déclare l'identifiant ${led.scriptTargetId}.`, `${control.name} · ${bank.name}`);
      }
      const hsv = led.hsv.join(":");
      if (ledValues.has(led.scriptTargetId) && ledValues.get(led.scriptTargetId) !== hsv) {
        add("error", `Plusieurs couleurs HSV différentes ciblent RGBLED:${led.scriptTargetId}.`, bank.name);
      }
      ledValues.set(led.scriptTargetId, hsv);
    }
  }

  const seenConnections = new Set();
  for (const connection of connections) {
    if (connection.needsReconfiguration) {
      add("warning", `Ancienne liaison à reconfigurer : ${connection.reconfigurationReason ?? "ses extrémités physiques ne sont pas identifiables."}`, `${connection.from ?? "?"} → ${connection.to ?? "?"}`);
      continue;
    }
    const from = instances.get(connection.from);
    const to = instances.get(connection.to);
    const key = `${connection.from}:${connection.fromPort ?? ""}:${connection.to}:${connection.toPort ?? ""}:${connection.bus}`;
    if (seenConnections.has(key)) add("error", "Connexion dupliquée.", `${connection.from} → ${connection.to}`);
    seenConnections.add(key);
    if (!from || !to) {
      add("error", "La connexion référence un module absent.", `${connection.from} → ${connection.to}`);
      continue;
    }
    const fromDefinition = definitions.get(from.definitionId);
    const toDefinition = definitions.get(to.definitionId);
    if (connection.physical) {
      const result = assessPhysicalConnection(
        project,
        catalog,
        { moduleId: connection.fromModuleId, connectorId: connection.fromConnectorId },
        { moduleId: connection.toModuleId, connectorId: connection.toConnectorId },
        connection.interface,
        connection.id
      );
      if (!result.allowed) {
        add("error", `Liaison physique refusée (${result.status}) : ${result.reason}`, `${from.name} ${connection.fromConnectorId} → ${to.name} ${connection.toConnectorId}`);
      } else if (result.connection.fromModuleId !== connection.fromModuleId ||
                 result.connection.fromConnectorId !== connection.fromConnectorId ||
                 result.connection.toModuleId !== connection.toModuleId ||
                 result.connection.toConnectorId !== connection.toConnectorId) {
        add("error", "Les extrémités ne respectent pas le sens de liaison documenté.", `${from.name} → ${to.name}`);
      }
      continue;
    }
    if (!fromDefinition?.buses?.includes(connection.bus) || !toDefinition?.buses?.includes(connection.bus)) {
      add("error", `Le bus ${connection.bus} n'est pas déclaré aux deux extrémités.`, `${from.name} → ${to.name}`);
    }
    const fromPort = fromDefinition?.ports?.find(port => port.id === connection.fromPort);
    const toPort = toDefinition?.ports?.find(port => port.id === connection.toPort);
    if (fromDefinition?.ports?.length) {
      if (!fromDefinition.ports.some(port => port.buses.includes(connection.bus))) {
        add("error", `Aucun connecteur source documenté ne porte le bus ${connection.bus}.`, from.name);
      } else if (!connection.fromPort) add("warning", "Connecteur source non précisé malgré des ports documentés.", from.name);
      else if (!fromPort) add("error", `Connecteur source inconnu : ${connection.fromPort}.`, from.name);
      else if (!fromPort.buses.includes(connection.bus)) add("error", `Le connecteur source ${connection.fromPort} ne porte pas le bus ${connection.bus}.`, from.name);
    }
    if (toDefinition?.ports?.length) {
      if (!toDefinition.ports.some(port => port.buses.includes(connection.bus))) {
        add("error", `Aucun connecteur destination documenté ne porte le bus ${connection.bus}.`, to.name);
      } else if (!connection.toPort) add("warning", "Connecteur destination non précisé malgré des ports documentés.", to.name);
      else if (!toPort) add("error", `Connecteur destination inconnu : ${connection.toPort}.`, to.name);
      else if (!toPort.buses.includes(connection.bus)) add("error", `Le connecteur destination ${connection.toPort} ne porte pas le bus ${connection.bus}.`, to.name);
    }
    if (connection.role === "chain" &&
        (fromPort?.direction !== "output" || toPort?.direction !== "input")) {
      add("error", "Une chaîne série doit partir d'un port de sortie vers un port d'entrée documentés.", `${from.name} → ${to.name}`);
    }
    if (connection.bus === "DIN" &&
        (fromDefinition?.category === "Front-end" || toDefinition?.category === "Front-end") &&
        fromDefinition?.id !== "din4" && toDefinition?.id !== "din4") {
      add("error", "Un front-end DIN doit être raccordé à un connecteur d'entrée J3-J6 d'une carte DIN4, pas directement à un autre module.", `${from.name} → ${to.name}`);
    }
    if (connection.bus === "AIN" &&
        (fromDefinition?.category === "Front-end" || toDefinition?.category === "Front-end") &&
        fromDefinition?.id !== "ainser64" && toDefinition?.id !== "ainser64") {
      add("error", "Un front-end analogique doit rejoindre les entrées documentées d'un AINSER64.", `${from.name} → ${to.name}`);
    }
  }

  const core = modules.find(module => module.definitionId === "core32f4");
  for (const [bus, definitionId, name] of [["DIN", "din4", "DIN"], ["DOUT", "dout", "DOUT"]]) {
    const chain = connections.filter(connection => connection.bus === bus && connection.role === "chain");
    const chainModules = modules.filter(module => module.definitionId === definitionId);
    if (chainModules.length > 8) {
      add("error", `La chaîne ${name} dépasse 8 cartes de 4 registres (limite documentée de 32 registres).`);
    }
    const incoming = new Map();
    const outgoing = new Map();
    for (const connection of chain) {
      incoming.set(connection.to, (incoming.get(connection.to) ?? 0) + 1);
      outgoing.set(connection.from, (outgoing.get(connection.from) ?? 0) + 1);
    }
    for (const module of chainModules) {
      if ((incoming.get(module.id) ?? 0) > 1 || (outgoing.get(module.id) ?? 0) > 1) {
        add("error", `Une chaîne ${name} série ne peut avoir qu'une connexion entrante et sortante par carte.`, module.name);
      }
    }
    if (core && (outgoing.get(core.id) ?? 0) > 1) {
      add("error", `Le Core32F4 ne peut avoir qu'une sortie vers la chaîne ${name}.`, core.name);
    }
    if (!chainModules.length) continue;
    const reached = new Set();
    let current = core?.id;
    while (current && !reached.has(current)) {
      reached.add(current);
      current = chain.find(connection => connection.from === current)?.to;
    }
    if (!core || chainModules.some(module => !reached.has(module.id))) {
      add("warning", `Une ou plusieurs cartes ${name} ne sont pas raccordées à la chaîne ${name} déclarée.`);
    }
    if (current) add("error", `La chaîne ${name} contient une boucle.`, current);
    const actualOrder = [];
    current = core?.id;
    while (current) {
      const next = chain.find(connection => connection.from === current)?.to;
      if (!next || actualOrder.includes(next)) break;
      actualOrder.push(next);
      current = next;
    }
    const expectedOrder = [...chainModules].sort((a, b) => a.chainOrder - b.chainOrder).map(module => module.id);
    if (expectedOrder.length === actualOrder.length && expectedOrder.some((id, index) => id !== actualOrder[index])) {
      add("warning", `L'ordre de la chaîne ${name} ne correspond pas à l'ordre enregistré des cartes.`);
    }
  }

  const generatedEventIds = new Set();
  const plannedEvents = planNgcEvents(project);
  for (const event of plannedEvents) {
    if (!validateInteger(event.eventId, 1, 4095)) {
      add("error", `L'identifiant d'événement ${event.eventId} doit être compris entre 1 et 4095.`, event.control.name);
    }
    if (generatedEventIds.has(event.eventId)) {
      add("error", `Identifiant d'événement structuré dupliqué : ${event.eventId}.`, event.control.name);
    }
    generatedEventIds.add(event.eventId);
    if (manualEventIds.has(event.eventId)) {
      add("error", `Conflit d'identifiant d'événement ${event.eventId} entre NGC avancé et modèle.`, "NGC avancé");
    }
  }
  for (const ledId of ledIds) {
    if (generatedEventIds.has(ledId)) add("error", `Conflit d'identifiant NGC ${ledId} entre un événement structuré et EVENT_RGBLED.`, "NGC");
  }
  const generatedBanks = new Set(plannedEvents.filter(event => event.assignment.bankScoped !== false).map(event => event.bank.order));
  for (const match of advancedNgc.matchAll(/^\s*#BANK\s+(\d+)/gm)) {
    const bank = Number(match[1]);
    if (generatedBanks.has(bank)) add("error", `Le bloc #BANK ${bank} avancé entre en conflit avec les événements générés.`, "NGC avancé");
  }
  for (const event of plannedEvents) {
    const manual = advancedNgc.split(/\r?\n/).find(line => {
      if (!/^\s*EVENT_\w+\b/.test(line)) return false;
      const pairs = parsePairs(line);
      const manualType = line.match(/^\s*(EVENT_\w+)/)?.[1];
      return manualType === event.directive &&
        Number(pairs.hw_id) === event.control.hwId &&
        (pairs.bank == null || event.assignment.bankScoped === false || Number(pairs.bank) === event.bank.order);
    });
    if (manual) add("error", `Le contrôle ${event.control.name} est déjà utilisé par un événement NGC avancé du même type et hw_id.`, "NGC avancé");
  }
  if (/^\s*(?:RESET_HW\b|#BANK\b)/m.test(advancedNgc)) {
    add("warning", "NGC avancé contient RESET_HW ou #BANK ; vérifiez les doublons avec la structure générée.");
  }

  const encoderConfigs = new Map();
  const encoderLines = [
    ...advancedNgc.split(/\r?\n/).filter(line => /^\s*ENC\s+n\s*=/.test(line)).map(line => ({ line, source: "NGC avancé" })),
    ...encoderControls.filter(control => control.encoderConfig).map(control => ({
      line: `ENC n=${control.encoderConfig.n} sr=${control.encoderConfig.sr} pins=${control.encoderConfig.pins} type=${control.encoderConfig.type}`,
      source: control.name
    }))
  ];
  for (const { line, source } of encoderLines) {
    const pairs = parsePairs(line);
    const number = Number(pairs.n);
    const sr = Number(pairs.sr);
    const pins = pairs.pins?.split(":").map(Number);
    if (!validateInteger(number, 1, 128) || !validateInteger(sr, 1, 16) ||
        pins?.length !== 2 || pins.some(pin => !validateInteger(pin, 0, 7)) ||
        pins[0] === pins[1] || Math.floor(pins[0] / 2) !== Math.floor(pins[1] / 2) ||
        !["non_detented", "detented1", "detented2", "detented3"].includes(pairs.type)) {
      add("error", "Déclaration ENC invalide (n, sr, pins ou type).", source);
      continue;
    }
    if (encoderConfigs.has(number)) add("error", `Configuration ENC n=${number} définie plusieurs fois.`, source);
    encoderConfigs.set(number, { sr, pins, type: pairs.type });
  }
  for (const control of encoderControls) {
    if (!Number.isInteger(control.hwId)) continue;
    const config = encoderConfigs.get(control.hwId);
    if (!config) add("warning", `Aucune déclaration ENC pour l'encodeur hw_id=${control.hwId}.`, control.name);
    else if (control.encoderConfig && control.encoderConfig.n !== control.hwId) {
      add("error", `ENC n=${control.encoderConfig.n} ne correspond pas au hw_id=${control.hwId}.`, control.name);
    }
  }

  const advancedNgr = project.advanced?.ngr ?? "";
  const structuredSections = new Set();
  for (const bank of banks) {
    if (controls.some(control => assignments[bank.id]?.[control.id]?.led?.hsv)) structuredSections.add(bank.order);
  }
  for (const match of advancedNgr.matchAll(/^\s*if\s+\^section\s*==\s*(\d+)/gm)) {
    const section = Number(match[1]);
    if (structuredSections.has(section)) add("error", `La section NGR ${section} existe à la fois en avancé et dans le modèle LED.`, `NGR section ${section}`);
  }
  if (structuredSections.size && !controls.some(control =>
    banks.some(bank => {
      const assignment = assignments[bank.id]?.[control.id];
      return assignment?.eventType === "Meta" && assignment.meta === `RunSection:${bank.order}` && assignment.bankScoped === false;
    })
  )) {
    add("warning", "Les sections NGR générées pour les LED n'ont aucun bouton Meta RunSection correspondant.");
  }

  const generatedLabels = new Set();
  for (const { control, bank } of plannedEvents) {
    const label = `mb_${control.id.replace(/[^a-zA-Z0-9_]/g, "_")}_b${bank.order}`;
    if (generatedLabels.has(label)) add("error", `Label NGL généré dupliqué : ${label}.`, "NGL");
    generatedLabels.add(label);
  }
  const advancedLabels = new Set();
  for (const match of (project.advanced?.ngl ?? "").matchAll(/^\s*LABEL\s+([^\s]+)/gm)) {
    if (advancedLabels.has(match[1])) add("error", `Label NGL avancé dupliqué : ${match[1]}.`, "NGL avancé");
    advancedLabels.add(match[1]);
    if (generatedLabels.has(match[1])) add("error", `Conflit de label ${match[1]} entre NGL avancé et modèle.`, "NGL avancé");
  }
  for (const label of generatedLabels) {
    if (advancedLabels.has(label)) add("error", `Conflit de label ${label} entre NGL avancé et modèle.`, "NGL avancé");
  }

  return issues;
}
