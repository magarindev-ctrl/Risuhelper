// SPDX-License-Identifier: GPL-3.0-only
// RPN CBS math/logic evaluator for prompt presets (no eval, bounded input).

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

const PRECEDENCE = {
  '+': 2, '-': 2, '*': 3, '/': 3, '^': 4, '%': 3,
  '<': 1, '>': 1, '|': 1, '&': 1, '≤': 1, '≥': 1, '=': 1, '≠': 1, '!': 5,
};
const isOperator = ch => Object.hasOwn(PRECEDENCE, ch);
const isNumber = token => Boolean(parseFloat(token)) || token === '0';

function toRPN(expression) {
  const clean = expression.replace(/\s+/g, '');
  const tokens = [];
  const output = [];
  const stack = [];
  let pending = '';

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '-' && (i === 0 || isOperator(clean[i - 1]) || clean[i - 1] === '(')) {
      pending += ch;
    } else if (isOperator(ch)) {
      tokens.push(pending || '0', ch);
      pending = '';
    } else {
      pending += ch;
    }
  }
  tokens.push(pending || '0');

  for (const token of tokens) {
    if (isNumber(token)) {
      output.push(token);
    } else if (isOperator(token)) {
      while (
        stack.length &&
        (token === '!'
          ? PRECEDENCE[token] < PRECEDENCE[stack[stack.length - 1]]
          : PRECEDENCE[token] <= PRECEDENCE[stack[stack.length - 1]])
      ) {
        output.push(stack.pop());
      }
      stack.push(token);
    }
  }
  while (stack.length) output.push(stack.pop());
  return output;
}

function evaluateRPN(tokens) {
  const stack = [];
  for (const token of tokens) {
    if (isNumber(token)) {
      stack.push(parseFloat(token));
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    switch (token) {
      case '+': stack.push(a + b); break;
      case '-': stack.push(a - b); break;
      case '*': stack.push(a * b); break;
      case '/': stack.push(a / b); break;
      case '^': stack.push(a ** b); break;
      case '%': stack.push(a % b); break;
      case '<': stack.push(a < b ? 1 : 0); break;
      case '>': stack.push(a > b ? 1 : 0); break;
      case '≤': stack.push(a <= b ? 1 : 0); break;
      case '≥': stack.push(a >= b ? 1 : 0); break;
      case '=': stack.push(a === b ? 1 : 0); break;
      case '≠': stack.push(a !== b ? 1 : 0); break;
      case '|': stack.push(a || b); break;
      case '&': stack.push(a && b); break;
      case '!': stack.push(b ? 0 : 1); break;
    }
  }
  return stack.length ? stack.pop() : 0;
}

function calculatePreset(source, { variables = {}, globals = {} } = {}) {
  const text = String(source ?? '');
  assert(text.length <= 65536, 'CBS 계산식은 65,536자 이하만 지원합니다.');
  const read = (map, key) => {
    const n = parseFloat(Object.hasOwn(map, key) ? map[key] : '');
    return Number.isNaN(n) ? '0' : String(n);
  };
  const execute = (expr) => evaluateRPN(
    toRPN(
      expr
        .replace(/\$([a-zA-Z0-9_]+)/g, (_, key) => read(variables, key))
        .replace(/@([a-zA-Z0-9_]+)/g, (_, key) => read(globals, key))
        .replace(/&&/g, '&')
        .replace(/\|\|/g, '|')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/==/g, '=')
        .replace(/!=/g, '≠')
        .replace(/null/gi, '0')
    )
  );

  const depth = [''];
  for (const ch of text) {
    if (ch === '(') {
      assert(depth.length < 50, 'CBS 계산식 괄호 중첩이 너무 깊습니다.');
      depth.push('');
    } else if (ch === ')' && depth.length > 1) {
      const value = execute(depth.pop());
      depth[depth.length - 1] += value;
    } else {
      depth[depth.length - 1] += ch;
    }
  }
  return String(execute(depth.join('')));
}

export { calculatePreset };
