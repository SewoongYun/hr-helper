/*
 * 9차 회귀 테스트 (브라우저에서 regression.html 을 열면 실행)
 *  - 서버(Code.gs): 모의 Google 환경(Properties·Cache·Lock·Drive·Docs·UrlFetch)에서 함수를 직접 부른다
 *  - 사이트(app.js): ../site/index.html?test&offline 를 숨은 iframe으로 열고 fetch를 모의 응답으로 바꾼다
 * 외부 AI나 실제 서버로는 아무 요청도 보내지 않는다. 학번·키 같은 값은 모두 가짜다.
 */
(function () {
  'use strict';

  const CODE_NEW = '../apps-script/Code.gs';
  const CODE_OLD = '../../8차_개발/apps-script/Code.gs';
  const FAKE_KEY = 'TEST-KEY-not-real-0000';

  // ───────── 모의 Google 환경
  function utf8(s) { return new TextEncoder().encode(s).length; }

  function makeEnv() {
    const env = { t: Date.parse('2026-11-09T10:00:00+09:00'), props: {}, cache: {}, lock: { held: false }, fetches: [], aiQueue: [], sleeps: [], docOpens: 0, docs: {}, nextId: 1, cacheThrows: false, onAi: null };
    const FakeDate = class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(env.t); }
      static now() { return env.t; }
    };
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes()));

    const PropertiesService = { getScriptProperties: () => ({
      getProperty: (k) => (k in env.props ? env.props[k] : null),
      setProperty: (k, v) => { env.props[k] = String(v); },
      deleteProperty: (k) => { delete env.props[k]; },
      getKeys: () => Object.keys(env.props),
    }) };
    const LockService = { getScriptLock: () => {
      const me = { mine: false };
      me.tryLock = () => { if (env.lock.held) return false; env.lock.held = true; me.mine = true; return true; };
      me.waitLock = (ms) => { if (!me.tryLock(ms)) throw new Error('잠금 대기 시간 초과(' + ms + 'ms)'); };
      me.releaseLock = () => { if (me.mine) { env.lock.held = false; me.mine = false; } };
      return me;
    } };
    // 실제 캐시처럼 항목 하나가 100KB(UTF-8)를 넘으면 오류를 낸다
    const checkVal = (v) => { if (env.cacheThrows) throw new Error('캐시 사용 불가(모의)'); if (utf8(String(v)) > 102400) throw new Error('Argument too large: value'); };
    const CacheService = { getScriptCache: () => ({
      get: (k) => (k in env.cache ? env.cache[k] : null),
      getAll: (keys) => { const o = {}; keys.forEach((k) => { if (k in env.cache) o[k] = env.cache[k]; }); return o; },
      put: (k, v) => { checkVal(v); env.cache[k] = String(v); },
      putAll: (obj) => { Object.keys(obj).forEach((k) => checkVal(obj[k])); Object.assign(env.cache, obj); },
      removeAll: (keys) => keys.forEach((k) => delete env.cache[k]),
    }) };
    const MimeType = { GOOGLE_DOCS: 'application/vnd.google-apps.document', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', GOOGLE_SLIDES: 'application/vnd.google-apps.presentation' };

    function file(id, name, mime, opts) {
      opts = opts || {};
      return {
        id, name, mime, updated: opts.updated || 1000, trashed: false, text: opts.text || '', size: opts.size || 1000,
        getId() { return this.id; }, getName() { return this.name; }, getMimeType() { return this.mime; },
        getLastUpdated() { return new Date(this.updated); }, getUrl() { return 'https://drive.example/' + this.id; }, getSize() { return this.size; },
        getBlob() { const self = this; return { getBytes: () => [1, 2, 3], getDataAsString: () => self.text }; },
        setTrashed(v) { this.trashed = v; }, moveTo(f) { f.files.push(this); },
      };
    }
    function folder(name) {
      return {
        name, files: [], subs: [],
        getFiles() { const a = this.files.filter((f) => !f.trashed); let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; },
        getFoldersByName(n) { const s = this.subs.find((x) => x.name === n); let used = false; return { hasNext: () => !!s && !used, next: () => { used = true; return s; } }; },
        createFolder(n) { const s = folder(n); this.subs.push(s); return s; },
      };
    }
    env.top = folder('고3 담임 도우미 챗봇 자료');
    env.file = file;
    env.folderMissing = false;
    const DriveApp = {
      getFoldersByName: () => { if (env.folderMissing) throw new Error('드라이브 오류(모의)'); let used = false; return { hasNext: () => !used, next: () => { used = true; return env.top; } }; },
      getFolderById: () => env.top,
      getFileById: (id) => {
        const all = env.top.files.concat(...env.top.subs.map((s) => s.files));
        return all.find((f) => f.id === id) || { setTrashed() {}, moveTo(f) { const d = env.docs[id]; f.files.push(file(id, d.name, MimeType.GOOGLE_DOCS, { text: d.text })); } };
      },
    };
    const DocumentApp = {
      openById: (id) => {
        env.docOpens++;
        const all = env.top.files.concat(...env.top.subs.map((s) => s.files));
        const f = all.find((x) => x.id === id);
        const d = env.docs[id];
        if (d) return { getId: () => id, getBody: () => ({ getText: () => d.text, setText: (t) => { d.text = t; if (f) f.text = t; } }), saveAndClose() {} };
        if (f) return { getId: () => id, getBody: () => ({ getText: () => f.text, setText: (t) => { f.text = t; } }), saveAndClose() {} };
        throw new Error('문서 없음 ' + id);
      },
      create: (name) => { const id = 'doc' + (env.nextId++); env.docs[id] = { name, text: '' }; return { getId: () => id, getBody: () => ({ setText: (t) => { env.docs[id].text = t; } }), saveAndClose() {} }; },
    };
    const ScriptApp = { getOAuthToken: () => 'tok', getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }) };
    const Utilities = {
      formatDate: (d, tz, f) => fmt(d, tz, f),
      sleep: (ms) => { env.sleeps.push(ms); env.t += ms; },
      getUuid: () => 'uuid-' + (env.nextId++),
      base64Encode: () => 'QkFTRTY0',
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      // 글자 전체로 해시를 만든 뒤 32바이트로 펼친다(앞부분이 같은 키도 다른 값이 나오게)
      computeDigest: (alg, s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; const out = []; for (let i = 0; i < 32; i++) { h = Math.imul(h ^ i, 16777619) >>> 0; out.push((h & 0xff) - 128); } return out; },
    };
    const Session = { getScriptTimeZone: () => 'Asia/Seoul' };
    const UrlFetchApp = { fetch: (url, opts) => {
      env.fetches.push({ url, body: opts && opts.payload ? String(opts.payload) : '', lockHeld: env.lock.held });
      const isAi = /generativelanguage|anthropic/.test(url);
      if (isAi) {
        if (env.onAi) env.onAi();
        const r = env.aiQueue.length ? env.aiQueue.shift() : { code: 200, text: '모의 답변입니다 [1]' };
        if (r.throw) throw new Error(r.throw);
        const json = r.code === 200 ? (/anthropic/.test(url) ? { content: [{ type: 'text', text: r.text }], stop_reason: 'end_turn' } : { candidates: [{ content: { parts: [{ text: r.text }] } }] }) : { error: { message: r.msg || 'error', status: r.status || '' } };
        return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(json), getHeaders: () => ({}) };
      }
      if (/\/copy$/.test(url)) {
        // 구글 변환 모의: env.convertText 를 주면 변환된 구글 문서에 그 글자가 들어 있고, 주지 않으면 변환본을 열지 못한다(변환 실패)
        const id = 'copy' + (env.nextId++);
        if (env.convertText != null) env.docs[id] = { name: '변환본', text: env.convertText };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id }), getHeaders: () => ({}) };
      }
      return { getResponseCode: () => 200, getContentText: () => '변환된 글', getHeaders: () => ({}) };
    } };
    const SpreadsheetApp = { openById: () => ({ getSheets: () => [] }), getActiveSpreadsheet: () => { throw new Error('시트 없음(모의)'); } };
    const ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 1 } };
    env.globals = { Date: FakeDate, PropertiesService, LockService, CacheService, MimeType, DriveApp, DocumentApp, ScriptApp, Utilities, Session, UrlFetchApp, SpreadsheetApp, ContentService };
    // 체크 저장(saveCheck_)이 쓰는 것과 같은 잠금 방식: 공용 잠금을 5초 기다려 잡고 놓는다
    env.simulateCheckSave = () => { const l = LockService.getScriptLock(); l.waitLock(5000); l.releaseLock(); };
    return env;
  }

  // 구글 변환으로 나온 글자 PDF 원문(모의): 빈 줄 없이 줄만 이어지고, '권장과목'은 거의 모든 줄에 있으며 대학·학과는 한 줄에만 있다
  const LONG_PDF = ['2028 모집단위별 반영과목 및 대학별 권장과목 자료집 첫 줄']
    .concat(Array.from({ length: 60 }, (_, i) => `${i + 1}쪽 가상대${i + 1} 인문계열 권장과목 안내: 국어 영어 사회 교과를 고르게 이수하도록 권장과목을 제시하며 필수 기준은 아님. ${'설명 '.repeat(20)}`))
    .concat(['부산대 기계공학 미적분Ⅱ 기하 중 1과목 이상, 물리학 역학과 에너지 이수 권장'])
    .concat(Array.from({ length: 60 }, (_, i) => `${i + 61}쪽 가상대${i + 61} 자연계열 권장과목 안내: 수학 과학 교과를 위계에 맞게 이수하도록 권장과목을 제시함. ${'설명 '.repeat(20)}`))
    .concat(['끝줄 표시 가나다']).join('\n');

  const FN_NAMES = ['chat_', 'chatCountRequest_', 'runDigest_', 'retryDigest_', 'digestStatus_', 'cachedText_', 'searchChatFolder_', 'aiTest_', 'aiStatus_', 'chatThinkLevel_', 'useQuota_', 'digestInfo_'];
  function loadServer(src, env) {
    const names = Object.keys(env.globals);
    const ret = '\nreturn {' + FN_NAMES.map((n) => n + ': typeof ' + n + " === 'function' ? " + n + ' : undefined').join(', ') + '};';
    return new Function(...names, src + ret)(...names.map((n) => env.globals[n]));
  }

  // ───────── 서버 테스트(코드 원문, 환경 → [통과 여부, 설명])
  const serverTests = [
    ['서버: 개인정보로 보이는 질문(학번)은 폴더 검색·AI 모두 하지 않음', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      const r = S.chat_({ question: '학생 30123 상담 기록 정리', ai: true });
      const aiCalls = env.fetches.filter((f) => /generativelanguage/.test(f.url)).length;
      return [r.blocked === true && aiCalls === 0, `blocked=${r.blocked}, AI 요청 ${aiCalls}건`];
    }],
    ['서버: 이전 대화에 섞인 개인정보는 AI 요청에서 빠짐', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      S.chat_({ question: '9월 할 일 알려줘', ai: true, history: [{ role: 'user', text: '학생 30123 상담' }, { role: 'bot', text: '찾지 못함' }] });
      const body = (env.fetches.find((f) => /generativelanguage/.test(f.url)) || {}).body || '';
      return [!!body && body.indexOf('30123') < 0, body ? (body.indexOf('30123') < 0 ? 'AI 요청에 30123 없음' : 'AI 요청에 30123이 들어감') : 'AI 요청이 없음'];
    }],
    ['잠금: 자료 정리가 AI를 기다리는 동안 체크 저장(공용 잠금 5초 대기)이 성공', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.top.files.push(env.file('pdf1', '설명회.pdf', 'application/pdf'));
      let saveOk = null;
      env.onAi = () => { try { env.simulateCheckSave(); saveOk = true; } catch (e) { saveOk = false; } };
      S.runDigest_(75);
      return [saveOk === true, saveOk === null ? 'AI 호출 없음' : saveOk ? '정리 중 체크 저장 성공' : '정리 중 체크 저장 실패(잠금 대기 시간 초과)'];
    }],
    ['실행권: 정리 중 두 번째 실행은 막고, 끝나면 실행권을 풂', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.top.files.push(env.file('pdf1', '설명회.pdf', 'application/pdf'));
      let nested = null;
      env.onAi = () => { env.onAi = null; nested = S.runDigest_(75); };
      S.runDigest_(75);
      const released = !('digestLease' in env.props);
      return [!!nested && nested.busy === true && released, `중복 실행 busy=${nested && nested.busy}, 끝난 뒤 실행권 ${released ? '풀림' : '남음'}`];
    }],
    ['실행권: 중단된 실행의 실행권은 만료 뒤 다시 정리 가능, 오류가 나도 실행권을 풂', (S, env) => {
      env.props.digestLease = JSON.stringify({ id: 'crashed', until: env.t + 1000 });
      const a = S.runDigest_(75);
      env.t += 2000;
      const b = S.runDigest_(75);
      env.folderMissing = true;
      let threw = false;
      try { S.runDigest_(75); } catch (e) { threw = true; }
      const released = !('digestLease' in env.props);
      return [a.busy === true && !b.busy && released, `만료 전 busy=${a.busy}, 만료 후 busy=${!!b.busy}, 오류(${threw ? '예외' : '처리'}) 뒤 실행권 ${released ? '풀림' : '남음'}`];
    }],
    ['재시도: 429가 계속되면 대기로 두었다가 백오프 시간이 지나면 다시 정리', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.top.files.push(env.file('pdf1', '설명회.pdf', 'application/pdf'));
      env.aiQueue = [{ code: 429, status: 'RESOURCE_EXHAUSTED' }, { code: 429 }, { code: 429 }];
      S.runDigest_(75);
      const info1 = JSON.parse(env.props['dg:pdf1'] || '{}');
      const st1 = S.digestStatus_();
      env.t += 6 * 60 * 1000;
      env.aiQueue = [{ code: 200, text: '정리된 글' }];
      S.runDigest_(75);
      const st2 = S.digestStatus_();
      const ok = info1.kind === 'temp' && info1.tries === 1 && st1.waiting === 1 && st2.done === 1;
      return [ok, `1차: kind=${info1.kind}, tries=${info1.tries}, 대기=${st1.waiting}, 요청 안 재시도 ${env.sleeps.length}번 → 6분 뒤: 끝남=${st2.done}`];
    }],
    ['재시도: 형식 오류는 자동 재시도하지 않고, 실패 자료 다시 시도로 다시 함', (S, env) => {
      env.top.files.push(env.file('hwp1', '안내.hwp', 'application/x-hwp'));
      S.runDigest_(75);
      const s1 = S.digestStatus_();
      const again = S.runDigest_(75);
      const retried = S.retryDigest_ ? S.retryDigest_() : null;
      const tried = retried && (retried.processed || []).some((p) => p.name === '안내.hwp');
      return [s1.failedCount === 1 && (again.processed || []).length === 0 && tried, `실패=${s1.failedCount}, 자동 실행 처리=${(again.processed || []).length}, 다시 시도 실행=${tried ? '함' : '안 함'}`];
    }],
    ['재시도: 키 오류(401)는 실패로 두고, 키를 바꾸면 다시 정리', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.top.files.push(env.file('pdf1', '설명회.pdf', 'application/pdf'));
      env.aiQueue = [{ code: 401, status: 'UNAUTHENTICATED' }];
      S.runDigest_(75);
      const s1 = S.digestStatus_();
      env.props.GEMINI_API_KEY = FAKE_KEY + '-new';
      const s2 = S.digestStatus_();
      return [s1.failedCount === 1 && s2.todo === 1, `키 오류 뒤 실패=${s1.failedCount}, 키 변경 뒤 할 차례=${s2.todo}`];
    }],
    ['한도: 자료 정리 하루 요청 한도는 채팅과 따로 세고, 다 쓰면 내일로 미룸', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.props.DIGEST_DAILY_LIMIT = '1';
      env.top.files.push(env.file('pdf1', 'a.pdf', 'application/pdf'), env.file('pdf2', 'b.pdf', 'application/pdf'));
      S.runDigest_(75);
      const st = S.digestStatus_();
      const ai = S.aiStatus_ ? S.aiStatus_() : null;
      return [!!ai && st.done === 1 && st.waiting === 1 && ai.digest.used === 1 && ai.chat.used === 0, ai ? `끝남=${st.done}, 대기=${st.waiting}, 자료 정리 ${ai.digest.used}/${ai.digest.limit}, 채팅 ${ai.chat.used}/${ai.chat.limit}` : 'aiStatus_ 없음'];
    }],
    ['캐시: 한글 4만 자(12만 바이트) 문서도 오류 없이 읽고 다음에는 캐시에서 꺼냄', (S, env) => {
      const d = env.file('doc2', '긴 문서', 'application/vnd.google-apps.document', { text: '가'.repeat(40000) });
      env.top.files.push(d);
      const cache = env.globals.CacheService.getScriptCache();
      let t1 = '';
      let err = '';
      try { t1 = S.cachedText_(d, cache); } catch (e) { err = e.message; }
      const opens = env.docOpens;
      let t2 = '';
      try { t2 = S.cachedText_(d, cache); } catch (e) { err = err || e.message; }
      return [!err && t1.length === 40000 && t2.length === 40000 && env.docOpens === opens, err ? '오류: ' + err : `읽은 글 ${t1.length}자, 두 번째는 ${env.docOpens === opens ? '캐시에서' : '다시 읽음'}`];
    }],
    ['캐시: 캐시 저장이 실패해도 읽은 문서는 검색에 쓰임', (S, env) => {
      env.cacheThrows = true;
      env.top.files.push(env.file('doc3', '학사 일정', 'application/vnd.google-apps.document', { text: '수시 원서 접수 일정은 9월입니다.' }));
      let r = null;
      let err = '';
      try { r = S.searchChatFolder_('수시 원서 접수 일정'); } catch (e) { err = e.message; }
      const n = r ? r.hits.length : 0;
      return [n > 0, err ? '오류: ' + err : `찾은 문단 ${n}개`];
    }],
    ['연결 시험: 인증 오류·모델 오류·한도 초과·정상을 구분하고 키를 돌려주지 않음', (S, env) => {
      if (!S.aiTest_) return [null, 'aiTest_ 없음'];
      env.props.GEMINI_API_KEY = FAKE_KEY;
      const cases = [[{ code: 401, status: 'UNAUTHENTICATED' }, 'auth'], [{ code: 404, msg: 'models/x is not found' }, 'model'], [{ code: 429, status: 'RESOURCE_EXHAUSTED' }, 'quota'], [{ code: 200, text: '확인' }, 'ok']];
      const got = cases.map(([resp, want]) => {
        env.aiQueue = resp.code === 429 ? [resp, resp, resp] : [resp];
        const r = S.aiTest_();
        return r.result === want ? want : want + '≠' + r.result;
      });
      const st = S.aiStatus_();
      const leak = JSON.stringify(st).indexOf(FAKE_KEY) >= 0;
      const ok = got.every((g) => g.indexOf('≠') < 0) && st.verified === true && !!st.lastOk && !leak;
      return [ok, `${got.join(', ')} · 연결 확인됨=${st.verified} · 키 노출=${leak ? '있음' : '없음'}`];
    }],
    ['생각 수준: 단순 질문은 low, 비교·조건 질문은 medium, 속성으로 고정 가능', (S, env) => {
      if (!S.chatThinkLevel_) return [null, 'chatThinkLevel_ 없음'];
      const a = S.chatThinkLevel_('9월에 할 일', 0);
      const b = S.chatThinkLevel_('부산대 경북대 수학교육과 권장과목 차이 비교해 줘', 0);
      const c = S.chatThinkLevel_('수학과 교직이수', 0);
      env.props.GEMINI_THINKING = 'high';
      const d = S.chatThinkLevel_('9월에 할 일', 0);
      return [a === 'low' && b === 'medium' && c === 'low' && d === 'high', `단순=${a}, 비교=${b}, '수학과'=${c}, 고정=${d}`];
    }],
    ['생각 수준(8차): "세 가지로 요약"·"정리"는 단순 요약이라 low', (S) => {
      const a = S.chatThinkLevel_('9월에 담임이 할 일을 세 가지로 요약해 줘', 0);
      const b = S.chatThinkLevel_('그중 원서 접수 전에 할 일만 골라줘', 0);
      return [a === 'low' && b === 'low', `세 가지 요약=${a}, 그중 고르기=${b}`];
    }],
    ['채팅(8차): 429가 와도 채팅은 다시 보내지 않고 바로 알림(기다림 없음)', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.aiQueue = [{ code: 429, status: 'RESOURCE_EXHAUSTED' }, { code: 200, text: '두 번째' }];
      const r = S.chat_({ question: '9월에 할 일 요약', ai: true, sources: [{ kind: '업무', title: '9월 · 수시 원서접수 확인', text: '확인', ref: '업무 m09-03' }] });
      const aiCalls = env.fetches.filter((f) => /generativelanguage/.test(f.url)).length;
      return [aiCalls === 1 && env.sleeps.length === 0 && !!r.aiError && !r.answer, `AI 요청 ${aiCalls}건, 대기 ${env.sleeps.length}번, aiError=${r.aiError ? '있음' : '없음'}`];
    }],
    ['채팅(8차): 걸린 시간(자료 찾기·AI·전체)을 응답과 실행 기록에 남기고, 기록에 질문 글·키는 없음', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      const logs = [];
      const orig = console.log;
      console.log = (...a) => logs.push(a.join(' '));
      let r;
      try { r = S.chat_({ question: '수시 원서 비밀질문 일정', ai: true, sources: [] }); } finally { console.log = orig; }
      const line = logs.find((l) => l.indexOf('[다람이 시간]') === 0) || '';
      const t = r.timing || {};
      const ok = t.searchMs != null && t.aiMs != null && t.totalMs != null && !!line && line.indexOf('비밀질문') < 0 && line.indexOf(FAKE_KEY) < 0 && /"aiMs"/.test(line);
      return [ok, line ? `${line.slice(0, 160)}` : '실행 기록 줄 없음'];
    }],
    ['채팅(8차): 근거는 8개까지만 보내고, "세 가지" 요청이면 개수 지키라는 줄을 붙임', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      const sources = Array.from({ length: 12 }, (_, i) => ({ kind: '업무', title: '자료' + (i + 1), text: '내용', ref: 'r' + i }));
      S.chat_({ question: '9월에 할 일을 세 가지로 요약해 줘', ai: true, sources });
      const body = (env.fetches.find((f) => /generativelanguage/.test(f.url)) || {}).body || '';
      const n = (body.match(/\[\d+\] \(업무\)/g) || []).length;
      const has = body.indexOf('정확히 3가지') >= 0;
      return [n === 8 && has, `보낸 근거 ${n}개, 개수 줄 ${has ? '있음' : '없음'}`];
    }],
    ['정리(9차): 글자 PDF는 구글 변환으로 원문 전체를 담고, 파일을 AI로 보내지 않음(요약 1번만)', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.convertText = LONG_PDF;
      env.top.files.push(env.file('pdf1', '권장과목 자료집.pdf', 'application/pdf'));
      const r = S.runDigest_(75);
      const ai = env.fetches.filter((f) => /generativelanguage/.test(f.url));
      const sentFile = ai.some((f) => f.body.indexOf('inlineData') >= 0);
      const doc = Object.keys(env.docs).map((k) => env.docs[k]).find((d) => /^\[자동 정리\]/.test(d.name)) || { text: '' };
      const whole = doc.text.indexOf('부산대 기계공학 미적분Ⅱ 기하') >= 0 && doc.text.indexOf('끝줄 표시 가나다') >= 0;
      const p = (r.processed || [])[0] || {};
      return [p.ok === true && !sentFile && ai.length === 1 && whole && /구글 변환/.test(p.how || ''), `처리=${p.ok ? '성공' : '실패 ' + (p.err || '')}, AI 요청 ${ai.length}건(파일 전송 ${sentFile ? '있음' : '없음'}), 원문 처음~끝 ${whole ? '모두 있음' : '빠짐'}, 방식="${p.how || ''}", ${p.chars || 0}자`];
    }],
    ['정리(9차): 14MB 넘는 PDF도 구글 변환이면 정리되고, [AI 제외] PDF는 AI 요청 0건으로 정리', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.convertText = LONG_PDF;
      env.top.files.push(env.file('big', '대입정보 119.pdf', 'application/pdf', { size: 16 * 1024 * 1024 }), env.file('no', '[AI 제외] 내부 자료.pdf', 'application/pdf'));
      const r = S.runDigest_(75);
      const ok2 = (r.processed || []).filter((p) => p.ok).length;
      const ai = env.fetches.filter((f) => /generativelanguage/.test(f.url)).length;
      return [ok2 === 2 && ai === 1, `정리 성공 ${ok2}개, AI 요청 ${ai}건(큰 파일 요약 1번만, [AI 제외]는 0번)`];
    }],
    ['정리(9차): 구글 변환이 안 되는 PDF는 AI로 읽고, 14MB를 넘으면 까닭을 알려 줌', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.top.files.push(env.file('scan', '스캔본.pdf', 'application/pdf'), env.file('bigscan', '큰 스캔본.pdf', 'application/pdf', { size: 16 * 1024 * 1024 }));
      const r = S.runDigest_(75);
      const a = (r.processed || []).find((p) => p.name === '스캔본.pdf') || {};
      const b = (r.processed || []).find((p) => p.name === '큰 스캔본.pdf') || {};
      const sentFile = env.fetches.some((f) => /generativelanguage/.test(f.url) && f.body.indexOf('inlineData') >= 0);
      return [a.ok === true && sentFile && b.ok === false && /14MB/.test(b.err || ''), `스캔본=${a.ok ? 'AI로 읽음' : '실패'}, 큰 스캔본="${b.err || ''}"`];
    }],
    ['정리(9차): 예전 방식(AI 요약)으로 만든 PDF 정리본은 다시 정리 대상이 되고, 사진 정리본은 그대로', (S, env) => {
      env.top.files.push(env.file('pdf1', '자료집.pdf', 'application/pdf'), env.file('img1', '안내.png', 'image/png'));
      env.props['dg:pdf1'] = JSON.stringify({ t: 1000, doc: 'old1' });
      env.props['dg:img1'] = JSON.stringify({ t: 1000, doc: 'old2' });
      const st = S.digestStatus_();
      return [st.todo === 1 && st.done === 1, `할 차례=${st.todo}(PDF), 끝남=${st.done}(사진)`];
    }],
    ['정리(9차): AI 요약이 일시 오류여도 원문 글자는 먼저 저장되어 검색되고, 요약만 다음에 다시 시도', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.convertText = LONG_PDF;
      env.top.files.push(env.file('pdf1', '권장과목 자료집.pdf', 'application/pdf'));
      env.aiQueue = [{ code: 503 }, { code: 503 }, { code: 503 }];
      const r = S.runDigest_(75);
      const st = S.digestStatus_();
      const found = S.searchChatFolder_('부산대 기계공학 미적분').hits;
      const p = (r.processed || [])[0] || {};
      env.t += 6 * 60 * 1000;
      S.runDigest_(75);
      const st2 = S.digestStatus_();
      return [p.ok === false && p.saved === true && st.waiting === 1 && found.length > 0 && /부산대/.test(found[0].text) && st2.done === 1, `1차: 요약 실패·원문 저장=${p.saved}, 대기=${st.waiting}, 검색 ${found.length}개 → 6분 뒤 끝남=${st2.done}`];
    }],
    ['검색(9차): 드문 낱말(대학·학과)이 맞는 묶음이 먼저, 끝 글자가 다른 꼴(기계공학부→기계공학)도 찾고, 요약(AI)과 원문을 구분', (S, env) => {
      env.props.GEMINI_API_KEY = FAKE_KEY;
      env.convertText = LONG_PDF;
      env.top.files.push(env.file('pdf1', '권장과목 자료집.pdf', 'application/pdf'));
      S.runDigest_(75);
      const hits = S.searchChatFolder_('부산대 기계공학부 권장과목').hits;
      const first = hits[0] || { text: '', ref: '' };
      const sum = S.searchChatFolder_('모의 답변입니다').hits[0] || {};
      // 근거 카드에 보여 줄 글(snip)은 맞는 줄부터 시작해야 한다(묶음 맨 앞 220자만 보이면 맞는 줄이 안 보이므로)
      const ok = /부산대 기계공학/.test(first.text) && /^… 부산대 기계공학/.test(first.snip || '') && first.ai === false && /원문 변환/.test(first.ref) && sum.ai === true && hits.length <= 4;
      return [ok, `1등 카드 글: "${String(first.snip || first.text).replace(/\s+/g, ' ').slice(0, 40)}…" (${first.ref}), 한 파일에서 ${hits.length}개, 요약 묶음 AI 표시=${sum.ai}`];
    }],
  ];

  // ───────── 사이트 테스트(iframe)
  function loadSite() {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.src = '../site/index.html?test&offline&r=' + Date.now();
      f.onload = () => {
        const w = f.contentWindow;
        const t0 = Date.now();
        (function wait() {
          if (w.__hrTest) return resolve(w);
          if (Date.now() - t0 > 8000) return reject(new Error('사이트를 불러오지 못함'));
          setTimeout(wait, 100);
        })();
      };
      document.body.appendChild(f);
    });
  }
  function mockFetch(w, responder) {
    const calls = [];
    w.fetch = async (url, opt) => {
      const body = opt && opt.body ? JSON.parse(opt.body) : {};
      calls.push(body);
      return new w.Response(JSON.stringify(responder(body)), { headers: { 'Content-Type': 'application/json' } });
    };
    return calls;
  }
  const siteTests = [
    ['사이트: 학번 질문은 서버로 보내지 않고, 다음 질문의 이전 대화에도 넣지 않음', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini'; T.chat.history = [];
      const calls = mockFetch(w, () => ({ ok: true, provider: 'gemini', answer: '9월 업무입니다 [1]', folder: [] }));
      await T.chatAsk('학생 30123 상담');
      const first = calls.length;
      await T.chatAsk('9월 할 일 요약해 줘');
      const sent = JSON.stringify(calls.map((c) => c.history || []));
      return [first === 0 && calls.length === 1 && sent.indexOf('30123') < 0, `첫 질문 전송 ${first}건, 다음 질문 전송 ${calls.length - first}건, 이전 대화에 30123 ${sent.indexOf('30123') < 0 ? '없음' : '있음'}`];
    }],
    ['사이트: 메일 주소·전화번호도 막고, 서버가 막은 질문도 기록에 넣지 않음', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini'; T.chat.history = [];
      const calls = mockFetch(w, (b) => (/수상한/.test(b.question) ? { ok: true, blocked: true, folder: [] } : { ok: true, answer: '답 [1]', folder: [] }));
      await T.chatAsk('parent@example.com 으로 안내 보내기');
      await T.chatAsk('010-1234-5678 연락');
      await T.chatAsk('수상한 질문');
      await T.chatAsk('수시 지원 전략 알려줘');
      const last = calls[calls.length - 1] || {};
      const hist = JSON.stringify(last.history || []);
      return [calls.length === 2 && hist.indexOf('수상한') < 0, `서버 전송 ${calls.length}건(메일·전화 차단), 마지막 요청의 이전 대화에 '수상한 질문' ${hist.indexOf('수상한') < 0 ? '없음' : '있음'}`];
    }],
    ['사이트: AI 상태를 연결 확인 전·이전 연결 성공으로 나눠 표시', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini';
      w.document.getElementById('chatFab').click();
      T.chat.ai = { keySet: true, verified: false, lastOk: '', lastError: null };
      T.chatModeText();
      const a = w.document.getElementById('chatMode').textContent;
      T.chat.ai = { keySet: true, verified: true, lastOk: '2026-11-09 14:20', lastError: null };
      T.chatModeText();
      const b = w.document.getElementById('chatMode').textContent;
      return [/연결 확인 전/.test(a) && /이전 연결 성공/.test(b) && /14:20/.test(b), `"${a}" → "${b}"`];
    }],
    ['사이트: 권장과목 카드에 적용 학년도·검증 상태를 보이고, 없는 값은 미확인', async (w) => {
      const T = w.__hrTest;
      T.switchView('subj');
      const prov = w.document.querySelector('.prov');
      const text = prov ? prov.textContent : '';
      const scope = (w.document.querySelector('.scope-chip') || {}).textContent || '';
      return [/2028학년도 대입/.test(text) && /검증 대기/.test(text) && /미확인/.test(text) && !/검증 완료/.test(text) && /2028학년도 대입 기준/.test(scope), `근거 줄: "${text.trim().slice(0, 90)}…" · 범위 표시: "${scope}"`];
    }],
    ['사이트: 다람이 그림의 색 정의(id)가 겹치지 않아 창을 열어도 흰 몸이 보임', async (w) => {
      w.document.getElementById('chatFab').click();
      const ids = [...w.document.querySelectorAll('linearGradient')].map((g) => g.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      const head = w.document.querySelector('.chat-avatar [fill^="url(#sqrW"]');
      const ref = head ? head.getAttribute('fill').slice(5, -1) : '';
      const def = ref ? w.document.getElementById(ref) : null;
      const visible = !!def && def.closest('.chat-fab') === null;
      return [dup.length === 0 && visible, `겹친 id ${dup.length}개, 머리 아이콘의 흰색 정의가 ${visible ? '보이는 곳(창 안)에 있음' : '숨겨진 단추 안에 있음'}`];
    }],
    ['사이트(8차): "수시 원서 접수 일정"은 서버·AI 없이 일정으로 바로 답하고 정시·추가모집을 섞지 않음', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini';
      const calls = mockFetch(w, () => ({ ok: true, answer: '안 와야 함' }));
      w.document.getElementById('chatFab').click();
      await T.chatAsk('수시 원서 접수 일정');
      const msg = [...w.document.querySelectorAll('#chatLog .chat-msg.bot')].pop().textContent;
      // 9차부터 답을 보여 준 뒤 드라이브 폴더만 뒤에서 찾는다(ai:false). AI 요청은 여전히 없어야 한다
      const aiCalls = calls.filter((c) => c.ai !== false).length;
      const ok = aiCalls === 0 && /AI 아님/.test(msg) && /9월 20일/.test(msg) && /9월 23일/.test(msg) && !/정시|추가모집/.test(msg);
      return [ok, `AI 요청 ${aiCalls}건, 답: "${msg.replace(/\s+/g, ' ').slice(0, 90)}…"`];
    }],
    ['사이트(9차): 바로 답한 질문도 드라이브 폴더를 뒤에서 찾아(AI 없이) 답 아래에 접어서 붙임', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini';
      const calls = mockFetch(w, (b) => (b.ai === false
        ? { ok: true, folder: [{ title: '기본사항 (원문 변환)', text: '수시모집 원서접수 2027. 09. 20.(월) ~ 09. 23.(목)', ref: '원문 변환 · 기본사항 · 3번째 부분', url: 'https://docs.google.com/document/d/x', srcUrl: 'https://drive.google.com/file/d/y', ai: false }] }
        : { ok: true, answer: '안 와야 함' }));
      w.document.getElementById('chatFab').click();
      await T.chatAsk('수시 원서 접수 일정');
      const el = [...w.document.querySelectorAll('#chatLog .chat-msg.bot')].pop();
      const shownFirst = /AI 아님/.test(el.textContent);
      for (let i = 0; i < 50 && !el.querySelector('.chat-drive'); i++) await new Promise((r) => setTimeout(r, 100));
      const box = el.querySelector('.chat-drive');
      const ok = shownFirst && calls.length === 1 && calls[0].ai === false && !!box && /원문 변환/.test(box.textContent) && !box.open;
      return [ok, `바로 답 먼저=${shownFirst}, 서버 요청 ${calls.length}건(ai=${calls[0] && calls[0].ai}), 드라이브 묶음 ${box ? '붙음(접힘)' : '없음'}`];
    }],
    ['사이트(8차): AI 실패 시 "이번 AI 답변 실패" 표시, "세 가지"면 검색 결과 정확히 3개(AI 아님), 다시 시도 단추', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini';
      T.chat.ai = { keySet: true, verified: true, lastOk: '2026-11-09 09:00', lastError: null };
      mockFetch(w, () => ({ ok: true, provider: 'gemini', aiError: '시간 초과(모의)', folder: [], timing: { searchMs: 100, aiMs: 50000, totalMs: 50200 } }));
      w.document.getElementById('chatFab').click();
      await T.chatAsk('9월에 담임이 할 일을 세 가지로 요약해 줘');
      const el = [...w.document.querySelectorAll('#chatLog .chat-msg.bot')].pop();
      const cards = el.querySelectorAll('.chat-src').length;
      const head = w.document.getElementById('chatMode').textContent;
      const ok = /이번 AI 답변 실패 · 검색 결과 표시 중/.test(el.textContent) && /AI 요약 아님/.test(el.textContent) && cards === 3 && !!el.querySelector('[data-chat-retry]') && /이번 AI 답변 실패/.test(head) && !/이전 연결 성공/.test(head);
      return [ok, `근거 카드 ${cards}개, 머리 줄 "${head}", 다시 시도 단추 ${el.querySelector('[data-chat-retry]') ? '있음' : '없음'}`];
    }],
    ['사이트(8차): 기다리는 동안 다시 시도를 두 번 눌러도 요청은 1번, 질문 말풍선도 늘지 않음', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini';
      let mode = 'fail';
      const calls = [];
      w.fetch = async (url, opt) => {
        calls.push(JSON.parse(opt.body));
        if (mode === 'slow') await new Promise((r) => setTimeout(r, 400));
        const body = mode === 'fail' ? { ok: true, aiError: '모의 실패', folder: [] } : { ok: true, answer: '다시 받은 답입니다 [1]', folder: [] };
        return new w.Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      };
      w.document.getElementById('chatFab').click();
      await T.chatAsk('9월 할 일 요약해 줘');
      const users = w.document.querySelectorAll('#chatLog .chat-msg.user').length;
      mode = 'slow';
      const btn = w.document.querySelector('[data-chat-retry]');
      btn.click(); btn.click();
      await T.chatAsk('또 다른 질문 요약');
      // 답이 올 때까지 기다린다(브라우저 창이 뒤에 있으면 타이머가 느려져 정해진 시간만 기다리면 어긋난다)
      for (let i = 0; i < 100 && T.chat.busy; i++) await new Promise((r) => setTimeout(r, 100));
      const users2 = w.document.querySelectorAll('#chatLog .chat-msg.user').length;
      const last = [...w.document.querySelectorAll('#chatLog .chat-msg.bot')].pop().textContent;
      // 실패 뒤 AI 상태 새로 고침(aiStatus)은 질문 요청이 아니므로 빼고 센다
      const chats = calls.filter((c) => c.action === 'chat').length;
      const ok = chats === 2 && users === users2 && /다시 받은 답/.test(last) && /AI 답변/.test(last);
      return [ok, `질문 요청 ${chats}건(처음 1 + 다시 시도 1), 질문 말풍선 ${users}→${users2}`];
    }],
    ['사이트(8차): AI가 4개를 답해도 "세 가지"면 3개만, 근거는 1~3개, 이어지는 질문에 그 달 업무를 근거로 보냄', async (w) => {
      const T = w.__hrTest; T.state.live = true; T.chat.provider = 'gemini'; T.chat.history = [];
      const calls = mockFetch(w, () => ({ ok: true, provider: 'gemini', answer: '요약입니다.\n1. 가 [1]\n2. 나 [2]\n3. 다 [3]\n4. 라 [4]', folder: [] }));
      w.document.getElementById('chatFab').click();
      await T.chatAsk('9월에 담임이 할 일을 세 가지로 요약해 줘');
      const el = [...w.document.querySelectorAll('#chatLog .chat-msg.bot')].pop();
      const items = (el.querySelector('.chat-answer').textContent.match(/\d\. /g) || []).length;
      const cards = el.querySelectorAll('.chat-src').length;
      await T.chatAsk('그중 원서 접수 전에 할 일만 골라줘');
      const follow = calls[1] || {};
      const titles = (follow.sources || []).map((s) => s.title);
      const has9 = titles.filter((t) => /^9월 · /.test(t)).length;
      const hasEvent = titles.some((t) => /수시 원서접수$/.test(t));
      const ok = items === 3 && cards >= 1 && cards <= 3 && has9 >= 5 && hasEvent && (follow.history || []).length === 2;
      return [ok, `답 항목 ${items}개, 근거 ${cards}개 · 이어지는 질문 근거: 9월 업무 ${has9}개, 수시 원서접수 일정 ${hasEvent ? '있음' : '없음'}, 이전 대화 ${(follow.history || []).length}줄`];
    }],
    ['사이트(8차): 대학·학과 이름이 정확히 맞는 권장과목 자료가 맨 앞', async (w) => {
      const T = w.__hrTest;
      const r = T.chatSearch('부산대 수학교육과 권장과목', 8);
      const first = r[0] || {};
      const other = r.filter((d) => d.kind === '권장과목' && !/^부산대/.test(d.title)).length;
      return [/^부산대/.test(first.title || '') && /수학교육과/.test(first.title || '') && other === 0, `1등: "${first.title}", 다른 대학 자료 ${other}개`];
    }],
  ];

  // ───────── 실행·표시
  const rows = document.getElementById('rows');
  function cell(v) { return v === true ? '<span class="pass">통과</span>' : v === false ? '<span class="fail">실패</span>' : '<span class="na">해당 없음</span>'; }
  function addRow(i, name, r7, r6, note) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i}</td><td>${name}</td><td>${cell(r7)}</td><td>${cell(r6)}</td><td><small></small></td>`;
    tr.querySelector('small').textContent = note;
    rows.appendChild(tr);
  }
  function runServer(src, fn) {
    if (!src) return [null, '코드를 불러오지 못함'];
    const env = makeEnv();
    let S;
    try { S = loadServer(src, env); } catch (e) { return [false, '코드 실행 오류: ' + e.message]; }
    try { return fn(S, env); } catch (e) { return [false, '오류: ' + e.message]; }
  }

  (async () => {
    const [srcNew, srcOld] = await Promise.all([CODE_NEW, CODE_OLD].map((u) => fetch(u + '?z=' + Date.now()).then((r) => (r.ok ? r.text() : '')).catch(() => '')));
    const results = [];
    // 문법 검사
    for (const [label, url] of [['Code.gs(8차)', CODE_NEW], ['site/app.js', '../site/app.js'], ['site/data.js', '../site/data.js'], ['site/recommend.js', '../site/recommend.js'], ['site/grade.js', '../site/grade.js'], ['tests/regression.js', 'regression.js']]) {
      const s = await fetch(url + '?z=' + Date.now()).then((r) => r.text());
      let ok = true;
      let msg = '문법 오류 없음';
      try { new Function(s); } catch (e) { ok = false; msg = e.message; }
      results.push(ok);
      addRow('문법', label + ' 문법 검사', ok, null, msg);
    }
    serverTests.forEach(([name, fn], i) => {
      const [p7, n7] = runServer(srcNew, fn);
      const [p6, n6] = runServer(srcOld, fn);
      results.push(p7);
      addRow(i + 1, name, p7, p6, '9차: ' + n7 + ' / 8차: ' + n6);
    });
    for (let i = 0; i < siteTests.length; i++) {
      const [name, fn] = siteTests[i];
      let p = false;
      let note = '';
      try { const w = await loadSite(); [p, note] = await fn(w); } catch (e) { note = '오류: ' + e.message; }
      results.push(p);
      addRow('S' + (i + 1), name, p, null, note);
    }
    const pass = results.filter((x) => x === true).length;
    const fail = results.filter((x) => x === false).length;
    const s = document.getElementById('summary');
    s.textContent = `9차: 통과 ${pass} · 실패 ${fail} (전체 ${results.length})`;
    s.className = fail ? 'fail' : 'pass';
    window.__testSummary = { pass, fail, total: results.length };
  })();
})();
