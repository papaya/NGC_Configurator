const directives = { encoder: 'EVENT_ENC', button: 'EVENT_BUTTON', analog: 'EVENT_AINSER' };

function manualEventIds(project) {
  const ids = new Set();
  for (const line of (project.advanced?.ngc ?? '').split(/\r?\n/)) {
    if (!/^\s*EVENT_\w+\b/.test(line)) continue;
    const match = line.match(/\bid\s*=\s*["']?(\d+)/);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
}

export function planNgcEvents(project) {
  const orderedBanks = [...(project.banks ?? [])].sort((a, b) => a.order - b.order);
  const controls = project.controls ?? [];
  const candidates = [];
  const firstBank = orderedBanks[0];
  if (firstBank) {
    for (const control of controls) {
      const assignment = project.assignments?.[firstBank.id]?.[control.id];
      if (assignment?.bankScoped === false) {
        candidates.push({
          control,
          assignment,
          bank: firstBank,
          directive: directives[control.kind],
        });
      }
    }
  }
  for (const bank of orderedBanks) {
    for (const control of controls) {
      const assignment = project.assignments?.[bank.id]?.[control.id];
      if (assignment && assignment.bankScoped !== false) {
        candidates.push({ control, assignment, bank, directive: directives[control.kind] });
      }
    }
  }

  const events = candidates.filter(
    (event) =>
      event.directive &&
      Number.isInteger(event.control.hwId) &&
      event.control.hwId >= 1 &&
      event.control.hwId <= 255
  );
  const occupied = manualEventIds(project);
  for (const led of project.ledEvents ?? []) {
    if (Number.isInteger(led.id)) occupied.add(led.id);
  }
  for (const event of events) {
    if (Number.isInteger(event.assignment.eventId)) occupied.add(event.assignment.eventId);
  }
  let nextId = 1;
  for (const event of events) {
    if (Number.isInteger(event.assignment.eventId)) {
      event.eventId = event.assignment.eventId;
      continue;
    }
    while (occupied.has(nextId)) nextId++;
    event.eventId = nextId;
    occupied.add(nextId++);
  }
  return events;
}
