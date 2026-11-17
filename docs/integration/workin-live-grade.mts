// Grading rules for workin-live cases (shared by the runner and the compare script).
export interface Expect { status: string[]; toolsAll?: string[]; toolsAny?: string[]; answerAll?: string[][]; answerNone?: string[]; approval: string | null }

const has = (answer: string, needle: string) => answer.toLowerCase().includes(needle.toLowerCase());

function checkTools(expect: Expect, tools: string[], failures: string[]) {
  for (const tool of expect.toolsAll ?? []) if (!tools.includes(tool)) failures.push(`missing tool ${tool}`);
  const anyTools = expect.toolsAny ?? [];
  if (anyTools.length > 0 && !anyTools.some((tool) => tools.includes(tool))) failures.push(`none of ${anyTools.join('|')}`);
}

function checkAnswers(expect: Expect, answer: string, failures: string[]) {
  for (const group of expect.answerAll ?? []) if (!group.some((alt) => has(answer, alt))) failures.push(`answer lacks ${group.join('|')}`);
  for (const bad of expect.answerNone ?? []) if (has(answer, bad)) failures.push(`answer contains "${bad}"`);
}

function checkApprovals(expect: Expect, approvals: string[], failures: string[]) {
  if (expect.approval && !approvals.includes(expect.approval)) failures.push(`no approval for ${expect.approval}`);
  if (!expect.approval && approvals.length) failures.push(`unexpected approval ${approvals.join(',')}`);
}

export function grade(expect: Expect, observed: { status: string; tools: string[]; answer: string; approvals: string[] }) {
  const failures: string[] = [];
  if (!expect.status.includes(observed.status)) failures.push(`status ${observed.status} not in ${expect.status.join('|')}`);
  checkTools(expect, observed.tools, failures);
  checkAnswers(expect, observed.answer, failures);
  checkApprovals(expect, observed.approvals, failures);
  return failures;
}
