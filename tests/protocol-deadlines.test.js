const assert = require("node:assert/strict");
const test = require("node:test");
const { movementDeadlineStatuses } = require("../src/core");

function movementRows(...movements) {
  return [
    ["MOVIMENTAÇÃO", "DATA"],
    ...movements.map(([movement, date]) => [movement, date])
  ];
}

function autuations(...rows) {
  return Object.fromEntries(rows.map(([rowIndex, movement, autuadoEm]) => [
    String(rowIndex),
    { movement, autuadoEm }
  ]));
}

test("Prenotado establishes a 20-business-day baseline and ordinary movements keep it", () => {
  const rows = movementRows(
    ["Prenotado", "09/11/2026"],
    ["Arquivos Compatíveis", "10/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations([1, "Prenotado", "2026-11-09T12:00:00.000Z"]),
    "2026-11-09"
  );

  assert.deepEqual(statuses["1"], {
    kind: "deadline",
    type: "Prenotação",
    startDate: "09/11/2026",
    dueDate: "07/12/2026",
    expired: false,
    daysRemaining: 20,
    overdueBusinessDays: 0,
    totalCalendarDays: 28,
    daysRemainingCalendar: 28,
    overdueCalendarDays: 0,
    urgency: "green"
  });
  assert.equal(statuses["2"].dueDate, "07/12/2026");
});

test("calendar countdown changes urgency after each third of the total deadline", () => {
  const rows = movementRows(["Prenotado", "09/11/2026"]);
  const autuation = autuations([1, "Prenotado", "2026-11-09"]);

  assert.equal(movementDeadlineStatuses(rows, autuation, "2026-11-18")["1"].urgency, "green");
  assert.equal(movementDeadlineStatuses(rows, autuation, "2026-11-19")["1"].urgency, "yellow");
  assert.equal(movementDeadlineStatuses(rows, autuation, "2026-11-28")["1"].urgency, "red");
});

test("the verification warning remains through ordinary movements after the deadline expires", () => {
  const rows = movementRows(
    ["Prenotado", "09/11/2026"],
    ["Arquivos Compatíveis", "10/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations([1, "Prenotado", "2026-11-09"]),
    "2026-12-08"
  );

  assert.equal(statuses["1"].expired, true);
  assert.equal(statuses["2"].expired, true);
  assert.equal(statuses["2"].overdueBusinessDays, 1);
});

test("Intimado counts 15 business days beginning the next day and replaces the baseline", () => {
  const rows = movementRows(
    ["Prenotado", "02/11/2026"],
    ["Intimado", "06/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations([1, "Prenotado", "2026-11-02"], [2, "Intimado", "2026-11-06"]),
    "2026-11-09"
  );

  assert.equal(statuses["1"], undefined);
  assert.equal(statuses["2"].type, "Intimação");
  assert.equal(statuses["2"].dueDate, "27/11/2026");
  assert.equal(statuses["2"].daysRemaining, 14);
  assert.equal(movementDeadlineStatuses(rows, autuations([2, "Intimado", "2026-11-06"]), "2026-11-27")["2"].expired, true);
});

test("Transcurso de Prazo replaces Intimado with a new 30-business-day deadline", () => {
  const rows = movementRows(
    ["Intimado", "02/11/2026"],
    ["Transcurso de Prazo (Purga de Mora)", "09/11/2026"],
    ["Requerimento Consolidação", "10/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations(
      [1, "Intimado", "2026-11-02"],
      [2, "Transcurso de Prazo (Purga de Mora)", "2026-11-09"]
    ),
    "2026-11-10"
  );

  assert.equal(statuses["1"], undefined);
  assert.equal(statuses["2"].type, "Transcurso de Prazo");
  assert.equal(statuses["2"].dueDate, "21/12/2026");
  assert.equal(statuses["3"].dueDate, "21/12/2026");
});

test("Consolidação ends the Transcurso de Prazo countdown", () => {
  const rows = movementRows(
    ["Intimado", "02/11/2026"],
    ["Transcurso de Prazo (Consolidação)", "09/11/2026"],
    ["Consolidação", "10/11/2026"],
    ["Arquivamento", "11/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations(
      [1, "Intimado", "2026-11-02"],
      [2, "Transcurso de Prazo (Consolidação)", "2026-11-09"],
      [3, "Consolidação", "2026-11-10"],
      [4, "Arquivamento", "2026-11-11"]
    ),
    "2026-11-12"
  );

  assert.deepEqual(statuses, {});
});

test("Desistência ends any active deadline", () => {
  const rows = movementRows(
    ["Exigência", "09/11/2026"],
    ["Desistência", "10/11/2026"],
    ["Juntada de Documentos", "11/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations(
      [1, "Exigência", "2026-11-09"],
      [2, "Desistência", "2026-11-10"],
      [3, "Juntada de Documentos", "2026-11-11"]
    ),
    "2026-11-12"
  );

  assert.deepEqual(statuses, {});
});

test("Exigência gets 30 business days, then compliance changes the status to pending response", () => {
  const rows = movementRows(
    ["Exigência", "09/11/2026"],
    ["Exigência Cumprida", "10/11/2026"],
    ["Juntada de Documentos", "11/11/2026"]
  );
  const onlyRequirement = movementDeadlineStatuses(
    rows,
    autuations([1, "Exigência", "2026-11-09"]),
    "2026-12-22"
  );
  assert.equal(onlyRequirement["1"].expired, true);
  assert.equal(onlyRequirement["1"].dueDate, "21/12/2026");

  const afterCompliance = movementDeadlineStatuses(
    rows,
    autuations([1, "Exigência", "2026-11-09"], [2, "Exigência Cumprida", "2026-11-10"]),
    "2027-01-04"
  );
  assert.deepEqual(afterCompliance["2"], { kind: "pending-response", label: "Pendente de resposta" });
  assert.deepEqual(afterCompliance["3"], { kind: "pending-response", label: "Pendente de resposta" });
});

test("a later deadline-triggering movement replaces pending response, while an unautuated movement does not", () => {
  const rows = movementRows(
    ["Exigência Cumprida", "02/11/2026"],
    ["Arquivamento", "03/11/2026"],
    ["Intimado", "06/11/2026"]
  );
  const statuses = movementDeadlineStatuses(
    rows,
    autuations([1, "Exigência Cumprida", "2026-11-02"], [3, "Intimado", "2026-11-06"]),
    "2026-11-09"
  );

  assert.equal(statuses["1"], undefined);
  assert.equal(statuses["2"], undefined);
  assert.equal(statuses["3"].type, "Intimação");
  assert.equal(statuses["3"].dueDate, "27/11/2026");
});

test("invalid dates and non-autuated deadline rows do not start a deadline", () => {
  const rows = movementRows(["Prenotado", "31/02/2026"], ["Exigência", "09/11/2026"]);
  const statuses = movementDeadlineStatuses(
    rows,
    autuations([2, "Exigência", "2026-11-09"]),
    "2026-11-09"
  );

  assert.equal(statuses["1"], undefined);
  assert.equal(statuses["2"].dueDate, "21/12/2026");
});
