/**
 * Dummy data for real MCP Workin tests (dev databases only).
 *
 * Seeds db_attendance for company c8f745e0 (10-21 November 2026): one dummy shift type, shift
 * assignments, attendances and attendance requests for 8 active employees with fixed patterns
 * (on time, often late, leave, absent, WFH, not checked in today). Every row is recorded in a
 * manifest so `--cleanup` removes exactly what was inserted. Attendances also carry
 * client_reference_id = 'dummy-mcp:<row id>'.
 *
 *   cd D:/Development/App/service_attendance
 *   NODE_ENV=development node <path>/workin-dummy-seed.cjs <employees.json> <manifest.json>
 *   NODE_ENV=development node <path>/workin-dummy-seed.cjs --cleanup <manifest.json>
 *
 * employees.json: [{ "id", "fullname", "code" }, ...] (7 employees; Ardi Mahendra is added first).
 * Must run from the service_attendance folder (uses its ./models and config).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { sequelize } = require(path.join(process.cwd(), "models"));
const COMPANY = "c8f745e0-aa6e-458b-bb70-4dda3e2accea";
const ARDI = { id: "c0c82cb7-97d6-45c2-a1b4-41b45ab6c169", fullname: "Ardi Mahendra", code: "D-0005" };
const TAG = "dummy-mcp";
const WEEKS = [["2026-11-10", "2026-11-14"], ["2026-11-17", "2026-11-21"]];
const PAST_DAYS = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-17"];
const TODAY = "2026-11-17";
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const uuid = () => crypto.randomUUID();

/** Per employee index: what happens on a given day. */
function dayPlan(index, date) {
  const today = date === TODAY;
  const plans = [
    () => (date === "2026-11-12" ? { in: "08:25", late: 25 } : { in: "07:55" }),                     // Ardi: on time, once late
    () => ({ in: `08:${30 + (PAST_DAYS.indexOf(date) * 3) % 15}`, late: 30 + (PAST_DAYS.indexOf(date) * 3) % 15 }), // often late
    () => (["2026-11-13", "2026-11-14"].includes(date) ? { status: "leave", reason: "Cuti tahunan" } : { in: "07:50" }),
    () => (date === "2026-11-11" ? { status: "absent" } : today ? null : { in: "07:58" }),             // absent once, not in today
    () => (date === "2026-11-12" ? { status: "wfh", in: "08:00", reason: "Work from home" } : { in: "08:05" }),
    () => (today ? null : { in: "07:45" }),                                                         // not checked in today
    () => ({ in: "07:58" }),
    () => (today ? { in: "08:16", late: 16 } : { in: "07:59" }),
  ];
  return plans[index]();
}

function attendanceRow(employee, date, plan, assignmentId) {
  const done = date !== TODAY;
  const present = !plan.status || plan.status === "wfh";
  const reason = plan.reason || null;
  const id = uuid();
  return {
    id, company_id: COMPANY, employee_id: employee.id,
    log_type: done ? "out" : "in",
    time_in: present && plan.in ? `${plan.in}:00` : null,
    time_out: present && done ? "17:05:00" : null,
    checkin_status: plan.late ? String(plan.late) : "",
    attendance_status: plan.status || "present",
    attendance_date: date, reason, explanation: reason,
    shift_assigment_id: assignmentId, status: "approved", createdAt: now(), updatedAt: now(),
    client_reference_id: `${TAG}:${id}`, // unique per row; find all with LIKE 'dummy-mcp:%'
  };
}

async function insert(table, rows, transaction) {
  if (rows.length) await sequelize.getQueryInterface().bulkInsert(table, rows, { transaction });
  return rows.map((row) => row.id);
}

