(function () {
  'use strict';

  const SCRIPT_URL = ((window.HR_CONFIG || {}).scriptUrl || '').trim();
  const MONTHS = ['준비', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2'];
  const CAT_COLORS = {
    '상담': '#2f6fde', '생기부': '#8a4fd1', '수능·모의고사': '#e8590c', '수시': '#0c8a5f', '정시': '#0b7d99',
    '면접': '#d6336c', '출결': '#5f3dc4', '학급운영': '#6b7785', '학부모': '#d08700', '행정': '#4f5866',
    '학사': '#5c940d', '연수': '#1098ad', '안내': '#ae3ec9',
  };
  // 연간 흐름표에 줄로 보여줄 분류(나머지는 '기타'로 묶지 않고 생략)
  const FLOW_CATS = ['상담', '생기부', '수능·모의고사', '수시', '면접', '정시', '출결', '학급운영', '학부모', '행정'];
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

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
    source: 'seed',          // seed | sheet | error
    updatedAt: '',
    cls: store.get('hr.cls', ''),
    code: store.get('hr.code', ''),
    live: false,             // 학년 코드 확인 후 체크를 시트와 공유하는 중
    progress: {},            // { 반: { 업무키: {done, memo, at} } }
    view: store.get('hr.view', 'month'),
    month: null,
    filter: 'all',
    open: new Set(),
    forms: null,
    formsMine: true,
    gradeMonth: null,
    resQuery: '',
  };
  const today = readToday();
  state.month = monthOfDate(today);
  state.gradeMonth = state.month;
  if (!state.live) state.progress = store.get('hr.progress', {});

  const $ = (sel) => document.querySelector(sel);
  const views = {
    month: $('#view-month'), year: $('#view-year'), grade: $('#view-grade'), res: $('#view-res'), forms: $('#view-forms'),
  };

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
  function str(v) { return v == null ? '' : String(v).trim(); }
  // 시트에 '3월', '03', '학기 전'처럼 적어도 '3', '준비'로 맞춘다
  function monthKey(v) {
    const s = str(v);
    const n = s.match(/^0?(\d{1,2})\s*월?$/);
    if (n) return n[1];
    return /^(학기\s*전|준비)$/.test(s) ? '준비' : s;
  }
  function truthy(v) { return v === true || /^(true|y|yes|o|★|1|v|✓|중요)$/i.test(str(v)); }
  function safeUrl(v) { const u = str(v); return /^https?:\/\//i.test(u) ? u : ''; }
  function toISO(v) {
    const s = str(v);
    const m = s.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  }
  function esc(v) {
    return str(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
    if (!state.cls) { toast('먼저 위에서 우리 반을 골라 주세요.'); $('#classSelect').focus(); return false; }
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
    renderDdays();
    Object.keys(views).forEach((v) => { views[v].hidden = v !== state.view; });
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    ({ month: renderMonth, year: renderYear, grade: renderGrade, res: renderRes, forms: renderForms })[state.view]();
  }

  function renderTop() {
    const s = state.data.settings;
    $('#brandSub').textContent = `${s.school ? s.school + ' · ' : ''}${s.year}학년도 · ${s.admissionYear}학년도 대입`;
    const sel = $('#classSelect');
    const opts = ['<option value="">반 선택</option>'].concat(s.classes.map((c) => `<option ${c === state.cls ? 'selected' : ''}>${esc(c)}</option>`));
    sel.innerHTML = opts.join('');
    const btn = $('#statusBtn');
    let text = '기본 데이터 · 이 기기에 저장';
    let st = 'local';
    if (state.source === 'error') { text = '시트 연결 실패 · 기본 데이터'; st = 'error'; }
    else if (state.live) { text = '시트 연결 · 체크 공유 중'; st = 'live'; }
    else if (state.source === 'sheet') { text = '시트 연결 · 체크는 이 기기'; st = 'sheet'; }
    btn.dataset.state = st;
    $('#statusText').textContent = text;
    $('#footSource').textContent = state.source === 'sheet'
      ? `업무 데이터: 구글 시트${state.updatedAt ? ` (불러온 시각 ${new Date(state.updatedAt).toLocaleString('ko-KR')})` : ''}`
      : '업무 데이터: 기본 데이터(site/data.js)';
  }

  function renderDdays() {
    const list = state.data.events.filter((e) => e.star && parseDate(e.end || e.date) >= today).slice(0, 4);
    $('#ddays').innerHTML = list.map((e) => {
      const d = days(today, parseDate(e.date));
      const label = d > 0 ? `D-${d}` : (d === 0 ? 'D-DAY' : '진행 중');
      const w = WEEK[parseDate(e.date).getDay()];
      return `<div class="dday ${d <= 0 ? 'today' : ''}"><b>${label}</b><span>${esc(e.title)}</span><small>${range(e)} (${w})</small></div>`;
    }).join('');
    $('#ddays').hidden = !list.length;
  }

  function catChip(cat) { return `<span class="chip cat" style="--c:${CAT_COLORS[cat] || '#6b7785'}">${esc(cat)}</span>`; }

  // ───────── 월별 업무

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
    }).join('') : '<p class="muted" style="margin:0;font-size:13px">이 달에 등록된 일정이 없습니다.</p>';

    const filters = [['all', '전체'], ['star', '★ 꼭 챙길 것'], ['todo', '남은 것'], ['done', '완료']]
      .map(([k, v]) => `<button data-filter="${k}" aria-pressed="${state.filter === k}">${v}</button>`).join('');

    views.month.innerHTML = `
      <div class="month-rail" role="group" aria-label="달 선택">${rail}</div>
      <div class="month-head">
        <div>
          <h2><em>${monthLabel(m)}</em>${esc(info.title)}</h2>
          <p>${esc(info.focus)}</p>
        </div>
        <div class="month-progress">
          <span class="muted">${state.cls ? esc(state.cls) + ' 진행' : '반을 고르면 진행률이 저장됩니다'}</span>
          <div><b>${stats.done}</b> / ${stats.total} · ${pct(stats)}%</div>
          <div class="bar"><i style="width:${pct(stats)}%"></i></div>
          <div class="month-tools">
            <button class="btn" data-act="expand">${state.open.size ? '모두 접기' : '모두 펼치기'}</button>
            <button class="btn" data-act="print">이 달 인쇄</button>
          </div>
        </div>
      </div>
      <div class="month-body">
        <aside class="card events-box"><h3>이 달의 주요 일정</h3>${eventHtml}</aside>
        <div class="tasks-box">
          <div class="filters" role="group" aria-label="업무 거르기">${filters}</div>
          ${groups.length ? groups.map((g) => `
            <section class="group">
              <h3 class="group-title">${g.cat ? catChip(g.cat) : '<span class="chip">매월 반복</span>'}<span>${g.items.length}개</span></h3>
              ${g.items.map(taskHtml).join('')}
            </section>`).join('') : '<div class="empty">조건에 맞는 업무가 없습니다.</div>'}
        </div>
      </div>`;
    // 좁은 화면에서 고른 달이 달 막대 가운데 오게 한다 (페이지는 스크롤하지 않음)
    const railEl = views.month.querySelector('.month-rail');
    const pill = railEl.querySelector('[aria-pressed="true"]');
    if (pill) railEl.scrollLeft = pill.offsetLeft - railEl.offsetLeft - (railEl.clientWidth - pill.offsetWidth) / 2;
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
      if (!r) return '';
      return r.url
        ? `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)} ↗</a>`
        : `<span class="btn off" title="시트의 '자료' 탭에 링크를 넣으면 열립니다">${esc(r.name)} (링크 미등록)</span>`;
    }).join('');
    const memo = (e && e.memo) || '';
    return `<article class="task card ${done ? 'is-done' : ''}" data-key="${esc(t.key)}">
      <div class="task-row">
        <button class="check" data-act="check" aria-pressed="${done}" aria-label="${esc(t.title)} 완료 표시">✓</button>
        <div class="task-main">
          <button class="task-title" data-act="open" aria-expanded="${open}">${t.star ? '<span class="star" aria-label="꼭 챙길 업무">★</span> ' : ''}${esc(t.title)}</button>
          <div class="task-meta">${t.recurring ? catChip(t.cat) : ''}<span class="when">${esc(t.when)}</span>${status}${memo && !open ? '<span class="has-memo">메모 있음</span>' : ''}</div>
        </div>
      </div>
      <div class="task-detail" ${open ? '' : 'hidden'}>
        ${t.detail ? `<p>${esc(t.detail)}</p>` : ''}
        ${t.note ? `<p class="muted">${esc(t.note)}</p>` : ''}
        ${links ? `<div class="links">${links}</div>` : ''}
        <textarea class="memo" data-key="${esc(t.key)}" placeholder="우리 반 메모 (예: 미제출 3명, 9/2 재안내)">${esc(memo)}</textarea>
        <div class="memo-note">${state.live ? '메모는 시트에 저장되어 같은 반 기록으로 공유됩니다.' : '메모는 이 브라우저에만 저장됩니다.'}</div>
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
    const card = act.closest('.task');
    const key = card && card.dataset.key;
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
    const key = ev.target.dataset.key;
    const ok = await saveEntry(key, { memo: ev.target.value.slice(0, 500) });
    if (ok) toast('메모를 저장했습니다.');
  });

  // ───────── 연간 흐름

  function renderYear() {
    const now = monthOfDate(today);
    const cats = FLOW_CATS.filter((c) => state.data.tasks.some((t) => t.cat === c && t.month !== '매월'));
    const head = MONTHS.map((m) => `<th class="${m === now ? 'now-col' : ''}">${monthShort(m)}</th>`).join('');
    const rows = cats.map((c) => {
      const color = CAT_COLORS[c] || '#6b7785';
      const cells = MONTHS.map((m) => {
        const list = state.data.tasks.filter((t) => t.cat === c && t.month === m);
        if (!list.length) return `<td class="${m === now ? 'now-col' : ''}"></td>`;
        const hot = list.some((t) => t.star);
        const title = list.map((t) => (t.star ? '★ ' : '') + t.title).join('\n');
        return `<td class="on ${hot ? 'hot' : ''} ${m === now ? 'now-col' : ''}" style="--c:${color}" data-month="${m}" title="${esc(title)}">${list.length}</td>`;
      }).join('');
      return `<tr><th class="row">${catChip(c)}</th>${cells}</tr>`;
    }).join('');

    const cards = MONTHS.map((m) => {
      const info = state.data.months.find((x) => x.month === m) || { title: '', focus: '' };
      const stars = state.data.tasks.filter((t) => t.month === m && t.star);
      const s = monthStats(m);
      return `<button class="card ycard ${m === now ? 'now' : ''}" data-month="${m}">
        <h3><em>${monthLabel(m)}</em>${esc(info.title)}</h3>
        <p>${esc(info.focus)}</p>
        ${stars.length ? `<ul>${stars.slice(0, 5).map((t) => `<li class="${isDone(t.id) ? 'done' : ''}">${esc(t.title)}</li>`).join('')}</ul>` : ''}
        <div class="foot-line"><span>업무 ${s.total}개</span><span>${state.cls ? `${esc(state.cls)} ${pct(s)}%` : ''}</span></div>
        <div class="bar" style="margin-top:6px"><i style="width:${pct(s)}%"></i></div>
      </button>`;
    }).join('');

    views.year.innerHTML = `
      <div class="year-head">
        <h2>${esc(state.data.settings.year)}학년도 고3 담임 1년 흐름</h2>
        <button class="btn" data-act="ics">일정을 캘린더 파일(.ics)로 받기</button>
      </div>
      <div class="card flow">
        <table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>
        <div class="flow-legend"><span>칸의 숫자 = 그 달의 업무 수</span><span><i style="background:#2f6fde"></i>꼭 챙길 업무가 있는 달</span><span><i style="background:color-mix(in srgb,#2f6fde 22%,transparent)"></i>일반 업무</span><span>칸을 누르면 그 달로 이동합니다</span></div>
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
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `고3담임_${state.data.settings.year}_일정.ics`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(`${items.length}개 일정을 담았습니다. 구글 캘린더 > 설정 > 가져오기에서 올리세요.`);
  }

  // ───────── 학년 현황

  function renderGrade() {
    if (!state.live) {
      views.grade.innerHTML = needLiveHtml('학년 현황', '반마다 어떤 업무를 마쳤는지 한 표로 봅니다.');
      return;
    }
    const classes = state.data.settings.classes;
    const now = monthOfDate(today);
    const head = MONTHS.map((m) => `<th class="${m === now ? 'now' : ''}">${monthShort(m)}</th>`).join('');
    const rows = classes.map((c) => {
      const cells = MONTHS.map((m) => {
        const p = pct(monthStats(m, c));
        return `<td><span class="pct" style="background:color-mix(in srgb,var(--ok) ${Math.round(p * 0.35)}%,transparent)">${p}%</span></td>`;
      }).join('');
      return `<tr class="${c === state.cls ? 'mine' : ''}"><td class="cls">${esc(c)}</td>${cells}</tr>`;
    }).join('');

    const gm = state.gradeMonth;
    const tasks = tasksFor(gm);
    const detailRows = tasks.map((t) => `<tr><td class="task-name">${t.star ? '<span class="star">★</span> ' : ''}${esc(t.title)}</td>${classes.map((c) => {
      const e = entry(t.key, c);
      return `<td title="${e && e.memo ? esc(e.memo) : ''}">${e && e.done ? '<span class="y">✓</span>' : '<span class="n">·</span>'}${e && e.memo ? '<sup>✎</sup>' : ''}</td>`;
    }).join('')}</tr>`).join('');

    views.grade.innerHTML = `
      <div class="card grade-table">
        <h3 style="margin:0 0 8px;font-size:15px">반별 · 달별 진행률</h3>
        <table><thead><tr><th class="cls">반</th>${head}</tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div class="card grade-table">
        <div class="grade-sub">
          <h3 style="margin:0;font-size:15px">업무별로 보기</h3>
          <select id="gradeMonth" aria-label="달 선택">${MONTHS.map((m) => `<option value="${m}" ${m === gm ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
          <span class="muted" style="font-size:12px">✎ 표시에 마우스를 올리면 메모가 보입니다.</span>
        </div>
        <table><thead><tr><th class="cls">업무</th>${classes.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${detailRows}</tbody></table>
      </div>`;
  }
  views.grade.addEventListener('change', (ev) => {
    if (ev.target.id === 'gradeMonth') { state.gradeMonth = ev.target.value; renderGrade(); }
  });

  function needLiveHtml(title, what) {
    if (!SCRIPT_URL) {
      return `<div class="empty"><h3>${title}은 구글 시트를 연결하면 열립니다</h3>
        <p>${what}</p><ol><li>README의 「구글 시트 연결하기」대로 Apps Script를 배포합니다.</li>
        <li>웹 앱 주소를 <code>site/config.js</code>에 넣고 다시 올립니다.</li><li>오른쪽 위 연결 버튼에서 학년 코드를 넣습니다.</li></ol></div>`;
    }
    return `<div class="empty"><h3>학년 코드를 넣으면 ${title}이 열립니다</h3><p>${what}</p>
      <p><button class="btn" data-open-settings>학년 코드 넣기</button></p></div>`;
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
      <div class="res-tools">
        <input id="resSearch" type="search" placeholder="자료 이름으로 찾기" value="${esc(state.resQuery)}" aria-label="자료 찾기">
      </div>
      ${missing ? `<p class="muted" style="font-size:13px;margin:0 0 6px">링크가 비어 있는 자료 ${missing}개: 구글 드라이브에 올린 뒤 시트의 '자료' 탭 링크 칸에 주소를 넣으면 여기와 업무 카드에서 바로 열립니다.</p>` : ''}
      ${cats.map((c) => `<section class="res-group"><h3>${esc(c)}</h3><div class="res-list">${list.filter((r) => r.cat === c).map((r) => {
        const u = used(r.id);
        return `<div class="card res"><b>${esc(r.name)}</b><p>${esc(r.desc)}</p>
          <div class="row"><span class="used">${u.length ? '쓰는 달: ' + u.join(', ') : ''}</span>
          ${r.url ? `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">열기 ↗</a>` : '<span class="btn off">링크 미등록</span>'}</div></div>`;
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
    if (!state.live) {
      views.forms.innerHTML = needLiveHtml('폼 요약', '기초조사, 면접 사전조사 같은 구글폼의 응답 수와 날짜별 인원을 숫자로만 보여 줍니다. 학생 이름은 사이트로 오지 않습니다.');
      return;
    }
    if (!state.forms) {
      views.forms.innerHTML = '<div class="empty">폼 응답을 세는 중입니다…</div>';
      try {
        state.forms = (await api('forms')).forms || [];
      } catch (err) {
        views.forms.innerHTML = `<div class="empty">폼 요약을 불러오지 못했습니다: ${esc(err.message)}</div>`;
        return;
      }
      if (state.view !== 'forms') return;
    }
    const list = state.forms.filter((f) => !state.formsMine || !f.cls || f.cls === state.cls);
    views.forms.innerHTML = `
      <div class="filters">
        <button data-mine="1" aria-pressed="${state.formsMine}">우리 반${state.cls ? ` (${esc(state.cls)})` : ''}과 공통</button>
        <button data-mine="0" aria-pressed="${!state.formsMine}">전체</button>
        <button data-act="reload-forms">새로 세기</button>
      </div>
      ${list.length ? `<div class="forms-grid">${list.map(formHtml).join('')}</div>` : `<div class="empty"><h3>보여 줄 폼이 없습니다</h3>
        <p>시트의 '폼 요약' 탭에 폼 응답 시트 주소와 탭 이름을 넣으면 여기에 나옵니다.</p></div>`}`;
  }
  function formHtml(f) {
    if (f.error) return `<div class="card form-card"><h3>${esc(f.name)}</h3><p class="err">${esc(f.error)}</p></div>`;
    const dates = Object.keys(f.dates || {}).sort();
    const max = Math.max(1, ...dates.map((d) => f.dates[d]));
    const yearOf = (mmdd) => { const n = Number(mmdd.slice(0, 2)); return n >= 3 ? baseYear() : baseYear() + 1; };
    const hist = dates.map((d) => {
      const past = new Date(yearOf(d), Number(d.slice(0, 2)) - 1, Number(d.slice(3))) < today;
      const w = WEEK[new Date(yearOf(d), Number(d.slice(0, 2)) - 1, Number(d.slice(3))).getDay()];
      return `<div class="hist-row ${past ? 'past' : ''}"><span>${Number(d.slice(0, 2))}.${Number(d.slice(3))} (${w})</span>
        <div class="track"><i style="width:${(f.dates[d] / max) * 100}%"></i></div><b>${f.dates[d]}</b></div>`;
    }).join('');
    return `<div class="card form-card">
      <h3>${esc(f.name)}</h3>
      <div class="task-meta">${f.cls ? `<span class="chip">${esc(f.cls)}</span>` : '<span class="chip">공통</span>'}<span class="when">${esc(f.desc)}</span></div>
      <div class="nums">
        <div><b>${f.responses}</b><span>응답</span></div>
        ${f.unique !== f.responses ? `<div><b>${f.unique}</b><span>중복 제외</span></div>` : ''}
        ${f.target ? `<div><b>${Math.max(0, f.target - f.unique)}</b><span>미제출 (${f.target}명 기준)</span></div>` : ''}
        ${dates.length ? `<div><b>${dates.reduce((s, d) => s + f.dates[d], 0)}</b><span>날짜 응답 수</span></div>` : ''}
      </div>
      ${hist ? `<div class="hist">${hist}</div>` : ''}
      ${f.latest ? `<p class="muted" style="font-size:12px;margin:10px 0 0">마지막 응답 ${new Date(f.latest).toLocaleString('ko-KR')}</p>` : ''}
    </div>`;
  }
  views.forms.addEventListener('click', (ev) => {
    const mine = ev.target.closest('[data-mine]');
    if (mine) { state.formsMine = mine.dataset.mine === '1'; renderForms(); return; }
    if (ev.target.closest('[data-act="reload-forms"]')) { state.forms = null; renderForms(); }
  });

  // ───────── 탭, 반 선택, 설정

  function switchView(v) {
    state.view = v;
    store.set('hr.view', v);
    render();
    window.scrollTo({ top: 0 });
  }
  document.querySelector('.tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-view]');
    if (b) switchView(b.dataset.view);
  });
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

  render();
  (async () => {
    if (!SCRIPT_URL) return;
    await loadSheet();
    if (state.source === 'sheet') state.month = state.month && MONTHS.includes(state.month) ? state.month : monthOfDate(today);
    await goLive(true);
    render();
  })();
})();
