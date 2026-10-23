import { loadCatalog } from "./catalog.js";
import { addBank, addModule, cloneProject, createProject, duplicateModule, removeBank, removeModule } from "./model.js";
import { generateFiles } from "./generator.js";
import { validateProject } from "./validate.js";
import { createGenerationDiff } from "./diff.js";
import { mergeConfigurationImport, prepareConfigurationImport } from "./config-import.js";
import { reconstructNgcHardware } from "./ngc-hardware-import.js";
import {
  assessPhysicalConnection,
  boardViewFor,
  connectPhysical,
  connectorFor,
  connectorWorldPosition,
  connectorsFor,
  migrateLegacyConnections,
  BOARD_ART_HEIGHT,
  BOARD_ART_WIDTH
} from "./physical-connectors.js";

const STORAGE_KEY = "modulbox-ngc-project-v1";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

let catalog;
let project;
let selectedControlId = null;
let selectedBankId = null;
let activeFilter = "Tous";
let searchText = "";
let zoom = 100;
let generated = {};
let generationDiff = "Première génération : les fichiers générés sont prévisualisés avant tout téléchargement.";
let selectedConnector = null;
let connectionInterface = "DIN";
let undoStack = [];
let redoStack = [];

try {
  catalog = await loadCatalog();
  const saved = localStorage.getItem(STORAGE_KEY);
  project = normalizeProject(saved ? JSON.parse(saved) : createProject());
  if (!project.schemaVersion || project.schemaVersion !== 1) throw new Error("Version du projet non prise en charge.");
  selectedBankId = project.banks[0]?.id ?? null;
  renderAll();
} catch (error) {
  $("#toast").textContent = `Erreur au démarrage : ${error.message}`;
  $("#toast").classList.add("visible", "error-toast");
  throw error;
}

function commit(change, message = "Modifications enregistrées localement") {
  undoStack.push(cloneProject(project));
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  change();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  $("#save-state").textContent = message;
  renderAll();
  updateHistoryButtons();
}

function navigate(page) {
  $$(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  $("#page-label").textContent = ({ project: "Projet", modules: "Bibliothèque", hardware: "Connexions", controls: "Contrôles MIDI", banks: "Banques", generate: "Génération", files: "Fichiers" })[page];
  if (page === "generate") renderGeneration();
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error-toast", error);
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 3000);
}

function definitionFor(instance) {
  return catalog.find(definition => definition.id === instance?.definitionId);
}

function normalizeProject(value) {
  value.connections ??= [];
  value.controls ??= [];
  value.assignments ??= {};
  value.ledEvents ??= [];
  value.advanced ??= {};
  value.advanced.ngc ??= "";
  value.advanced.ngr ??= "";
  value.advanced.ngl ??= "";
  value.modules ??= [];
  for (const [index, module] of value.modules.entries()) {
    module.wiringLayout ??= { x: 80 + index * 280, y: 80 };
    module.rotation ??= 0;
  }
  for (const control of value.controls) {
    control.physical ??= null;
    control.hwIdSource ??= Number.isInteger(control.hwId) ? "manual" : "unassigned";
  }
  for (const bank of value.banks ?? []) {
    value.assignments[bank.id] ??= {};
    for (const control of value.controls) {
      const assignment = value.assignments[bank.id][control.id];
      if (!assignment) continue;
      assignment.eventType ??= "CC";
      assignment.bankScoped ??= true;
      assignment.led ??= {};
      assignment.led.forwardId ??= null;
      assignment.led.pattern ??= null;
      assignment.led.scriptTargetId ??= null;
      assignment.led.eventHsv ??= null;
      assignment.led.hsv ??= null;
    }
  }
  migrateLegacyConnections(value, catalog);
  return value;
}

function rebuildDinChain(targetProject = project) {
  const core = targetProject.modules.find(module => module.definitionId === "core32f4");
  if (!core) return false;
  const din = targetProject.modules.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  targetProject.connections = targetProject.connections.filter(connection =>
    !(connection.interface === "DIN" && connection.role === "chain") &&
    !(connection.bus === "DIN" && connection.role === "chain")
  );
  const ordered = [core, ...din];
  ordered.slice(0, -1).forEach((module, index) => {
    const next = ordered[index + 1];
    connectPhysical(targetProject, catalog,
      { moduleId: module.id, connectorId: module.definitionId === "core32f4" ? "J8J9" : "J2" },
      { moduleId: next.id, connectorId: "J1" },
      "DIN");
  });
  return true;
}

function issues() {
  return validateProject(project, catalog);
}

function renderAll() {
  $("#sidebar-project-name").textContent = project.metadata.name || "Projet sans nom";
  $("#project-name").value = project.metadata.name;
  renderProject();
  renderLibrary();
  renderConnections();
  renderControls();
  renderLedEvents();
  renderBanks();
  renderHistory();
}

function renderProject() {
  const counts = [
    ["MODULES", project.modules.length],
    ["CONTRÔLES", project.controls.length],
    ["BANQUES", project.banks.length]
  ];
  $("#project-metrics").innerHTML = counts.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${label === "MODULES" ? "instances physiques" : label === "CONTRÔLES" ? "affectations logiques" : "configurées"}</small></div>`).join("");
  $("#module-count-foot").textContent = `${project.modules.length} module${project.modules.length === 1 ? "" : "s"}`;
  const canvas = $("#controller-canvas");
  if (!project.modules.length) {
    canvas.innerHTML = `<div class="canvas-empty"><span>▦</span><h3>Votre surface est vide</h3><p>Ajoutez le Core32F4 et les cartes documentées depuis la bibliothèque.</p><button class="primary-button" data-go="modules">Parcourir les modules</button></div>`;
  } else {
    canvas.innerHTML = `<div class="surface-legend"><span>Surface ergonomique</span><small>Déplacement visuel sans effet sur l’ordre électrique</small></div><div class="surface-grid">${project.modules.map((module, index) => {
      const definition = definitionFor(module);
      return `<article class="surface-card ${selectedControlId && project.controls.find(control => control.id === selectedControlId)?.moduleId === module.id ? "selected" : ""}" draggable="true" data-module="${escapeHtml(module.id)}" style="--x:${Number(module.layout?.x) || 0}px;--y:${Number(module.layout?.y) || 0}px;--accent:${["#a78bfa","#5eead4","#fbbf24","#fb7185"][index % 4]}"><div class="surface-card-top"><span class="module-kind">${escapeHtml(definition?.category ?? "Module")}</span><div><button class="icon-button duplicate-module" data-duplicate="${escapeHtml(module.id)}" aria-label="Dupliquer">⧉</button><button class="icon-button remove-module" data-remove="${escapeHtml(module.id)}" aria-label="Supprimer">×</button></div></div><input class="surface-name" data-module-name="${escapeHtml(module.id)}" aria-label="Nom du module" value="${escapeHtml(module.name)}"><small>${escapeHtml(definition?.name ?? module.definitionId)}</small><div class="surface-controls">${definition?.buses?.map(bus => `<i>${escapeHtml(bus)}</i>`).join("")}</div><button class="text-button module-controls" data-module-controls="${escapeHtml(module.id)}">${project.controls.filter(control => control.moduleId === module.id).length} contrôles <span>→</span></button></article>`;
    }).join("")}</div>`;
    bindSurfaceDragging();
  }
  const currentIssues = issues();
  const errors = currentIssues.filter(item => item.severity === "error").length;
  const warnings = currentIssues.filter(item => item.severity === "warning").length;
  const status = errors ? "Erreur" : warnings ? "À vérifier" : project.modules.length ? "Structure OK*" : "Incomplet";
  $("#overall-status").textContent = status;
  $("#overall-status").className = `status-pill ${errors ? "bad" : warnings ? "warn" : "good"}`;
  $("#summary-issues").innerHTML = currentIssues.length
    ? currentIssues.slice(0, 5).map(item => `<div class="issue-line ${item.severity}"><span>${item.severity === "error" ? "!" : item.severity === "warning" ? "△" : "i"}</span><p><strong>${escapeHtml(item.target)}</strong><small>${escapeHtml(item.message)}</small></p></div>`).join("")
    : `<div class="issue-line info"><span>✓</span><p><strong>Aucune incohérence détectée</strong><small>Ce résultat ne constitue pas une validation électrique.</small></p></div>`;
}

function renderLibrary() {
  const categories = ["Tous", ...new Set(catalog.map(item => item.category))];
  $("#module-filters").innerHTML = categories.map(category => `<button class="filter-pill ${category === activeFilter ? "selected" : ""}" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("");
  const modules = catalog.filter(item => (activeFilter === "Tous" || item.category === activeFilter) && `${item.name} ${item.description}`.toLowerCase().includes(searchText.toLowerCase()));
  $("#module-library").innerHTML = modules.map(definition => {
    const count = project.modules.filter(module => module.definitionId === definition.id).length;
    const warning = definition.status !== "Documenté";
    return `<article class="library-card"><div class="library-image">${definition.image ? `<img src="./${escapeHtml(definition.image)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<span>▦</span><small>Illustration indisponible</small>'">` : `<span>▦</span><small>Illustration générique</small>`}<span class="category-chip">${escapeHtml(definition.category)}</span></div><div class="library-card-body"><div class="library-title"><h3>${escapeHtml(definition.name)}</h3><span class="status-dot ${warning ? "warning-dot" : ""}" title="${escapeHtml(definition.status)}"></span></div><p>${escapeHtml(definition.description)}</p><div class="module-tags">${definition.buses.map(bus => `<span>${escapeHtml(bus)}</span>`).join("")}</div><div class="library-meta"><span>${definition.controls.reduce((sum, control) => sum + control.count, 0)} contrôles configurables${definition.controls.length ? "" : " déclarés"}</span><a href="./${escapeHtml(definition.evidence)}" target="_blank" rel="noreferrer">Source ↗</a></div><button class="small-button full-width add-module" data-add="${escapeHtml(definition.id)}" ${definition.maxInstances != null && count >= definition.maxInstances ? "disabled" : ""}>${count ? `${count} ajouté${count > 1 ? "s" : ""} · Ajouter` : "＋ Ajouter au projet"}</button></div></article>`;
  }).join("") || `<div class="empty-result">Aucun module ne correspond à cette recherche.</div>`;
}

