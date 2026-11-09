(function () {
  'use strict';

  const SCRIPT_URL = ((window.HR_CONFIG || {}).scriptUrl || '').trim();
  const MONTHS = ['준비', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2'];
  const VIEWS = ['month', 'year', 'grade', 'conv', 'subj', 'forms', 'res'];
  const CAT_COLORS = {
    '상담': '#3b6fd8', '생기부': '#8b5cd6', '수능·모의고사': '#e07a1f', '수시': '#1f9a6e', '정시': '#1a86a8',
    '면접': '#d24f7b', '출결': '#6c5ce7', '학급운영': '#7d8590', '학부모': '#c99212', '행정': '#5f6672',
    '학사': '#6a9a1f', '연수': '#1599b0', '안내': '#b05cc7',
  };
  // 연간 흐름표에 줄로 보여줄 분류
  const FLOW_CATS = ['상담', '생기부', '수능·모의고사', '수시', '면접', '정시', '출결', '학급운영', '학부모', '행정'];
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5.5 12.5l4 4L18.5 8"/></svg>';
  const AUTO_REFRESH_MS = 2 * 60 * 1000; // 다른 창에서 돌아왔을 때 이보다 오래됐으면 다시 불러온다

  // 2022 개정 교육과정 선택 과목 (권장과목 확인에서 고르는 목록)
  const SUBJECTS = [
    ['수학', ['대수', '미적분Ⅰ', '확률과 통계', '미적분Ⅱ', '기하', '경제 수학', '인공지능 수학', '직무 수학', '수학과 문화', '실용 통계', '수학과제 탐구']],
    ['과학', ['물리학', '화학', '생명과학', '지구과학', '역학과 에너지', '전자기와 양자', '물질과 에너지', '화학 반응의 세계', '세포와 물질대사', '생물의 유전', '지구시스템과학', '행성우주과학', '과학의 역사와 문화', '기후변화와 환경생태', '융합과학 탐구']],
    ['정보·기술·가정', ['정보', '인공지능 기초', '데이터 과학', '기술·가정', '생활과학 탐구']],
    ['사회', ['한국사', '세계시민과 지리', '세계사', '사회와 문화', '현대사회와 윤리', '한국지리 탐구', '도시의 미래 탐구', '동아시아 역사 기행', '정치', '법과 사회', '경제', '윤리와 사상', '인문학과 윤리', '국제 관계의 이해', '여행지리', '사회문제 탐구', '금융과 경제생활', '윤리문제 탐구', '기후변화와 지속가능한 세계']],
    ['국어·영어', ['화법과 언어', '독서와 작문', '문학', '주제 탐구 독서', '문학과 영상', '독서 토론과 글쓰기', '매체 의사소통', '영어Ⅰ', '영어Ⅱ', '영어 독해와 작문', '영미 문학 읽기', '영어 발표와 토론', '심화 영어', '실생활 영어 회화', '미디어 영어', '세계 문화와 영어']],
    ['체육·예술', ['체육1', '체육2', '운동과 건강', '스포츠 문화', '스포츠 과학', '스포츠 생활1', '미술', '미술 창작', '미술 감상과 비평']],
    ['제2외국어·한문', ['한문', '한문 고전 읽기', '중국어', '중국어 회화', '심화 중국어', '일본어', '일본어 회화', '심화 일본어', '독일어', '독일어 회화', '심화 독일어', '프랑스어', '프랑스어 회화', '심화 프랑스어']],
    ['교양', ['진로와 직업', '인간과 철학', '논리와 사고', '인간과 심리', '교육의 이해', '보건', '생태와 환경', '논술']],
  ];
  // 과목 이름(띄어쓰기 무시) → 표준 이름
  const SUBJECT_KEY = new Map();
  SUBJECTS.forEach(([, list]) => list.forEach((s) => SUBJECT_KEY.set(squash(s), s)));
  // 자료집마다 다르게 적은 이름 중 같은 과목이 분명한 것만 맞춘다. '미적분'처럼 뜻이 둘인 이름은 넣지 않는다
  const ALIAS = {
    '물리': '물리학', '세포와물질대사': '세포와 물질대사', '생물과유전': '생물의 유전', '체육(1)': '체육1', '체육(2)': '체육2',
    // 4차 엑셀의 오타·다른 표기
    '사화와문화': '사회와 문화', '프랑스회화': '프랑스어 회화',
  };
  Object.keys(ALIAS).forEach((k) => SUBJECT_KEY.set(squash(k), ALIAS[k]));
  // recommend.js 한 줄: [권역, 지역, 대학, 계열·단과대, 모집단위, 핵심, 권장, 반영, 비고, 엑셀 행, 자동 판정 조건, 확인 필요 사유]
  const REC_FIELDS = ['region', 'area', 'univ', 'group', 'unit', 'core', 'rec', 'all', 'note', 'row', 'rule', 'review'];
  // 자료 도우미(채팅). provider: 서버에 AI 키가 있으면 'gemini' 또는 'claude'
  const chat = { provider: '', useAi: true, busy: false, history: [] };
  // 질문 낱말 끝의 조사·어미를 떼어 찾는다 (Code.gs의 CHAT_TAIL과 같게 유지)
  const CHAT_TAIL = /(에서는|에서|으로는|으로|까지|부터|이랑|하고|이나|인가요|있나요|할까요|해야|해요|나요|가요|은|는|이|가|을|를|에|의|도|로|와|과|만|요)$/;
  // 데이터에서 {이름}으로 부르는 과목 묶음
  const SUBJECT_SETS = {
    '과학진로선택': ['역학과 에너지', '전자기와 양자', '물질과 에너지', '화학 반응의 세계', '세포와 물질대사', '생물의 유전', '지구시스템과학', '행성우주과학'],
  };

  // ───────── 저장소: 학교·학년도·연결 대상마다 따로 저장한다

  function safeStorage(kind) {
    try { const s = window[kind]; const k = '__hr_test'; s.setItem(k, '1'); s.removeItem(k); return s; } catch (e) { return null; }
  }
  const LS = safeStorage('localStorage');
  const SS = safeStorage('sessionStorage');
  function sget(s, key, fallback) {
    if (!s) return fallback;
    try { const v = s.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function sset(s, key, value) { if (s) try { s.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ } }
  function sdel(s, key) { if (s) try { s.removeItem(key); } catch (e) { /* 무시 */ } }

  // 짧은 고정 해시(저장 키와 캘린더 UID에 쓴다. 보안 용도가 아님)
  function hash(s) {
    let h = 5381;
    for (const ch of String(s)) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
    return h.toString(36);
  }
  const BACKEND = SCRIPT_URL ? `sheet-${hash(SCRIPT_URL)}` : 'local';
  const CODE_KEY = `hr:v1:code:${BACKEND}`;
  function scope(kind, backend) {
    const s = state.data.settings;
    return `hr:v1:${s.school || '학교'}|${s.year}|${backend || 'local'}:${kind}`;
  }
  function yearKey(kind) { const s = state.data.settings; return `hr:v1:${s.school || '학교'}|${s.year}:${kind}`; }

  // 2차까지 쓰던 고정 키(hr.progress, hr.cls)를 2027학년도 송우고 '이 기기' 공간으로 복사한다. 원래 키는 지우지 않는다
  function migrateLegacy() {
    if (!LS || sget(LS, 'hr:v1:migrated', false)) return;
    const seed = (window.SEED || {}).settings || {};
    const base = `hr:v1:${seed.school || '학교'}|${seed.year || '2027'}`;
    const old = sget(LS, 'hr.progress', null);
    if (old && typeof old === 'object') {
      const target = sget(LS, `${base}|local:progress`, {});
      Object.keys(old).forEach((cls) => {
        target[cls] = target[cls] || {};
        Object.keys(old[cls] || {}).forEach((k) => { if (!target[cls][k]) target[cls][k] = Object.assign({ from: '2차 버전' }, old[cls][k]); });
      });
      sset(LS, `${base}|local:progress`, target);
    }
    const oldCls = sget(LS, 'hr.cls', '');
    if (oldCls && !sget(LS, `${base}:cls`, '')) sset(LS, `${base}:cls`, oldCls);
    sset(LS, 'hr:v1:migrated', true);
  }

  const state = {
    data: normalize(window.SEED || {}),
    recommend: seedRecommend(),
    recommendSource: 'seed',
    source: 'seed',          // seed | sheet | error
    fetchedAt: null,
    cls: '',
    code: '',
    remember: false,
    live: false,             // 학년 코드 확인 후 체크를 시트와 공유하는 중
    progress: {},            // { 반: { 업무키: {done, memo, at, srv} } }  srv = 시트에 저장된 수정 시각
    saving: new Set(),
    queues: {},
    view: viewFromHash() || sget(LS, 'hr.view', 'month'),
    month: null,
    filter: 'all',
    open: new Set(),
    forms: null,
    formsMine: true,
    gradeMonth: null,
    resQuery: '',
    conv: { dir: '9to5', value: '2.8', bulk: '', col: -1, result: null },
    subj: { picked: new Set(), query: '', region: '', univ: '', sort: 'source', limit: 40, mode: 'rec' },
    // 교직이수 개설 학과: 학년 코드 확인 뒤 시트에서만 받는다(원문 재배포 금지 자료라 사이트 파일에 넣지 않음)
    kyojik: [],
    kj: { query: '', area: '' },
  };
  if (!VIEWS.includes(state.view)) state.view = 'month';
  migrateLegacy();
  loadLocalState();
  const today = readToday();
  state.month = monthOfDate(today);
  state.gradeMonth = state.month;

  function loadLocalState() {
    state.cls = sget(LS, yearKey('cls'), '');
    state.remember = !!sget(LS, CODE_KEY, '');
    state.code = sget(SS, CODE_KEY, '') || sget(LS, CODE_KEY, '');
    if (!state.live) state.progress = sget(LS, scope('progress'), {});
  }

  const $ = (sel) => document.querySelector(sel);
  const views = {};
  VIEWS.forEach((v) => { views[v] = document.getElementById(`view-${v}`); });

  // ───────── 데이터 정리

  function normalize(raw) {
    const s = raw.settings || {};
    const classes = Array.isArray(s.classes) ? s.classes : String(s.classes || '').split(',');
    const tasks = (raw.tasks || []).map((t) => ({
      id: str(t.id), month: monthKey(t.month), cat: str(t.cat) || '기타', when: str(t.when),
      title: str(t.title), detail: str(t.detail), due: toISO(t.due), star: truthy(t.star),
      links: str(t.links).split(/[,\s]+/).filter(Boolean), note: str(t.note),
    })).filter((t) => t.id && t.title);
    return {
      settings: {
        year: str(s.year) || '2027',
        admissionYear: str(s.admissionYear) || String(Number(str(s.year) || 2027) + 1),
        school: str(s.school),
        classes: classes.map(str).filter(Boolean),
      },
      months: (raw.months || []).map((m) => ({ month: monthKey(m.month), title: str(m.title), focus: str(m.focus) })),
      tasks,
      events: (raw.events || []).map((e) => ({
        id: str(e.id), date: toISO(e.date), end: toISO(e.end), time: toTime(e.time), title: str(e.title), type: str(e.type),
        star: truthy(e.star), note: str(e.note),
      })).filter((e) => e.date && e.title).sort((a, b) => a.date.localeCompare(b.date)),
      resources: (raw.resources || []).map((r) => ({
        id: str(r.id), name: str(r.name), cat: str(r.cat) || '기타', url: safeUrl(r.url), desc: str(r.desc), locked: r.locked === true,
      })).filter((r) => r.id && r.name),
    };
  }
  function seedRecommend() {
    return (window.RECOMMEND || []).map((r) => normRec(Object.fromEntries(REC_FIELDS.map((k, i) => [k, r[i]]))));
  }
  function normRec(r) {
    const out = {
      region: str(r.region), area: str(r.area), univ: str(r.univ), group: str(r.group), unit: str(r.unit),
      core: str(r.core), rec: str(r.rec), all: str(r.all),
      note: str(r.note), row: str(r.row), page: str(r.page), rule: str(r.rule), review: str(r.review),
    };
    out.parsed = { core: parseReq(out.core), rec: parseReq(out.rec), all: parseReq(out.all), rule: parseReq(out.rule) };
    // 비고 조건(rule)은 권장과목이 있으면 권장 쪽, 없으면 핵심 쪽 조건으로 본다
    out.ruleTier = out.rec ? 'rec' : 'core';
    applyNoteCount(out);
    // 검색은 대학·계열·모집단위 이름만 본다 ('화학'을 찾으면 화학 과목이 들어간 학과가 아니라 화학과가 나오게)
    out.hay = squash(`${out.univ} ${out.group} ${out.unit}`).toLowerCase();
    return out;
  }
  // 비고의 과목 수 조건.
  //  "*A, B, C: 2과목 이상" / "-A, B 중 1과목 이상"이고 A, B, C가 모두 과목 칸에 그대로 나열돼 있으면 그 과목들을 묶음 조건으로 바꿔 판정한다.
  //  그 밖의 과목 수 조건(자동 판정 조건이 따로 없는 줄)은 '추가 확인' 항목으로 남겨 '모두 충족'으로 보이지 않게 한다
  function applyNoteCount(out) {
    if (out.rule) return;
    let rest = out.note;
    const m = out.note.match(/(?:^|[/\s])[*-]\s*([^:*/-]+?)\s*(?::|중)\s*(\d)\s*과목\s*이상/);
    if (m) {
      const names = splitTop(m[1]).map((s) => SUBJECT_KEY.get(squash(s)));
      const need = Number(m[2]);
      const tier = ['all', 'core', 'rec'].find((k) => names.every((n) => n && out.parsed[k].some((it) => it.type === 'sub' && it.name === n)));
      if (names.length && tier && need <= names.length) {
        const kept = out.parsed[tier].filter((it) => !(it.type === 'sub' && names.includes(it.name)));
        kept.push({ type: 'group', names: [...new Set(names)], need, label: `(${names.join(', ')} 중 ${need}과목)`, fromNote: true });
        out.parsed[tier] = kept;
        rest = out.note.replace(m[0], ' ');
      }
    }
    // 비고에 남은 다른 과목 수 조건이 있으면(예: "-수학: 과목 위계를 고려하여 3과목 이상") 추가 확인으로 둔다
    if (/\d\s*과목\s*이상|중\s*\d\s*과목/.test(rest)) {
      out.parsed.rule = [{ type: 'text', text: '비고의 과목 수 조건', reason: '비고에 과목 수 조건이 있어 자동 판정하지 않음 · 비고를 확인하세요' }];
    }
  }
  // 화면에 보일 출처 위치: 4차 엑셀은 행 번호, 3차 자료집 탭은 쪽수
  function recRef(r) { return r.row ? `엑셀 ${r.row}행` : r.page ? `자료집 ${r.page}쪽` : ''; }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function squash(v) { return str(v).replace(/\s+/g, ''); }
  // 시트에 '3월', '03', '학기 전'처럼 적어도 '3', '준비'로 맞춘다
  function monthKey(v) {
    const s = str(v);
    const n = s.match(/^0?(\d{1,2})\s*월?$/);
    if (n) return n[1];
    return /^(학기\s*전|준비)$/.test(s) ? '준비' : s;
  }
  function truthy(v) { return v === true || /^(true|y|yes|o|★|1|v|✓|중요)$/i.test(str(v)); }
  // 외부 링크(http)와 사이트 안 화면 이동(#conv 등)만 허용한다
  function safeUrl(v) {
    const u = str(v);
    if (/^https?:\/\//i.test(u)) return u;
    return /^#[a-z]+$/.test(u) && VIEWS.includes(u.slice(1)) ? u : '';
  }
  function toISO(v) {
    const s = str(v);
    const m = s.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  }
  function toTime(v) {
    const m = str(v).match(/^(\d{1,2}):(\d{2})/);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  }
  function esc(v) {
    return str(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fix2(n) { return (Math.round(n * 100) / 100).toFixed(2); }
  function cssEsc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'); }

  // ───────── 날짜

  function readToday() {
    // 미리보기용: 주소 끝에 ?today=2027-08-20 을 붙이면 그날 기준으로 보여 준다
    const q = toISO(new URLSearchParams(location.search).get('today'));
    const d = q ? parseDate(q) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function days(a, b) { return Math.round((b - a) / 86400000); }
  function md(iso) { const d = parseDate(iso); return `${d.getMonth() + 1}.${d.getDate()}`; }
  function range(e) {
    let out;
    if (!e.end || e.end === e.date) out = md(e.date);
    else {
      const a = parseDate(e.date); const b = parseDate(e.end);
      out = a.getMonth() === b.getMonth() ? `${md(e.date)}~${b.getDate()}` : `${md(e.date)}~${md(e.end)}`;
    }
    return e.time ? `${out} ${e.time}` : out;
  }
  function hhmm(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function baseYear() { return Number(state.data.settings.year) || 2027; }
  function monthYM(m) {
    const y = baseYear();
    if (m === '준비') return [y, 2];
    const n = Number(m);
    return n >= 3 ? [y, n] : [y + 1, n];
  }
  function monthOfDate(d) {
    const y = baseYear();
    if (d < new Date(y, 2, 1)) return '준비';
    if (d >= new Date(y + 1, 2, 1)) return '2';
    return String(d.getMonth() + 1);
  }
  function monthLabel(m) { return m === '준비' ? '학기 전' : `${m}월`; }
  function monthShort(m) { return m === '준비' ? '준비' : `${m}월`; }
  function eventsIn(m) {
    const [y, n] = monthYM(m);
    const first = new Date(y, n - 1, 1); const last = new Date(y, n, 0);
    return state.data.events.filter((e) => parseDate(e.date) <= last && parseDate(e.end || e.date) >= first);
  }

  // ───────── 업무와 진행

  function tasksFor(m) {
    const list = state.data.tasks.filter((t) => t.month === m).map((t) => Object.assign({ key: t.id }, t));
    if (m !== '준비') {
      state.data.tasks.filter((t) => t.month === '매월')
        .forEach((t) => list.push(Object.assign({ key: `${t.id}@${m}`, recurring: true }, t)));
    }
    return list;
  }
  function entry(key, cls) { return ((state.progress[cls || state.cls] || {})[key]) || null; }
  function isDone(key, cls) { const e = entry(key, cls); return !!(e && e.done); }
  function monthStats(m, cls) {
    const list = tasksFor(m);
    return { total: list.length, done: list.filter((t) => isDone(t.key, cls)).length };
  }
  function pct(s) { return s.total ? Math.round((s.done / s.total) * 100) : 0; }

  function saveLocal() { if (!state.live) sset(LS, scope('progress'), state.progress); }

  // 화면에 먼저 반영하고(낙관적 갱신), 시트 연결 중이면 같은 업무의 요청을 순서대로 보낸다.
  // 바뀐 칸만 보내고, 시트의 수정 시각(srv)이 다르면 서버가 거절해 최신 내용을 돌려준다.
  function saveEntry(key, patch) {
    if (!state.cls) { toast('먼저 우리 반을 골라 주세요.'); $('#classSelect').focus(); return Promise.resolve(false); }
    const cls = state.cls;
    const byCls = state.progress[cls] || (state.progress[cls] = {});
    const before = byCls[key] ? Object.assign({}, byCls[key]) : null;
    const token = `${Date.now()}-${Math.random()}`;
    byCls[key] = Object.assign({ done: false, memo: '' }, before, patch, { at: new Date().toISOString(), token });
    if (!state.live) { delete byCls[key].token; byCls[key].uploaded = false; saveLocal(); return Promise.resolve(true); }

    const qk = `${cls}|${key}`;
    state.saving.add(qk);
    const run = () => api('check', { cls, task: key, patch, prevAt: (state.progress[cls][key] || {}).srv || '' })
      .then((res) => {
        const cur = state.progress[cls][key];
        const e = res.entry || {};
        // 그사이 이 화면에서 더 새로 바꾼 값이 있으면 그 값은 지키고 수정 시각만 받아 둔다
        state.progress[cls][key] = cur && cur.token !== token
          ? Object.assign({}, cur, { srv: e.at })
          : { done: !!e.done, memo: e.memo || '', at: e.at, srv: e.at };
        return true;
      })
      .catch((err) => {
        const cur = state.progress[cls][key];
        if (err.conflict && err.entry) {
          state.progress[cls][key] = { done: !!err.entry.done, memo: err.entry.memo || '', at: err.entry.at, srv: err.entry.at };
          toast('다른 화면에서 먼저 고친 내용이 있어 시트의 최신 내용을 불러왔습니다. 다시 확인해 주세요.');
        } else {
          // 더 새 변경이 없을 때만 되돌린다
          if (cur && cur.token === token) { if (before) state.progress[cls][key] = before; else delete state.progress[cls][key]; }
          toast(`시트에 저장하지 못했습니다: ${err.message} 화면은 저장 전 상태로 돌아갔습니다.`);
        }
        return false;
      })
      .finally(() => { state.saving.delete(qk); if (state.view === 'month') keepFocus(views.month, renderMonth); });
    const chain = (state.queues[qk] || Promise.resolve()).then(run);
    state.queues[qk] = chain.catch(() => {});
    return chain;
  }

  // ───────── 서버(Apps Script)

  async function api(action, payload) {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      // text/plain 이어야 브라우저가 사전 요청(CORS preflight)을 보내지 않는다
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, code: state.code }, payload || {})),
    });
    const json = await res.json();
    if (!json.ok) {
      const err = new Error(json.error || '요청을 처리하지 못했습니다.');
      err.conflict = !!json.conflict;
      err.entry = json.entry || null;
      throw err;
    }
    return json;
  }

  async function loadSheet() {
    if (!SCRIPT_URL) return;
    try {
      const res = await fetch(`${SCRIPT_URL}?action=data`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      state.data = normalize(json);
      state.source = 'sheet';
      state.fetchedAt = new Date();
      const rows = (json.recommend || []).filter((r) => str(r.univ) && str(r.unit));
      if (rows.length) {
        state.recommend = rows.map(normRec);
        state.recommendSource = 'sheet';
      }
      loadLocalState(); // 시트의 학교·학년도가 기본값과 다를 수 있다
    } catch (err) {
      console.warn(err);
      state.source = 'error';
    }
  }

  async function goLive(silent) {
    if (!SCRIPT_URL || !state.code) { state.live = false; return false; }
    try {
      const json = await api('progress');
      state.progress = {};
      (json.progress || []).forEach((p) => {
        (state.progress[p.cls] || (state.progress[p.cls] = {}))[p.task] = { done: !!p.done, memo: p.memo || '', at: p.at || '', srv: p.at || '' };
      });
      state.live = true;
      state.fetchedAt = new Date();
      loadTeacherData();
      return true;
    } catch (err) {
      state.live = false;
      state.progress = sget(LS, scope('progress'), {});
      if (!silent) throw err;
      toast(`학년 코드를 확인하지 못했습니다: ${err.message}`);
      return false;
    }
  }

  // 교사용으로 표시된 자료 링크는 학년 코드를 확인한 뒤에만 받는다
  async function loadTeacherData() {
    try {
      const json = await api('teacherData');
      const byId = new Map((json.resources || []).map((r) => [str(r.id), r]));
      state.data.resources = state.data.resources.map((r) => {
        const t = byId.get(r.id);
        return t ? Object.assign({}, r, { url: safeUrl(t.url), locked: false }) : r;
      });
      state.kyojik = (json.kyojik || []).map((k) => ({
        page: str(k.page), area: str(k.area), univ: str(k.univ), group: str(k.group), depts: str(k.depts),
      })).filter((k) => k.univ && k.depts);
      chat.provider = str(json.chat);
      chatModeText();
      if (state.view === 'res' || state.view === 'month' || state.view === 'subj') render();
    } catch (err) { console.warn(err); }
  }

  // '이 기기'에만 저장된 기록 중 시트로 아직 올리지 않은 것 (같은 학교·학년도만)
  function pendingLocal() {
    const local = sget(LS, scope('progress', 'local'), {});
    const list = [];
    Object.keys(local).forEach((cls) => Object.keys(local[cls] || {}).forEach((task) => {
      const e = local[cls][task];
      if (e && !e.uploaded && (e.done || e.memo)) list.push({ cls, task, e });
    }));
    return list;
  }

  // 사용자가 누를 때만 올린다. 시트에 이미 같은 반·업무 기록이 있으면 덮어쓰지 않고 보류한다
  async function uploadPending() {
    const list = pendingLocal();
    const local = sget(LS, scope('progress', 'local'), {});
    const classes = state.data.settings.classes;
    let ok = 0; let fail = 0; let held = 0;
    for (const { cls, task, e } of list) {
      if (!classes.includes(cls) || entry(task, cls)) { held++; continue; }
      try {
        const res = await api('check', { cls, task, patch: { done: !!e.done, memo: e.memo || '' }, prevAt: '' });
        const se = res.entry || {};
        (state.progress[cls] || (state.progress[cls] = {}))[task] = { done: !!se.done, memo: se.memo || '', at: se.at, srv: se.at };
        local[cls][task] = Object.assign({}, e, { uploaded: true });
        ok++;
      } catch (err) {
        if (err.conflict) held++; else fail++;
      }
    }
    sset(LS, scope('progress', 'local'), local);
    const parts = [`올림 ${ok}개`];
    if (fail) parts.push(`실패 ${fail}개(다시 시도할 수 있게 남겨 둠)`);
    if (held) parts.push(`보류 ${held}개(시트에 이미 기록이 있거나 반 목록에 없음)`);
    toast(parts.join(', '));
    renderPendingBox();
    render();
  }

  async function refresh(manual) {
    if (!SCRIPT_URL) { if (manual) toast('시트가 연결되지 않아 새로 불러올 내용이 없습니다.'); return; }
    if (state.saving.size) { if (manual) toast('저장 중인 내용이 있어 잠시 뒤에 다시 시도해 주세요.'); return; }
    await loadSheet();
    if (state.code) await goLive(true);
    state.forms = null;
    keepFocus(views[state.view], render);
    if (manual) toast(`새로 불러왔습니다 (${hhmm(new Date())}).`);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !SCRIPT_URL) return;
    const typing = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
    if (!typing && (!state.fetchedAt || Date.now() - state.fetchedAt > AUTO_REFRESH_MS)) refresh(false);
  });

  // ───────── 공통 화면

  function render() {
    renderTop();
    const boot = $('#bootMsg');
    if (boot) boot.hidden = true;
    VIEWS.forEach((v) => { views[v].hidden = v !== state.view; });
    document.querySelectorAll('.nav [data-view], .tabbar [data-view], .more-sheet [data-view]').forEach((b) => {
      if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    // 아래 탭 바에 없는 화면을 보고 있으면 '더보기'를 켠 상태로 둔다
    const inMore = !document.querySelector(`.tabbar [data-view="${state.view}"]`);
    if (inMore) $('#moreBtn').setAttribute('aria-current', 'page'); else $('#moreBtn').removeAttribute('aria-current');
    ({ month: renderMonth, year: renderYear, grade: renderGrade, conv: renderConv, subj: renderSubj, forms: renderForms, res: renderRes })[state.view]();
  }

  // 다시 그린 뒤에도 키보드 초점이 같은 단추에 머물게 한다
  function keepFocus(container, fn) {
    const a = document.activeElement;
    let sel = null;
    if (a && container && container.contains(a) && a !== container) {
      const row = a.closest('[data-key]');
      if (a.id) sel = `#${cssEsc(a.id)}`;
      else if (a.dataset.sub) sel = `[data-sub="${cssEsc(a.dataset.sub)}"]`;
      else if (row && a.dataset.act) sel = `[data-key="${cssEsc(row.dataset.key)}"] [data-act="${a.dataset.act}"]`;
      else if (a.dataset.month) sel = `[data-month="${cssEsc(a.dataset.month)}"]${a.classList.contains('cellbtn') ? `.cellbtn[data-cat="${cssEsc(a.dataset.cat || '')}"]` : ''}`;
      else if (a.dataset.filter) sel = `[data-filter="${cssEsc(a.dataset.filter)}"]`;
      else if (a.dataset.dir) sel = `[data-dir="${cssEsc(a.dataset.dir)}"]`;
      else if (a.dataset.sort) sel = `[data-sort="${cssEsc(a.dataset.sort)}"]`;
      else if (a.dataset.act) sel = `[data-act="${cssEsc(a.dataset.act)}"]`;
      else if (a.dataset.preset) sel = `[data-preset="${cssEsc(a.dataset.preset)}"]`;
      else if (a.dataset.mine) sel = `[data-mine="${cssEsc(a.dataset.mine)}"]`;
    }
    fn();
    if (sel) { const el = container.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
  }

  function renderTop() {
    const s = state.data.settings;
    $('#brandSub').textContent = `${s.school ? s.school + ' · ' : ''}${s.year}학년도 · ${s.admissionYear} 대입`;
    const sel = $('#classSelect');
    sel.innerHTML = ['<option value="">반 선택</option>']
      .concat(s.classes.map((c) => `<option ${c === state.cls ? 'selected' : ''}>${esc(c)}</option>`)).join('');
    let text = '오프라인 모드 · 이 기기에만 저장';
    let st = 'local';
    if (state.source === 'error') { text = '시트 연결 실패 · 기본 데이터'; st = 'error'; }
    else if (state.live) { text = '시트 연결 · 체크 공유 중'; st = 'live'; }
    else if (state.source === 'sheet') { text = '시트 연결 · 체크는 이 기기에만'; st = 'sheet'; }
    $('#statusBtn').dataset.state = st;
    $('#statusText').textContent = text;
    $('#statusBtn').title = `${text} (눌러서 시트 연결 설정)`;
    $('#footSource').textContent = state.source === 'sheet'
      ? `업무 데이터: 구글 시트${state.fetchedAt ? ` (마지막으로 불러온 시각 ${state.fetchedAt.toLocaleString('ko-KR')})` : ''}`
      : '업무 데이터: 기본 데이터(site/data.js)';
  }

  function catDot(cat) { return `<span class="dotcat" style="--c:${CAT_COLORS[cat] || '#7d8590'}">${esc(cat)}</span>`; }
  function head(over, title, lead) {
    return `<header class="page-head"><p class="overline">${over}</p><h1 tabindex="-1">${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`;
  }

  // ───────── 월별 업무

  function upcomingHtml() {
    const list = state.data.events.filter((e) => e.star && parseDate(e.end || e.date) >= today).slice(0, 4);
    if (!list.length) return '<p class="muted" style="margin:0;font-size:13px">남은 주요 일정이 없습니다.</p>';
    return list.map((e) => {
      const d = days(today, parseDate(e.date));
      const label = d > 0 ? `D-${d}` : (d === 0 ? 'D-DAY' : '진행 중');
      return `<div class="dd ${d <= 0 ? 'now' : ''}"><b>${label}</b><span>${esc(e.title)}<small>${range(e)} (${WEEK[parseDate(e.date).getDay()]})</small></span></div>`;
    }).join('');
  }

  function ringHtml(p, done, total) {
    const r = 46; const c = 2 * Math.PI * r;
    return `<div class="ring" role="img" aria-label="진행률 ${p}%">
      <svg viewBox="0 0 108 108"><circle class="track" cx="54" cy="54" r="${r}"/><circle class="val" cx="54" cy="54" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg>
      <div><b>${p}%</b><small>${done}/${total}</small></div></div>`;
  }

  function pendingNoticeHtml() {
    if (!state.live) return '';
    const n = pendingLocal().length;
    return n ? `<div class="notice warn" style="margin:0 0 14px"><span>이 기기에만 저장된 ${esc(state.data.settings.year)}학년도 기록 ${n}개가 있습니다. 자동으로 올리지 않습니다.</span>
      <button class="btn" data-open-settings>확인하고 올리기</button></div>` : '';
  }

  function renderMonth() {
    const m = state.month;
    const info = state.data.months.find((x) => x.month === m) || { title: '', focus: '' };
    const now = monthOfDate(today);
    const rail = MONTHS.map((x) => {
      const s = monthStats(x);
      return `<button class="month-pill ${x === now ? 'now' : ''}" data-month="${x}" aria-pressed="${x === m}" aria-label="${monthLabel(x)} 업무 ${s.total}개 중 ${s.done}개 완료">
        <strong>${monthShort(x)}</strong><small>${s.done}/${s.total}</small>
        <div class="bar"><i style="width:${pct(s)}%"></i></div></button>`;
    }).join('');

    const tasks = tasksFor(m);
    const stats = monthStats(m);
    const events = eventsIn(m);
    const shown = tasks.filter((t) => {
      if (state.filter === 'star') return t.star;
      if (state.filter === 'todo') return !isDone(t.key);
      if (state.filter === 'done') return isDone(t.key);
      return true;
    });

    const groups = [];
    shown.forEach((t) => {
      const name = t.recurring ? '매월 반복' : t.cat;
      let g = groups.find((x) => x.name === name);
      if (!g) groups.push(g = { name, cat: t.recurring ? '' : t.cat, items: [] });
      g.items.push(t);
    });
    groups.sort((a, b) => (a.name === '매월 반복') - (b.name === '매월 반복'));

    const eventHtml = events.length ? events.map((e) => {
      const past = parseDate(e.end || e.date) < today;
      return `<div class="event ${e.star ? 'star' : ''} ${past ? 'past' : ''}">
        <div class="d">${range(e)}<small>${esc(e.type)}</small></div>
        <div class="t">${e.star ? '<span class="star" aria-label="중요">★</span> ' : ''}${esc(e.title)}${e.note ? `<br><small class="muted">${esc(e.note)}</small>` : ''}</div></div>`;
    }).join('') : '<p class="muted" style="margin:6px 0 0;font-size:13px">이 달에 등록된 일정이 없습니다. 학사일정은 시트의 \'일정\' 탭에 추가하세요.</p>';

    const filters = [['all', '전체'], ['star', '★ 꼭 챙길 것'], ['todo', '남은 것'], ['done', '완료']]
      .map(([k, v]) => `<button data-filter="${k}" aria-pressed="${state.filter === k}">${v}</button>`).join('');

    views.month.innerHTML = `
      <section class="hero">
        <div class="card hero-main">
          <div class="hero-text">
            <p class="hero-month"><b>${monthLabel(m)}</b><span>${m === now ? '이번 달' : esc(state.data.settings.year) + '학년도'}</span></p>
            <h1 tabindex="-1">${esc(info.title)}</h1>
            <p>${esc(info.focus)}</p>
          </div>
          ${ringHtml(pct(stats), stats.done, stats.total)}
        </div>
        <aside class="card upcoming"><h2>다가오는 주요 일정</h2>${upcomingHtml()}</aside>
      </section>
      <div class="month-rail" role="group" aria-label="달 선택">${rail}</div>
      <div class="month-body">
        <div>
          <div class="toolbar">
            <div class="seg" role="group" aria-label="업무 거르기">${filters}</div>
            <div class="right">
              ${SCRIPT_URL ? '<button class="btn" data-act="refresh">새로고침</button>' : ''}
              <button class="btn" data-act="expand">${state.open.size ? '모두 접기' : '모두 펼치기'}</button>
              <button class="btn" data-act="print">이 달 인쇄</button>
            </div>
          </div>
          ${pendingNoticeHtml()}
          ${state.cls ? '' : '<p class="notice" style="margin:0 0 14px">우리 반을 고르면 체크와 메모가 반별로 저장됩니다.</p>'}
          ${groups.length ? groups.map((g) => `
            <section class="group">
              <h3 class="group-title">${g.cat ? catDot(g.cat) : '<span class="dotcat">매월 반복</span>'}<small>${g.items.filter((t) => isDone(t.key)).length}/${g.items.length}</small></h3>
              <div class="card tasks">${g.items.map(taskHtml).join('')}</div>
            </section>`).join('') : '<div class="empty">조건에 맞는 업무가 없습니다.</div>'}
        </div>
        <aside class="card events-box"><h2>이 달의 일정</h2>${eventHtml}</aside>
      </div>`;
    // 좁은 화면에서 고른 달이 달 막대 가운데 오게 한다 (페이지는 스크롤하지 않음)
    const railEl = views.month.querySelector('.month-rail');
    const pill = railEl.querySelector('[aria-pressed="true"]');
    if (pill) railEl.scrollLeft = pill.offsetLeft - railEl.offsetLeft - (railEl.clientWidth - pill.offsetWidth) / 2;
  }

  function linkBtn(r) {
    if (!r.url) {
      return r.locked
        ? `<span class="btn off" title="교사용 자료입니다. 학년 코드를 넣으면 열립니다">${esc(r.name)} · 교사용(코드 필요)</span>`
        : `<span class="btn off" title="시트의 '자료' 탭에 링크를 넣으면 열립니다">${esc(r.name)} · 링크 미등록</span>`;
    }
    return r.url.startsWith('#')
      ? `<a class="btn" href="${esc(r.url)}">${esc(r.name)} →</a>`
      : `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)} ↗</a>`;
  }

  function taskHtml(t) {
    const e = entry(t.key);
    const done = !!(e && e.done);
    const open = state.open.has(t.key);
    const saving = state.saving.has(`${state.cls}|${t.key}`);
    let status = '';
    if (saving) status = '<span class="chip soon">저장 중…</span>';
    else if (done) status = `<span class="chip done">완료${e.at ? ' ' + md(e.at.slice(0, 10)) : ''}</span>`;
    else if (t.due) {
      const d = days(today, parseDate(t.due));
      if (d < 0) status = '<span class="chip late">기한 지남</span>';
      else if (d <= 7) status = `<span class="chip soon">${d === 0 ? '오늘까지' : 'D-' + d}</span>`;
    }
    const links = t.links.map((id) => {
      const r = state.data.resources.find((x) => x.id === id);
      return r ? linkBtn(r) : '';
    }).join('');
    const memo = (e && e.memo) || '';
    const detailId = `detail-${t.key.replace(/[^\w-]/g, '_')}`;
    return `<article class="task ${done ? 'is-done' : ''}" data-key="${esc(t.key)}">
      <div class="task-row">
        <button class="check" data-act="check" aria-pressed="${done}" aria-label="${esc(t.title)} 완료 표시" ${saving ? 'aria-busy="true"' : ''}>${CHECK_SVG}</button>
        <div class="task-main">
          <button class="task-title" data-act="open" aria-expanded="${open}" aria-controls="${detailId}">${t.star ? '<span class="star" aria-label="꼭 챙길 업무">★</span> ' : ''}${esc(t.title)}</button>
          <div class="task-meta">${t.recurring ? catDot(t.cat) : ''}<span>${esc(t.when)}</span>${status}${memo && !open ? '<span class="has-memo">메모 있음</span>' : ''}</div>
        </div>
      </div>
      <div class="task-detail" id="${detailId}" ${open ? '' : 'hidden'}>
        ${t.detail ? `<p>${esc(t.detail)}</p>` : ''}
        ${t.note ? `<p class="muted">${esc(t.note)}</p>` : ''}
        ${links ? `<div class="links">${links}</div>` : ''}
        <textarea class="memo" data-key="${esc(t.key)}" aria-label="${esc(t.title)} 메모" placeholder="우리 반 메모 (예: 미제출 3명, 9/2 재안내)">${esc(memo)}</textarea>
        <div class="memo-note">${state.live ? '메모는 시트에 저장되어 학년 코드를 아는 선생님 모두가 볼 수 있습니다. 학생 이름은 적지 마세요.' : '메모는 이 브라우저에만 저장됩니다. 학생 이름은 적지 마세요.'}</div>
      </div>
    </article>`;
  }

  views.month.addEventListener('click', async (ev) => {
    const pill = ev.target.closest('[data-month]');
    if (pill) { state.month = pill.dataset.month; state.open.clear(); keepFocus(views.month, renderMonth); return; }
    const f = ev.target.closest('[data-filter]');
    if (f) { state.filter = f.dataset.filter; keepFocus(views.month, renderMonth); return; }
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    const row = act.closest('.task');
    const key = row && row.dataset.key;
    if (act.dataset.act === 'open') {
      state.open.has(key) ? state.open.delete(key) : state.open.add(key);
      keepFocus(views.month, renderMonth);
    } else if (act.dataset.act === 'check') {
      const done = !isDone(key);
      const p = saveEntry(key, { done });
      keepFocus(views.month, renderMonth); // 저장 중 표시
      const ok = await p;
      if (ok && done) toast(state.live ? '완료로 표시하고 시트에 저장했습니다.' : '완료로 표시했습니다(이 기기).');
    } else if (act.dataset.act === 'expand') {
      if (state.open.size) state.open.clear(); else tasksFor(state.month).forEach((t) => state.open.add(t.key));
      keepFocus(views.month, renderMonth);
    } else if (act.dataset.act === 'refresh') {
      refresh(true);
    } else if (act.dataset.act === 'print') {
      const before = new Set(state.open);
      tasksFor(state.month).forEach((t) => state.open.add(t.key));
      renderMonth();
      window.print();
      state.open = before;
      renderMonth();
    }
  });
  views.month.addEventListener('change', async (ev) => {
    if (!ev.target.classList.contains('memo')) return;
    const ok = await saveEntry(ev.target.dataset.key, { memo: ev.target.value.slice(0, 500) });
    if (ok) toast(state.live ? '메모를 시트에 저장했습니다.' : '메모를 이 기기에 저장했습니다.');
  });

  // ───────── 연간 흐름

  function renderYear() {
    const now = monthOfDate(today);
    const cats = FLOW_CATS.filter((c) => state.data.tasks.some((t) => t.cat === c && t.month !== '매월'));
    const headRow = MONTHS.map((m) => `<th scope="col" class="${m === now ? 'now-col' : ''}">${monthShort(m)}</th>`).join('');
    const rows = cats.map((c) => {
      const color = CAT_COLORS[c] || '#7d8590';
      const cells = MONTHS.map((m) => {
        const list = state.data.tasks.filter((t) => t.cat === c && t.month === m);
        if (!list.length) return `<td class="${m === now ? 'now-col' : ''}"></td>`;
        const hot = list.some((t) => t.star);
        const title = list.map((t) => (t.star ? '★ ' : '') + t.title).join('\n');
        return `<td class="on ${hot ? 'hot' : ''} ${m === now ? 'now-col' : ''}" style="--c:${color}">
          <button class="cellbtn" data-month="${m}" data-cat="${esc(c)}" title="${esc(title)}" aria-label="${monthLabel(m)} ${esc(c)} 업무 ${list.length}개${hot ? ', 꼭 챙길 업무 포함' : ''}. 누르면 그 달로 이동">${list.length}</button></td>`;
      }).join('');
      return `<tr><th scope="row" class="row">${catDot(c)}</th>${cells}</tr>`;
    }).join('');

    const cards = MONTHS.map((m) => {
      const info = state.data.months.find((x) => x.month === m) || { title: '', focus: '' };
      const stars = state.data.tasks.filter((t) => t.month === m && t.star);
      const s = monthStats(m);
      return `<button class="card ycard ${m === now ? 'now' : ''}" data-month="${m}">
        <span class="m">${monthLabel(m)}${m === now ? ' · 이번 달' : ''}</span>
        <h3>${esc(info.title)}</h3>
        <p>${esc(info.focus)}</p>
        ${stars.length ? `<ul>${stars.slice(0, 5).map((t) => `<li class="${isDone(t.id) ? 'done' : ''}">${esc(t.title)}</li>`).join('')}</ul>` : ''}
        <div class="foot-line"><span>업무 ${s.total}개</span><span>${state.cls ? `${esc(state.cls)} ${pct(s)}%` : ''}</span></div>
        <div class="bar" style="margin-top:6px"><i style="width:${pct(s)}%"></i></div>
      </button>`;
    }).join('');

    views.year.innerHTML = `
      ${head(`${esc(state.data.settings.year)}학년도 · ${esc(state.data.settings.admissionYear)} 대입`, '고3 담임의 1년 흐름',
        '3월 1차 상담에서 시작해 6월 2차 상담, 8월 하반기 모의평가와 최종 상담, 9월 원서, 10~11월 면접, 12월 정시 상담으로 이어집니다. 칸을 누르면 그 달로 이동합니다.')}
      <div class="card flow">
        <table><caption class="sr-only">분류별·달별 업무 수</caption><thead><tr><th scope="col"><span class="sr-only">분류</span></th>${headRow}</tr></thead><tbody>${rows}</tbody></table>
        <div class="flow-legend"><span>숫자 = 그 달의 업무 수</span><span><i style="background:#3b6fd8"></i>꼭 챙길 업무가 있는 달</span><span><i style="background:color-mix(in srgb,#3b6fd8 18%,var(--surface))"></i>일반 업무</span>
        <button class="btn" data-act="ics" style="margin-left:auto">일정을 캘린더 파일(.ics)로 받기</button></div>
      </div>
      <div class="year-grid">${cards}</div>`;
  }

  views.year.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-month]');
    if (go) { state.month = go.dataset.month; state.open.clear(); switchView('month'); return; }
    if (ev.target.closest('[data-act="ics"]')) downloadIcs();
  });

  // RFC 5545: 한 줄은 75바이트를 넘지 않게 접는다(한글은 3바이트)
  function icsFold(line) {
    const out = []; let cur = ''; let bytes = 0;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function downloadIcs() {
    const s = state.data.settings;
    const prefix = `${s.year}-${hash(s.school || '학교')}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const icsEsc = (v) => str(v).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
    const day = (iso) => iso.replace(/-/g, '');
    const next = (iso) => { const d = parseDate(iso); d.setDate(d.getDate() + 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
    // 한국 시각(UTC+9)을 UTC로 바꿔 적는다
    const utc = (iso, time, addMin) => {
      const [y, mo, d] = iso.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
      const t = new Date(Date.UTC(y, mo - 1, d, h - 9, mi + (addMin || 0)));
      return t.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    };
    const items = [];
    state.data.events.forEach((e) => {
      const id = e.id || hash(`${e.date}|${e.title}`);
      const desc = [e.type, e.note].filter(Boolean).join(' · ');
      if (e.time && e.end && e.end !== e.date) {
        items.push({ uid: `${prefix}-ev-${id}`, allDay: true, start: e.date, end: e.end, title: e.title, desc });
        items.push({ uid: `${prefix}-ev-${id}-due`, start: e.end, time: e.time, title: `${e.title} 마감(${e.time})`, desc });
      } else if (e.time) {
        items.push({ uid: `${prefix}-ev-${id}`, start: e.date, time: e.time, title: `${e.title}(${e.time})`, desc });
      } else {
        items.push({ uid: `${prefix}-ev-${id}`, allDay: true, start: e.date, end: e.end || e.date, title: e.title, desc });
      }
    });
    state.data.tasks.filter((t) => t.due && t.star).forEach((t) => {
      items.push({ uid: `${prefix}-task-${t.id}`, allDay: true, start: t.due, end: t.due, title: `[담임] ${t.title}`, desc: t.detail });
    });
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hr-helper//KO', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:고3 담임 ${s.year}`];
    items.forEach((it) => {
      lines.push('BEGIN:VEVENT', `UID:${it.uid}@hr-helper`, `DTSTAMP:${stamp}`);
      if (it.allDay) lines.push(`DTSTART;VALUE=DATE:${day(it.start)}`, `DTEND;VALUE=DATE:${next(it.end)}`);
      else lines.push(`DTSTART:${utc(it.start, it.time)}`, `DTEND:${utc(it.start, it.time, 30)}`);
      lines.push(icsFold(`SUMMARY:${icsEsc(it.title)}`), icsFold(`DESCRIPTION:${icsEsc(it.desc)}`), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    saveFile(`고3담임_${s.year}_일정.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8');
    toast(`${items.length}개 일정을 담았습니다. 구글 캘린더 > 설정 > 가져오기에서 올리세요.`);
  }
  function saveFile(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ───────── 학년 현황

  function renderGrade() {
    const top = head('학년 공유', '반별 진행 현황', '반마다 어떤 업무를 마쳤는지 한 표로 봅니다. 학년 코드를 넣은 선생님들의 체크가 모입니다.');
    if (!state.live) { views.grade.innerHTML = top + needLiveHtml('학년 현황'); return; }
    const classes = state.data.settings.classes;
    const now = monthOfDate(today);
    const headRow = MONTHS.map((m) => `<th scope="col" style="${m === now ? 'color:var(--accent)' : ''}">${monthShort(m)}</th>`).join('');
    const rows = classes.map((c) => {
      const cells = MONTHS.map((m) => {
        const p = pct(monthStats(m, c));
        return `<td><span class="pct" style="background:color-mix(in srgb,var(--ok) ${Math.round(p * 0.32)}%,transparent)">${p}%</span></td>`;
      }).join('');
      return `<tr class="${c === state.cls ? 'mine' : ''}"><th scope="row" class="cls">${esc(c)}</th>${cells}</tr>`;
    }).join('');

    const gm = state.gradeMonth;
    const tasks = tasksFor(gm);
    const memos = [];
    const detailRows = tasks.map((t) => `<tr><th scope="row" class="task-name">${t.star ? '<span class="star" aria-label="중요">★</span> ' : ''}${esc(t.title)}</th>${classes.map((c) => {
      const e = entry(t.key, c);
      if (e && e.memo) memos.push({ t, c, memo: e.memo });
      return `<td>${e && e.done ? '<span class="y" aria-label="완료">✓</span>' : '<span class="n" aria-label="미완료">·</span>'}${e && e.memo ? '<sup aria-label="메모 있음">✎</sup>' : ''}</td>`;
    }).join('')}</tr>`).join('');

    views.grade.innerHTML = `${top}
      <div class="card grade-table">
        <h2 class="card-title" style="margin-bottom:10px">반별 · 달별 진행률</h2>
        <table><thead><tr><th scope="col" class="cls">반</th>${headRow}</tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div class="card grade-table">
        <div class="grade-sub">
          <h2 class="card-title" style="margin:0">업무별로 보기</h2>
          <label class="sr-only" for="gradeMonth">달 선택</label>
          <select id="gradeMonth">${MONTHS.map((m) => `<option value="${m}" ${m === gm ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        </div>
        <table><thead><tr><th scope="col" class="cls">업무</th>${classes.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${detailRows}</tbody></table>
        <h3 class="card-title" style="margin:18px 0 8px">이 달 메모 (✎)</h3>
        ${memos.length ? `<ul class="memo-list">${memos.map((x) => `<li><b>${esc(x.c)}</b> · ${esc(x.t.title)}<br><span>${esc(x.memo)}</span></li>`).join('')}</ul>` : '<p class="muted" style="margin:0;font-size:13px">메모가 없습니다.</p>'}
      </div>`;
  }
  views.grade.addEventListener('change', (ev) => {
    if (ev.target.id === 'gradeMonth') { state.gradeMonth = ev.target.value; keepFocus(views.grade, renderGrade); }
  });

  function needLiveHtml(title) {
    if (!SCRIPT_URL) {
      return `<div class="empty"><h3>${title}은 구글 시트를 연결하면 열립니다</h3>
        <ol><li>README의 「구글 시트 연결하기」대로 Apps Script를 배포합니다.</li>
        <li>웹 앱 주소를 <code>site/config.js</code>에 넣고 다시 올립니다.</li><li>연결 단추에서 학년 코드를 넣습니다.</li></ol></div>`;
    }
    return `<div class="empty"><h3>학년 코드를 넣으면 ${title}이 열립니다</h3>
      <p><button class="btn dark" data-open-settings>학년 코드 넣기</button></p></div>`;
  }

  // ───────── 내신 9↔5 변환

  const CONV_NOTICE = '이 결과는 과거 표본을 이용한 상담 참고용 추정값입니다. 대학의 공식 환산점수·합격선·합격 가능성을 뜻하지 않습니다. 평균등급만으로 개인의 5등급 성적이나 석차백분위를 정확히 환산할 수 없습니다. 실제 지원 판단은 해당 대학의 반영 과목·학점·성취도·환산 방식으로 확인하세요.';
  function convTable(dir) { return dir === '9to5' ? window.GRADE_9TO5 : window.GRADE_5TO9; }
  // 표의 이웃한 두 줄 사이를 직선으로 보간한다. 반환: [상, 평균, 하]
  function convert(dir, x) {
    const t = convTable(dir);
    if (!t || !t.length || !isFinite(x)) return null;
    if (x < t[0][0] || x > t[t.length - 1][0]) return null;
    for (let i = 0; i < t.length - 1; i++) {
      const a = t[i]; const b = t[i + 1];
      if (x >= a[0] && x <= b[0]) {
        const k = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
        return [1, 2, 3].map((j) => a[j] + k * (b[j] - a[j]));
      }
    }
    const last = t[t.length - 1];
    return [last[1], last[2], last[3]];
  }
  // 제도상 등급별 누적 비율 막대(개인 위치 표시는 하지 않는다)
  function scaleHtml(cuts, label) {
    const n = cuts.length;
    const parts = cuts.map((c, i) => {
      const w = c - (i ? cuts[i - 1] : 0);
      const a = Math.round(78 - (i / (n - 1)) * 70);
      return `<div style="width:${w}%;--a:${a}%" class="${a > 45 ? 'dark' : 'light'}" title="${i + 1}등급: 누적 ${c}%">${w >= 6 ? i + 1 : ''}</div>`;
    }).join('');
    return `<div class="scale-row"><span>${label}</span><div class="scale" role="img" aria-label="${label} 누적 비율 ${cuts.join(', ')}%">${parts}</div></div>`;
  }

  function renderConv() {
    const c = state.conv;
    const from = c.dir === '9to5' ? 9 : 5;
    const to = c.dir === '9to5' ? 5 : 9;
    const x = parseFloat(c.value);
    const out = convert(c.dir, x);
    const cuts = window.GRADE_CUTS;

    // 5등급 경계(누적 %)가 9등급의 몇 등급 어디쯤에 걸리는지 말로 나타낸다
    const where = (cut) => {
      const g = cuts.nine.findIndex((v) => v >= cut);
      const prev = g ? cuts.nine[g - 1] : 0;
      const f = (cut - prev) / (cuts.nine[g] - prev);
      const part = f >= 0.95 ? '끝' : f >= 0.6 ? '대부분' : f >= 0.35 ? '중간' : '앞부분';
      return `${g + 1}등급 ${part}까지`;
    };
    const cutRows = [1, 2, 3, 4, 5].map((g) => {
      const five = cuts.five[g - 1];
      return `<tr><td>${g}등급</td><td>상위 ${five}%</td><td>${(five - (g > 1 ? cuts.five[g - 2] : 0))}%</td><td>9등급 ${where(five)}</td></tr>`;
    }).join('');

    views.conv.innerHTML = `
      ${head('도구 · 2028 대입', '내신 9등급 ↔ 5등급 참고 변환',
        '대학이 공개한 9등급 입결이나 학교의 지난 진학 자료를 5등급 기준으로 대략 가늠해 보는 상담 참고 도구입니다. 개인의 합격 여부를 판단하는 도구가 아닙니다.')}
      <div class="conv-grid">
        <section class="card card-pad">
          <h2>한 개 바꾸기</h2>
          <p class="sub">대진대 입학팀 표본 연구의 변환표를 0.1(5등급은 0.05) 간격 사이에서 직선으로 이어 계산합니다.</p>
          <div class="seg" role="group" aria-label="변환 방향">
            <button data-dir="9to5" aria-pressed="${c.dir === '9to5'}">9등급 → 5등급</button>
            <button data-dir="5to9" aria-pressed="${c.dir === '5to9'}">5등급 → 9등급</button>
          </div>
          ${c.dir === '5to9' ? '<p class="muted small" style="margin:8px 0 0">5→9 표는 9→5 표를 거꾸로 계산한 것이 아니라 원 자료에 따로 실린 표입니다. 두 방향을 이어 계산하면 처음 값으로 돌아오지 않을 수 있습니다.</p>' : ''}
          <div class="conv-input">
            <label class="sr-only" for="convValue">${from}등급 평균 (1~${from})</label>
            <input id="convValue" type="number" inputmode="decimal" step="0.01" min="1" max="${from}" value="${esc(c.value)}">
            <span class="arrow" aria-hidden="true">→</span>
            <div class="conv-out" aria-live="polite"><b>${out ? fix2(out[1]) : '–'}</b><span>${to}등급 '평균' 열 값 (참고 추정)</span></div>
          </div>
          <p class="notice warn" style="margin-top:12px"><span>${CONV_NOTICE}</span></p>
          ${out ? `<div class="conv-range" aria-label="원 자료의 상·평균·하 열 값">
            <div><small>상 (원 자료 표기)</small><strong>${fix2(out[0])}</strong></div>
            <div><small>평균 (원 자료 표기)</small><strong>${fix2(out[1])}</strong></div>
            <div><small>하 (원 자료 표기)</small><strong>${fix2(out[2])}</strong></div>
          </div>
          <p class="muted small" style="margin:8px 0 0">상·평균·하가 정확히 어떤 통계값인지는 원 자료 연구보고서로 아직 확인하지 못했습니다(검증 대기). 개인별 예측 범위나 유불리로 해석하지 마세요.</p>`
          : `<p class="notice" style="margin-top:14px">1~${from} 사이의 값을 넣어 주세요.</p>`}
        </section>
        <section class="card card-pad">
          <h2>제도상 등급 비율</h2>
          <p class="sub">상대평가 등급별 누적 비율입니다. 평균등급을 이 막대 위의 위치(백분위)로 바꿀 수는 없습니다.</p>
          <div class="scale-wrap">
            ${scaleHtml(cuts.nine, '9등급')}
            ${scaleHtml(cuts.five, '5등급')}
            <div class="ticks" aria-hidden="true">${[0, 25, 50, 75, 100].map((t) => `<span style="left:${t}%">${t}%</span>`).join('')}</div>
          </div>
          <table class="cuts"><thead><tr><th scope="col">5등급</th><th scope="col">누적</th><th scope="col">비율</th><th scope="col">9등급 경계로 보면</th></tr></thead><tbody>${cutRows}</tbody></table>
        </section>
      </div>
      <section class="card card-pad bulk" style="margin-bottom:16px">
        <h2>입결 표 한꺼번에 바꾸기</h2>
        <p class="sub">엑셀·구글 시트에서 복사한 표(탭 구분) 또는 CSV(쉼표 구분, 큰따옴표 지원)를 붙여 넣으세요. 입력 척도: <b>${from}등급 평균(1~${from})</b>. 결과에 ${to}등급 상·평균·하 열이 붙습니다.</p>
        <label class="sr-only" for="bulkInput">변환할 표</label>
        <textarea id="bulkInput" placeholder="예)\n대학\t학과\t입결(9등급)\t모집인원\n○○대\t간호학과\t2.31\t3\n○○대\t컴퓨터공학과\t3.4\t5">${esc(c.bulk)}</textarea>
        <div class="toolbar" style="margin:10px 0 0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label for="bulkCol" class="muted" style="font-size:13px">바꿀 열</label>
            <select id="bulkCol" class="select"></select>
          </div>
          <div class="right">
            <button class="btn" data-act="sample">예시 넣기</button>
            <button class="btn" data-act="clear">지우기</button>
            <button class="btn dark" data-act="copy" id="bulkCopy">결과 복사</button>
          </div>
        </div>
        <div id="bulkOut" aria-live="polite"></div>
      </section>
      <details class="card full-table">
        <summary>전체 변환표 보기</summary>
        <div class="two">
          <div><p class="overline">9등급 → 5등급</p><div class="mini-wrap">${miniTable(window.GRADE_9TO5, '9등급', 10)}</div></div>
          <div><p class="overline">5등급 → 9등급</p><div class="mini-wrap">${miniTable(window.GRADE_5TO9, '5등급', 20)}</div></div>
        </div>
      </details>
      <p class="muted" style="font-size:12px;margin-top:14px">출처: ${esc(window.GRADE_SOURCE || '')}. 원점수 기반 중간석차 백분위로 재산출한 표본 추정치입니다. 원 자료의 일부 구간은 값의 순서가 뒤바뀌어 있으며 임의로 고치지 않았습니다. 사진 자료를 옮겨 적은 것으로, 원본과의 전체 대조는 검증 대기 상태입니다.</p>`;
    renderBulk();
  }

  function miniTable(rows, label, band) {
    return `<table class="mini"><thead><tr><th scope="col">${label}</th><th scope="col">상</th><th scope="col">평균</th><th scope="col">하</th></tr></thead><tbody>${
      rows.map((r, i) => `<tr class="${i && i % band === 0 ? 'band' : ''}"><td>${r[0]}</td><td>${fix2(r[1])}</td><td>${fix2(r[2])}</td><td>${fix2(r[3])}</td></tr>`).join('')
    }</tbody></table>`;
  }

  // 탭이 있으면 TSV, 아니면 CSV로 읽는다. 큰따옴표로 감싼 칸(쉼표·줄바꿈·"" 포함)을 지원한다
  function parseTable(text) {
    const delim = text.includes('\t') ? '\t' : ',';
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows.map((r) => r.map((s) => s.trim())).filter((r) => r.some((s) => s !== ''));
  }
  // 칸 전체가 숫자일 때만 등급으로 본다 ("입결(9등급)" 같은 머리글은 제외)
  function numIn(v, max) {
    if (!/^\s*\d+(\.\d+)?\s*$/.test(String(v))) return null;
    const n = parseFloat(v);
    return n >= 1 && n <= max ? n : null;
  }
  const COL_YES = /(입결|등급|내신|컷|cut|평균|성적|환산)/i;
  const COL_NO = /(모집|인원|경쟁|률|명|번호|순위|충원|예비|학번|연도|년도|학년도)/;
  // 머리글로 입결 열을 고른다. 애매하면 고르지 않고(-1) 직접 고르게 한다
  function pickColumn(rows, width, max, header) {
    const cands = [];
    for (let i = 0; i < width; i++) {
      const body = header ? rows.slice(1) : rows;
      if (body.some((r) => numIn(r[i] || '', max) != null)) cands.push(i);
    }
    if (header) {
      const yes = cands.filter((i) => COL_YES.test(header[i] || '') && !COL_NO.test(header[i] || ''));
      return yes.length === 1 ? { col: yes[0], why: 'header' } : { col: -1, why: yes.length ? 'many' : 'none' };
    }
    return cands.length === 1 ? { col: cands[0], why: 'only' } : { col: -1, why: cands.length ? 'noheader' : 'none' };
  }
  // 스프레드시트에 다시 붙일 때 수식으로 실행되지 않게 = + - @ 로 시작하는 글자 칸 앞에 ' 를 붙인다(숫자는 그대로)
  function cellOut(v) { return /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v; }

  function renderBulk() {
    const c = state.conv;
    const max = c.dir === '9to5' ? 9 : 5;
    const to = c.dir === '9to5' ? '5등급' : '9등급';
    const sel = $('#bulkCol');
    const box = $('#bulkOut');
    const copyBtn = $('#bulkCopy');
    const raw = c.bulk.trim() ? parseTable(c.bulk) : [];
    const width = Math.max(0, ...raw.map((r) => r.length));
    const rows = raw.map((r) => r.concat(Array(width - r.length).fill(''))); // 표시와 복사가 같은 칸 수를 쓴다
    state.conv.result = null;
    copyBtn.disabled = true;
    if (!rows.length) {
      sel.innerHTML = '<option value="-1">표를 붙여 넣으면 고를 수 있어요</option>';
      sel.disabled = true;
      box.innerHTML = '';
      return;
    }
    const firstNumeric = rows[0].some((v) => numIn(v, max) != null);
    const header = !firstNumeric && rows.length > 1 ? rows[0] : null;
    const auto = pickColumn(rows, width, max, header);
    const col = c.col >= 0 && c.col < width ? c.col : auto.col;
    sel.disabled = false;
    sel.innerHTML = '<option value="-1">— 열을 고르세요 —</option>' + Array.from({ length: width }, (_, i) =>
      `<option value="${i}" ${i === col ? 'selected' : ''}>${String.fromCharCode(65 + i)}열${header && header[i] ? ' · ' + esc(header[i]) : ''}</option>`).join('');
    if (col < 0) {
      const why = { many: '입결로 보이는 열이 여러 개입니다.', none: `머리글에서 입결 열을 찾지 못했습니다(1~${max} 숫자 열이 없거나 모집인원·경쟁률 같은 열만 있음).`, noheader: '머리글이 없고 숫자 열이 여러 개입니다.' }[auto.why] || '';
      box.innerHTML = `<p class="notice warn" style="margin-top:12px"><span>${why} 잘못 바꾸지 않도록 자동으로 고르지 않았습니다. 위 「바꿀 열」에서 입결 열을 직접 골라 주세요.</span></p>`;
      return;
    }
    const outRows = rows.map((r, i) => {
      if (i === 0 && header) return { cells: r, add: [`${to}(상)·참고 추정`, `${to}(평균)·참고 추정`, `${to}(하)·참고 추정`], head: true };
      const v = numIn(r[col] || '', max);
      const res = v == null ? null : convert(c.dir, v);
      return { cells: r, add: res ? res.map(fix2) : ['', '', ''] };
    });
    const body = outRows.filter((r) => !r.head);
    const converted = body.filter((r) => r.add[1]).length;
    const samples = body.map((r) => r.cells[col]).filter(Boolean).slice(0, 3).join(', ');
    state.conv.result = { rows: outRows, source: window.GRADE_SOURCE || '' };
    copyBtn.disabled = !converted;
    box.innerHTML = `<p class="result-meta" style="margin-top:12px"><span>변환 열: <b>${String.fromCharCode(65 + col)}열${header && header[col] ? ` 「${esc(header[col])}」` : ''}</b> · 예: ${esc(samples)} · ${converted}줄 변환${body.length - converted ? `, 1~${max} 숫자가 아닌 ${body.length - converted}줄은 비워 둠` : ''}${auto.why === 'only' && c.col < 0 ? ' · 머리글이 없어 하나뿐인 숫자 열을 골랐습니다. 맞는지 확인하세요' : ''}</span></p>
      <div class="bulk-out"><table>${outRows.map((r) => `<tr>${r.cells.map((v, j) => r.head ? `<th scope="col">${esc(v)}</th>` : `<td class="${j === col ? 'num' : ''}">${esc(v)}</td>`).join('')}${
        r.add.map((v) => r.head ? `<th scope="col">${esc(v)}</th>` : `<td class="num new">${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>
      <p class="muted small" style="margin:8px 0 0">복사 결과 마지막 줄에 출처와 '참고 추정' 안내가 함께 들어갑니다.</p>`;
  }

  views.conv.addEventListener('click', async (ev) => {
    const d = ev.target.closest('[data-dir]');
    if (d) { state.conv.dir = d.dataset.dir; state.conv.value = d.dataset.dir === '9to5' ? '2.8' : '1.8'; state.conv.col = -1; keepFocus(views.conv, renderConv); return; }
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'sample') {
      state.conv.bulk = state.conv.dir === '9to5'
        ? '대학\t학과\t전형\t입결(9등급)\t모집인원\n○○대\t간호학과\t학생부교과\t2.31\t3\n○○대\t컴퓨터공학과\t학생부종합\t3.4\t5\n△△대\t경영학과\t학생부교과\t4.12\t8\n△△대\t기계공학과\t학생부종합\t5.05\t4'
        : '학생\t5등급 평균\nA\t1.62\nB\t2.35\nC\t3.1';
      state.conv.col = -1;
      keepFocus(views.conv, renderConv);
    } else if (act.dataset.act === 'clear') {
      state.conv.bulk = ''; state.conv.col = -1; state.conv.result = null;
      keepFocus(views.conv, renderConv);
    } else if (act.dataset.act === 'copy') {
      const r = state.conv.result;
      if (!r || !r.rows.length) { toast('복사할 결과가 없습니다.'); return; }
      const lines = r.rows.map((row) => row.cells.concat(row.add).map(cellOut).join('\t'));
      lines.push(`출처: ${r.source} · 상담 참고용 추정값이며 대학의 공식 환산·합격선이 아님`);
      try { await navigator.clipboard.writeText(lines.join('\n')); toast('복사했습니다. 엑셀이나 구글 시트에 붙여 넣으세요.'); }
      catch (e) { toast('복사하지 못했습니다. 표를 드래그해서 복사해 주세요.'); }
    }
  });
  views.conv.addEventListener('input', (ev) => {
    if (ev.target.id === 'convValue') {
      state.conv.value = ev.target.value;
      keepFocus(views.conv, renderConv);
    } else if (ev.target.id === 'bulkInput') {
      state.conv.bulk = ev.target.value;
      state.conv.col = -1;
      renderBulk();
    }
  });
  views.conv.addEventListener('change', (ev) => {
    if (ev.target.id === 'bulkCol') { state.conv.col = Number(ev.target.value); renderBulk(); }
  });

  // ───────── 권장과목 확인

  // 글을 판정 항목으로 나눈다.
  //  sub: 과목 하나 / group: "(A, B 중 n과목)", "[A 또는 B]", "A/B 중 n과목 이상" 또는 {묶음} / text: 자동 판정하지 않는 조건(이유 포함)
  function parseReq(text) {
    const items = [];
    if (!text) return items;
    // 칸 전체가 "A, B 중 n과목 (이상)(이수)" 한 문장이면 통째로 묶음이다 (예: "기하, 미적분Ⅱ 중 1과목 이수")
    const whole = text.trim().match(/^([^()[\]{}]+?)\s*중\s*(\d)\s*과목(?:\s*이상)?(?:\s*이수)?$/);
    if (whole && !/또는|\//.test(whole[1])) return [makeGroup(whole[1], Number(whole[2]), whole[0])];
    const groups = [];
    const rest = text
      .replace(/[([]([^()[\]]*?)\s*중\s*(\d)\s*과목(?:\s*이상)?[)\]]/g, (_, inner, n) => {
        groups.push(makeGroup(inner, Number(n), `(${inner} 중 ${n}과목)`));
        return `§${groups.length - 1}§`;
      })
      // [A 또는 B] → 둘 중 1과목
      .replace(/\[([^[\]]+?)\]/g, (all, inner) => {
        if (!/또는/.test(inner)) return all;
        const parts = inner.split(/\s*또는\s*/);
        groups.push(makeGroup(parts.join(', '), 1, `(${parts.join(', ')} 중 1과목)`));
        return `§${groups.length - 1}§`;
      });
    splitTop(rest).forEach((tok) => {
      const t = tok.trim().replace(/^[-\s]+|[\s]+$/g, '');
      if (!t || t === '-') return;
      const g = t.match(/^§(\d+)§$/);
      if (g) { items.push(groups[Number(g[1])]); return; }
      // A 또는 B
      if (/^[^()[\]]+\s또는\s[^()[\]]+$/.test(t)) {
        const parts = t.split(/\s*또는\s*/);
        items.push(makeGroup(parts.join(', '), 1, `(${parts.join(', ')} 중 1과목)`));
        return;
      }
      // A/B/C 중 n과목 (이상)
      const slash = t.match(/^([^()[\]]+\/[^()[\]]+?)\s*중\s*(\d)\s*과목(?:\s*이상)?(?:\s*이수)?$/);
      if (slash) {
        const parts = slash[1].split(/\s*\/\s*/);
        items.push(makeGroup(parts.join(', '), Number(slash[2]), `(${parts.join(', ')} 중 ${slash[2]}과목)`));
        return;
      }
      const direct = SUBJECT_KEY.get(squash(t));
      if (direct) { items.push({ type: 'sub', name: direct }); return; }
      if (squash(t) === '미적분') { items.push({ type: 'text', text: t, reason: '미적분Ⅰ·Ⅱ 중 어느 과목인지 원문 확인 필요' }); return; }
      const m = t.match(/^(수학|과학|사회|국어|영어)\s*\((.*)\)$/);
      if (m) {
        const inner = splitTop(m[2]).map((s) => s.trim());
        const subs = inner.map((s) => SUBJECT_KEY.get(squash(s)));
        if (inner.length && subs.every(Boolean) && !inner.some((s) => /^특히/.test(s))) {
          [...new Set(subs)].forEach((s) => items.push({ type: 'sub', name: s }));
          return;
        }
      }
      items.push({ type: 'text', text: t, reason: '교과 영역이나 조건 문장이라 자동 판정하지 않음' });
    });
    return items;
  }
  // 묶음 조건: 과목 이름과 {묶음}을 펼쳐 같은 과목은 한 번만 센다. 해석할 수 없으면 판정 불가 항목으로 만든다
  function makeGroup(inner, need, label) {
    const names = [];
    let unknown = false;
    splitTop(inner).forEach((s) => {
      const t = s.trim();
      const set = t.match(/^\{(.+)\}$/);
      if (set && SUBJECT_SETS[set[1]]) { names.push(...SUBJECT_SETS[set[1]]); return; }
      const k = SUBJECT_KEY.get(squash(t));
      if (k) names.push(k); else unknown = true;
    });
    const uniq = [...new Set(names)];
    if (unknown) return { type: 'text', text: label, reason: '묶음 안에 목록에 없는 과목·영역이 있어 자동 판정하지 않음' };
    if (!(need >= 1) || need > uniq.length) return { type: 'text', text: label, reason: `요구 과목 수(${need})가 서로 다른 인정 과목 수(${uniq.length})보다 많아 판정 불가` };
    return { type: 'group', names: uniq, need, label: label.replace(/\{과학진로선택\}/, '과학 진로 선택 과목') };
  }
  function splitTop(s) {
    const out = []; let depth = 0; let cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.filter((x) => x.trim());
  }
  // 항목 하나: 'ok' 충족 / 'miss' 미충족 / 'unknown' 판정 불가
  function itemState(it) {
    const p = state.subj.picked;
    if (it.type === 'sub') return p.has(it.name) ? 'ok' : 'miss';
    if (it.type === 'group') return it.names.filter((n) => p.has(n)).length >= it.need ? 'ok' : 'miss';
    return 'unknown';
  }
  function tally(items) {
    const t = { ok: 0, miss: 0, unknown: 0, auto: 0 };
    items.forEach((it) => { const s = itemState(it); t[s]++; if (s !== 'unknown') t.auto++; });
    return t;
  }
  // 모집단위 하나의 판정. 합격·지원자격 판정이 아니라 '대학이 밝힌 권장 이수 과목과의 대조'다
  function evaluate(r) {
    const coreItems = r.parsed.core.concat(r.parsed.all, r.ruleTier === 'core' ? r.parsed.rule : []);
    const recItems = r.parsed.rec.concat(r.ruleTier === 'rec' ? r.parsed.rule : []);
    const core = tally(coreItems); const rec = tally(recItems);
    const unknown = core.unknown + rec.unknown;
    let status;
    if (!coreItems.length && !recItems.length) status = r.review ? 'hold' : 'none';
    else if (r.review) status = 'hold';
    else if (core.miss) status = 'miss';
    else if (!core.auto && !rec.auto) status = 'unknown';
    else if (unknown) status = 'partial';
    else status = 'ok';
    return { core, rec, unknown, status };
  }
  const STATUS = {
    ok: ['full', '자동 확인한 조건 모두 충족'],
    partial: ['warn', '추가 확인 필요'],
    miss: ['miss', '핵심·반영 미충족 있음'],
    hold: ['warn', '판정 보류 · 원문 확인'],
    unknown: ['', '자동 판정 불가'],
    none: ['', '지정 과목 없음'],
  };
  const SORT_ORDER = { ok: 0, partial: 1, miss: 2, hold: 3, unknown: 4, none: 5 };

  function chipsHtml(items, kind) {
    const picking = state.subj.picked.size > 0;
    return items.map((it) => {
      if (it.type === 'text') return `<span class="sub-chip text" title="${esc(it.reason)}">${esc(it.text)}<span class="sr-only"> (${esc(it.reason)})</span></span>`;
      const s = itemState(it);
      const cls = !picking ? '' : s === 'ok' ? 'ok' : `miss ${kind === 'rec' ? 'rec' : ''}`;
      const mark = picking ? (s === 'ok' ? '✓ ' : '') : '';
      const sr = picking ? `<span class="sr-only"> (${s === 'ok' ? '충족' : '미충족'})</span>` : '';
      if (it.type === 'group') return `<span class="sub-chip group ${cls}">${mark}${esc(it.label)}${sr}</span>`;
      return `<span class="sub-chip ${cls}">${mark}${esc(it.name)}${sr}</span>`;
    }).join('');
  }

  function subjModeHtml() {
    const m = state.subj.mode;
    return `<div class="seg" role="group" aria-label="보기 고르기" style="margin-bottom:14px">
      <button data-mode="rec" aria-pressed="${m === 'rec'}">권장과목 대조</button>
      <button data-mode="kyojik" aria-pressed="${m === 'kyojik'}">교직이수 개설 학과</button></div>`;
  }

  function renderKyojik(target = views.subj) {
    const k = state.kj;
    const rows = state.kyojik;
    const areas = [...new Set(rows.map((r) => r.area).filter(Boolean))];
    const words = k.query.toLowerCase().split(/\s+/).filter(Boolean).map(squash);
    const list = rows.filter((r) => (!k.area || r.area === k.area)
      && words.every((w) => squash(`${r.univ} ${r.group} ${r.depts}`).toLowerCase().includes(w)));
    const byUniv = new Map();
    list.forEach((r) => { if (!byUniv.has(r.univ)) byUniv.set(r.univ, []); byUniv.get(r.univ).push(r); });
    const card = ([univ, items]) => `<article class="card unit">
        <div class="unit-head"><h3><span class="univ">${esc(items[0].area)}</span>${esc(univ)}</h3></div>
        ${items.map((r) => `<div class="req"><b>${esc(r.group)}</b><div class="subs">${r.depts.split(/,\s*(?![^()]*\))/).map((d) => `<span class="sub-chip">${esc(d)}</span>`).join('')}</div></div>`).join('')}
        <p class="unit-note"><span class="pg">원문 ${esc(items[0].page)}쪽</span></p>
      </article>`;
    const body = !rows.length
      ? `<div class="notice" style="margin-bottom:16px"><span>${state.live
        ? "시트에 '교직이수' 탭이 없거나 비어 있습니다. Apps Script를 4차 Code.gs로 다시 배포했는지 확인하세요."
        : '학년 코드를 넣어 시트에 연결한 선생님만 볼 수 있습니다. 원문에 \'무단전재 및 재배포 금지\'가 적혀 있어 공개 사이트 파일에는 싣지 않고 학교 시트에만 두었습니다.'}</span></div>`
      : `<div class="search-row">
          <label class="sr-only" for="kjSearch">대학·학과 이름으로 찾기</label>
          <input id="kjSearch" type="search" placeholder="대학이나 학과 이름 (예: 수학, 간호, 부산대 화학)" value="${esc(k.query)}">
          <label class="sr-only" for="kjArea">지역 고르기</label>
          <select id="kjArea" class="select"><option value="">전체 지역</option>${areas.map((a) => `<option ${a === k.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        </div>
        <div id="kjResults">
        <div class="result-meta"><span>${byUniv.size}개 대학 · ${list.length}줄</span></div>
        ${byUniv.size ? [...byUniv].map(card).join('') : '<div class="empty">찾는 학과가 없습니다. 다른 이름으로 찾아보세요.</div>'}
        </div>`;
    target.innerHTML = `
      ${head('도구 · 2027학년도 기준', '교직이수 개설 학과',
        '대학별로 교직과정(중등 교원자격)을 이수할 수 있는 학과입니다. 사범대학이 아닌 학과를 고르는 학생 상담에 씁니다.')}
      ${subjModeHtml()}
      <div class="notice warn" style="margin-bottom:12px"><span><b>2027학년도 기준 자료입니다.</b> 지금 고3(2028학년도 입학)이 입학할 때는 바뀔 수 있고, 교직이수는 입학 후 선발 인원·성적 기준이 따로 있습니다. 상담 때 해당 대학 학과 안내를 꼭 함께 확인하세요.</span></div>
      <div class="notice" style="margin-bottom:16px"><span>출처: 한국대학교육협의회 「2027학년도 교직이수 개설 학과」(대입정보포털 어디가). 원문 그대로 옮겼습니다(원문 표기 오류도 고치지 않음).</span></div>
      ${body}`;
  }

  function renderSubj(target = views.subj) {
    if (state.subj.mode === 'kyojik') { renderKyojik(target); return; }
    const s = state.subj;
    const meta = window.RECOMMEND_META || {};
    const regions = [...new Set(state.recommend.map((r) => r.region).filter(Boolean))];
    const inRegion = state.recommend.filter((r) => !s.region || r.region === s.region);
    const univs = [...new Set(inRegion.map((r) => r.univ))];
    if (s.univ && !univs.includes(s.univ)) s.univ = '';
    const words = s.query.toLowerCase().split(/\s+/).filter(Boolean).map(squash);
    let list = inRegion.filter((r) => (!s.univ || r.univ === s.univ) && words.every((w) => r.hay.includes(w)));
    const picking = s.picked.size > 0;
    if (picking && s.sort === 'fit') {
      const key = (r) => {
        const e = evaluate(r);
        const ratio = (t) => (t.auto ? t.ok / t.auto : 0);
        return [SORT_ORDER[e.status], -ratio(e.core), -ratio(e.rec)];
      };
      list = list.map((r) => ({ r, k: key(r) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]).map((x) => x.r);
    }
    const shown = list.slice(0, s.limit);

    const pickHtml = SUBJECTS.map(([group, subs], gi) => {
      const chips = subs.map((n) => `<button class="pick" data-sub="${esc(n)}" aria-pressed="${s.picked.has(n)}">${esc(n)}</button>`).join('');
      const pickedHere = subs.filter((n) => s.picked.has(n)).length;
      return gi < 2
        ? `<div class="pick-group" role="group" aria-label="${group}"><p>${group}</p><div class="picks">${chips}</div></div>`
        : `<div class="pick-group"><details ${pickedHere ? 'open' : ''}><summary>${group}${pickedHere ? ` · ${pickedHere}` : ''}</summary><div class="picks" role="group" aria-label="${group}">${chips}</div></details></div>`;
    }).join('');

    const unitHtml = (r) => {
      const e = evaluate(r);
      const badges = [];
      if (picking) {
        const [cls, label] = STATUS[e.status];
        badges.push(`<span class="${cls}">${label}</span>`);
        if (e.core.auto) badges.push(`<span>핵심·반영 자동 ${e.core.ok}/${e.core.auto}</span>`);
        if (e.rec.auto) badges.push(`<span>권장 자동 ${e.rec.ok}/${e.rec.auto}</span>`);
        if (e.unknown) badges.push(`<span class="warn">추가 확인 ${e.unknown}</span>`);
      } else if (r.review) badges.push('<span class="warn">판정 보류 · 원문 확인</span>');
      const req = (label, items, kind) => items.length ? `<div class="req ${kind === 'core' ? 'core' : ''}"><b>${label}</b><div class="subs">${chipsHtml(items, kind)}</div></div>` : '';
      return `<article class="card unit status-${e.status}">
        <div class="unit-head"><h3><span class="univ">${esc(r.univ)}${r.group ? ` · ${esc(r.group)}` : ''}</span>${esc(r.unit)}</h3>
          <div class="score">${badges.join('')}</div></div>
        ${req('핵심', r.parsed.core, 'core')}${req('반영', r.parsed.all, 'core')}${req('권장', r.parsed.rec, 'rec')}
        ${r.parsed.rule.length ? req('비고 조건', r.parsed.rule, r.ruleTier) : ''}
        ${e.status === 'none' ? '<div class="req"><b>과목</b><div class="subs"><span class="sub-chip text">지정 없음</span></div></div>' : ''}
        ${r.review ? `<p class="unit-review">⚠ ${esc(r.review)}</p>` : ''}
        <p class="unit-note">${esc(r.note)}${recRef(r) ? `<span class="pg">${r.note ? '· ' : ''}${esc(recRef(r))}</span>` : ''}</p>
      </article>`;
    };

    target.innerHTML = `
      ${head('도구 · 2022 개정 교육과정', '대학별 권장과목 대조',
        '학생이 이수했거나 이수할 과목을 고르면, 대학이 밝힌 핵심·권장 과목과 대조합니다. 고른 과목은 저장되지 않습니다.')}
      ${subjModeHtml()}
      <div class="notice warn" style="margin-bottom:12px"><span><b>지원자격·합격 가능성·가점 판정이 아닙니다.</b> 대학이 발표한 '권장 이수 과목'과 자동으로 대조할 수 있는 범위만 계산합니다.
        '추가 확인'은 교과 영역 표현, 과목 수·학점 조건, 뜻이 둘인 과목명('미적분' 등)처럼 프로그램이 판정하지 않은 조건 수입니다.</span></div>
      <div class="notice" style="margin-bottom:16px"><span>기준 자료: ${esc(meta.source || '')}. ${esc(meta.status || '')}. 지원 전 해당 대학의 최신 모집요강을 확인하세요.</span></div>
      <div class="subj-layout">
        <aside class="card picker" aria-label="이수 과목 고르기">
          <h2>이수 과목 <small>${s.picked.size}개 선택</small></h2>
          <p class="sub" style="margin:0">일반·진로·융합 선택 과목. 공통과목은 빼고 고르세요.</p>
          ${pickHtml}
          <div class="pick-tools">
            <button class="btn" data-preset="nat">자연계 기본</button>
            <button class="btn" data-preset="hum">인문계 기본</button>
            <button class="btn" data-preset="clear">모두 해제</button>
          </div>
        </aside>
        <div>
          <div class="search-row">
            <label class="sr-only" for="subjSearch">학과나 대학 이름으로 찾기</label>
            <input id="subjSearch" type="search" placeholder="학과나 대학 이름 (예: 간호, 컴퓨터, 고려대 화학)" value="${esc(s.query)}">
            ${regions.length ? `<label class="sr-only" for="subjRegion">권역 고르기</label>
            <select id="subjRegion" class="select"><option value="">전체 권역</option>${regions.map((g) => `<option ${g === s.region ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}
            <label class="sr-only" for="subjUniv">대학 고르기</label>
            <select id="subjUniv" class="select"><option value="">전체 대학 (${univs.length})</option>${univs.map((u) => `<option ${u === s.univ ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
          </div>
          <div id="subjResults">
          <div class="result-meta">
            <span>자료 ${list.length}줄${list.length > shown.length ? ` 중 ${shown.length}줄 표시` : ''} <small class="muted">(한 줄에 여러 모집단위가 묶여 있을 수 있음)</small></span>
            ${picking ? `<div class="seg" role="group" aria-label="정렬"><button data-sort="source" aria-pressed="${s.sort === 'source'}">자료 순</button><button data-sort="fit" aria-pressed="${s.sort === 'fit'}">자동 확인 결과 순</button></div>` : '<span>과목을 고르면 대조 결과가 표시됩니다</span>'}
          </div>
          ${picking && s.sort === 'fit' ? '<p class="muted small" style="margin:-4px 2px 10px">정렬 순서: 모두 충족 → 추가 확인 필요 → 미충족 있음 → 판정 보류 → 자동 판정 불가 → 지정 없음. 합격 가능성이나 전공 적합도 순위가 아닙니다.</p>' : ''}
          ${shown.length ? shown.map(unitHtml).join('') : '<div class="empty">찾는 모집단위가 없습니다. 다른 이름으로 찾아보세요.</div>'}
          ${list.length > shown.length ? `<p style="text-align:center"><button class="btn" data-more>더 보기 (${list.length - shown.length}줄 남음)</button></p>` : ''}
          ${seedOfferHtml()}
          <p class="muted" style="font-size:12px;margin-top:14px">출처: ${state.recommendSource === 'sheet' ? '구글 시트 \'권장과목\' 탭' : esc(meta.source || '')}. 권역별 엑셀 ${state.recommend.length.toLocaleString()}줄을 옮겨 두었습니다. 점선 항목은 자동 판정하지 않는 조건입니다(마우스를 올리거나 화면 읽기 프로그램으로 이유 확인).</p>
          </div>
        </div>
      </div>`;
  }
  function seedOfferHtml() {
    if (!state.live || state.recommendSource === 'sheet') return '';
    return `<div class="notice" style="margin-top:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span>이 표를 구글 시트 '권장과목' 탭으로 보내면 선생님들이 대학을 추가하거나 고칠 수 있습니다. 탭이 비어 있을 때만 채웁니다.</span>
      <button class="btn dark" data-seed>시트로 보내기</button></div>`;
  }

  views.subj.addEventListener('click', async (ev) => {
    const s = state.subj;
    const mode = ev.target.closest('[data-mode]');
    if (mode) { s.mode = mode.dataset.mode; renderSubjKeep(); return; }
    const b = ev.target.closest('[data-sub]');
    if (b) { const n = b.dataset.sub; s.picked.has(n) ? s.picked.delete(n) : s.picked.add(n); renderSubjKeep(); return; }
    const p = ev.target.closest('[data-preset]');
    if (p) {
      const presets = {
        nat: ['대수', '미적분Ⅰ', '확률과 통계', '미적분Ⅱ', '기하', '물리학', '화학', '생명과학'],
        hum: ['대수', '미적분Ⅰ', '확률과 통계', '사회와 문화', '세계시민과 지리', '현대사회와 윤리', '화법과 언어', '독서와 작문', '문학', '영어Ⅰ', '영어Ⅱ'],
      };
      if (p.dataset.preset === 'clear') s.picked.clear(); else (presets[p.dataset.preset] || []).forEach((n) => s.picked.add(n));
      renderSubjKeep();
      return;
    }
    const sort = ev.target.closest('[data-sort]');
    if (sort) { s.sort = sort.dataset.sort; renderSubjKeep(); return; }
    if (ev.target.closest('[data-more]')) { s.limit += 40; renderSubjKeep(); return; }
    if (ev.target.closest('[data-seed]')) {
      // Code.gs의 권장과목 머리글 순서: 12개 필드 + 자료집 쪽
      const rows = state.recommend.map((r) => REC_FIELDS.map((k) => r[k]).concat(r.page));
      try {
        await api('seedRecommend', { rows });
        toast(`${rows.length}줄을 시트 '권장과목' 탭에 만들었습니다.`);
        state.recommendSource = 'sheet';
        renderSubjKeep();
      } catch (err) { toast(`보내지 못했습니다: ${err.message}`); }
    }
  });
  views.subj.addEventListener('input', (ev) => {
    const id = ev.target.id;
    if (id !== 'subjSearch' && id !== 'kjSearch') return;
    if (id === 'kjSearch') state.kj.query = ev.target.value;
    else { state.subj.query = ev.target.value; state.subj.limit = 40; }
    refreshResults(views.subj, renderSubj, id === 'kjSearch' ? '#kjResults' : '#subjResults');
  });
  views.subj.addEventListener('change', (ev) => {
    if (ev.target.id === 'subjUniv') { state.subj.univ = ev.target.value; state.subj.limit = 40; renderSubjKeep(); }
    if (ev.target.id === 'kjArea') { state.kj.area = ev.target.value; renderSubjKeep(); }
    if (ev.target.id === 'subjRegion') { state.subj.region = ev.target.value; state.subj.univ = ''; state.subj.limit = 40; renderSubjKeep(); }
  });
  // 과목을 고를 때 왼쪽 목록의 스크롤 위치와 키보드 초점을 지킨다
  // 검색어를 칠 때는 결과 부분만 바꾼다. 검색칸까지 다시 만들면 한글 조합이 끊겨 'ㅅㅜㅎㅏ'처럼 자모가 따로 들어간다
  function refreshResults(view, render, sel) {
    const live = view.querySelector(sel);
    const tmp = document.createElement('div');
    render(tmp);
    const fresh = tmp.querySelector(sel);
    if (live && fresh) live.replaceWith(fresh); else render();
  }
  function renderSubjKeep() {
    const picker = views.subj.querySelector('.picker');
    const top = picker ? picker.scrollTop : 0;
    keepFocus(views.subj, renderSubj);
    const again = views.subj.querySelector('.picker');
    if (again) again.scrollTop = top;
  }

  // ───────── 자료실

  function renderRes(target = views.res) {
    const q = state.resQuery.toLowerCase();
    const list = state.data.resources.filter((r) => !q || (r.name + r.desc + r.cat).toLowerCase().includes(q));
    const cats = [...new Set(list.map((r) => r.cat))];
    const used = (id) => [...new Set(state.data.tasks.filter((t) => t.links.includes(id)).map((t) => t.month))]
      .sort((a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b)).map(monthShort);
    const missing = state.data.resources.filter((r) => !r.url && !r.locked).length;
    const locked = state.data.resources.filter((r) => r.locked && !r.url).length;
    const lead = [
      missing ? `링크가 비어 있는 자료 ${missing}개: 구글 드라이브에 올린 뒤 시트의 '자료' 탭 링크 칸에 주소를 넣으면 열립니다.` : '',
      locked ? `교사용 자료 ${locked}개는 학년 코드를 넣어야 링크가 보입니다.` : '',
    ].filter(Boolean).join(' ');
    target.innerHTML = `
      ${head('자료', '자료실', lead)}
      <div class="res-tools">
        <label class="sr-only" for="resSearch">자료 찾기</label>
        <input id="resSearch" type="search" placeholder="자료 이름으로 찾기" value="${esc(state.resQuery)}">
      </div>
      <div id="resResults">
      ${cats.map((c) => `<section class="res-group"><h3>${esc(c)}</h3><div class="res-list">${list.filter((r) => r.cat === c).map((r) => {
        const u = used(r.id);
        return `<div class="card res"><b>${esc(r.name)}</b><p>${esc(r.desc)}</p>
          <div class="row"><span class="used">${u.length ? '쓰는 달: ' + u.join(', ') : ''}</span>
          ${r.url ? (r.url.startsWith('#') ? `<a class="btn" href="${esc(r.url)}">열기 →</a>` : `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">열기 ↗</a>`) : `<span class="btn off">${r.locked ? '교사용 · 코드 필요' : '링크 미등록'}</span>`}</div></div>`;
      }).join('')}</div></section>`).join('') || '<div class="empty">찾는 자료가 없습니다.</div>'}
      </div>`;
  }
  views.res.addEventListener('input', (ev) => {
    if (ev.target.id !== 'resSearch') return;
    state.resQuery = ev.target.value;
    refreshResults(views.res, renderRes, '#resResults');
  });

  // ───────── 폼 요약

  async function renderForms(force) {
    const top = head('도구', '구글폼 응답 요약', '구글폼의 응답 수와 날짜별 인원을 숫자로만 보여 줍니다. 학생 이름이나 응답 내용은 사이트로 오지 않습니다.');
    if (!state.live) { views.forms.innerHTML = top + needLiveHtml('폼 요약'); return; }
    if (!state.forms || force) {
      views.forms.innerHTML = top + '<div class="empty" role="status">폼 응답을 세는 중입니다…</div>';
      try {
        state.forms = (await api('forms', { force: !!force })).forms || [];
      } catch (err) {
        views.forms.innerHTML = top + `<div class="empty">폼 요약을 불러오지 못했습니다: ${esc(err.message)}</div>`;
        return;
      }
      if (state.view !== 'forms') return;
    }
    const list = state.forms.filter((f) => !state.formsMine || !f.cls || f.cls === state.cls);
    views.forms.innerHTML = `${top}
      <div class="toolbar">
        <div class="seg" role="group" aria-label="보기 범위">
          <button data-mine="1" aria-pressed="${state.formsMine}">우리 반${state.cls ? ` (${esc(state.cls)})` : ''}과 공통</button>
          <button data-mine="0" aria-pressed="${!state.formsMine}">전체</button>
        </div>
        <button class="btn" data-act="reload-forms">지금 다시 세기</button>
      </div>
      ${list.length ? `<div class="forms-grid">${list.map(formHtml).join('')}</div>` : `<div class="empty"><h3>보여 줄 폼이 없습니다</h3>
        <p>시트의 '폼 요약' 탭에 폼 응답 시트 주소와 탭 이름을 넣으면 여기에 나옵니다.</p></div>`}`;
  }
  function formHtml(f) {
    if (f.error) return `<div class="card form-card"><h3>${esc(f.name)}</h3><p class="err">${esc(f.error)}</p></div>`;
    const dates = Object.keys(f.dates || {}).sort();
    const max = Math.max(1, ...dates.map((d) => f.dates[d]));
    const unit = f.dateBasis === 'students' ? '명' : '건';
    const hist = dates.map((d) => {
      const dt = parseDate(d);
      return `<div class="hist-row ${dt < today ? 'past' : ''}"><span>${dt.getMonth() + 1}.${dt.getDate()} (${WEEK[dt.getDay()]})</span>
        <div class="track" aria-hidden="true"><i style="width:${(f.dates[d] / max) * 100}%"></i></div><b>${f.dates[d]}${unit}</b></div>`;
    }).join('');
    const students = typeof f.students === 'number';
    return `<div class="card form-card">
      <h3>${esc(f.name)}</h3>
      <div class="task-meta"><span class="chip">${f.cls ? esc(f.cls) : '공통'}</span><span>${esc(f.desc)}</span></div>
      <div class="nums">
        <div><b>${f.responses}</b><span>응답(건)</span></div>
        ${students ? `<div><b>${f.students}</b><span>학생(명)</span></div>` : ''}
        ${f.unidentified ? `<div><b>${f.unidentified}</b><span>학번 빈 응답</span></div>` : ''}
        ${students && f.target ? `<div><b>${Math.max(0, f.target - f.students)}</b><span>미제출 (${f.target}명 기준)</span></div>` : ''}
      </div>
      <p class="muted small" style="margin:-4px 0 10px">${students
        ? `학생 수는 「${esc(f.uniqueKey || '')}」 열 기준이며, 같은 학생이 여러 번 내면 가장 최근 응답만 셉니다. 날짜별 인원도 학생 기준(한 학생이 같은 날짜를 두 칸에 적어도 1명)입니다.`
        : '학번(중복 확인) 열을 지정하지 않아 학생 수를 셀 수 없습니다. 아래 날짜별 숫자는 응답 건수입니다.'}${f.inferredYear ? ' 연도가 없는 날짜는 학년도 기준(3~12월은 그해, 1~2월은 다음 해)으로 연도를 붙였습니다.' : ''}${f.invalidDates ? ` 날짜로 읽을 수 없는 값 ${f.invalidDates}개는 뺐습니다.` : ''}</p>
      ${hist ? `<div class="hist">${hist}</div>` : ''}
      <p class="muted small" style="margin:12px 0 0">${f.latest ? `마지막 응답 ${new Date(f.latest).toLocaleString('ko-KR')} · ` : ''}${f.countedAt ? `집계 시각 ${new Date(f.countedAt).toLocaleString('ko-KR')}` : ''}</p>
    </div>`;
  }
  views.forms.addEventListener('click', (ev) => {
    const mine = ev.target.closest('[data-mine]');
    if (mine) { state.formsMine = mine.dataset.mine === '1'; keepFocus(views.forms, () => renderForms()); return; }
    if (ev.target.closest('[data-act="reload-forms"]')) renderForms(true);
  });

  // ───────── 화면 이동, 반 선택, 설정

  function viewFromHash() { const h = location.hash.replace('#', ''); return VIEWS.includes(h) ? h : ''; }
  function switchView(v, fromUser) {
    state.view = v;
    sset(LS, 'hr.view', v);
    if (location.hash !== `#${v}`) history.replaceState(null, '', `#${v}`);
    render();
    window.scrollTo({ top: 0 });
    // 메뉴로 화면을 바꾸면 새 화면 제목으로 초점을 옮긴다(화면 읽기 프로그램용)
    if (fromUser !== false) { const h = views[v].querySelector('h1'); if (h) h.focus({ preventScroll: true }); }
  }
  // 왼쪽 메뉴, 아래 탭 바, 더보기 시트 어디서 눌러도 같은 화면 이동
  const moreSheet = $('#moreSheet');
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('.nav [data-view], .tabbar [data-view], .more-sheet [data-view]');
    if (!b) return;
    if (moreSheet.open) moreSheet.close();
    switchView(b.dataset.view);
  });
  $('#moreBtn').addEventListener('click', () => moreSheet.showModal());
  // 시트 바깥(어두운 부분)을 누르면 닫는다
  moreSheet.addEventListener('click', (ev) => { if (ev.target === moreSheet) moreSheet.close(); });
  window.addEventListener('hashchange', () => { const v = viewFromHash(); if (v && v !== state.view) switchView(v); });
  $('#classSelect').addEventListener('change', (ev) => {
    state.cls = ev.target.value;
    sset(LS, yearKey('cls'), state.cls);
    render();
  });

  const dialog = $('#settings');
  function renderPendingBox() {
    const box = $('#pendingBox');
    const list = state.live ? pendingLocal() : [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    const byCls = {};
    list.forEach((x) => { byCls[x.cls] = (byCls[x.cls] || 0) + 1; });
    box.hidden = false;
    box.innerHTML = `<p><b>이 기기에만 저장된 기록 ${list.length}개</b> (${esc(state.data.settings.school)} ${esc(state.data.settings.year)}학년도, 이 브라우저)<br>
      ${Object.keys(byCls).map((c) => `${esc(c)} ${byCls[c]}개`).join(' · ')}</p>
      <p class="muted small">시트에 이미 같은 반·업무 기록이 있으면 덮어쓰지 않고 보류합니다. 실패한 항목은 남겨 두어 다시 올릴 수 있습니다.</p>
      <button type="button" class="btn dark" id="uploadPending">시트로 올리기</button>`;
  }
  function openSettings() {
    $('#connInfo').textContent = SCRIPT_URL
      ? (state.source === 'error'
        ? '시트에 연결하지 못해 기본 데이터를 보여 주고 있습니다. Apps Script 배포 상태를 확인해 주세요.'
        : '시트 연결 모드: 업무·일정·자료를 구글 시트에서 불러옵니다. 시트를 고친 내용은 최대 1분 뒤 서버에 반영되고, 열린 화면에는 「새로고침」을 누르거나 다른 창에서 돌아오면 보입니다.')
      : '오프라인 모드: site/config.js 에 Apps Script 주소가 없어 기본 데이터로 동작합니다. 체크와 메모는 이 브라우저에만 저장됩니다.';
    $('#fetchInfo').textContent = state.fetchedAt ? `마지막으로 불러온 시각: ${state.fetchedAt.toLocaleString('ko-KR')}` : '';
    const input = $('#codeInput');
    input.value = state.code;
    input.disabled = !SCRIPT_URL;
    $('#codeSave').disabled = !SCRIPT_URL;
    $('#refreshBtn').disabled = !SCRIPT_URL;
    $('#codeRemember').checked = state.remember;
    $('#codeRemember').disabled = !SCRIPT_URL;
    const msg = $('#codeMsg');
    msg.className = 'msg' + (state.live ? ' good' : '');
    msg.textContent = state.live ? '학년 코드 확인됨: 체크가 시트와 공유되고 있습니다.' : '';
    renderPendingBox();
    dialog.showModal();
  }
  $('#statusBtn').addEventListener('click', openSettings);
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#uploadPending')) { uploadPending(); return; }
    if (!ev.target.closest('[data-open-settings]')) return;
    if (moreSheet.open) moreSheet.close();
    openSettings();
  });
  $('#refreshBtn').addEventListener('click', async () => { await refresh(true); openSettings(); });
  $('#codeSave').addEventListener('click', async () => {
    const msg = $('#codeMsg');
    state.code = $('#codeInput').value.trim();
    state.remember = $('#codeRemember').checked;
    if (!state.code) { msg.className = 'msg bad'; msg.textContent = '학년 코드를 넣어 주세요.'; return; }
    msg.className = 'msg'; msg.textContent = '확인 중…';
    try {
      await goLive(false);
      // 기본은 이 탭(세션)에만 기억한다. '이 기기에 기억하기'를 고른 경우만 브라우저에 남긴다
      sset(SS, CODE_KEY, state.code);
      if (state.remember) sset(LS, CODE_KEY, state.code); else sdel(LS, CODE_KEY);
      state.forms = null;
      msg.className = 'msg good';
      msg.textContent = '확인됨: 이제 체크가 시트에 저장됩니다.';
      renderPendingBox();
      render();
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = err.message;
    }
  });
  $('#codeClear').addEventListener('click', () => {
    state.code = '';
    state.live = false;
    state.forms = null;
    sdel(SS, CODE_KEY);
    sdel(LS, CODE_KEY);
    state.progress = sget(LS, scope('progress'), {});
    $('#codeInput').value = '';
    $('#codeMsg').className = 'msg';
    $('#codeMsg').textContent = '이 기기에서 학년 코드를 지웠습니다. 시트의 기록은 그대로입니다. 이 기기에 남은 체크·메모를 지우려면 「이 기기 기록 지우기」를 누르세요.';
    renderPendingBox();
    render();
  });
  $('#localClear').addEventListener('click', () => {
    const key = scope('progress', 'local');
    const n = Object.values(sget(LS, key, {})).reduce((sum, c) => sum + Object.keys(c || {}).length, 0);
    if (!n) { $('#codeMsg').className = 'msg'; $('#codeMsg').textContent = '이 기기에 저장된 체크·메모가 없습니다.'; return; }
    if (!window.confirm(`이 브라우저에 저장된 ${state.data.settings.year}학년도 체크·메모 ${n}개를 지웁니다. 시트의 기록은 지우지 않습니다. 계속할까요?`)) return;
    sdel(LS, key);
    if (!state.live) state.progress = {};
    $('#codeMsg').className = 'msg';
    $('#codeMsg').textContent = `이 기기의 기록 ${n}개를 지웠습니다.`;
    renderPendingBox();
    render();
  });

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ───────── 자료 도우미(채팅)
  //
  // 1) 이 브라우저에 있는 자료(업무·일정·자료실·권장과목, 시트 연결 시 교직이수)에서 질문과 맞는 줄을 찾는다(무료)
  // 2) 시트에 연결되어 있으면 서버가 드라이브 '챗봇 자료' 폴더도 찾아 준다
  // 3) 서버에 AI 키가 있으면 찾은 자료만 근거로 AI가 문장으로 정리한다. 근거 번호 [n]은 아래 출처 목록과 이어진다

  // 자료 도우미 캐릭터 '다람이': 하얀 로봇 몸에 다람쥐 귀·꼬리·도토리 (직접 그린 SVG)
  const SQUIRREL_SVG = `<svg class="squirrel" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="sqrW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6deec"/></linearGradient>
      <linearGradient id="sqrV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3566"/><stop offset="1" stop-color="#0c1023"/></linearGradient>
      <linearGradient id="sqrT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4b06a"/><stop offset="1" stop-color="#c2692a"/></linearGradient>
      <linearGradient id="sqrE" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8fbff"/><stop offset="1" stop-color="#38c9ff"/></linearGradient>
    </defs>
    <path d="M43 57c12-1 19-12 16-23-2-8-10-13-17-10 6 3 9 9 6 15-2 5-8 7-8 12 0 3 1 5 3 6z" fill="url(#sqrT)"/>
    <path d="M48 27c5 2 8 7 8 12" stroke="#ffd7a6" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <rect x="8.5" y="39" width="7" height="13" rx="3.5" transform="rotate(28 12 45.5)" fill="url(#sqrW)"/>
    <rect x="17" y="40" width="24" height="19" rx="10" fill="url(#sqrW)"/>
    <ellipse cx="29" cy="51" rx="3.1" ry="3.5" fill="#c2692a"/>
    <path d="M25.6 49c0-2.7 6.8-2.7 6.8 0z" fill="#7a4520"/><path d="M29 46.4v-1.4" stroke="#7a4520" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M15 17 14 4l10 8z" fill="url(#sqrW)"/><path d="M43 17l1-13-10 8z" fill="url(#sqrW)"/>
    <path d="M16.4 14.4 15.9 8l4.8 4z" fill="#ffc1a6"/><path d="M41.6 14.4l.5-6.4-4.8 4z" fill="#ffc1a6"/>
    <rect x="11" y="10" width="36" height="30" rx="14" fill="url(#sqrW)"/>
    <rect x="7.5" y="20" width="5" height="11" rx="2.5" fill="#3d7bff"/><rect x="45.5" y="20" width="5" height="11" rx="2.5" fill="#3d7bff"/>
    <rect x="15" y="15" width="28" height="21" rx="10" fill="url(#sqrV)"/>
    <rect x="21" y="20.5" width="4.2" height="6.8" rx="2.1" fill="url(#sqrE)"/><rect x="32.8" y="20.5" width="4.2" height="6.8" rx="2.1" fill="url(#sqrE)"/>
    <path d="M25.6 30.2c2 2 4.8 2 6.8 0" stroke="#7fe8ff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="19.3" cy="30.4" rx="2" ry="1.2" fill="#ff8fb3" opacity=".6"/><ellipse cx="38.7" cy="30.4" rx="2" ry="1.2" fill="#ff8fb3" opacity=".6"/>
    <path d="M18.5 18.4c3-1.6 6.6-2 9.6-1.6" stroke="#fff" stroke-opacity=".28" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="21" cy="12.6" rx="5" ry="1.3" fill="#fff"/>
  </svg>`;
  const CHAT_EXAMPLES = ['9월에 할 일', '수시 원서 접수 일정', '부산대 수학교육 권장과목', '수학과 교직이수 되는 대학', '지역의사제 지원자격'];
  const CHAT_HINTS = [
    [/교직/, '교직이수'], [/권장|반영|과목|이수/, '권장과목'], [/일정|날짜|언제|마감|접수|기간|발표/, '일정'],
    [/업무|할\s*일|챙길|해야|준비/, '업무'], [/양식|자료|사이트|링크|폼/, '자료'],
  ];

  function chatDocs() {
    const d = state.data;
    const out = [];
    d.tasks.forEach((t) => out.push({
      kind: '업무', title: `${monthShort(t.month)} · ${t.title}`, text: [t.when, t.detail, t.note].filter(Boolean).join(' · '),
      key: `${t.title} ${t.cat}`, ref: `업무 ${t.id}`, month: t.month, go: { view: 'month', month: t.month },
    }));
    d.events.forEach((e) => out.push({
      kind: '일정', title: `${e.date}${e.end ? `~${e.end}` : ''}${e.time ? ` ${e.time}` : ''} ${e.title}`, text: e.note,
      key: e.title, ref: `일정 ${e.date}`, month: String(Number(e.date.slice(5, 7))), go: { view: 'year' },
    }));
    d.resources.forEach((r) => out.push({
      kind: '자료', title: r.name, text: `${r.cat} · ${r.desc}`, key: r.name, ref: `자료실 ${r.id}`, go: { view: 'res', query: r.name },
    }));
    state.recommend.forEach((r) => out.push({
      kind: '권장과목', title: `${r.univ} ${r.group ? `${r.group} ` : ''}${r.unit}`,
      text: [r.core && `핵심: ${r.core}`, r.rec && `권장: ${r.rec}`, r.all && `반영: ${r.all}`, r.note && `비고: ${r.note}`, r.review && `확인 필요: ${r.review}`].filter(Boolean).join(' / '),
      key: `${r.univ} ${r.group} ${r.unit}`, ref: `권장과목 ${recRef(r)}`, go: { view: 'subj', query: `${r.univ} ${r.unit}` },
    }));
    state.kyojik.forEach((k) => out.push({
      kind: '교직이수', title: `${k.univ} · ${k.group}`, text: k.depts, key: `${k.univ} ${k.depts}`,
      ref: `교직이수 원문 ${k.page}쪽`, go: { view: 'subj', mode: 'kyojik', query: k.univ },
    }));
    return out;
  }

  function chatTerms(q) {
    const words = q.replace(/[?!.,·()[\]"'~]/g, ' ').split(/\s+/).map((w) => w.replace(CHAT_TAIL, '')).filter((w) => w.length >= 2);
    const grams = [];
    words.forEach((w) => { for (let i = 0; i < w.length - 1; i++) grams.push(w.slice(i, i + 2)); });
    return { words, grams };
  }

  // 낱말이 대학·학과·업무 이름에 맞으면 크게, 내용에 맞으면 중간, 두 글자 조각이 맞으면 작게 점수를 준다
  function chatSearch(q, limit) {
    const { words, grams } = chatTerms(q);
    const month = (q.match(/(\d{1,2})\s*월/) || [])[1];
    const hints = CHAT_HINTS.filter(([re]) => re.test(q)).map(([, k]) => k);
    if (!words.length && !month) return [];
    return chatDocs().map((d) => {
      const key = squash(d.key).toLowerCase();
      const body = squash(`${d.title} ${d.text}`).toLowerCase();
      let s = 0;
      let wordHit = false;
      words.forEach((w) => {
        const lw = w.toLowerCase();
        if (key.includes(lw)) { s += 6; wordHit = true; } else if (body.includes(lw)) { s += 3; wordHit = true; }
      });
      let g = 0;
      grams.forEach((x) => { if (body.includes(x.toLowerCase())) g++; });
      s += g;
      const monthHit = month && d.month === String(Number(month));
      if (monthHit) s += 8;
      if (!(wordHit || monthHit || (grams.length && g >= Math.ceil(grams.length * 0.6)))) return null;
      if (hints.includes(d.kind)) s *= 1.6;
      return { d, s };
    }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.d);
  }

  function chatModeText() {
    const el = $('#chatMode');
    if (!el) return;
    const ai = state.live && chat.provider;
    el.textContent = ai ? `AI 정리 켜짐 · ${chat.provider === 'gemini' ? 'Gemini' : 'Claude'}` : state.live ? '검색 모드 · 사이트 + 드라이브 폴더' : '검색 모드 · 사이트 자료';
    const tg = $('#chatAiToggle');
    if (tg) { tg.hidden = !ai; tg.setAttribute('aria-pressed', String(chat.useAi)); }
  }

  function chatSourceHtml(d, n) {
    const go = d.url ? `<a class="chat-go" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">문서 열기 ↗</a>`
      : d.go ? `<button class="chat-go" data-chat-go='${esc(JSON.stringify(d.go))}'>화면에서 보기 →</button>` : '';
    return `<div class="chat-src">${n ? `<span class="chat-n">${n}</span>` : ''}<div>
      <p class="chat-src-head"><span class="chat-kind">${esc(d.kind)}</span><b>${esc(d.title)}</b></p>
      ${d.text ? `<p class="chat-src-text">${esc(d.text.length > 220 ? `${d.text.slice(0, 220)}…` : d.text)}</p>` : ''}
      <p class="chat-src-ref">${esc(d.ref || '')} ${go}</p></div></div>`;
  }

  // AI 답은 믿지 않는 글로 다룬다: 먼저 이스케이프한 뒤 굵게·목록·근거 번호만 꾸민다
  function chatAnswerHtml(text, count) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^\s*[-*•]\s+/gm, '• ')
      .replace(/\[(\d{1,2})\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= count ? `<sup class="chat-cite">${n}</sup>` : m))
      .replace(/\n/g, '<br>');
  }

  function chatAdd(role, html) {
    const log = $('#chatLog');
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function chatAsk(q) {
    q = q.trim();
    if (!q || chat.busy) return;
    chat.busy = true;
    chatAdd('user', esc(q));
    chat.history.push({ role: 'user', text: q });
    const wait = chatAdd('bot', '<p class="chat-wait">다람이가 자료를 찾는 중…</p>');
    const local = chatSearch(q, 30);
    const notes = [];
    // 학번·연락처처럼 보이는 숫자가 있으면 서버(AI)로 보내지 않는다
    const personal = /\d{5,}|\d{2,3}-\d{3,4}-\d{4}|\d{1,2}\s*반\s*\d{1,2}\s*번/.test(q);
    if (/교직/.test(q) && !state.kyojik.length) notes.push('교직이수 자료는 학년 코드로 시트에 연결해야 찾을 수 있습니다.');
    let folder = [];
    let answer = '';
    if (state.live && !personal) {
      try {
        const res = await api('chat', {
          question: q, ai: !!(chat.provider && chat.useAi),
          sources: local.map((d) => ({ kind: d.kind, title: d.title, text: d.text, ref: d.ref })),
          history: chat.history.slice(-5, -1),
        });
        folder = (res.folder || []).map((h) => ({ kind: '참고자료', title: str(h.title), text: str(h.text), ref: str(h.ref), url: str(h.url) }));
        answer = str(res.answer);
        if (res.quota) notes.push('오늘 AI 질문 한도를 다 써서 찾은 자료만 보여 드립니다.');
        if (res.aiError) notes.push(`AI 답변을 받지 못해 찾은 자료만 보여 드립니다. (${res.aiError})`);
        if (res.folderNote) notes.push(str(res.folderNote));
      } catch (err) { notes.push(`서버에 묻지 못해 사이트 자료만 찾았습니다. (${err.message})`); }
    } else if (personal && state.live) notes.push('학번·연락처처럼 보이는 숫자가 있어 서버와 AI로 보내지 않고 사이트 자료만 찾았습니다. 학생 정보는 적지 마세요.');

    const all = local.concat(folder);
    let html;
    if (answer) {
      // 번호는 서버로 보낸 순서(사이트 자료 → 폴더 문단)와 같다
      const cited = [...new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= all.length);
      const shown = cited.length ? cited : all.slice(0, 3).map((_, i) => i + 1);
      html = `<div class="chat-answer">${chatAnswerHtml(answer, all.length)}</div>
        ${shown.length ? `<details class="chat-sources" open><summary>근거 ${shown.length}개</summary>${shown.map((n) => chatSourceHtml(all[n - 1], n)).join('')}</details>` : ''}`;
    } else {
      const top = local.slice(0, 5).concat(folder.slice(0, 3));
      html = top.length
        ? `<p>등록된 자료에서 찾은 내용입니다.</p>${top.map((d) => chatSourceHtml(d)).join('')}`
        : '<p>등록된 자료에서 찾지 못했습니다. 대학 이름, 학과, 달(예: 9월), \'교직이수\', \'권장과목\' 같은 낱말을 넣어 다시 물어보세요.</p>';
    }
    if (notes.length) html += `<p class="chat-note-line">${notes.map(esc).join('<br>')}</p>`;
    wait.innerHTML = html;
    chat.history.push({ role: 'bot', text: answer || (local[0] ? `찾은 자료: ${local.slice(0, 3).map((d) => d.title).join(', ')}` : '찾지 못함') });
    $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
    chat.busy = false;
  }

  function chatGo(go) {
    if (go.view === 'subj') {
      state.subj.mode = go.mode || 'rec';
      if (go.mode === 'kyojik') state.kj.query = go.query || '';
      else { state.subj.query = go.query || ''; state.subj.region = ''; state.subj.univ = ''; state.subj.limit = 40; }
    }
    if (go.view === 'res') state.resQuery = go.query || '';
    if (go.view === 'month' && go.month) { state.month = go.month; state.open.clear(); }
    if (window.matchMedia('(max-width: 719px)').matches) chatOpen(false);
    switchView(go.view);
  }

  function chatOpen(open) {
    const panel = $('#chatPanel');
    panel.hidden = !open;
    $('#chatFab').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('chat-open', open);
    if (open) { chatModeText(); $('#chatInput').focus(); } else $('#chatFab').focus();
  }

  function setupChat() {
    const fab = document.createElement('button');
    fab.id = 'chatFab';
    fab.className = 'chat-fab';
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-controls', 'chatPanel');
    fab.setAttribute('aria-label', '다람이에게 물어보기 (자료 도우미)');
    fab.innerHTML = `<span class="chat-fab-bubble" aria-hidden="true">궁금한 거 물어보세요!</span><span class="chat-fab-char">${SQUIRREL_SVG}</span>`;
    const panel = document.createElement('section');
    panel.id = 'chatPanel';
    panel.className = 'chat-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', '다람이 자료 도우미');
    panel.innerHTML = `
      <header class="chat-head">
        <span class="chat-avatar">${SQUIRREL_SVG}</span>
        <div><b>다람이 · 자료 도우미</b><small id="chatMode"></small></div>
        <button id="chatAiToggle" class="chat-toggle" aria-pressed="true" hidden title="끄면 AI 없이 찾은 자료만 보여 줍니다">AI 정리</button>
        <button class="chat-x" data-chat-close aria-label="자료 도우미 닫기">×</button>
      </header>
      <div id="chatLog" class="chat-log" aria-live="polite">
        <div class="chat-msg bot"><p>안녕하세요, 다람이예요! 선생님들이 모아 둔 자료에서 도토리 줍듯 찾아 드릴게요. 업무·일정·자료실·권장과목${state.live ? '·교직이수·드라이브 폴더' : ''} 자료를 찾을 수 있어요.</p>
          <div class="chat-ex">${CHAT_EXAMPLES.map((e) => `<button data-chat-ex>${esc(e)}</button>`).join('')}</div></div>
      </div>
      <form class="chat-form">
        <label class="sr-only" for="chatInput">질문</label>
        <textarea id="chatInput" rows="1" placeholder="궁금한 것을 물어보세요 (Enter 보내기)"></textarea>
        <button type="submit" class="btn dark">보내기</button>
      </form>
      <p class="chat-foot">학생 이름·학번·연락처는 적지 마세요. 답은 등록된 자료에 근거하며 대학 모집요강 원문을 꼭 확인하세요.</p>`;
    document.body.append(fab, panel);

    fab.addEventListener('click', () => chatOpen(panel.hidden));
    const input = panel.querySelector('#chatInput');
    const send = () => { const q = input.value; input.value = ''; input.style.height = ''; chatAsk(q); };
    panel.querySelector('.chat-form').addEventListener('submit', (ev) => { ev.preventDefault(); send(); });
    input.addEventListener('keydown', (ev) => {
      // 한글 조합 중의 Enter는 글자 확정이므로 보내지 않는다
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); send(); }
      if (ev.key === 'Escape') chatOpen(false);
    });
    input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-chat-close]')) { chatOpen(false); return; }
      const ex = ev.target.closest('[data-chat-ex]');
      if (ex) { chatAsk(ex.textContent); return; }
      const go = ev.target.closest('[data-chat-go]');
      if (go) { try { chatGo(JSON.parse(go.dataset.chatGo)); } catch (e) { /* 무시 */ } return; }
      const tg = ev.target.closest('#chatAiToggle');
      if (tg) { chat.useAi = !chat.useAi; chatModeText(); }
    });
    chatModeText();
  }

  // ───────── 시작

  // 자동 점검용: 주소에 ?test 가 있을 때만 내부 함수를 꺼내 둔다
  if (new URLSearchParams(location.search).has('test')) {
    window.__hrTest = { state, parseReq, evaluate, normRec, pickColumn, parseTable, pendingLocal, uploadPending, saveEntry, scope, render, chat, chatSearch, chatAsk };
  }
  if (location.hash !== `#${state.view}`) history.replaceState(null, '', `#${state.view}`);
  render();
  setupChat();
  window.__hrReady = true;
  (async () => {
    if (!SCRIPT_URL) return;
    await loadSheet();
    await goLive(true);
    render();
  })();
})();
