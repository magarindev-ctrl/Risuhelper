const VERSION = '0.2.0';
const PLUGIN_NAME = 'risuhelper';
const STORAGE_KEY = 'risuhelper_state_v1';
const PRESET_STORAGE_KEY = 'risuhelper_preset_v1';

/**
 * Editable configuration keys present in RisuAI's allowedDbKeys
 * across upstream kwaroran/Risuai and major forks (PocketRisu, RisuBard, HaejeokRisuai, RisuNest).
 * Note: 'askRemoval' is intentionally omitted from default config edits because PocketRisu/RisuBard omit it.
 */
const ALLOWED_CONFIG_KEYS = [
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'theme',
  'textTheme',
  'lineHeight',
  'seperateModelsForAxModels',
  'seperateModels',
  'customCSS',
  'guiHTML',
  'colorSchemeName',
  'enabledModules',
  'moduleIntergration',
  'selectedPersona',
];

const CONFIG_KEY_TYPES = {
  temperature: 'number',
  maxContext: 'number',
  maxResponse: 'number',
  frequencyPenalty: 'number',
  PresensePenalty: 'number',
  theme: 'string',
  textTheme: 'string',
  lineHeight: 'number',
  seperateModelsForAxModels: 'boolean',
  seperateModels: 'object',
  customCSS: 'string',
  guiHTML: 'string',
  colorSchemeName: 'string',
  enabledModules: 'array',
  moduleIntergration: 'string',
  selectedPersona: 'number',
};

const CHAR_FIELD_META = {
  name: { label: '캐릭터 이름', path: 'char.name', multiline: false },
  desc: { label: '캐릭터 설명 (Description)', path: 'char.desc', multiline: true },
  firstMessage: { label: '첫 메시지 (First Message)', path: 'char.firstMessage', multiline: true },
  creatorNotes: { label: '제작자 코멘트 (Creator Notes)', path: 'char.creatorNotes', multiline: true },
  systemPrompt: { label: '시스템 프롬프트 (System Prompt)', path: 'char.systemPrompt', multiline: true },
  replaceGlobalNote: { label: '글로벌 노트 덮어쓰기 (Replace Global Note)', path: 'char.replaceGlobalNote', multiline: true },
  postHistoryInstructions: { label: '히스토리 이후 지시 (Post-History)', path: 'char.postHistoryInstructions', multiline: true },
  exampleMessage: { label: '예시 대화 (Example Message)', path: 'char.exampleMessage', multiline: true },
  personality: { label: '성격 (Personality)', path: 'char.personality', multiline: true },
  scenario: { label: '시나리오 (Scenario)', path: 'char.scenario', multiline: true },
  backgroundHTML: { label: '백그라운드 임베딩 (Background HTML)', path: 'char.backgroundHTML', multiline: true },
  virtualscript: { label: '캐릭터 스크립트 (virtualscript)', path: 'char.virtualscript', multiline: true },
};

const MAX_LLM_CONTENT_CHARS = 24000;
const ALLOWED_CHAR_FIELDS = Object.keys(CHAR_FIELD_META);
const ALLOWED_LORE_TEXT_FIELDS = ['comment', 'key', 'secondkey', 'content', 'insertorder'];
const ALLOWED_PERSONA_TEXT_FIELDS = ['name', 'note', 'personaPrompt'];

const SCREEN_LABELS = {
  character: '캐릭터 설정',
  lorebook: '로어북',
  scripts: '스크립트 (정규식 · Lua)',
  persona: '페르소나',
  module: '모듈',
  settings: '설정 / 컨피그',
  chat: '채팅 화면',
  unknown: '일반 / 수동 선택',
};

export {
  VERSION,
  PLUGIN_NAME,
  STORAGE_KEY,
  PRESET_STORAGE_KEY,
  MAX_LLM_CONTENT_CHARS,
  ALLOWED_CONFIG_KEYS,
  CONFIG_KEY_TYPES,
  CHAR_FIELD_META,
  ALLOWED_CHAR_FIELDS,
  ALLOWED_LORE_TEXT_FIELDS,
  ALLOWED_PERSONA_TEXT_FIELDS,
  SCREEN_LABELS,
};
