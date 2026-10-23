import { loadCatalog } from "./catalog.js";
import { addBank, addModule, appendAdvancedText, cloneProject, createProject, duplicateModule, removeBank, removeModule } from "./model.js";
import { generateFiles } from "./generator.js";
import { validateProject } from "./validate.js";
import { createGenerationDiff } from "./diff.js";

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

function connectionRole(bus, fromDefinition, toDefinition) {
  return (bus === "DIN" && ["core32f4", "din4"].includes(fromDefinition?.id) && toDefinition?.id === "din4") ||
    (bus === "DOUT" && ["core32f4", "dout"].includes(fromDefinition?.id) && toDefinition?.id === "dout")
    ? "chain"
    : "peripheral";
}

function connectionPorts(definition, bus, role, side) {
  let ports = definition?.ports?.filter(port => port.buses.includes(bus)) ?? [];
  if (role === "chain") {
    const direction = side === "from" ? "output" : "input";
    ports = ports.filter(port => port.usage === "chain" && port.direction === direction);
  } else if (ports.some(port => port.usage === "control")) {
    ports = ports.filter(port => port.usage === "control");
  } else {
    ports = ports.filter(port => port.usage === "bus");
  }
  return ports;
}

function defaultPort(definition, bus, role, side) {
  const candidates = connectionPorts(definition, bus, role, side);
  if (candidates.length > 1) {
    const directed = candidates.filter(port => port.direction === (side === "from" ? "output" : "input"));
    if (directed.length === 1) return directed[0].id;
  }
  return candidates.length === 1 ? candidates[0].id : "";
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
  for (const connection of value.connections) {
    const source = value.modules.find(module => module.id === connection.from);
    if (source?.definitionId === "core32f4" && connection.fromPort === "J8J9") {
      connection.fromPort = connection.bus === "DIN" ? "J9" : connection.bus === "DOUT" ? "J8" : connection.fromPort;
    }
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
  return value;
}

function rebuildDinChain() {
  const core = project.modules.find(module => module.definitionId === "core32f4");
  if (!core) return false;
  const din = project.modules.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  project.connections = project.connections.filter(connection => !(connection.bus === "DIN" && connection.role === "chain"));
  const ordered = [core, ...din];
  ordered.slice(0, -1).forEach((module, index) => {
    const next = ordered[index + 1];
    project.connections.push({
      from: module.id,
      to: next.id,
      bus: "DIN",
      role: "chain",
      fromPort: module.definitionId === "core32f4" ? "J9" : "J2",
      toPort: "J1"
    });
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

function renderConnections() {
  const instances = project.modules;
  const options = instances.map(module => `<option value="${escapeHtml(module.id)}">${escapeHtml(module.name)} — ${escapeHtml(definitionFor(module)?.name)}</option>`).join("");
  $("#connection-from").innerHTML = options;
  $("#connection-to").innerHTML = options;
  refreshConnectionPortChoices();
  const links = project.connections.length ? project.connections.map((connection, index) => {
    const from = instances.find(module => module.id === connection.from);
    const to = instances.find(module => module.id === connection.to);
    return `<div class="connection-row"><span class="bus-chip">${escapeHtml(connection.bus)}</span><div><strong>${escapeHtml(from?.name ?? connection.from)} → ${escapeHtml(to?.name ?? connection.to)}</strong><small>${escapeHtml(connection.fromPort ?? "")} → ${escapeHtml(connection.toPort ?? "")}</small></div><button class="icon-button remove-connection" data-index="${index}" aria-label="Supprimer la liaison">×</button></div>`;
  }).join("") : `<p class="muted small">Aucune liaison déclarée. Les cartes visibles ne sont pas présumées connectées.</p>`;
  const dinModules = instances.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  const chainOrder = dinModules.length ? `<div class="din-order"><p class="eyebrow">ORDRE DES CARTES DIN</p>${dinModules.map((module, index) => `<div class="din-order-row"><span>${index + 1}</span><strong>${escapeHtml(module.name)}</strong><button class="icon-button move-din" data-din="${escapeHtml(module.id)}" data-direction="-1" aria-label="Monter" ${index === 0 ? "disabled" : ""}>↑</button><button class="icon-button move-din" data-din="${escapeHtml(module.id)}" data-direction="1" aria-label="Descendre" ${index === dinModules.length - 1 ? "disabled" : ""}>↓</button></div>`).join("")}<small>Modifier l’ordre met à jour la chaîne DIN déclarée.</small></div>` : "";
  $("#connection-list").innerHTML = `${links}${chainOrder}`;

  const diagram = $("#hardware-diagram");
  const core = instances.filter(module => module.definitionId === "core32f4");
  const din = instances.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  const other = instances.filter(module => !["core32f4", "din4"].includes(module.definitionId));
  const order = [...core, ...din, ...other];
  diagram.style.setProperty("--zoom", `${zoom / 100}`);
  if (!order.length) {
    diagram.innerHTML = `<div class="canvas-empty"><span>⌘</span><h3>Aucune carte à afficher</h3><p>Ajoutez des modules avant de définir le diagramme.</p></div>`;
    return;
  }
  const nodes = order.map((module, index) => {
    const def = definitionFor(module);
    const connectedIn = project.connections.some(connection => connection.to === module.id);
    const connectedOut = project.connections.some(connection => connection.from === module.id);
    const connectedPorts = project.connections.filter(connection => connection.from === module.id || connection.to === module.id).map(connection => {
      const outgoing = connection.from === module.id;
      const peer = project.modules.find(item => item.id === (outgoing ? connection.to : connection.from));
      return `<small>${outgoing ? "→" : "←"} ${escapeHtml(connection.bus)} ${escapeHtml(peer?.name ?? "module")} · ${escapeHtml(connection.fromPort ?? "port ?")} → ${escapeHtml(connection.toPort ?? "port ?")}</small>`;
    });
    const node = `<div class="diagram-node ${module.definitionId === "core32f4" ? "core-node" : ""}"><span class="node-dot"></span><small>${escapeHtml(def?.category)}</small><strong>${escapeHtml(module.name)}</strong><span class="node-buses">${def?.buses.map(bus => `<i>${escapeHtml(bus)}</i>`).join("")}</span><div class="node-ports"><span>${connectedIn ? "IN ●" : "IN ○"}</span><span>${connectedOut ? "OUT ●" : "OUT ○"}</span></div><div class="node-connections">${connectedPorts.length ? connectedPorts.join("") : "<small>Aucune liaison</small>"}</div></div>`;
    const next = order[index + 1];
    const connected = next && project.connections.some(connection => connection.from === module.id && connection.to === next.id);
    const link = next ? `<div class="diagram-link ${connected ? "connected" : ""}"><span>⇢</span></div>` : "";
    return node + link;
  }).join("");
  diagram.innerHTML = `<div class="diagram-canvas">${nodes}</div><p class="diagram-caption">Les connecteurs et bus listés dans chaque carte sont les liaisons déclarées. Les flèches entre cartes voisines ne représentent que la disposition visuelle.</p>`;
}

function refreshConnectionPortChoices() {
  const fromDefinition = definitionFor(project.modules.find(module => module.id === $("#connection-from").value));
  const toDefinition = definitionFor(project.modules.find(module => module.id === $("#connection-to").value));
  const bus = $("#connection-bus").value;
  const role = connectionRole(bus, fromDefinition, toDefinition);
  for (const [side, definition, selector] of [
    ["from", fromDefinition, "#connection-from-port"],
    ["to", toDefinition, "#connection-to-port"]
  ]) {
    const ports = connectionPorts(definition, bus, role, side);
    const select = $(selector);
    select.innerHTML = `<option value="">— Connecteur à préciser —</option>${ports.map(port => `<option value="${escapeHtml(port.id)}">${escapeHtml(port.id)}</option>`).join("")}`;
    select.value = defaultPort(definition, bus, role, side);
  }
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
    commit(() => {
      [ordered[index].chainOrder, ordered[targetIndex].chainOrder] = [ordered[targetIndex].chainOrder, ordered[index].chainOrder];
      rebuildDinChain();
    });
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

$("#add-connection").addEventListener("click", () => {
  const from = $("#connection-from").value;
  const to = $("#connection-to").value;
  const bus = $("#connection-bus").value;
  if (!from || !to || from === to) return showToast("Choisissez deux modules différents.", true);
  if (project.connections.some(item => item.from === from && item.to === to && item.bus === bus)) return showToast("Cette liaison existe déjà.", true);
  const fromDef = definitionFor(project.modules.find(item => item.id === from));
  const toDef = definitionFor(project.modules.find(item => item.id === to));
  if (!fromDef?.buses.includes(bus) || !toDef?.buses.includes(bus)) return showToast(`Le bus ${bus} n’est pas déclaré par les deux modules.`, true);
  const role = connectionRole(bus, fromDef, toDef);
  commit(() => project.connections.push({
    from,
    to,
    bus,
    role,
    fromPort: $("#connection-from-port").value,
    toPort: $("#connection-to-port").value
  }));
});

for (const selector of ["#connection-bus", "#connection-from", "#connection-to"]) {
  $(selector).addEventListener("change", refreshConnectionPortChoices);
}

$("#build-din-chain").addEventListener("click", () => {
  const core = project.modules.find(module => module.definitionId === "core32f4");
  const din = project.modules.filter(module => module.definitionId === "din4").sort((a, b) => a.chainOrder - b.chainOrder);
  if (!core) return showToast("Ajoutez le Core32F4 avant de créer la chaîne.", true);
  if (!din.length) return showToast("Aucune carte DIN4_R5_KS n’est présente.", true);
  commit(() => rebuildDinChain());
  showToast("Chaîne DIN ajoutée d’après la documentation. Vérifiez le câblage réel.");
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
    undoStack.push(cloneProject(project));
    project = normalizeProject(loaded);
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
    const imported = {};
    for (const file of files) {
      const extension = file.name.split(".").pop().toLowerCase();
      if (!["ngc", "ngr", "ngl"].includes(extension)) throw new Error(`${file.name} n’est pas un fichier NGC, NGR ou NGL.`);
      imported[extension] = await file.text();
    }
    commit(() => {
      for (const [extension, content] of Object.entries(imported)) {
        project.advanced[extension] = appendAdvancedText(project.advanced[extension], content);
      }
    }, "Directives importées et conservées");
    showToast(`${files.length} fichier(s) ajouté(s) sans remplacer les blocs avancés existants.`);
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
