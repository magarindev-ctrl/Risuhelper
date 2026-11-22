// SPDX-License-Identifier: GPL-3.0-only
// RisuAI/RisuBard toggle syntax & V2 block activation condition parser/compiler.

function parseToggleSyntax(template) {
  const parsed = [];
  for (const line of String(template ?? '').split('\n')) {
    const [key, value, type, option] = line.replace(/\r$/, '').split('=');
    if (['group', 'groupEnd', 'divider'].includes(type)) {
      parsed.push({ key, value, type });
    } else if (type === 'caption' && value) {
      parsed.push({ key, value, type });
    } else if (key && value) {
      parsed.push({
        key,
        value,
        type: ['select', 'text', 'textarea'].includes(type) ? type : 'switch',
        options: option?.split(',') ?? [],
      });
    }
  }
  return parsed;
}

function parseToggleTree(template) {
  const items = [];
  const definitions = [];
  const stack = [];
  const target = () => (stack.length ? stack[stack.length - 1].children : items);

  for (const toggle of parseToggleSyntax(template)) {
    if (toggle.type === 'group') {
      const g = { type: 'group', label: toggle.value ?? '', children: [] };
      target().push(g);
      stack.push(g);
    } else if (toggle.type === 'groupEnd') {
      stack.pop();
    } else if (['caption', 'divider'].includes(toggle.type)) {
      target().push({ type: toggle.type, label: toggle.value ?? '' });
    } else {
      const definition = {
        ...toggle,
        key: 'toggle_' + toggle.key,
        rawKey: toggle.key,
        label: toggle.value,
        group: stack.length ? stack[stack.length - 1].label : undefined,
      };
      definitions.push(definition);
      target().push({ type: 'toggle', definition });
    }
  }
  return { items, definitions };
}

const toggleDefault = (definition) => (
  ['text', 'textarea'].includes(definition.type) ? '' : '0'
);

const OPS = {
  is: 'equal',
  isnot: 'notequal',
  greater: 'greater',
  greaterequal: 'greater_equal',
  less: 'less',
  lessequal: 'less_equal',
};

const safeArg = (value) => (
  typeof value === 'string' && value.length > 0 && !/[{}\r\n]/.test(value) && !value.includes('::')
);

function compileV2(body, activation) {
  if (!activation?.conditions?.length) return body;
  if (!['and', 'or'].includes(activation.join)) {
    throw new Error('조건 결합은 and/or여야 합니다.');
  }
  const expression = activation.conditions
    .map(c => {
      if (!safeArg(c.key) || !safeArg(c.value) || !OPS[c.operator]) {
        throw new Error('조건 키·값에는 중괄호·줄바꿈·::를 사용할 수 없습니다.');
      }
      return `{{${OPS[c.operator]}::{{getglobalvar::${c.key}}}::${c.value}}}`;
    })
    .join(`::${activation.join}::`);
  return `{{#when::keep::${expression}}}\n${body}\n{{/when}}`;
}

function parseV2(source) {
  const text = String(source ?? '');
  const wrapper = text.match(/^\{\{#when::keep::(.+)\}\}\r?\n([\s\S]*)\r?\n\{\{\/when\}\}$/);
  if (!wrapper) return { body: text, activation: null };
  const comparison = /\{\{(equal|notequal|greater|greater_equal|less|less_equal)::\{\{getglobalvar::([^{}\r\n]+)\}\}::([^{}\r\n]+)\}\}/y;
  const conditions = [];
  const joins = [];
  let cursor = 0;

  while (cursor < wrapper[1].length) {
    comparison.lastIndex = cursor;
    const m = comparison.exec(wrapper[1]);
    if (!m) return { body: text, activation: null };
    conditions.push({
      key: m[2],
      operator: Object.keys(OPS).find(k => OPS[k] === m[1]),
      value: m[3],
    });
    cursor = comparison.lastIndex;
    if (cursor === wrapper[1].length) break;
    const separator = wrapper[1].slice(cursor).match(/^::(and|or)::/);
    if (!separator) return { body: text, activation: null };
    joins.push(separator[1]);
    cursor += separator[0].length;
  }

  if (!conditions.length || joins.some(j => j !== joins[0])) {
    return { body: text, activation: null };
  }
  return { body: wrapper[2], activation: { join: joins[0] ?? 'and', conditions } };
}

export { parseToggleSyntax, parseToggleTree, compileV2, parseV2, toggleDefault };