async function seed(employeesFile, manifestFile) {
  if (fs.existsSync(manifestFile)) throw new Error(`${manifestFile} exists: run --cleanup first`);
  const employees = [ARDI, ...JSON.parse(fs.readFileSync(employeesFile, "utf8"))].slice(0, 8);
  const manifest = { tag: TAG, company: COMPANY, employees, shift_types: [], shift_assignments: [], attendances: [], attendance_requests: [] };
  await sequelize.transaction(async (transaction) => {
    const shiftId = uuid();
    manifest.shift_types = await insert("shift_types", [{
      id: shiftId, company_id: COMPANY, shift_type_name: "Shift Pagi (dummy MCP)", start_time: "08:00:00",
      end_time: "17:00:00", checkin_opening_time: 60, time_tolerance: 15, kode_shift: "DMCP",
      createdAt: now(), updatedAt: now(),
    }], transaction);
    const assignments = employees.flatMap((employee) => WEEKS.map(([start, end]) => ({
      id: uuid(), employee_id: employee.id, shift_type_id: shiftId, status: "active", company_id: COMPANY,
      start_date: start, end_date: end, createdAt: now(), updatedAt: now(), ignore_holiday_date: 0, is_exchange: 0, is_pindah_shift: 0,
    })));
    manifest.shift_assignments = await insert("shift_assignments", assignments, transaction);
    const attendances = employees.flatMap((employee, index) => PAST_DAYS.flatMap((date) => {
      const plan = dayPlan(index, date);
      const assignment = assignments.find((a) => a.employee_id === employee.id && a.start_date <= date && a.end_date >= date);
      return plan ? [attendanceRow(employee, date, plan, assignment.id)] : [];
    }));
    manifest.attendances = await insert("attendances", attendances, transaction);
    const request = (employee, reason, from, status, explanation) => ({
      id: uuid(), employee_id: employee.id, company_id: COMPANY, reason, from_date: from, to_date: from,
      explanation, status, createdAt: now(), updatedAt: now(),
    });
    manifest.attendance_requests = await insert("attendance_requests", [
      request(employees[4], "Work from home", "2026-11-12", "approved", "WFH karena renovasi rumah (dummy MCP)"),
      request(employees[6], "overtime", "2026-11-18", "submit", "Lembur closing bulanan (dummy MCP)"),
      request(employees[7], "tukar_shift", "2026-11-19", "submit", "Tukar shift dengan rekan (dummy MCP)"),
    ], transaction);
  });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  for (const key of ["shift_types", "shift_assignments", "attendances", "attendance_requests"]) {
    console.log(`${key}: ${manifest[key].length}`);
  }
  console.log(`manifest: ${manifestFile}`);
}

async function cleanup(manifestFile) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  await sequelize.transaction(async (transaction) => {
    // Rows created later through MCP with the dummy shift (e.g. live case WL-026 with an accepted approval).
    if ((manifest.shift_types || []).length) {
      const [extra] = await sequelize.query("DELETE FROM shift_assignments WHERE shift_type_id IN (:ids) AND id NOT IN (:known)",
        { replacements: { ids: manifest.shift_types, known: manifest.shift_assignments.length ? manifest.shift_assignments : [""] }, transaction });
      console.log(`shift_assignments created via MCP with the dummy shift: deleted ${extra.affectedRows ?? 0}`);
    }
    for (const table of ["attendance_requests", "attendances", "shift_assignments", "shift_types"]) {
      const ids = manifest[table] || [];
      if (!ids.length) continue;
      const [result] = await sequelize.query(`DELETE FROM ${table} WHERE id IN (:ids)`, { replacements: { ids }, transaction });
      console.log(`${table}: deleted ${result.affectedRows ?? ids.length}`);
    }
  });
  fs.renameSync(manifestFile, `${manifestFile}.removed`);
}

const [first, second, third] = process.argv.slice(2);
(first === "--cleanup" ? cleanup(second) : seed(first, second))
  .catch((error) => {
    const details = (error.errors || []).map((e) => `${e.path}: ${e.message} (${e.value})`).join("; ");
    console.error(error.message, details || error.parent?.sqlMessage || "");
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
