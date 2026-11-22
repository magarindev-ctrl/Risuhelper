import { RisuHelperApp } from './ui.js';

const api = typeof risuai !== 'undefined' ? risuai : globalThis.Risuai;
if (api && typeof document !== 'undefined') {
  const app = new RisuHelperApp(api, document);
  app.init().catch((err) => {
    console.error('[RisuHelper] 초기화 실패:', err);
    if (document.body) {
      document.body.textContent = `RisuHelper를 시작하지 못했습니다: ${err?.message || err}`;
    }
  });
}
