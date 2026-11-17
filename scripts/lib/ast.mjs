import ts from 'typescript';

export function parseSource(filename, text) {
  return ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
}

function executableFunction(node) {
  return ts.isFunctionLike(node) && node.body !== undefined;
}

function expressionBranches(node) {
  if (ts.isParameter(node) || ts.isBindingElement(node)) return node.initializer ? 1 : 0;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return node.questionDotToken ? 1 : 0;
  if (!ts.isBinaryExpression(node)) return 0;
  const operators = [
    ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
  ];
  return operators.includes(node.operatorToken.kind) ? 1 : 0;
}

function branchCount(node) {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) return 1;
  if (ts.isIterationStatement(node, false) || ts.isCatchClause(node) || ts.isCaseClause(node)) return 1;
  return expressionBranches(node);
}

function complexityOf(fn) {
  let complexity = 1;
  const visit = node => {
    if (node !== fn && executableFunction(node)) return;
    complexity += branchCount(node);
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return complexity;
}

export function functionMetrics(source) {
  const metrics = [];
  const visit = node => {
    if (executableFunction(node)) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const end = source.getLineAndCharacterOfPosition(node.end).line;
      const name = node.name?.getText(source) ?? '<anonymous>';
      metrics.push({ name, line: start + 1, lines: end - start + 1, complexity: complexityOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return metrics;
}

function importIsTypeOnly(node) {
  if (node.isTypeOnly || node.importClause?.isTypeOnly) return true;
  const clause = node.importClause;
  const bindings = clause?.namedBindings;
  return !clause?.name && bindings && ts.isNamedImports(bindings)
    && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
}

function callSpecifier(node) {
  if (!ts.isCallExpression(node)) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0];
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return node.arguments[0];
  return undefined;
}

function moduleReference(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  return callSpecifier(node);
}

export function importReferences(source) {
  const references = [];
  const visit = node => {
    const expression = moduleReference(node);
    if (expression) {
      const literal = ts.isStringLiteralLike(expression);
      references.push({
        specifier: literal ? expression.text : undefined,
        typeOnly: Boolean(importIsTypeOnly(node) || ts.isImportTypeNode(node)),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

export function lintDiagnostics(source) {
  const errors = [];
  const visit = node => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (node.kind === ts.SyntaxKind.AnyKeyword) errors.push({ code: 'EXPLICIT_ANY', line, message: 'Use unknown and validate boundary data' });
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
      errors.push({ code: 'EVAL', line, message: 'Dynamic eval is not allowed' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (hasTypeBypass(source.text)) {
    errors.push({ code: 'TYPE_BYPASS', line: 1, message: 'Type checking bypass directives are not allowed' });
  }
  return errors;
}

function hasTypeBypass(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const comment = token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
    if (comment && /@ts-(?:ignore|nocheck)\b/.test(scanner.getTokenText())) return true;
  }
  return false;
}