function renderConnectorInspector(module, connector) {
  const node = $("#connector-inspector");
  if (!module || !connector) {
    node.innerHTML = `<p class="muted small">Sélectionnez un connecteur pour inspecter sa fonction, son type et les sources disponibles.</p>`;
    return;
  }
  const definition = definitionFor(module);
  const position = connector.positionStatus === "approximate"
    ? "Emplacement indicatif depuis le rendu de référence; non coté."
    : "Emplacement physique non documenté.";
  const pins = connector.pins == null ? "nombre de broches non établi" : `${connector.pins} broches`;
  const evidence = boardViewFor(module.definitionId)?.evidence ?? definition?.evidence;
  node.innerHTML = `<div class="connector-inspector-heading"><strong>${escapeHtml(module.name)} · ${escapeHtml(connector.silkscreen)}</strong><small>${escapeHtml(connector.type)} · ${escapeHtml(pins)}</small></div><p>${escapeHtml(connector.function)}</p><p class="muted small">Interfaces : ${escapeHtml(connector.interfaces.join(", "))}<br>Direction : ${escapeHtml(connector.direction)}<br>${escapeHtml(position)}</p><a href="./${escapeHtml(evidence ?? "#")}" target="_blank" rel="noreferrer">Consulter la source ↗</a>`;
}

function wireColor(interfaceName) {
  return ({
    DIN: "#34d399",
    "DIN-control": "#22d3ee",
    DOUT: "#a78bfa",
    "DOUT-control": "#e879f9",
    "LED-data": "#fbbf24",
    "SPI/AIN": "#60a5fa"
  })[interfaceName] ?? "#d6dbea";
}

function boardArtBounds(module) {
  const rotation = ((module.rotation ?? 0) % 360 + 360) % 360;
  const quarterTurn = rotation === 90 || rotation === 270;
  return {
    width: quarterTurn ? BOARD_ART_HEIGHT : BOARD_ART_WIDTH,
    height: quarterTurn ? BOARD_ART_WIDTH : BOARD_ART_HEIGHT
  };
}

function connectorPlanPosition(module, connector) {
  const documentedPosition = connectorWorldPosition(module, connector);
  if (documentedPosition) return documentedPosition;
  const unknownConnectors = connectorsFor(module.definitionId).filter(item => !item.position);
  const index = unknownConnectors.findIndex(item => item.id === connector?.id);
  if (index < 0) return null;
  const bounds = boardArtBounds(module);
  const columns = Math.max(1, Math.floor(bounds.width / 48));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const cellWidth = (bounds.width - 6 - 2 * (columns - 1)) / columns;
  return {
    x: (Number(module.wiringLayout?.x) || 0) + 3 + column * (cellWidth + 2) + cellWidth / 2,
    y: (Number(module.wiringLayout?.y) || 0) + bounds.height + 24 + row * 20
  };
}

function wirePath(fromPoint, toPoint) {
  const direction = Math.sign(toPoint.x - fromPoint.x) || 1;
  const bend = Math.max(36, Math.abs(toPoint.x - fromPoint.x) * 0.35) * direction;
  return `M ${fromPoint.x} ${fromPoint.y} C ${fromPoint.x + bend} ${fromPoint.y}, ${toPoint.x - bend} ${toPoint.y}, ${toPoint.x} ${toPoint.y}`;
}

function updateWireGeometry(layoutOverrides = new Map()) {
  const physicalConnections = project.connections.filter(connection =>
    connection.fromModuleId && connection.toModuleId && !connection.needsReconfiguration
  );
  const moduleById = new Map(project.modules.map(module => [module.id, module]));
  physicalConnections.forEach((connection, index) => {
    const group = $(`#hardware-diagram [data-wire-index="${index}"]`);
    if (!group) return;
    const from = moduleById.get(connection.fromModuleId);
    const to = moduleById.get(connection.toModuleId);
    const fromLayout = layoutOverrides.get(from?.id);
    const toLayout = layoutOverrides.get(to?.id);
    const fromModule = fromLayout ? { ...from, wiringLayout: fromLayout } : from;
    const toModule = toLayout ? { ...to, wiringLayout: toLayout } : to;
    const fromPoint = connectorPlanPosition(fromModule, connectorFor(from?.definitionId, connection.fromConnectorId));
    const toPoint = connectorPlanPosition(toModule, connectorFor(to?.definitionId, connection.toConnectorId));
    if (!fromPoint || !toPoint) return;
    group.querySelector(".physical-wire").setAttribute("d", wirePath(fromPoint, toPoint));
    group.querySelector(".wire-start").setAttribute("cx", fromPoint.x);
    group.querySelector(".wire-start").setAttribute("cy", fromPoint.y);
    group.querySelector(".wire-destination").setAttribute("cx", toPoint.x);
    group.querySelector(".wire-destination").setAttribute("cy", toPoint.y);
  });
}

