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

  // 2022 개정 교육과정 선택 과목 (권장과목 확인에서 고르는 목록)
  const SUBJECTS = [
    ['수학', ['대수', '미적분Ⅰ', '확률과 통계', '미적분Ⅱ', '기하', '경제 수학', '인공지능 수학', '직무 수학', '수학과 문화', '실용 통계', '수학과제 탐구']],
    ['과학', ['물리학', '화학', '생명과학', '지구과학', '역학과 에너지', '전자기와 양자', '물질과 에너지', '화학 반응의 세계', '세포와 물질대사', '생물의 유전', '지구시스템과학', '행성우주과학', '과학의 역사와 문화', '기후변화와 환경생태', '융합과학 탐구']],
    ['정보·기술', ['정보', '인공지능 기초', '데이터 과학', '기술·가정']],
    ['사회', ['한국사', '세계시민과 지리', '세계사', '사회와 문화', '현대사회와 윤리', '한국지리 탐구', '도시의 미래 탐구', '동아시아 역사 기행', '정치', '법과 사회', '경제', '윤리와 사상', '인문학과 윤리', '국제 관계의 이해', '여행지리', '사회문제 탐구', '금융과 경제생활', '윤리문제 탐구', '기후변화와 지속가능한 세계']],
    ['국어·영어', ['화법과 언어', '독서와 작문', '문학', '주제 탐구 독서', '문학과 영상', '독서 토론과 글쓰기', '매체 의사소통', '영어Ⅰ', '영어Ⅱ', '영어 독해와 작문', '영미 문학 읽기', '영어 발표와 토론', '심화 영어', '실생활 영어 회화', '미디어 영어', '세계 문화와 영어']],
    ['제2외국어·한문', ['한문', '한문 고전 읽기', '중국어', '일본어', '독일어', '프랑스어']],
  ];
  const SUBJECT_KEY = new Map();
  SUBJECTS.forEach(([, list]) => list.forEach((s) => SUBJECT_KEY.set(squash(s), s)));
  // 자료집마다 다르게 적은 이름을 2022 과목 이름으로 맞춘다
  const ALIAS = { '물리': '물리학', '화학반응의세계': '화학 반응의 세계', '세포와물질대사': '세포와 물질대사', '생물과유전': '생물의 유전' };
  Object.keys(ALIAS).forEach((k) => SUBJECT_KEY.set(squash(k), ALIAS[k]));

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
    },
  };

  const state = {
    data: normalize(window.SEED || {}),
    recommend: seedRecommend(),
    recommendSource: 'seed',
    source: 'seed',          // seed | sheet | error
    updatedAt: '',
    cls: store.get('hr.cls', ''),
    code: store.get('hr.code', ''),
    live: false,             // 학년 코드 확인 후 체크를 시트와 공유하는 중
    progress: store.get('hr.progress', {}), // { 반: { 업무키: {done, memo, at} } }
    view: viewFromHash() || store.get('hr.view', 'month'),
    month: null,
    filter: 'all',
    open: new Set(),
    forms: null,
    formsMine: true,
    gradeMonth: null,
    resQuery: '',
    conv: { dir: '9to5', value: '2.8', bulk: '', col: -1 },
    subj: { picked: new Set(), query: '', univ: '', sort: 'source', limit: 40 },
  };
  if (!VIEWS.includes(state.view)) state.view = 'month';
  const today = readToday();
  state.month = monthOfDate(today);
  state.gradeMonth = state.month;

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
        date: toISO(e.date), end: toISO(e.end), title: str(e.title), type: str(e.type), star: truthy(e.star), note: str(e.note),
      })).filter((e) => e.date && e.title).sort((a, b) => a.date.localeCompare(b.date)),
      resources: (raw.resources || []).map((r) => ({
        id: str(r.id), name: str(r.name), cat: str(r.cat) || '기타', url: safeUrl(r.url), desc: str(r.desc),
      })).filter((r) => r.id && r.name),
    };
  }
  function seedRecommend() {
    return (window.RECOMMEND || []).map((r) => normRec({ univ: r[0], unit: r[1], core: r[2], rec: r[3], all: r[4], note: r[5], page: r[6] }));
  }
  function normRec(r) {
    const out = { univ: str(r.univ), unit: str(r.unit), core: str(r.core), rec: str(r.rec), all: str(r.all), note: str(r.note), page: str(r.page) };
    out.parsed = { core: parseReq(out.core), rec: parseReq(out.rec), all: parseReq(out.all) };
    // 검색은 대학·모집단위 이름만 본다 ('화학'을 찾으면 화학 과목이 들어간 학과가 아니라 화학과가 나오게)
    out.hay = squash(`${out.univ} ${out.unit}`).toLowerCase();
    return out;
  }
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
  function esc(v) {
    return str(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fix2(n) { return (Math.round(n * 100) / 100).toFixed(2); }

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
    if (!e.end || e.end === e.date) return md(e.date);
    const a = parseDate(e.date); const b = parseDate(e.end);
    return a.getMonth() === b.getMonth() ? `${md(e.date)}~${b.getDate()}` : `${md(e.date)}~${md(e.end)}`;
  }
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

  function setEntry(cls, key, patch) {
    const byCls = state.progress[cls] || (state.progress[cls] = {});
    const prev = byCls[key] || { done: false, memo: '' };
    byCls[key] = Object.assign({}, prev, patch, { at: new Date().toISOString() });
    if (!state.live) store.set('hr.progress', state.progress);
    return prev;
  }

  async function saveEntry(key, patch) {
    if (!state.cls) { toast('먼저 우리 반을 골라 주세요.'); $('#classSelect').focus(); return false; }
    const cls = state.cls;
    const prev = setEntry(cls, key, patch);
    if (!state.live) return true;
    const next = state.progress[cls][key];
    try {
      await api('check', { cls, task: key, done: next.done, memo: next.memo || '' });
      return true;
    } catch (err) {
      state.progress[cls][key] = prev;
      toast(`저장하지 못했습니다: ${err.message}`);
      render();
      return false;
    }
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
    if (!json.ok) throw new Error(json.error || '요청을 처리하지 못했습니다.');
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
      state.updatedAt = json.updatedAt || '';
      const rows = (json.recommend || []).filter((r) => str(r.univ) && str(r.unit));
      if (rows.length) {
        state.recommend = rows.map(normRec);
        state.recommendSource = 'sheet';
      }
    } catch (err) {
      console.warn(err);
      state.source = 'error';
    }
  }

  async function goLive(silent) {
    if (!SCRIPT_URL || !state.code) { state.live = false; return false; }
    try {
      const json = await api('progress');
      const local = store.get('hr.progress', {});
      state.progress = {};
      (json.progress || []).forEach((p) => {
        (state.progress[p.cls] || (state.progress[p.cls] = {}))[p.task] = { done: !!p.done, memo: p.memo || '', at: p.at || '' };
      });
      state.live = true;
      await uploadLocal(local);
      return true;
    } catch (err) {
      state.live = false;
      state.progress = store.get('hr.progress', {});
      if (!silent) throw err;
      toast(`학년 코드를 확인하지 못했습니다: ${err.message}`);
      return false;
    }
  }

  // 코드를 넣기 전에 이 브라우저에서 체크한 우리 반 기록을 시트로 올린다
  async function uploadLocal(local) {
    const mine = local[state.cls] || {};
    const keys = Object.keys(mine).filter((k) => !entry(k) && (mine[k].done || mine[k].memo));
    for (const key of keys) {
      try {
        await api('check', { cls: state.cls, task: key, done: !!mine[key].done, memo: mine[key].memo || '' });
        setEntry(state.cls, key, { done: !!mine[key].done, memo: mine[key].memo || '' });
      } catch (err) { console.warn(err); }
    }
    if (keys.length) toast(`이 기기에서 체크한 ${keys.length}개를 시트에 올렸습니다.`);
  }

  // ───────── 공통 화면

  function render() {
    renderTop();
    VIEWS.forEach((v) => { views[v].hidden = v !== state.view; });
    document.querySelectorAll('.nav [data-view]').forEach((b) => {
      if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    ({ month: renderMonth, year: renderYear, grade: renderGrade, conv: renderConv, subj: renderSubj, forms: renderForms, res: renderRes })[state.view]();
  }

  function renderTop() {
    const s = state.data.settings;
    $('#brandSub').textContent = `${s.school ? s.school + ' · ' : ''}${s.year}학년도 · ${s.admissionYear} 대입`;
    const sel = $('#classSelect');
    sel.innerHTML = ['<option value="">반 선택</option>']
      .concat(s.classes.map((c) => `<option ${c === state.cls ? 'selected' : ''}>${esc(c)}</option>`)).join('');
    let text = '기본 데이터 · 이 기기 저장';
    let st = 'local';
    if (state.source === 'error') { text = '시트 연결 실패'; st = 'error'; }
    else if (state.live) { text = '시트 연결 · 체크 공유 중'; st = 'live'; }
    else if (state.source === 'sheet') { text = '시트 연결 · 체크는 이 기기'; st = 'sheet'; }
    $('#statusBtn').dataset.state = st;
    $('#statusText').textContent = text;
    $('#footSource').textContent = state.source === 'sheet'
      ? `업무 데이터: 구글 시트${state.updatedAt ? ` (불러온 시각 ${new Date(state.updatedAt).toLocaleString('ko-KR')})` : ''}`
      : '업무 데이터: 기본 데이터(site/data.js)';
  }

  function catDot(cat) { return `<span class="dotcat" style="--c:${CAT_COLORS[cat] || '#7d8590'}">${esc(cat)}</span>`; }
  function head(over, title, lead) {
    return `<header class="page-head"><p class="overline">${over}</p><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`;
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

  function renderMonth() {
    const m = state.month;
    const info = state.data.months.find((x) => x.month === m) || { title: '', focus: '' };
    const now = monthOfDate(today);
    const rail = MONTHS.map((x) => {
      const s = monthStats(x);
      return `<button class="month-pill ${x === now ? 'now' : ''}" data-month="${x}" aria-pressed="${x === m}">
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
        <div class="t">${e.star ? '<span class="star">★</span> ' : ''}${esc(e.title)}${e.note ? `<br><small class="muted">${esc(e.note)}</small>` : ''}</div></div>`;
    }).join('') : '<p class="muted" style="margin:6px 0 0;font-size:13px">이 달에 등록된 일정이 없습니다. 학사일정은 시트의 \'일정\' 탭에 추가하세요.</p>';

    const filters = [['all', '전체'], ['star', '★ 꼭 챙길 것'], ['todo', '남은 것'], ['done', '완료']]
      .map(([k, v]) => `<button data-filter="${k}" aria-pressed="${state.filter === k}">${v}</button>`).join('');

    views.month.innerHTML = `
      <section class="hero">
        <div class="card hero-main">
          <div class="hero-text">
            <p class="hero-month"><b>${monthLabel(m)}</b><span>${m === now ? '이번 달' : esc(state.data.settings.year) + '학년도'}</span></p>
            <h1>${esc(info.title)}</h1>
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
              <button class="btn" data-act="expand">${state.open.size ? '모두 접기' : '모두 펼치기'}</button>
              <button class="btn" data-act="print">이 달 인쇄</button>
            </div>
          </div>
          ${state.cls ? '' : '<p class="notice" style="margin:0 0 14px">왼쪽 아래(휴대폰은 위쪽)에서 우리 반을 고르면 체크와 메모가 반별로 저장됩니다.</p>'}
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
    if (!r.url) return `<span class="btn off" title="시트의 '자료' 탭에 링크를 넣으면 열립니다">${esc(r.name)} · 링크 미등록</span>`;
    return r.url.startsWith('#')
      ? `<a class="btn" href="${esc(r.url)}">${esc(r.name)} →</a>`
      : `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)} ↗</a>`;
  }

  function taskHtml(t) {
    const e = entry(t.key);
    const done = !!(e && e.done);
    const open = state.open.has(t.key);
    let status = '';
    if (done) status = `<span class="chip done">완료${e.at ? ' ' + md(e.at.slice(0, 10)) : ''}</span>`;
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
    return `<article class="task ${done ? 'is-done' : ''}" data-key="${esc(t.key)}">
      <div class="task-row">
        <button class="check" data-act="check" aria-pressed="${done}" aria-label="${esc(t.title)} 완료 표시">${CHECK_SVG}</button>
        <div class="task-main">
          <button class="task-title" data-act="open" aria-expanded="${open}">${t.star ? '<span class="star" aria-label="꼭 챙길 업무">★</span> ' : ''}${esc(t.title)}</button>
          <div class="task-meta">${t.recurring ? catDot(t.cat) : ''}<span>${esc(t.when)}</span>${status}${memo && !open ? '<span class="has-memo">메모 있음</span>' : ''}</div>
        </div>
      </div>
      <div class="task-detail" ${open ? '' : 'hidden'}>
        ${t.detail ? `<p>${esc(t.detail)}</p>` : ''}
        ${t.note ? `<p class="muted">${esc(t.note)}</p>` : ''}
        ${links ? `<div class="links">${links}</div>` : ''}
        <textarea class="memo" data-key="${esc(t.key)}" placeholder="우리 반 메모 (예: 미제출 3명, 9/2 재안내)">${esc(memo)}</textarea>
        <div class="memo-note">${state.live ? '메모는 시트에 저장되어 학년 코드를 아는 선생님과 공유됩니다. 학생 이름은 적지 마세요.' : '메모는 이 브라우저에만 저장됩니다.'}</div>
      </div>
    </article>`;
  }

  views.month.addEventListener('click', async (ev) => {
    const pill = ev.target.closest('[data-month]');
    if (pill) { state.month = pill.dataset.month; state.open.clear(); renderMonth(); return; }
    const f = ev.target.closest('[data-filter]');
    if (f) { state.filter = f.dataset.filter; renderMonth(); return; }
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    const row = act.closest('.task');
    const key = row && row.dataset.key;
    if (act.dataset.act === 'open') {
      state.open.has(key) ? state.open.delete(key) : state.open.add(key);
      renderMonth();
    } else if (act.dataset.act === 'check') {
      const done = !isDone(key);
      const ok = await saveEntry(key, { done });
      if (ok) { renderMonth(); if (done) toast(state.live ? '완료로 표시하고 시트에 저장했습니다.' : '완료로 표시했습니다.'); }
    } else if (act.dataset.act === 'expand') {
      if (state.open.size) state.open.clear(); else tasksFor(state.month).forEach((t) => state.open.add(t.key));
      renderMonth();
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
    if (ok) toast('메모를 저장했습니다.');
  });

  // ───────── 연간 흐름

  function renderYear() {
    const now = monthOfDate(today);
    const cats = FLOW_CATS.filter((c) => state.data.tasks.some((t) => t.cat === c && t.month !== '매월'));
    const headRow = MONTHS.map((m) => `<th class="${m === now ? 'now-col' : ''}">${monthShort(m)}</th>`).join('');
    const rows = cats.map((c) => {
      const color = CAT_COLORS[c] || '#7d8590';
      const cells = MONTHS.map((m) => {
        const list = state.data.tasks.filter((t) => t.cat === c && t.month === m);
        if (!list.length) return `<td class="${m === now ? 'now-col' : ''}"></td>`;
        const hot = list.some((t) => t.star);
        const title = list.map((t) => (t.star ? '★ ' : '') + t.title).join('\n');
        return `<td class="on ${hot ? 'hot' : ''} ${m === now ? 'now-col' : ''}" style="--c:${color}" data-month="${m}" title="${esc(title)}">${list.length}</td>`;
      }).join('');
      return `<tr><th class="row">${catDot(c)}</th>${cells}</tr>`;
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
        '3월 1차 상담에서 시작해 6월 2차 상담, 8월 최종 상담, 9월 원서, 10~11월 면접, 12월 정시 상담으로 이어집니다. 칸을 누르면 그 달로 이동합니다.')}
      <div class="card flow">
        <table><thead><tr><th></th>${headRow}</tr></thead><tbody>${rows}</tbody></table>
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

  function downloadIcs() {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const icsEsc = (s) => str(s).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
    const day = (iso) => iso.replace(/-/g, '');
    const next = (iso) => { const d = parseDate(iso); d.setDate(d.getDate() + 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
    const items = state.data.events.map((e, i) => ({ uid: `ev${i}-${e.date}`, start: e.date, end: e.end || e.date, title: e.title, desc: e.type }))
      .concat(state.data.tasks.filter((t) => t.due && t.star).map((t) => ({ uid: `task-${t.id}`, start: t.due, end: t.due, title: `[담임] ${t.title}`, desc: t.detail })));
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hr-helper//KO', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:고3 담임 ${state.data.settings.year}`];
    items.forEach((it) => {
      lines.push('BEGIN:VEVENT', `UID:${it.uid}@hr-helper`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(it.start)}`,
        `DTEND;VALUE=DATE:${next(it.end)}`, `SUMMARY:${icsEsc(it.title)}`, `DESCRIPTION:${icsEsc(it.desc)}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    saveFile(`고3담임_${state.data.settings.year}_일정.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8');
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
    const headRow = MONTHS.map((m) => `<th style="${m === now ? 'color:var(--accent)' : ''}">${monthShort(m)}</th>`).join('');
    const rows = classes.map((c) => {
      const cells = MONTHS.map((m) => {
        const p = pct(monthStats(m, c));
        return `<td><span class="pct" style="background:color-mix(in srgb,var(--ok) ${Math.round(p * 0.32)}%,transparent)">${p}%</span></td>`;
      }).join('');
      return `<tr class="${c === state.cls ? 'mine' : ''}"><td class="cls">${esc(c)}</td>${cells}</tr>`;
    }).join('');

    const gm = state.gradeMonth;
    const detailRows = tasksFor(gm).map((t) => `<tr><td class="task-name">${t.star ? '<span class="star">★</span> ' : ''}${esc(t.title)}</td>${classes.map((c) => {
      const e = entry(t.key, c);
      return `<td title="${e && e.memo ? esc(e.memo) : ''}">${e && e.done ? '<span class="y">✓</span>' : '<span class="n">·</span>'}${e && e.memo ? '<sup>✎</sup>' : ''}</td>`;
    }).join('')}</tr>`).join('');

    views.grade.innerHTML = `${top}
      <div class="card grade-table">
        <h2 class="card-title" style="margin-bottom:10px">반별 · 달별 진행률</h2>
        <table><thead><tr><th class="cls">반</th>${headRow}</tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div class="card grade-table">
        <div class="grade-sub">
          <h2 class="card-title" style="margin:0">업무별로 보기</h2>
          <select id="gradeMonth" aria-label="달 선택">${MONTHS.map((m) => `<option value="${m}" ${m === gm ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
          <span class="muted" style="font-size:12px">✎ 표시에 마우스를 올리면 메모가 보입니다.</span>
        </div>
        <table><thead><tr><th class="cls">업무</th>${classes.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${detailRows}</tbody></table>
      </div>`;
  }
  views.grade.addEventListener('change', (ev) => {
    if (ev.target.id === 'gradeMonth') { state.gradeMonth = ev.target.value; renderGrade(); }
  });

  function needLiveHtml(title) {
    if (!SCRIPT_URL) {
      return `<div class="empty"><h3>${title}은 구글 시트를 연결하면 열립니다</h3>
        <ol><li>README의 「구글 시트 연결하기」대로 Apps Script를 배포합니다.</li>
        <li>웹 앱 주소를 <code>site/config.js</code>에 넣고 다시 올립니다.</li><li>왼쪽 아래 연결 단추에서 학년 코드를 넣습니다.</li></ol></div>`;
    }
    return `<div class="empty"><h3>학년 코드를 넣으면 ${title}이 열립니다</h3>
      <p><button class="btn dark" data-open-settings>학년 코드 넣기</button></p></div>`;
  }

  // ───────── 내신 9↔5 변환

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
  // 평균 등급을 막대 위 위치(%)로 바꾼다. 등급 구간 안에서 고르게 퍼져 있다고 보는 대략적인 표시
  function gradePos(cuts, v) {
    const g = Math.min(cuts.length, Math.max(1, Math.floor(v)));
    const start = g === 1 ? 0 : cuts[g - 2];
    if (v >= cuts.length) return 100;
    return start + (v - g) * (cuts[g - 1] - start);
  }
  function scaleHtml(cuts, label, marker) {
    const n = cuts.length;
    const parts = cuts.map((c, i) => {
      const w = c - (i ? cuts[i - 1] : 0);
      const a = Math.round(78 - (i / (n - 1)) * 70);
      return `<div style="width:${w}%;--a:${a}%" class="${a > 45 ? 'dark' : 'light'}" title="${i + 1}등급: 누적 ${c}%">${w >= 6 ? i + 1 : ''}</div>`;
    }).join('');
    return `<div class="scale-row"><span>${label}</span><div class="scale">${parts}${marker != null ? `<i class="marker" style="left:${marker}%"></i>` : ''}</div></div>`;
  }

  function renderConv() {
    const c = state.conv;
    const from = c.dir === '9to5' ? 9 : 5;
    const to = c.dir === '9to5' ? 5 : 9;
    const x = parseFloat(c.value);
    const out = convert(c.dir, x);
    const cuts = window.GRADE_CUTS;
    const nineVal = c.dir === '9to5' ? x : (out ? out[1] : null);
    const fiveVal = c.dir === '9to5' ? (out ? out[1] : null) : x;

    // 5등급 경계(누적 %)가 9등급의 몇 등급 어디쯤에 걸리는지 말로 나타낸다
    const where = (c) => {
      const g = cuts.nine.findIndex((v) => v >= c);
      const prev = g ? cuts.nine[g - 1] : 0;
      const f = (c - prev) / (cuts.nine[g] - prev);
      const part = f >= 0.95 ? '끝' : f >= 0.6 ? '대부분' : f >= 0.35 ? '중간' : '앞부분';
      return `${g + 1}등급 ${part}까지`;
    };
    const cutRows = [1, 2, 3, 4, 5].map((g) => {
      const five = cuts.five[g - 1];
      return `<tr><td>${g}등급</td><td>상위 ${five}%</td><td>${(five - (g > 1 ? cuts.five[g - 2] : 0))}%</td><td>9등급 ${where(five)}</td></tr>`;
    }).join('');

    views.conv.innerHTML = `
      ${head('도구 · 2028 대입', '내신 9등급 ↔ 5등급 변환',
        '2027학년도 고3은 5등급 내신으로 지원하지만, 대학이 공개한 입결과 우리 학교 진학 자료는 9등급입니다. 대학 입결(9등급)을 5등급으로 바꿔 학생 성적과 같은 눈금에서 비교하세요.')}
      <div class="conv-grid">
        <section class="card card-pad">
          <h2>한 개 바꾸기</h2>
          <p class="sub">대진대 입학팀 변환표를 0.1(5등급은 0.05) 간격 사이에서 직선으로 이어 계산합니다.</p>
          <div class="seg" role="group" aria-label="변환 방향">
            <button data-dir="9to5" aria-pressed="${c.dir === '9to5'}">9등급 → 5등급</button>
            <button data-dir="5to9" aria-pressed="${c.dir === '5to9'}">5등급 → 9등급</button>
          </div>
          <div class="conv-input">
            <input id="convValue" type="number" inputmode="decimal" step="0.01" min="1" max="${from}" value="${esc(c.value)}" aria-label="${from}등급 평균">
            <span class="arrow">→</span>
            <div class="conv-out"><b>${out ? fix2(out[1]) : '–'}</b><span>${to}등급 평균값</span></div>
          </div>
          ${out ? `<div class="conv-range">
            <div><small>상 (유리한 경우)</small><strong>${fix2(out[0])}</strong></div>
            <div><small>평균</small><strong>${fix2(out[1])}</strong></div>
            <div><small>하 (불리한 경우)</small><strong>${fix2(out[2])}</strong></div>
          </div>` : `<p class="notice" style="margin-top:14px">1~${from} 사이의 값을 넣어 주세요.</p>`}
          <p class="notice" style="margin-top:14px"><span>같은 9등급 평균이라도 학교·과목 구성에 따라 5등급 값이 달라서 <b>상~하 범위</b>로 보는 것이 안전합니다. 상담할 때는 '평균' 대신 범위를 함께 말해 주세요.</span></p>
        </section>
        <section class="card card-pad">
          <h2>등급 비율이 이렇게 바뀝니다</h2>
          <p class="sub">상대평가 누적 비율. 5등급 1등급(상위 10%)은 9등급 1등급(4%)과 2등급(11%) 사이입니다.</p>
          <div class="scale-wrap">
            ${scaleHtml(cuts.nine, '9등급', nineVal != null && isFinite(nineVal) ? gradePos(cuts.nine, nineVal) : null)}
            ${scaleHtml(cuts.five, '5등급', fiveVal != null && isFinite(fiveVal) ? gradePos(cuts.five, fiveVal) : null)}
            <div class="ticks">${[0, 25, 50, 75, 100].map((t) => `<span style="left:${t}%">${t}%</span>`).join('')}</div>
          </div>
          <table class="cuts"><thead><tr><th>5등급</th><th>누적</th><th>비율</th><th>9등급으로 보면</th></tr></thead><tbody>${cutRows}</tbody></table>
          <p class="muted" style="font-size:12px;margin:10px 0 0">빨간 선은 위에서 넣은 값의 대략적인 위치입니다.</p>
        </section>
      </div>
      <section class="card card-pad bulk" style="margin-bottom:16px">
        <h2>입결 표 한꺼번에 바꾸기</h2>
        <p class="sub">엑셀에서 대학·학과·입결(9등급) 열을 복사해 붙여 넣으면 ${c.dir === '9to5' ? '5등급' : '9등급'} 상·평균·하 열을 붙여 줍니다. 결과는 다시 엑셀에 붙여 넣을 수 있습니다.</p>
        <textarea id="bulkInput" placeholder="예)\n대학\t학과\t전형\t70%컷\n○○대\t간호학과\t교과\t2.31\n○○대\t컴퓨터공학과\t종합\t3.4">${esc(c.bulk)}</textarea>
        <div class="toolbar" style="margin:10px 0 0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="muted" style="font-size:13px">바꿀 열</span>
            <select id="bulkCol" class="select"></select>
          </div>
          <div class="right">
            <button class="btn" data-act="sample">예시 넣기</button>
            <button class="btn" data-act="clear">지우기</button>
            <button class="btn dark" data-act="copy">결과 복사</button>
          </div>
        </div>
        <div id="bulkOut"></div>
      </section>
      <details class="card full-table">
        <summary>전체 변환표 보기</summary>
        <div class="two">
          <div><p class="overline">9등급 → 5등급</p><div class="mini-wrap">${miniTable(window.GRADE_9TO5, '9등급', 10)}</div></div>
          <div><p class="overline">5등급 → 9등급</p><div class="mini-wrap">${miniTable(window.GRADE_5TO9, '5등급', 20)}</div></div>
        </div>
      </details>
      <p class="muted" style="font-size:12px;margin-top:14px">출처: ${esc(window.GRADE_SOURCE || '')}. 원점수 기반 중간석차 백분위로 재산출한 추정치이며, 대학별 환산 방식(성취도 반영, 반영 과목 수)에 따라 실제 결과는 다릅니다.</p>`;
    renderBulk();
  }

  function miniTable(rows, label, band) {
    return `<table class="mini"><thead><tr><th>${label}</th><th>상</th><th>평균</th><th>하</th></tr></thead><tbody>${
      rows.map((r, i) => `<tr class="${i && i % band === 0 ? 'band' : ''}"><td>${r[0]}</td><td>${fix2(r[1])}</td><td>${fix2(r[2])}</td><td>${fix2(r[3])}</td></tr>`).join('')
    }</tbody></table>`;
  }

  function bulkRows() {
    return state.conv.bulk.split(/\r?\n/).filter((l) => l.trim())
      .map((l) => (l.includes('\t') ? l.split('\t') : l.split(',')).map((s) => s.trim()));
  }
  // 칸 전체가 숫자일 때만 등급으로 본다 ("입결(9등급)" 같은 머리글은 제외)
  function numIn(v, max) {
    if (!/^\s*\d+(\.\d+)?\s*$/.test(String(v))) return null;
    const n = parseFloat(v);
    return n >= 1 && n <= max ? n : null;
  }
  function renderBulk() {
    const c = state.conv;
    const max = c.dir === '9to5' ? 9 : 5;
    const rows = bulkRows();
    const width = Math.max(0, ...rows.map((r) => r.length));
    const sel = $('#bulkCol');
    const counts = Array.from({ length: width }, (_, i) => rows.filter((r) => numIn(r[i] || '', max) != null).length);
    let col = c.col >= 0 && c.col < width ? c.col : -1;
    if (col < 0 && width) col = counts.lastIndexOf(Math.max(...counts));
    const header = rows.length && numIn(rows[0][col] || '', max) == null ? rows[0] : null;
    sel.innerHTML = width ? Array.from({ length: width }, (_, i) => `<option value="${i}" ${i === col ? 'selected' : ''}>${String.fromCharCode(65 + i)}열${header && header[i] ? ' · ' + esc(header[i]) : ''}</option>`).join('') : '<option>붙여 넣으면 고를 수 있어요</option>';
    sel.disabled = !width;
    const box = $('#bulkOut');
    if (!rows.length) { box.innerHTML = ''; return; }
    const to = c.dir === '9to5' ? '5등급' : '9등급';
    const outRows = rows.map((r, i) => {
      if (i === 0 && header) return { cells: r, add: [`${to}(상)`, `${to}(평균)`, `${to}(하)`], head: true };
      const v = numIn(r[col] || '', max);
      const res = v == null ? null : convert(c.dir, v);
      return { cells: r, add: res ? res.map(fix2) : ['', '', ''] };
    });
    state.conv.result = outRows;
    const converted = outRows.filter((r) => !r.head && r.add[1]).length;
    box.innerHTML = `<p class="result-meta" style="margin-top:12px"><span>${converted}줄을 바꿨습니다${outRows.length - (header ? 1 : 0) - converted ? `, 숫자가 없는 ${outRows.length - (header ? 1 : 0) - converted}줄은 비워 두었습니다` : ''}.</span></p>
      <div class="bulk-out"><table>${outRows.map((r) => `<tr>${r.cells.concat(Array(width - r.cells.length).fill('')).map((v, j) => r.head ? `<th>${esc(v)}</th>` : `<td class="${j === col ? 'num' : ''}">${esc(v)}</td>`).join('')}${
        r.add.map((v) => r.head ? `<th>${esc(v)}</th>` : `<td class="num new">${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  }

  views.conv.addEventListener('click', async (ev) => {
    const d = ev.target.closest('[data-dir]');
    if (d) { state.conv.dir = d.dataset.dir; state.conv.value = d.dataset.dir === '9to5' ? '2.8' : '1.8'; state.conv.col = -1; renderConv(); return; }
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'sample') {
      state.conv.bulk = state.conv.dir === '9to5'
        ? '대학\t학과\t전형\t입결(9등급)\n○○대\t간호학과\t학생부교과\t2.31\n○○대\t컴퓨터공학과\t학생부종합\t3.4\n△△대\t경영학과\t학생부교과\t4.12\n△△대\t기계공학과\t학생부종합\t5.05'
        : '학생\t5등급 평균\nA\t1.62\nB\t2.35\nC\t3.1';
      state.conv.col = -1;
      renderConv();
    } else if (act.dataset.act === 'clear') {
      state.conv.bulk = ''; state.conv.col = -1; renderConv();
    } else if (act.dataset.act === 'copy') {
      const rows = state.conv.result || [];
      if (!rows.length) { toast('먼저 표를 붙여 넣어 주세요.'); return; }
      const tsv = rows.map((r) => r.cells.concat(r.add).join('\t')).join('\n');
      try { await navigator.clipboard.writeText(tsv); toast('복사했습니다. 엑셀이나 구글 시트에 붙여 넣으세요.'); }
      catch (e) { toast('복사하지 못했습니다. 표를 드래그해서 복사해 주세요.'); }
    }
  });
  views.conv.addEventListener('input', (ev) => {
    if (ev.target.id === 'convValue') {
      state.conv.value = ev.target.value;
      const pos = ev.target.selectionStart;
      renderConv();
      const input = $('#convValue');
      input.focus();
      try { input.setSelectionRange(pos, pos); } catch (e) { /* number 입력칸은 커서 지정이 안 되는 브라우저가 있다 */ }
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

  // "수학(대수, 미적분Ⅰ), (A, B 중 2과목), 물리학" 같은 글을 과목·묶음·글자 조각으로 나눈다
  function parseReq(text) {
    const items = [];
    if (!text) return items;
    // "(A, B 중 n과목)" 묶음은 자리표시(§0§)로 바꿔 두었다가 원래 순서대로 넣는다
    const groups = [];
    const rest = text.replace(/\(([^()]*?)\s*중\s*(\d)\s*과목\)/g, (_, inner, n) => {
      const names = inner.split(',').map((s) => SUBJECT_KEY.get(squash(s)) || str(s)).filter(Boolean);
      groups.push({ type: 'group', names, need: Number(n) });
      return `§${groups.length - 1}§`;
    });
    splitTop(rest).forEach((tok) => {
      const t = tok.trim().replace(/^[-\s]+|[\s]+$/g, '');
      if (!t || t === '-') return;
      const g = t.match(/^§(\d+)§$/);
      if (g) { items.push(groups[Number(g[1])]); return; }
      const direct = SUBJECT_KEY.get(squash(t));
      if (direct) { items.push({ type: 'sub', name: direct }); return; }
      if (squash(t) === '미적분') { items.push({ type: 'group', names: ['미적분Ⅰ', '미적분Ⅱ'], need: 1, label: '미적분' }); return; }
      const m = t.match(/^(수학|과학|사회|국어|영어)\s*\((.*)\)$/);
      if (m) {
        const inner = splitTop(m[2]).map((s) => s.replace(/^특히\s*/, '').trim());
        const subs = inner.map((s) => SUBJECT_KEY.get(squash(s)) || (squash(s) === '미적분' ? 'calc' : null));
        if (subs.length && subs.every(Boolean)) {
          subs.forEach((s) => items.push(s === 'calc' ? { type: 'group', names: ['미적분Ⅰ', '미적분Ⅱ'], need: 1, label: '미적분' } : { type: 'sub', name: s }));
          return;
        }
      }
      items.push({ type: 'text', text: t });
    });
    return items;
  }
  function splitTop(s) {
    const out = []; let depth = 0; let cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.filter((x) => x.trim());
  }
  function itemOk(it) {
    const p = state.subj.picked;
    // 자료집이 그냥 '미적분'이라고 적은 곳은 미적분Ⅰ·Ⅱ 중 하나만 들어도 인정한다
    const has = (n) => p.has(n) || (squash(n) === '미적분' && (p.has('미적분Ⅰ') || p.has('미적분Ⅱ')));
    if (it.type === 'sub') return has(it.name);
    if (it.type === 'group') return it.names.filter(has).length >= it.need;
    return null;
  }
  function tally(items) {
    const counted = items.filter((it) => it.type !== 'text');
    return { total: counted.length, ok: counted.filter(itemOk).length };
  }
  function chipsHtml(items, kind) {
    const picking = state.subj.picked.size > 0;
    return items.map((it) => {
      if (it.type === 'text') return `<span class="sub-chip text">${esc(it.text)}</span>`;
      const ok = itemOk(it);
      const cls = !picking ? '' : ok ? 'ok' : `miss ${kind === 'rec' ? 'rec' : ''}`;
      const mark = picking ? (ok ? '✓ ' : '') : '';
      if (it.type === 'group') {
        const label = it.label || `${it.names.join(', ')} 중 ${it.need}과목`;
        return `<span class="sub-chip group ${cls}">${mark}${esc(label)}</span>`;
      }
      return `<span class="sub-chip ${cls}">${mark}${esc(it.name)}</span>`;
    }).join('');
  }

  function renderSubj() {
    const s = state.subj;
    const univs = [...new Set(state.recommend.map((r) => r.univ))];
    const words = s.query.toLowerCase().split(/\s+/).filter(Boolean).map(squash);
    let list = state.recommend.filter((r) => (!s.univ || r.univ === s.univ) && words.every((w) => r.hay.includes(w)));
    const picking = s.picked.size > 0;
    if (picking && s.sort === 'fit') {
      const score = (r) => {
        const c = tally(r.parsed.core.concat(r.parsed.all)); const k = tally(r.parsed.rec);
        return (c.total ? c.ok / c.total : 1) * 2 + (k.total ? k.ok / k.total : 0);
      };
      list = list.slice().sort((a, b) => score(b) - score(a));
    }
    const shown = list.slice(0, s.limit);

    const pickHtml = SUBJECTS.map(([group, subs], gi) => {
      const chips = subs.map((n) => `<button class="pick" data-sub="${esc(n)}" aria-pressed="${s.picked.has(n)}">${esc(n)}</button>`).join('');
      const pickedHere = subs.filter((n) => s.picked.has(n)).length;
      return gi < 2
        ? `<div class="pick-group"><p>${group}</p><div class="picks">${chips}</div></div>`
        : `<div class="pick-group"><details ${pickedHere ? 'open' : ''}><summary>${group}${pickedHere ? ` · ${pickedHere}` : ''}</summary><div class="picks">${chips}</div></details></div>`;
    }).join('');

    const unitHtml = (r) => {
      const core = tally(r.parsed.core); const rec = tally(r.parsed.rec); const all = tally(r.parsed.all);
      const badge = (t, label, kind) => {
        if (!picking || !t.total) return '';
        const cls = t.ok === t.total ? 'full' : kind === 'core' ? 'miss' : '';
        return `<span class="${cls}">${label} ${t.ok}/${t.total}</span>`;
      };
      const req = (label, items, kind) => items.length ? `<div class="req ${kind === 'core' ? 'core' : ''}"><b>${label}</b><div class="subs">${chipsHtml(items, kind)}</div></div>` : '';
      return `<article class="card unit">
        <div class="unit-head"><h3><span class="univ">${esc(r.univ)}</span>${esc(r.unit)}</h3>
          <div class="score">${badge(core, '핵심', 'core')}${badge(all, '반영', 'core')}${badge(rec, '권장', 'rec')}</div></div>
        ${req('핵심', r.parsed.core, 'core')}${req('권장', r.parsed.rec, 'rec')}${req('반영', r.parsed.all, 'core')}
        ${!r.parsed.core.length && !r.parsed.rec.length && !r.parsed.all.length ? '<div class="req"><b>과목</b><div class="subs"><span class="sub-chip text">지정 없음</span></div></div>' : ''}
        <p class="unit-note">${esc(r.note)}${r.page ? `<span class="pg">${r.note ? '· ' : ''}자료집 ${esc(r.page)}쪽</span>` : ''}</p>
      </article>`;
    };

    views.subj.innerHTML = `
      ${head('도구 · 2022 개정 교육과정', '대학별 권장과목 확인',
        '학생이 이수했거나 이수할 과목을 고르면, 희망 대학·학과의 핵심과목과 권장과목을 채웠는지 바로 보여 줍니다. 고른 과목은 저장되지 않습니다.')}
      <div class="subj-layout">
        <aside class="card picker">
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
            <input id="subjSearch" type="search" placeholder="학과나 대학 이름 (예: 간호, 컴퓨터, 고려대 화학)" value="${esc(s.query)}" aria-label="학과 찾기">
            <select id="subjUniv" class="select" aria-label="대학 고르기"><option value="">전체 대학 (${univs.length})</option>${univs.map((u) => `<option ${u === s.univ ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
          </div>
          <div class="result-meta">
            <span>${list.length}개 모집단위${list.length > shown.length ? ` 중 ${shown.length}개 표시` : ''}</span>
            ${picking ? `<div class="seg"><button data-sort="source" aria-pressed="${s.sort === 'source'}">자료집 순</button><button data-sort="fit" aria-pressed="${s.sort === 'fit'}">충족 높은 순</button></div>` : '<span>과목을 고르면 충족 여부가 표시됩니다</span>'}
          </div>
          ${shown.length ? shown.map(unitHtml).join('') : '<div class="empty">찾는 모집단위가 없습니다. 다른 이름으로 찾아보세요.</div>'}
          ${list.length > shown.length ? `<p style="text-align:center"><button class="btn" data-more>더 보기 (${list.length - shown.length}개 남음)</button></p>` : ''}
          ${seedOfferHtml()}
          <p class="muted" style="font-size:12px;margin-top:14px">출처: ${state.recommendSource === 'sheet' ? '구글 시트 \'권장과목\' 탭' : esc(window.RECOMMEND_SOURCE || '')}. 수도권 대학과 강원대를 옮겨 두었습니다. 대학 발표에 따라 바뀔 수 있으니 지원 전 해당 대학 모집요강을 꼭 확인하세요. '수학②'처럼 대학이 묶음으로 적은 항목은 회색 점선으로 표시하고 계산하지 않습니다.</p>
        </div>
      </div>`;
  }
  function seedOfferHtml() {
    if (!state.live || state.recommendSource === 'sheet') return '';
    return `<div class="notice" style="margin-top:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span>이 표를 구글 시트 '권장과목' 탭으로 보내면 선생님들이 대학을 추가하거나 고칠 수 있습니다.</span>
      <button class="btn dark" data-seed>시트로 보내기</button></div>`;
  }

  views.subj.addEventListener('click', async (ev) => {
    const s = state.subj;
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
      const rows = state.recommend.map((r) => [r.univ, r.unit, r.core, r.rec, r.all, r.note, r.page]);
      try {
        await api('seedRecommend', { rows });
        toast(`${rows.length}줄을 시트 '권장과목' 탭에 만들었습니다.`);
        state.recommendSource = 'sheet';
        renderSubjKeep();
      } catch (err) { toast(`보내지 못했습니다: ${err.message}`); }
    }
  });
  views.subj.addEventListener('input', (ev) => {
    if (ev.target.id !== 'subjSearch') return;
    state.subj.query = ev.target.value;
    state.subj.limit = 40;
    const pos = ev.target.selectionStart;
    renderSubj();
    const input = $('#subjSearch');
    input.focus();
    input.setSelectionRange(pos, pos);
  });
  views.subj.addEventListener('change', (ev) => {
    if (ev.target.id === 'subjUniv') { state.subj.univ = ev.target.value; state.subj.limit = 40; renderSubjKeep(); }
  });
  // 과목을 고를 때 왼쪽 목록의 스크롤 위치를 지킨다
  function renderSubjKeep() {
    const picker = views.subj.querySelector('.picker');
    const top = picker ? picker.scrollTop : 0;
    renderSubj();
    const again = views.subj.querySelector('.picker');
    if (again) again.scrollTop = top;
  }

  // ───────── 자료실

  function renderRes() {
    const q = state.resQuery.toLowerCase();
    const list = state.data.resources.filter((r) => !q || (r.name + r.desc + r.cat).toLowerCase().includes(q));
    const cats = [...new Set(list.map((r) => r.cat))];
    const used = (id) => [...new Set(state.data.tasks.filter((t) => t.links.includes(id)).map((t) => t.month))]
      .sort((a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b)).map(monthShort);
    const missing = state.data.resources.filter((r) => !r.url).length;
    views.res.innerHTML = `
      ${head('자료', '자료실', missing ? `링크가 비어 있는 자료 ${missing}개: 구글 드라이브에 올린 뒤 시트의 '자료' 탭 링크 칸에 주소를 넣으면 여기와 업무 카드에서 바로 열립니다.` : '')}
      <div class="res-tools">
        <input id="resSearch" type="search" placeholder="자료 이름으로 찾기" value="${esc(state.resQuery)}" aria-label="자료 찾기">
      </div>
      ${cats.map((c) => `<section class="res-group"><h3>${esc(c)}</h3><div class="res-list">${list.filter((r) => r.cat === c).map((r) => {
        const u = used(r.id);
        return `<div class="card res"><b>${esc(r.name)}</b><p>${esc(r.desc)}</p>
          <div class="row"><span class="used">${u.length ? '쓰는 달: ' + u.join(', ') : ''}</span>
          ${r.url ? (r.url.startsWith('#') ? `<a class="btn" href="${esc(r.url)}">열기 →</a>` : `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">열기 ↗</a>`) : '<span class="btn off">링크 미등록</span>'}</div></div>`;
      }).join('')}</div></section>`).join('') || '<div class="empty">찾는 자료가 없습니다.</div>'}`;
  }
  views.res.addEventListener('input', (ev) => {
    if (ev.target.id !== 'resSearch') return;
    state.resQuery = ev.target.value;
    const pos = ev.target.selectionStart;
    renderRes();
    const input = $('#resSearch');
    input.focus();
    input.setSelectionRange(pos, pos);
  });

  // ───────── 폼 요약

  async function renderForms() {
    const top = head('도구', '구글폼 응답 요약', '기초조사, 면접 사전조사 같은 구글폼의 응답 수와 날짜별 인원을 숫자로만 보여 줍니다. 학생 이름은 사이트로 오지 않습니다.');
    if (!state.live) { views.forms.innerHTML = top + needLiveHtml('폼 요약'); return; }
    if (!state.forms) {
      views.forms.innerHTML = top + '<div class="empty">폼 응답을 세는 중입니다…</div>';
      try {
        state.forms = (await api('forms')).forms || [];
      } catch (err) {
        views.forms.innerHTML = top + `<div class="empty">폼 요약을 불러오지 못했습니다: ${esc(err.message)}</div>`;
        return;
      }
      if (state.view !== 'forms') return;
    }
    const list = state.forms.filter((f) => !state.formsMine || !f.cls || f.cls === state.cls);
    views.forms.innerHTML = `${top}
      <div class="toolbar">
        <div class="seg">
          <button data-mine="1" aria-pressed="${state.formsMine}">우리 반${state.cls ? ` (${esc(state.cls)})` : ''}과 공통</button>
          <button data-mine="0" aria-pressed="${!state.formsMine}">전체</button>
        </div>
        <button class="btn" data-act="reload-forms">새로 세기</button>
      </div>
      ${list.length ? `<div class="forms-grid">${list.map(formHtml).join('')}</div>` : `<div class="empty"><h3>보여 줄 폼이 없습니다</h3>
        <p>시트의 '폼 요약' 탭에 폼 응답 시트 주소와 탭 이름을 넣으면 여기에 나옵니다.</p></div>`}`;
  }
  function formHtml(f) {
    if (f.error) return `<div class="card form-card"><h3>${esc(f.name)}</h3><p class="err">${esc(f.error)}</p></div>`;
    const dates = Object.keys(f.dates || {}).sort();
    const max = Math.max(1, ...dates.map((d) => f.dates[d]));
    const dateOf = (mmdd) => { const n = Number(mmdd.slice(0, 2)); return new Date(n >= 3 ? baseYear() : baseYear() + 1, n - 1, Number(mmdd.slice(3))); };
    const hist = dates.map((d) => {
      const dt = dateOf(d);
      return `<div class="hist-row ${dt < today ? 'past' : ''}"><span>${dt.getMonth() + 1}.${dt.getDate()} (${WEEK[dt.getDay()]})</span>
        <div class="track"><i style="width:${(f.dates[d] / max) * 100}%"></i></div><b>${f.dates[d]}</b></div>`;
    }).join('');
    return `<div class="card form-card">
      <h3>${esc(f.name)}</h3>
      <div class="task-meta"><span class="chip">${f.cls ? esc(f.cls) : '공통'}</span><span>${esc(f.desc)}</span></div>
      <div class="nums">
        <div><b>${f.responses}</b><span>응답</span></div>
        ${f.unique !== f.responses ? `<div><b>${f.unique}</b><span>중복 제외</span></div>` : ''}
        ${f.target ? `<div><b>${Math.max(0, f.target - f.unique)}</b><span>미제출 (${f.target}명 기준)</span></div>` : ''}
        ${dates.length ? `<div><b>${dates.reduce((sum, d) => sum + f.dates[d], 0)}</b><span>날짜 응답 수</span></div>` : ''}
      </div>
      ${hist ? `<div class="hist">${hist}</div>` : ''}
      ${f.latest ? `<p class="muted" style="font-size:12px;margin:12px 0 0">마지막 응답 ${new Date(f.latest).toLocaleString('ko-KR')}</p>` : ''}
    </div>`;
  }
  views.forms.addEventListener('click', (ev) => {
    const mine = ev.target.closest('[data-mine]');
    if (mine) { state.formsMine = mine.dataset.mine === '1'; renderForms(); return; }
    if (ev.target.closest('[data-act="reload-forms"]')) { state.forms = null; renderForms(); }
  });

  // ───────── 화면 이동, 반 선택, 설정

  function viewFromHash() { const h = location.hash.replace('#', ''); return VIEWS.includes(h) ? h : ''; }
  function switchView(v) {
    state.view = v;
    store.set('hr.view', v);
    if (location.hash !== `#${v}`) history.replaceState(null, '', `#${v}`);
    render();
    window.scrollTo({ top: 0 });
  }
  document.querySelector('.nav').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-view]');
    if (b) switchView(b.dataset.view);
  });
  window.addEventListener('hashchange', () => { const v = viewFromHash(); if (v && v !== state.view) switchView(v); });
  $('#classSelect').addEventListener('change', (ev) => {
    state.cls = ev.target.value;
    store.set('hr.cls', state.cls);
    render();
  });

  const dialog = $('#settings');
  function openSettings() {
    $('#connInfo').textContent = SCRIPT_URL
      ? (state.source === 'error'
        ? '시트에 연결하지 못해 기본 데이터를 보여 주고 있습니다. Apps Script 배포 상태를 확인해 주세요.'
        : '업무·일정·자료를 구글 시트에서 불러오고 있습니다. 시트를 고치면 1분 안에 사이트에 반영됩니다.')
      : 'site/config.js 에 Apps Script 주소가 없어 기본 데이터로 동작합니다. 체크와 메모는 이 브라우저에만 저장됩니다.';
    const input = $('#codeInput');
    input.value = state.code;
    input.disabled = !SCRIPT_URL;
    $('#codeSave').disabled = !SCRIPT_URL;
    const msg = $('#codeMsg');
    msg.className = 'msg' + (state.live ? ' good' : '');
    msg.textContent = state.live ? '학년 코드 확인됨: 체크가 시트와 공유되고 있습니다.' : '';
    dialog.showModal();
  }
  $('#statusBtn').addEventListener('click', openSettings);
  document.addEventListener('click', (ev) => { if (ev.target.closest('[data-open-settings]')) openSettings(); });
  $('#codeSave').addEventListener('click', async () => {
    const msg = $('#codeMsg');
    state.code = $('#codeInput').value.trim();
    if (!state.code) { msg.className = 'msg bad'; msg.textContent = '학년 코드를 넣어 주세요.'; return; }
    msg.className = 'msg'; msg.textContent = '확인 중…';
    try {
      await goLive(false);
      store.set('hr.code', state.code);
      state.forms = null;
      msg.className = 'msg good';
      msg.textContent = '확인됨: 이제 체크가 시트에 저장됩니다.';
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
    store.set('hr.code', '');
    state.progress = store.get('hr.progress', {});
    $('#codeInput').value = '';
    $('#codeMsg').className = 'msg';
    $('#codeMsg').textContent = '코드를 지웠습니다. 체크는 다시 이 브라우저에만 저장됩니다.';
    render();
  });

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ───────── 시작

  if (location.hash !== `#${state.view}`) history.replaceState(null, '', `#${state.view}`);
  render();
  (async () => {
    if (!SCRIPT_URL) return;
    await loadSheet();
    await goLive(true);
    render();
  })();
})();
