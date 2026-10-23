export const PROJECT_VERSION = 1;

export function createProject(name = "Nouveau contrôleur") {
  return {
    schemaVersion: PROJECT_VERSION,
    metadata: { name, createdAt: new Date().toISOString() },
    modules: [],
    connections: [],
    controls: [],
    banks: [{ id: "bank-1", name: "Banque 1", order: 1 }],
    assignments: {},
    ledEvents: [],
    advanced: { ngc: "", ngr: "", ngl: "" }
  };
}

export function cloneProject(project) {
  return structuredClone(project);
}

export function appendAdvancedText(existing, imported) {
  if (!existing) return imported;
  if (!imported) return existing;
  const importedAt = existing.indexOf(imported);
  if (importedAt >= 0 &&
      (importedAt === 0 || existing[importedAt - 1] === "\n") &&
      (importedAt + imported.length === existing.length ||
       existing[importedAt + imported.length] === "\n" ||
       imported.endsWith("\n"))) {
    return existing;
  }
  return `${existing}${existing.endsWith("\n") ? "" : "\n"}${imported}`;
}

export function nextHardwareId(project, kind, preferredStart = 1) {
  const used = new Set(project.controls.filter(c => c.kind === kind).map(c => c.hwId).filter(Number.isInteger));
  let candidate = preferredStart;
  while (candidate <= 255 && used.has(candidate)) candidate++;
  return candidate <= 255 ? candidate : null;
}

export function addModule(project, definition) {
  const count = project.modules.filter(module => module.definitionId === definition.id).length;
  if (definition.maxInstances != null && count >= definition.maxInstances) {
    throw new Error(`${definition.name} est limité à ${definition.maxInstances} instance(s).`);
  }

  let ordinal = 1;
  while (project.modules.some(module => module.id === `${definition.id}-${ordinal}`)) ordinal++;
  const instanceId = `${definition.id}-${ordinal}`;
  const module = {
    id: instanceId,
    definitionId: definition.id,
    name: `${definition.name} ${ordinal}`,
    layout: { x: 80 + (count % 3) * 220, y: 80 + Math.floor(count / 3) * 150 },
    wiringLayout: { x: 80 + project.modules.length * 280, y: 80 },
    rotation: 0,
    chainOrder: Math.max(0, ...project.modules.map(item => item.chainOrder ?? 0)) + 1
  };
  project.modules.push(module);

  for (const template of definition.controls) {
    for (let index = 1; index <= template.count; index++) {
      const controlId = `${instanceId}-${template.prefix.toLowerCase()}-${index}`;
      const control = {
        id: controlId,
        moduleId: instanceId,
        name: `${template.prefix} ${index}`,
        kind: template.kind,
        hwId: null,
        hwIdSource: "unassigned",
        physical: structuredClone(template.resources?.[index - 1] ?? null)
      };
      project.controls.push(control);
      for (const bank of project.banks) {
        project.assignments[bank.id] ??= {};
        project.assignments[bank.id][controlId] = {
          eventId: null,
          channel: 1,
          cc: project.controls.length % 128,
          valueMin: 0,
          valueMax: 127,
          buttonMode: "Toggle",
          label: control.name,
          eventType: "CC",
          bankScoped: true,
          led: { forwardId: null, pattern: null, scriptTargetId: null, eventHsv: null, hsv: null }
        };
      }
    }
  }
  return module;
}

export function duplicateModule(project, definition, sourceId) {
  const source = project.modules.find(module => module.id === sourceId);
  if (!source) throw new Error("Le module source est introuvable.");
  const duplicate = addModule(project, definition);
  duplicate.name = `${source.name} (copie)`;
  duplicate.layout = { x: (Number(source.layout?.x) || 0) + 30, y: (Number(source.layout?.y) || 0) + 30 };
  duplicate.wiringLayout = { x: (Number(source.wiringLayout?.x) || 0) + 280, y: Number(source.wiringLayout?.y) || 0 };

  const sourceControls = project.controls.filter(control => control.moduleId === sourceId);
  const duplicateControls = project.controls.filter(control => control.moduleId === duplicate.id);
  sourceControls.forEach((control, index) => {
    const copy = duplicateControls[index];
    if (!copy) return;
    copy.name = control.name;
    copy.hwId = null;
    copy.hwIdSource = "unassigned";
    copy.physical = structuredClone(control.physical ?? null);
    for (const bank of project.banks) {
      const assignment = project.assignments[bank.id]?.[control.id];
      if (assignment) project.assignments[bank.id][copy.id] = structuredClone(assignment);
    }
  });
  return duplicate;
}

export function removeModule(project, instanceId) {
  project.modules = project.modules.filter(module => module.id !== instanceId);
  const removedControls = project.controls.filter(control => control.moduleId === instanceId).map(control => control.id);
  project.controls = project.controls.filter(control => control.moduleId !== instanceId);
  project.connections = project.connections.filter(connection =>
    connection.from !== instanceId && connection.to !== instanceId &&
    connection.fromModuleId !== instanceId && connection.toModuleId !== instanceId
  );
  for (const bank of Object.values(project.assignments)) {
    for (const controlId of removedControls) delete bank[controlId];
  }
}

export function removeBank(project, bankId) {
  if (project.banks.length <= 1) throw new Error("Le projet doit conserver au moins une banque.");
  const bank = project.banks.find(item => item.id === bankId);
  if (!bank) throw new Error("La banque à supprimer est introuvable.");
  const referenced = Object.values(project.assignments ?? {}).some(assignments =>
    Object.values(assignments ?? {}).some(assignment =>
      assignment?.eventType === "Meta" && assignment.meta === `SetBank:${bank.order}`
    )
  );
  if (referenced) throw new Error(`La banque ${bank.order} est référencée par un événement Meta SetBank.`);
  project.banks = project.banks.filter(item => item.id !== bankId);
  delete project.assignments[bankId];
}

export function addBank(project) {
  const index = Math.max(0, ...project.banks.map(bank => bank.order ?? 0)) + 1;
  const bank = { id: `bank-${Date.now()}-${index}`, name: `Banque ${index}`, order: index };
  project.banks.push(bank);
  project.assignments[bank.id] = {};
  for (const control of project.controls) {
    const previous = project.assignments[project.banks.at(-2)?.id]?.[control.id];
    const assignment = previous ? structuredClone(previous) : {
      eventId: null,
      channel: 1,
      cc: 1,
      valueMin: 0,
      valueMax: 127,
      buttonMode: "Toggle",
      label: control.name,
      eventType: "CC",
      bankScoped: true,
      led: { forwardId: null, pattern: null, scriptTargetId: null, eventHsv: null, hsv: null }
    };
    if (assignment.eventType === "Meta") {
      assignment.eventType = "CC";
      assignment.bankScoped = true;
      assignment.buttonMode = "Toggle";
      delete assignment.meta;
    }
    project.assignments[bank.id][control.id] = assignment;
  }
  return bank;
}