function renderConnections() {
  const instances = project.modules;
  const moduleById = new Map(instances.map(module => [module.id, module]));
  const physicalConnections = project.connections.filter(connection => connection.fromModuleId && connection.toModuleId && !connection.needsReconfiguration);
  const links = project.connections.length ? project.connections.map((connection, index) => {
    if (connection.needsReconfiguration) {
      return `<div class="connection-row connection-unknown"><span class="bus-chip">À revoir</span><div><strong>${escapeHtml(connection.from)} → ${escapeHtml(connection.to)}</strong><small>${escapeHtml(connection.reconfigurationReason)}</small></div><button class="icon-button remove-connection" data-index="${index}" aria-label="Supprimer la liaison à reconfigurer">×</button></div>`;
    }
    const from = moduleById.get(connection.fromModuleId);
    const to = moduleById.get(connection.toModuleId);
    const fromConnector = connectorFor(from?.definitionId, connection.fromConnectorId);
    const toConnector = connectorFor(to?.definitionId, connection.toConnectorId);
    const positionsKnown = fromConnector?.position && toConnector?.position;
    const address = connection.ngcAddress
      ? ` · NGC hw_id ${connection.ngcAddress.firstHwId}–${connection.ngcAddress.lastHwId}${Number.isInteger(connection.ngcAddress.shiftRegister) ? ` (SR${connection.ngcAddress.shiftRegister})` : ""}`
      : "";
    return `<div class="connection-row connection-validated"><span class="bus-chip">${escapeHtml(connection.interface)}</span><div><strong>${escapeHtml(from?.name ?? connection.fromModuleId)} · ${escapeHtml(fromConnector?.silkscreen ?? connection.fromConnectorId)} → ${escapeHtml(to?.name ?? connection.toModuleId)} · ${escapeHtml(toConnector?.silkscreen ?? connection.toConnectorId)}</strong><small>${escapeHtml(connection.role)} · compatibilité documentée${escapeHtml(address)}${positionsKnown ? "" : " · extrémité schématique, emplacement physique inconnu"}</small></div><button class="icon-button remove-connection" data-index="${index}" aria-label="Supprimer la liaison">×</button></div>`;
  }).join("") : `<p class="muted small">Aucune liaison déclarée. La disposition des cartes ne constitue pas un câblage.</p>`;
  const dinModules = instances.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  const chainOrder = dinModules.length ? `<div class="din-order"><p class="eyebrow">ORDRE DES CARTES DIN</p>${dinModules.map((module, index) => `<div class="din-order-row"><span>${index + 1}</span><strong>${escapeHtml(module.name)}</strong><button class="icon-button move-din" data-din="${escapeHtml(module.id)}" data-direction="-1" aria-label="Monter" ${index === 0 ? "disabled" : ""}>↑</button><button class="icon-button move-din" data-din="${escapeHtml(module.id)}" data-direction="1" aria-label="Descendre" ${index === dinModules.length - 1 ? "disabled" : ""}>↓</button></div>`).join("")}<small>Modifier l’ordre reconstruit uniquement les liaisons DIN sourcées.</small></div>` : "";
  $("#connection-list").innerHTML = `${links}${chainOrder}`;

  const diagram = $("#hardware-diagram");
  diagram.style.setProperty("--zoom", `${zoom / 100}`);
  const boardModels = instances.map(module => {
    const definition = definitionFor(module);
    const board = boardViewFor(module.definitionId);
    const rotation = ((module.rotation ?? 0) % 360 + 360) % 360;
    const quarterTurn = rotation === 90 || rotation === 270;
    return {
      module, definition, board, rotation,
      width: quarterTurn ? BOARD_ART_HEIGHT : BOARD_ART_WIDTH,
      height: quarterTurn ? BOARD_ART_WIDTH : BOARD_ART_HEIGHT
    };
  });
  if (!boardModels.length) {
    diagram.innerHTML = `<div class="canvas-empty"><span>⌘</span><h3>Aucune carte à afficher</h3><p>Ajoutez des modules avant de définir le diagramme.</p></div>`;
    $("#connector-inventory").innerHTML = "";
    renderConnectorInspector(null, null);
    return;
  }
  $("#connection-interface").value = connectionInterface;
  $("#cancel-connection").disabled = !selectedConnector;
  const mapWidth = Math.max(900, ...boardModels.map(item => (Number(item.module.wiringLayout?.x) || 0) + item.width + 60));
  const mapHeight = Math.max(420, ...boardModels.map(item => {
    const unknown = connectorsFor(item.module.definitionId).filter(connector => !connector.position);
    const columns = Math.max(1, Math.floor(item.width / 48));
    const rows = Math.ceil(unknown.length / columns);
    const portsHeight = unknown.length ? 36 + Math.max(0, rows - 1) * 20 : 0;
    return (Number(item.module.wiringLayout?.y) || 0) + item.height + portsHeight + 90;
  }));
  const markers = [...new Set(physicalConnections.map(connection => wireColor(connection.interface)))]
    .map((color, index) => `<marker id="wire-arrow-${index}" data-wire-color="${color}" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${color}"/></marker>`)
    .join("");
  const wires = physicalConnections.map((connection, index) => {
    const from = moduleById.get(connection.fromModuleId);
    const to = moduleById.get(connection.toModuleId);
    const fromPoint = connectorPlanPosition(from, connectorFor(from?.definitionId, connection.fromConnectorId));
    const toPoint = connectorPlanPosition(to, connectorFor(to?.definitionId, connection.toConnectorId));
    if (!fromPoint || !toPoint) return "";
    const color = wireColor(connection.interface);
    const markerIndex = [...new Set(physicalConnections.map(item => wireColor(item.interface)))].indexOf(color);
    return `<g data-wire-index="${index}"><path class="physical-wire" stroke="${color}" marker-end="url(#wire-arrow-${markerIndex})" d="${wirePath(fromPoint, toPoint)}"/><circle class="wire-end wire-start" cx="${fromPoint.x}" cy="${fromPoint.y}" r="4" fill="${color}"/><circle class="wire-end wire-destination" cx="${toPoint.x}" cy="${toPoint.y}" r="4" fill="${color}"/></g>`;
  }).join("");
  const boards = boardModels.map(({ module, definition, board, rotation, width, height }) => {
    const left = Number(module.wiringLayout?.x) || 0;
    const top = Number(module.wiringLayout?.y) || 0;
    const connectors = connectorsFor(module.definitionId);
    const hotspotButtons = connectors.filter(connector => connector.position).map(connector => {
      const selected = selectedConnector?.moduleId === module.id && selectedConnector.connectorId === connector.id;
      const isCandidate = selectedConnector && (assessPhysicalConnection(project, catalog, selectedConnector, { moduleId: module.id, connectorId: connector.id }, connectionInterface).allowed ||
        assessPhysicalConnection(project, catalog, { moduleId: module.id, connectorId: connector.id }, selectedConnector, connectionInterface).allowed);
      const used = physicalConnections.some(connection =>
        (connection.fromModuleId === module.id && connection.fromConnectorId === connector.id) ||
        (connection.toModuleId === module.id && connection.toConnectorId === connector.id)
      );
      const classes = ["connector-hotspot", selected ? "selected" : "", isCandidate ? "candidate" : "", used ? "connected" : ""].filter(Boolean).join(" ");
      return `<button class="${classes}" data-label="${escapeHtml(connector.silkscreen)}" data-connector-module="${escapeHtml(module.id)}" data-connector-id="${escapeHtml(connector.id)}" aria-label="${escapeHtml(`Sélectionner ${module.name} ${connector.silkscreen}`)}" style="left:${connector.position.x * 100}%;top:${connector.position.y * 100}%" title="${escapeHtml(`${connector.silkscreen} — ${connector.function} (${connector.positionStatus === "approximate" ? "position indicative" : "position inconnue"})`)}"></button>`;
    }).join("");
    const image = board?.boardView ?? definition?.image;
    const boardImage = image
      ? `<img src="./${escapeHtml(image)}" alt="Vue de référence ${escapeHtml(definition?.name ?? module.definitionId)}" draggable="false">`
      : `<div class="no-board-image">Aucun rendu de carte disponible</div>`;
    const unknownConnectors = connectors.filter(connector => !connector.position);
    const portColumns = Math.max(1, Math.floor(width / 48));
    const portRows = Math.ceil(unknownConnectors.length / portColumns);
    const portsHeight = unknownConnectors.length ? 36 + Math.max(0, portRows - 1) * 20 : 0;
    const unknownPorts = unknownConnectors.map(connector => {
      const selected = selectedConnector?.moduleId === module.id && selectedConnector.connectorId === connector.id;
      const isCandidate = selectedConnector && (assessPhysicalConnection(project, catalog, selectedConnector, { moduleId: module.id, connectorId: connector.id }, connectionInterface).allowed ||
        assessPhysicalConnection(project, catalog, { moduleId: module.id, connectorId: connector.id }, selectedConnector, connectionInterface).allowed);
      const usedConnection = physicalConnections.find(connection =>
        (connection.fromModuleId === module.id && connection.fromConnectorId === connector.id) ||
        (connection.toModuleId === module.id && connection.toConnectorId === connector.id)
      );
      const classes = ["schematic-port", selected ? "selected" : "", isCandidate ? "candidate" : "", usedConnection ? "connected" : ""].filter(Boolean).join(" ");
      const connectionColor = usedConnection ? wireColor(usedConnection.interface) : null;
      return `<button class="${classes}" data-connector-module="${escapeHtml(module.id)}" data-connector-id="${escapeHtml(connector.id)}" style="${connectionColor ? `--port-color:${connectionColor}` : ""}" title="${escapeHtml(`${connector.silkscreen} — position physique inconnue; port schématique`)}" aria-label="${escapeHtml(`Sélectionner ${module.name} ${connector.silkscreen}, position inconnue`)}">${escapeHtml(connector.silkscreen)}</button>`;
    }).join("");
    const addressLabel = module.ngcAddress?.firstShiftRegister
      ? `SR${module.ngcAddress.firstShiftRegister}–${module.ngcAddress.lastShiftRegister} · hw_id ${module.ngcAddress.firstHwId}–${module.ngcAddress.lastHwId}`
      : module.ngcAddress?.firstEncoder
        ? `ENC ${module.ngcAddress.firstEncoder}–${module.ngcAddress.lastEncoder}`
        : "";
    return `<article class="wire-board ${selectedConnector?.moduleId === module.id ? "board-active" : ""}" data-wire-module="${escapeHtml(module.id)}" style="left:${left}px;top:${top}px;width:${width}px;height:${height + portsHeight}px;--board-width:${BOARD_ART_WIDTH}px;--board-height:${BOARD_ART_HEIGHT}px;--art-height:${height}px;--port-columns:${portColumns};--rotation:${rotation}deg"><header class="wire-board-heading"><div><strong>${escapeHtml(module.name)}</strong>${addressLabel ? `<small class="wire-board-address">${escapeHtml(addressLabel)}</small>` : ""}</div><button class="icon-button rotate-board" data-rotate="${escapeHtml(module.id)}" aria-label="Tourner la carte de 90 degrés">↻</button></header><div class="wire-art-area"><div class="wire-art-rotator">${boardImage}${hotspotButtons || `<span class="no-hotspots">Position des connecteurs inconnue</span>`}</div></div>${unknownConnectors.length ? `<div class="schematic-port-area"><small>Ports · positions inconnues</small><div class="schematic-port-list">${unknownPorts}</div></div>` : ""}</article>`;
  }).join("");
  diagram.innerHTML = `<div class="physical-map" style="width:${mapWidth}px;height:${mapHeight}px"><svg class="wire-layer" width="${mapWidth}" height="${mapHeight}" aria-label="Câbles entre connecteurs"><defs>${markers}</defs>${wires}</svg>${boards}</div>`;
  bindWiringBoardDragging();
  $("#connector-inventory").innerHTML = boardModels.map(({ module, definition }) => {
    const connectors = connectorsFor(module.definitionId);
    if (!connectors.length) {
      const listed = definition?.connectors ?? [];
      return `<details class="connector-inventory"><summary>${escapeHtml(module.name)} · inventaire incomplet</summary><p class="unknown-connectors">Résumé sans données physiques normalisées; compatibilité inconnue et connexion bloquée.</p>${listed.length ? `<ul>${listed.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}</details>`;
    }
    return `<details class="connector-inventory"><summary>${escapeHtml(module.name)} · ${connectors.length} connecteurs documentés</summary><div class="connector-inventory-list">${connectors.map(connector => {
      const selected = selectedConnector?.moduleId === module.id && selectedConnector.connectorId === connector.id;
      const isCandidate = selectedConnector && (assessPhysicalConnection(project, catalog, selectedConnector, { moduleId: module.id, connectorId: connector.id }, connectionInterface).allowed ||
        assessPhysicalConnection(project, catalog, { moduleId: module.id, connectorId: connector.id }, selectedConnector, connectionInterface).allowed);
      const used = physicalConnections.some(connection =>
        (connection.fromModuleId === module.id && connection.fromConnectorId === connector.id) ||
        (connection.toModuleId === module.id && connection.toConnectorId === connector.id)
      );
      return `<button class="inventory-connector ${selected ? "selected" : ""} ${isCandidate ? "candidate" : ""} ${used ? "connected" : ""}" data-inspect-module="${escapeHtml(module.id)}" data-inspect-connector="${escapeHtml(connector.id)}"><strong>${escapeHtml(connector.silkscreen)}</strong><span>${escapeHtml(connector.type)} · ${connector.pins == null ? "broches inconnues" : `${connector.pins} broches`}</span><small>${escapeHtml(connector.function)} · ${connector.position ? "position indicative" : "position inconnue"}</small></button>`;
    }).join("")}</div></details>`;
  }).join("");
  const inspected = selectedConnector &&
    moduleById.get(selectedConnector.moduleId) &&
    connectorFor(moduleById.get(selectedConnector.moduleId).definitionId, selectedConnector.connectorId);
  renderConnectorInspector(inspected ? moduleById.get(selectedConnector.moduleId) : null, inspected);
}

function bindWiringBoardDragging() {
  $$(".wire-board").forEach(card => {
    let drag = null;
    card.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const module = project.modules.find(item => item.id === card.dataset.wireModule);
      if (!module) return;
      event.preventDefault();
      drag = {
        module,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: Number(module.wiringLayout?.x) || 0,
        top: Number(module.wiringLayout?.y) || 0,
        moved: false
      };
      card.setPointerCapture(event.pointerId);
    });
    card.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const scale = zoom / 100;
      const left = Math.max(0, drag.left + (event.clientX - drag.startX) / scale);
      const top = Math.max(0, drag.top + (event.clientY - drag.startY) / scale);
      drag.moved ||= Math.abs(left - drag.left) > 2 || Math.abs(top - drag.top) > 2;
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      updateWireGeometry(new Map([[drag.module.id, { ...drag.module.wiringLayout, x: left, y: top }]]));
    });
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const scale = zoom / 100;
      const left = Math.max(0, drag.left + (event.clientX - drag.startX) / scale);
      const top = Math.max(0, drag.top + (event.clientY - drag.startY) / scale);
      const currentDrag = drag;
      drag = null;
      if (currentDrag.moved) {
        commit(() => {
          currentDrag.module.wiringLayout = {
            ...currentDrag.module.wiringLayout,
            x: left,
            y: top
          };
        });
      } else {
        updateWireGeometry();
      }
    };
    card.addEventListener("pointerup", finishDrag);
    card.addEventListener("pointercancel", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      card.style.left = `${drag.left}px`;
      card.style.top = `${drag.top}px`;
      drag = null;
      updateWireGeometry();
    });
  });
}

function renderControls() {
  const selectedBank = project.banks.find(bank => bank.id === selectedBankId) ?? project.banks[0];
  selectedBankId = selectedBank?.id ?? null;
  $("#control-bank").innerHTML = project.banks.map(bank => `<option value="${escapeHtml(bank.id)}" ${bank.id === selectedBankId ? "selected" : ""}>${escapeHtml(bank.name)}</option>`).join("");
  const controls = project.controls;
  $("#control-count").textContent = `${controls.length} contrôle${controls.length === 1 ? "" : "s"}`;
  $("#control-list").innerHTML = controls.length ? controls.map(control => {
    const module = project.modules.find(item => item.id === control.moduleId);
    return `<button class="control-row ${selectedControlId === control.id ? "selected" : ""}" data-control="${escapeHtml(control.id)}"><span class="control-type">${control.kind === "encoder" ? "⟳" : control.kind === "analog" ? "↕" : "◉"}</span><span><strong>${escapeHtml(control.name)}</strong><small>${escapeHtml(module?.name)} · ${escapeHtml(control.kind)} · HW ${escapeHtml(control.hwId)}</small></span><span class="row-arrow">→</span></button>`;
  }).join("") : `<div class="empty-list"><span>◉</span><strong>Aucun contrôle défini</strong><small>Les contrôles sont créés à l’ajout d’un module physique pris en charge.</small></div>`;
  const control = controls.find(item => item.id === selectedControlId);
  const inspector = $("#control-inspector");
  if (!control) {
    inspector.innerHTML = `<div class="inspector-empty"><span>◉</span><h3>Sélectionnez un contrôle</h3><p>Ses paramètres MIDI et sa ressource physique apparaîtront ici.</p></div>`;
    return;
  }
  const assignment = project.assignments[selectedBankId]?.[control.id] ?? {};
  const led = assignment.led ?? {};
  const physical = control.physical;
  const eventType = assignment.eventType ?? "CC";
  const messageType = assignment.messageType ?? "CC";
  const hwIdMax = ({ button: 256, encoder: 128, analog: 128 })[control.kind] ?? 256;
  const hsvText = hsv => Array.isArray(hsv) ? hsv.join(":") : "";
  inspector.innerHTML = `
    <div class="inspector-heading"><div><p class="eyebrow">INSPECTEUR · ${escapeHtml(selectedBank?.name)}</p><h2>${escapeHtml(control.name)}</h2><p class="muted small">${escapeHtml(control.id)}</p></div><span class="control-type large">${control.kind === "encoder" ? "⟳" : control.kind === "analog" ? "↕" : "◉"}</span></div>
    <div class="divider"></div><p class="eyebrow">RESSOURCE MATÉRIELLE</p>
    <label>Identifiant hw_id<input type="number" min="1" max="${hwIdMax}" data-control-field="hwId" data-control-id="${escapeHtml(control.id)}" value="${escapeHtml(control.hwId ?? "")}"></label>
    <p class="help-text">${control.hwIdSource === "suggested" ? "Valeur proposée ; confirmez-la avec le câblage et la configuration de registres." : "Saisie manuelle : elle n'est pas déduite de la position graphique."}</p>
    <p class="help-text">Connecteur(s) documenté(s) : ${escapeHtml(physical?.connectors?.join(", ") || "non documenté")}<br>Signal(aux) : ${escapeHtml(physical?.signals?.join(", ") || "non documenté")}</p>
    ${control.kind === "encoder" ? `<div class="divider"></div><p class="eyebrow">CONFIGURATION ENC EXPLICITE</p><div class="form-grid"><label>ENC n<input type="number" min="1" max="128" data-encoder-field="n" value="${escapeHtml(control.encoderConfig?.n ?? "")}"></label><label>Shift register<input type="number" min="1" max="16" data-encoder-field="sr" value="${escapeHtml(control.encoderConfig?.sr ?? "")}"></label><label>Pins DIN (a:b)<input data-encoder-field="pins" placeholder="1:0" value="${escapeHtml(control.encoderConfig?.pins ?? "")}"></label><label>Type<input data-encoder-field="type" placeholder="non_detented" value="${escapeHtml(control.encoderConfig?.type ?? "")}"></label></div>` : ""}
    <div class="divider"></div><p class="eyebrow">ÉVÉNEMENT MIDI · ${escapeHtml(selectedBank?.name)}</p>
    ${control.kind === "button" ? `<label>Type d'événement<select data-assignment-field="eventType"><option value="CC" ${eventType === "CC" ? "selected" : ""}>CC</option><option value="Meta" ${eventType === "Meta" ? "selected" : ""}>Meta · RunSection</option></select></label>` : ""}
    ${eventType === "Meta" ? `<label>Commande Meta<input data-assignment-field="meta" value="${escapeHtml(assignment.meta ?? "")}" placeholder="RunSection:1"></label><p class="help-text">Commandes validées : RunSection:n, SetBank:n, IncBank, DecBank et CycleBank. Un bouton Meta utilise button_mode=OnOnly.</p>` : `<label>Message MIDI<select data-assignment-field="messageType"><option value="CC" ${messageType === "CC" ? "selected" : ""}>CC</option>${control.kind === "button" ? `<option value="NoteOn" ${messageType === "NoteOn" ? "selected" : ""}>NoteOn</option>` : ""}</select></label><div class="form-grid"><label>Canal MIDI<input type="number" min="1" max="16" data-assignment-field="channel" value="${escapeHtml(assignment.channel ?? 1)}"></label>${messageType === "NoteOn" ? `<label>Numéro de note (key)<input type="number" min="0" max="127" data-assignment-field="key" value="${escapeHtml(assignment.key ?? 60)}"></label>` : `<label>Numéro CC<input type="number" min="0" max="127" data-assignment-field="cc" value="${escapeHtml(assignment.cc ?? 1)}"></label>`}<label>Valeur min<input type="number" min="0" max="127" data-assignment-field="valueMin" value="${escapeHtml(assignment.valueMin ?? 0)}"></label><label>Valeur max<input type="number" min="0" max="127" data-assignment-field="valueMax" value="${escapeHtml(assignment.valueMax ?? 127)}"></label></div>${control.kind === "button" ? `<label>Mode du bouton<select data-assignment-field="buttonMode"><option value="OnOff" ${assignment.buttonMode === "OnOff" ? "selected" : ""}>OnOff</option><option value="OnOnly" ${assignment.buttonMode === "OnOnly" ? "selected" : ""}>OnOnly</option><option value="Toggle" ${(assignment.buttonMode ?? "Toggle") === "Toggle" ? "selected" : ""}>Toggle</option></select></label>` : ""}`}
    <label class="check-row"><input type="checkbox" data-assignment-field="bankScoped" ${assignment.bankScoped === false ? "" : "checked"}> Événement distinct dans chaque banque (#BANK)</label>
    <label>Label NGL<input data-assignment-field="label" value="${escapeHtml(assignment.label ?? control.name)}"></label>
    <div class="divider"></div><p class="eyebrow">LED RGB · DIRECTIVES OBSERVÉES</p>
    <div class="form-grid"><label>fwd_id RGBLED<input type="number" min="0" data-led-field="forwardId" value="${escapeHtml(led.forwardId ?? "")}"></label><label>rgbled_pattern observé<input type="number" min="0" max="1" data-led-field="pattern" value="${escapeHtml(led.pattern ?? "")}"></label><label>hsv événement<input data-led-field="eventHsv" placeholder="60:100:10" value="${escapeHtml(hsvText(led.eventHsv))}"></label><label>Cible NGR RGBLED<input type="number" min="1" data-led-field="scriptTargetId" value="${escapeHtml(led.scriptTargetId ?? "")}"></label><label>set_hsv section<input data-led-field="hsv" placeholder="60:100:10" value="${escapeHtml(hsvText(led.hsv))}"></label></div>
    <div class="inspector-note"><strong>Génération limitée aux directives vérifiées</strong><small>ENC et les champs LED sont générés explicitement ; les réglages non modélisés restent dans les blocs avancés.</small></div>`;
}

function renderLedEvents() {
  const list = $("#led-event-list");
  if (!list) return;
  list.innerHTML = project.ledEvents.length ? project.ledEvents.map(led =>
    `<div class="connection-row"><span class="bus-chip">RGBLED:${escapeHtml(led.id)}</span><div><strong>dimmed=${escapeHtml(led.dimmed)}</strong><small>range=${escapeHtml(led.rangeMin)}:${escapeHtml(led.rangeMax)}</small></div><button class="icon-button remove-led-event" data-led-id="${escapeHtml(led.id)}" aria-label="Supprimer la déclaration LED">×</button></div>`
  ).join("") : `<p class="muted small">Aucun EVENT_RGBLED déclaré.</p>`;
}
function renderBanks() {
  $("#bank-tabs").innerHTML = project.banks.map(bank => `<button class="bank-tab ${bank.id === selectedBankId ? "active" : ""}" data-bank="${escapeHtml(bank.id)}">${escapeHtml(bank.name)}<small>${project.controls.length} contrôles</small></button>`).join("");
  const header = `<thead><tr><th>Contrôle</th>${project.banks.map(bank => `<th>${escapeHtml(bank.name)}</th>`).join("")}</tr></thead>`;
  const body = project.controls.map(control => `<tr><td><strong>${escapeHtml(control.name)}</strong><small>${escapeHtml(control.kind)}</small></td>${project.banks.map(bank => {
    const assignment = project.assignments[bank.id]?.[control.id] ?? {};
    return `<td>${assignment.eventType === "Meta" ? escapeHtml(assignment.meta ?? "Meta") : `CC ${escapeHtml(assignment.cc ?? "—")}`}<small>${assignment.eventType === "Meta" ? "global" : `Ch ${escapeHtml(assignment.channel ?? "—")}`}</small></td>`;
  }).join("")}</tr>`).join("");
  $("#bank-matrix").innerHTML = `${header}<tbody>${body || `<tr><td colspan="${project.banks.length + 1}" class="muted">Ajoutez des modules avec des contrôles configurables.</td></tr>`}</tbody>`;
  const bank = project.banks.find(item => item.id === selectedBankId);
  const editor = $("#bank-editor");
  if (!bank) {
    editor.innerHTML = `<p class="muted">Aucune banque disponible.</p>`;
    return;
  }
  editor.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">BANQUE SÉLECTIONNÉE</p><h2>${escapeHtml(bank.name)}</h2></div><button class="danger-button delete-bank" ${project.banks.length < 2 ? "disabled" : ""}>Supprimer</button></div><label>Nom de la banque<input id="bank-name" value="${escapeHtml(bank.name)}"></label><p class="help-text">L’ordre est utilisé pour le champ bank des événements NGC. L’ajout ou suppression de banques ne prétend pas modifier votre script NGR de changement de banque.</p>`;
}

function renderGeneration() {
  const current = issues();
  const errors = current.filter(item => item.severity === "error").length;
  $("#generation-summary").textContent = errors ? `${errors} erreur${errors > 1 ? "s" : ""} bloquante${errors > 1 ? "s" : ""}` : `${current.length} avertissement${current.length === 1 ? "" : "s"} / informations`;
  $("#generation-issues").innerHTML = current.length ? current.map(item => `<div class="issue-line ${item.severity}"><span>${item.severity === "error" ? "!" : item.severity === "warning" ? "△" : "i"}</span><p><strong>${escapeHtml(item.target)}</strong><small>${escapeHtml(item.message)}</small></p></div>`).join("") : `<div class="issue-line info"><span>✓</span><p><strong>Structure cohérente</strong><small>La validation ne certifie pas la compatibilité firmware ni les connexions physiques.</small></p></div>`;
  $("#advanced-ngc").value = project.advanced.ngc;
  $("#advanced-ngr").value = project.advanced.ngr;
  $("#advanced-ngl").value = project.advanced.ngl;
  $("#hardware-summary").innerHTML = `<div><span>Cartes physiques</span><strong>${project.modules.length}</strong></div><div><span>Contrôles logiques</span><strong>${project.controls.length}</strong></div><div><span>Banques</span><strong>${project.banks.length}</strong></div><div><span>Connexions déclarées</span><strong>${project.connections.length}</strong></div><p class="help-text">Le NGR structuré est généré lorsqu'une affectation contient set_hsv ; aucun script de transition de banque complet n'est déduit.</p>`;
  renderGeneratedFiles();
}

function renderGeneratedFiles() {
  const names = Object.keys(generated);
  $("#generated-files").innerHTML = names.length ? names.map(name => `<button class="generated-file ${name === renderGeneratedFiles.active ? "selected" : ""}" data-preview="${escapeHtml(name)}"><span>▤</span><span><strong>${escapeHtml(name)}</strong><small>${generated[name].split("\n").length - 1} lignes</small></span><b>›</b></button>`).join("") : `<p class="muted small">Lancez la validation pour afficher les fichiers.</p>`;
  const previewName = generated[renderGeneratedFiles.active] ? renderGeneratedFiles.active : names[0];
  $("#file-preview")?.remove();
  if (previewName) {
    const preview = document.createElement("pre");
    preview.id = "file-preview";
    preview.className = "file-preview";
    preview.textContent = generated[previewName];
    $("#generated-files").append(preview);
  }
  $("#download-buttons").innerHTML = names.map(name => `<button class="small-button full-width download-file" data-download="${escapeHtml(name)}">Télécharger ${escapeHtml(name)}</button>`).join("");
  const diff = $("#generation-diff");
  if (diff) diff.textContent = generationDiff;
}

function renderHistory() {
  const names = Object.keys(generated);
  $("#generation-history").innerHTML = names.length ? `<div class="history-entry"><span class="history-check">✓</span><div><strong>${escapeHtml(project.metadata.name)}</strong><small>${names.map(escapeHtml).join(" · ")}</small></div></div>` : `<p class="muted small">Aucune génération effectuée dans cette session.</p>`;
}

function bindSurfaceDragging() {
  $$(".surface-card").forEach(card => {
    card.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", card.dataset.module));
    card.addEventListener("dragover", event => event.preventDefault());
    card.addEventListener("drop", event => {
      event.preventDefault();
      const movedId = event.dataTransfer.getData("text/plain");
      const moved = project.modules.find(item => item.id === movedId);
      const target = project.modules.find(item => item.id === card.dataset.module);
      if (!moved || !target || moved === target) return;
      commit(() => {
        [moved.layout.x, moved.layout.y, target.layout.x, target.layout.y] = [target.layout.x, target.layout.y, moved.layout.x, moved.layout.y];
      });
    });
  });
}

function selectOrConnectConnector(endpoint) {
  const module = project.modules.find(item => item.id === endpoint.moduleId);
  const connector = connectorFor(module?.definitionId, endpoint.connectorId);
  if (connector && !connector.interfaces.includes(connectionInterface) &&
      connector.interfaces.some(name => ["DIN-control", "DOUT-control"].includes(name))) {
    connectionInterface = connector.interfaces.find(name => ["DIN-control", "DOUT-control"].includes(name));
  }
  $("#connection-interface").value = connectionInterface;
  if (!selectedConnector) {
    renderConnectorInspector(module, connector);
    if (!connector?.interfaces.includes(connectionInterface)) {
      showToast(`${connector?.silkscreen ?? "Connecteur"} ne porte pas l’interface ${connectionInterface}; aucune liaison n’a été créée.`, true);
      return;
    }
    selectedConnector = endpoint;
    renderConnections();
    return;
  }
  if (selectedConnector.moduleId === endpoint.moduleId && selectedConnector.connectorId === endpoint.connectorId) {
    selectedConnector = null;
    renderConnections();
    return;
  }
  const forward = assessPhysicalConnection(project, catalog, selectedConnector, endpoint, connectionInterface);
  const reverse = forward.allowed ? forward : assessPhysicalConnection(project, catalog, endpoint, selectedConnector, connectionInterface);
  if (!reverse.allowed) {
    renderConnectorInspector(module, connector);
    showToast(`${reverse.reason}${reverse.source ? ` Source : ${reverse.source}.` : ""}`, true);
    return;
  }
  const selection = selectedConnector;
  selectedConnector = null;
  try {
    commit(() => connectPhysical(project, catalog, selection, endpoint, connectionInterface));
    showToast(`Liaison ${connectionInterface} documentée créée.`);
  } catch (error) {
    selectedConnector = selection;
    renderConnections();
    showToast(error.message, true);
  }
}

function updateHistoryButtons() {
  $("#undo-button").disabled = undoStack.length === 0;
  $("#redo-button").disabled = redoStack.length === 0;
}

function download(name, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-page]");
  if (nav) navigate(nav.dataset.page);
  const go = event.target.closest("[data-go]");
  if (go) navigate(go.dataset.go);
  const inspectConnector = event.target.closest("[data-inspect-module]");
  if (inspectConnector) {
    const module = project.modules.find(item => item.id === inspectConnector.dataset.inspectModule);
    const connector = connectorFor(module?.definitionId, inspectConnector.dataset.inspectConnector);
    if (connector) selectOrConnectConnector({ moduleId: module.id, connectorId: connector.id });
    else renderConnectorInspector(module, connector);
    return;
  }
  const rotateBoard = event.target.closest("[data-rotate]");
  if (rotateBoard) {
    const module = project.modules.find(item => item.id === rotateBoard.dataset.rotate);
    if (!module) return;
    commit(() => { module.rotation = ((module.rotation ?? 0) + 90) % 360; });
    return;
  }
  const connectorButton = event.target.closest("[data-connector-module]");
  if (connectorButton) {
    selectOrConnectConnector({
      moduleId: connectorButton.dataset.connectorModule,
      connectorId: connectorButton.dataset.connectorId
    });
    return;
  }
  const cancelConnection = event.target.closest("#cancel-connection");
  if (cancelConnection) {
    selectedConnector = null;
    renderConnections();
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) { activeFilter = filter.dataset.filter; renderLibrary(); }
  const add = event.target.closest("[data-add]");
  if (add) {
    const definition = catalog.find(item => item.id === add.dataset.add);
    try {
      commit(() => addModule(project, definition), "Modifications enregistrées localement");
      showToast(`${definition.name} ajouté au projet.`);
      navigate("project");
    } catch (error) { showToast(error.message, true); }
  }
  const duplicate = event.target.closest("[data-duplicate]");
  if (duplicate) {
    const source = project.modules.find(item => item.id === duplicate.dataset.duplicate);
    const definition = definitionFor(source);
    try {
      commit(() => duplicateModule(project, definition, source.id));
      showToast(`${source.name} dupliqué.`);
    } catch (error) { showToast(error.message, true); }
  }
  const remove = event.target.closest("[data-remove]");
  if (remove) commit(() => removeModule(project, remove.dataset.remove));
  const moveDin = event.target.closest(".move-din");
  if (moveDin) {
    const ordered = project.modules.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
    const index = ordered.findIndex(module => module.id === moveDin.dataset.din);
    const targetIndex = index + Number(moveDin.dataset.direction);
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const candidate = cloneProject(project);
    const candidateDin = candidate.modules.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
    [candidateDin[index].chainOrder, candidateDin[targetIndex].chainOrder] = [candidateDin[targetIndex].chainOrder, candidateDin[index].chainOrder];
    try {
      rebuildDinChain(candidate);
      commit(() => {
        candidateDin.forEach(module => {
          const original = project.modules.find(item => item.id === module.id);
          original.chainOrder = module.chainOrder;
        });
        project.connections = candidate.connections;
      });
    } catch (error) {
      showToast(error.message, true);
    }
  }
  const moduleControls = event.target.closest("[data-module-controls]");
  if (moduleControls) {
    const control = project.controls.find(item => item.moduleId === moduleControls.dataset.moduleControls);
    if (control) selectedControlId = control.id;
    navigate("controls");
    renderControls();
  }
  const control = event.target.closest("[data-control]");
  if (control) { selectedControlId = control.dataset.control; renderControls(); }
  const bank = event.target.closest("[data-bank]");
  if (bank) { selectedBankId = bank.dataset.bank; renderBanks(); renderControls(); }
  const removeConnection = event.target.closest(".remove-connection");
  if (removeConnection) commit(() => project.connections.splice(Number(removeConnection.dataset.index), 1));
  const deleteBank = event.target.closest(".delete-bank");
  if (deleteBank && project.banks.length > 1) {
    try {
      commit(() => {
        removeBank(project, selectedBankId);
        selectedBankId = project.banks[0].id;
      });
    } catch (error) {
      showToast(error.message, true);
    }
  }
  const preview = event.target.closest("[data-preview]");
  if (preview) { renderGeneratedFiles.active = preview.dataset.preview; renderGeneratedFiles(); }
  const downloadFile = event.target.closest("[data-download]");
  if (downloadFile) download(downloadFile.dataset.download, generated[downloadFile.dataset.download]);
});

$("#project-name").addEventListener("change", event => commit(() => { project.metadata.name = event.target.value.trim(); }));
$("#module-search").addEventListener("input", event => { searchText = event.target.value; renderLibrary(); });
$("#control-bank").addEventListener("change", event => { selectedBankId = event.target.value; renderControls(); });
$("#connection-interface").addEventListener("change", event => {
  connectionInterface = event.target.value;
  renderConnections();
});

$("#controller-canvas").addEventListener("change", event => {
  const instanceId = event.target.dataset.moduleName;
  if (!instanceId) return;
  const value = event.target.value.trim();
  if (!value) return renderProject();
  commit(() => { project.modules.find(module => module.id === instanceId).name = value; });
});

$("#control-inspector").addEventListener("change", event => {
  const field = event.target.dataset.controlField;
  const encoderField = event.target.dataset.encoderField;
  const assignmentField = event.target.dataset.assignmentField;
  const ledField = event.target.dataset.ledField;
  if (field) {
    const control = project.controls.find(item => item.id === event.target.dataset.controlId);
    const value = event.target.value === "" ? null : Number(event.target.value);
    commit(() => { control.hwId = value; control.hwIdSource = "manual"; });
  } else if (encoderField && selectedControlId) {
    const value = ["n", "sr"].includes(encoderField)
      ? (event.target.value === "" ? null : Number(event.target.value))
      : event.target.value.trim();
    commit(() => {
      const control = project.controls.find(item => item.id === selectedControlId);
      control.encoderConfig ??= {};
      control.encoderConfig[encoderField] = value;
    });
  } else if (assignmentField && selectedControlId) {
    const value = assignmentField === "bankScoped"
      ? event.target.checked
      : event.target.type === "number" ? Number(event.target.value) : event.target.value;
    commit(() => {
      const assignment = project.assignments[selectedBankId][selectedControlId];
      assignment[assignmentField] = value;
      if (assignmentField === "eventType" && value === "Meta") {
        assignment.bankScoped = false;
        assignment.buttonMode = "OnOnly";
        assignment.meta ||= `RunSection:${project.banks.find(bank => bank.id === selectedBankId)?.order ?? 1}`;
      }
    });
  } else if (ledField && selectedControlId) {
    let value;
    if (["forwardId", "pattern", "scriptTargetId"].includes(ledField)) {
      value = event.target.value === "" ? null : Number(event.target.value);
    } else if (["eventHsv", "hsv"].includes(ledField)) {
      value = event.target.value.trim() === "" ? null : event.target.value.split(":").map(Number);
    }
    commit(() => { project.assignments[selectedBankId][selectedControlId].led[ledField] = value; });
  }
});

$("#add-led-event").addEventListener("click", () => {
  const led = {
    id: Number($("#led-event-id").value),
    dimmed: Number($("#led-event-dimmed").value),
    rangeMin: Number($("#led-event-range-min").value),
    rangeMax: Number($("#led-event-range-max").value)
  };
  if (!Number.isSafeInteger(led.id) || led.id < 1 ||
      !Number.isInteger(led.dimmed) || led.dimmed < 0 || led.dimmed > 127 ||
      !Number.isInteger(led.rangeMin) || led.rangeMin < 0 || led.rangeMin > 127 ||
      !Number.isInteger(led.rangeMax) || led.rangeMax < led.rangeMin || led.rangeMax > 127) {
    return showToast("Vérifiez l'identifiant et les valeurs dimmed/range.", true);
  }
  if (project.ledEvents.some(item => item.id === led.id)) return showToast("Cet identifiant EVENT_RGBLED existe déjà.", true);
  commit(() => project.ledEvents.push(led));
  $("#led-event-id").value = "";
});

$("#led-event-list").addEventListener("click", event => {
  const button = event.target.closest(".remove-led-event");
  if (!button) return;
  const id = Number(button.dataset.ledId);
  commit(() => { project.ledEvents = project.ledEvents.filter(led => led.id !== id); });
});

$("#build-din-chain").addEventListener("click", () => {
  const core = project.modules.find(module => module.definitionId === "core32f4");
  const din = project.modules.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  if (!core) return showToast("Ajoutez le Core32F4 avant de créer la chaîne.", true);
  if (!din.length) return showToast("Aucune carte DIN4_R5_KS n’est présente.", true);
  const candidate = cloneProject(project);
  try {
    rebuildDinChain(candidate);
    commit(() => { project.connections = candidate.connections; });
    showToast("Chaîne DIN documentée ajoutée; le plan montre chaque extrémité. Vérifiez le câblage réel.");
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#zoom-in").addEventListener("click", () => { zoom = Math.min(140, zoom + 10); $("#zoom-label").textContent = `${zoom}%`; $("#hardware-diagram").style.setProperty("--zoom", `${zoom / 100}`); });
$("#zoom-out").addEventListener("click", () => { zoom = Math.max(70, zoom - 10); $("#zoom-label").textContent = `${zoom}%`; $("#hardware-diagram").style.setProperty("--zoom", `${zoom / 100}`); });
$("#arrange-modules").addEventListener("click", () => commit(() => project.modules.forEach((module, index) => { module.layout.x = 30 + (index % 3) * 220; module.layout.y = 35 + Math.floor(index / 3) * 145; })));
$("#add-bank").addEventListener("click", () => commit(() => { selectedBankId = addBank(project).id; }));
$("#bank-editor").addEventListener("change", event => {
  if (event.target.id === "bank-name") commit(() => { project.banks.find(bank => bank.id === selectedBankId).name = event.target.value.trim(); });
});

for (const id of ["advanced-ngc", "advanced-ngr", "advanced-ngl"]) {
  $( `#${id}`).addEventListener("change", event => {
    const key = id.slice("advanced-".length).toLowerCase();
    commit(() => { project.advanced[key] = event.target.value; });
    renderGeneration();
  });
}

$("#run-generation").addEventListener("click", () => {
  const result = generateFiles(project, catalog);
  generationDiff = Object.keys(generated).length
    ? createGenerationDiff(generated, result.files)
    : "Première génération : les fichiers générés sont prévisualisés avant tout téléchargement.";
  generated = result.files;
  renderGeneration();
  renderHistory();
  if (Object.keys(generated).length) showToast(`${Object.keys(generated).length} fichier(s) prêt(s) au téléchargement.`);
  else showToast("La génération est bloquée par des erreurs.", true);
});
$("#validate-button").addEventListener("click", renderGeneration);
$("#save-project").addEventListener("click", () => download(`${project.metadata.name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "ModulBox"}.json`, JSON.stringify(project, null, 2), "application/json"));
$("#save-project-secondary").addEventListener("click", () => $("#save-project").click());
$("#load-project-button").addEventListener("click", () => $("#load-project-input").click());
$("#load-project-input").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const loaded = JSON.parse(await file.text());
    if (loaded.schemaVersion !== 1 || !Array.isArray(loaded.modules) || !Array.isArray(loaded.banks)) throw new Error("Le fichier ne correspond pas au format de projet v1.");
    const candidate = normalizeProject(loaded);
    const connectionErrors = validateProject(candidate, catalog).filter(issue =>
      issue.severity === "error" &&
      (issue.message.includes("Liaison physique refusée") ||
       issue.message.includes("Les extrémités ne respectent pas") ||
       issue.message.includes("Connexion dupliquée.") ||
       issue.message.includes("La connexion référence un module absent"))
    );
    if (connectionErrors.length) {
      throw new Error(`Le projet contient une ou plusieurs liaisons physiques refusées : ${connectionErrors.map(issue => issue.message).join(" ")}`);
    }
    undoStack.push(cloneProject(project));
    project = candidate;
    selectedBankId = project.banks[0]?.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    renderAll();
    showToast("Projet chargé.");
  } catch (error) { showToast(`Impossible de charger le projet : ${error.message}`, true); }
  event.target.value = "";
});

$("#import-config-button").addEventListener("click", () => $("#import-config-input").click());
$("#import-config-input").addEventListener("change", async event => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    const imported = await prepareConfigurationImport(files);
    const candidate = cloneProject(project);
    candidate.advanced = mergeConfigurationImport(candidate.advanced, imported);
    const reconstruction = imported.ngc
      ? reconstructNgcHardware(candidate, catalog, candidate.advanced.ngc)
      : { created: [], warnings: [], parsed: { events: [], encoders: [] } };
    commit(() => {
      project = candidate;
    }, "Directives importées et conservées");
    navigate(imported.ngc ? "hardware" : "generate");
    const summary = Object.keys(imported).map(extension => extension.toUpperCase()).join(" / ");
    const inferred = reconstruction.created.length
      ? ` ${reconstruction.created.length} carte(s) ajoutée(s), avec ${candidate.connections.length} liaison(s) documentée(s).`
      : imported.ngc && reconstruction.parsed.events.length + reconstruction.parsed.encoders.length
        ? " Topologie matérielle déjà présente dans le projet."
        : "";
    const warnings = reconstruction.warnings.length
      ? ` À vérifier : ${reconstruction.warnings.join(" ")}`
      : "";
    showToast(`${files.length} fichier(s) importé(s) (${summary}); directives préservées.${inferred}${warnings}`, reconstruction.warnings.length > 0);
  } catch (error) { showToast(error.message, true); }
  event.target.value = "";
});

$("#undo-button").addEventListener("click", () => {
  if (!undoStack.length) return;
  redoStack.push(cloneProject(project));
  project = undoStack.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  renderAll();
  updateHistoryButtons();
});
$("#redo-button").addEventListener("click", () => {
  if (!redoStack.length) return;
  undoStack.push(cloneProject(project));
  project = redoStack.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  renderAll();
  updateHistoryButtons();
});
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) $("#redo-button").click();
    else $("#undo-button").click();
  }
});
