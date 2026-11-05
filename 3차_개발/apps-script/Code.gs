/**
 * 고3 담임 업무 도우미 서버 (Google Apps Script) · 3차
 * 업무표 구글 시트 > 확장 프로그램 > Apps Script 에 이 파일 내용을 그대로 붙여 넣습니다.
 * 코드를 고친 뒤에는 "배포 > 배포 관리 > 편집 > 새 버전"으로 다시 배포해야 반영됩니다.
 *
 * 누구나 읽을 수 있는 것(GET): 설정(학년 코드 제외), 월별 요약, 업무, 일정, 자료(교사용 링크 제외), 권장과목
 * 학년 코드가 있어야 하는 것(POST): 진행 읽기·저장, 교사용 자료 링크, 폼 요약, 권장과목 탭 처음 채우기
 * 폼 요약은 응답 수와 날짜별 인원만 보내고, 학생 이름·학번·응답 내용은 사이트로 보내지 않습니다.
 * 학년 코드를 아는 사람은 모든 반의 기록을 읽고 고칠 수 있습니다(반별 권한 구분 없음).
 */

const CACHE_SECONDS = 60;       // 시트를 고치면 최대 이 시간 뒤에 서버 응답에 반영(열린 화면은 새로고침 필요)
const FORM_CACHE_SECONDS = 300; // 폼 요약 집계를 다시 세는 간격('지금 다시 세기'는 무시하고 바로 셈)
const MAX_MEMO = 500;
const WRONG_CODE_DELAY_MS = 800; // 틀린 코드 요청에만 두는 지연(맞는 코드는 막지 않는다)
const AT_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX";

// 탭 이름과 머리글. 사이트에서 쓰는 이름(오른쪽)과 시트 머리글(왼쪽)을 짝지어 둔다.
// 읽기와 쓰기 모두 머리글로 열을 찾으므로 열 순서를 바꿔도 된다. 머리글 이름은 바꾸지 마세요.
const TABS = {
  settings: { name: '설정', headers: { '항목': 'key', '값': 'value', '설명': 'help' } },
  months: { name: '월별 요약', headers: { '월': 'month', '제목': 'title', '핵심': 'focus' } },
  tasks: {
    name: '업무',
    headers: {
      'ID': 'id', '월': 'month', '분류': 'cat', '시기': 'when', '기한': 'due', '업무': 'title',
      '세부 내용': 'detail', '중요': 'star', '자료': 'links', '비고': 'note',
    },
  },
  events: {
    name: '일정',
    headers: { 'ID': 'id', '시작일': 'date', '종료일': 'end', '시각': 'time', '일정': 'title', '구분': 'type', '중요': 'star', '비고': 'note' },
  },
  resources: { name: '자료', headers: { 'ID': 'id', '이름': 'name', '분류': 'cat', '링크': 'url', '설명': 'desc', '공개 범위': 'scope' } },
  progress: { name: '진행', headers: { '반': 'cls', '업무 키': 'task', '완료': 'done', '메모': 'memo', '수정 시각': 'at' } },
  forms: {
    name: '폼 요약',
    headers: {
      '이름': 'name', '반': 'cls', '응답 시트 주소': 'sheet', '탭 이름': 'tab', '날짜 열 키워드': 'dateKey',
      '중복 확인 열 키워드': 'uniqueKey', '대상 인원': 'target', '설명': 'desc',
    },
  },
  recommend: {
    name: '권장과목',
    headers: {
      '대학': 'univ', '모집단위': 'unit', '핵심과목': 'core', '권장과목': 'rec', '반영과목(구분 없음)': 'all',
      '비고': 'note', '자료집 쪽': 'page', '자동 판정 조건': 'rule', '확인 필요 사유': 'review',
    },
  },
};
const MAX_RECOMMEND_ROWS = 2000;
const REPEAT_MONTHS = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2'];

// 설정 탭의 '항목' 이름
const SETTING_KEYS = { '학년도': 'year', '대입 학년도': 'admissionYear', '학교': 'school', '반 목록': 'classes', '학년 코드': 'code' };

function doGet(e) {
  try {
    return json_(Object.assign({ ok: true }, readPublic_()));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: '시트를 읽지 못했습니다: ' + err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const settings = readSettings_();
    const denied = checkCode_(String(body.code || ''), settings.code);
    if (denied) return json_({ ok: false, error: denied });

    if (body.action === 'progress') return json_({ ok: true, progress: readProgress_() });
    if (body.action === 'check') return json_(saveCheck_(body, settings));
    if (body.action === 'teacherData') return json_({ ok: true, resources: readResources_(true) });
    if (body.action === 'forms') return json_({ ok: true, forms: summarizeForms_(body.force === true, settings) });
    if (body.action === 'seedRecommend') return json_(seedRecommend_(body.rows));
    return json_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: err.userMessage || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}

// 시트를 고치면 캐시를 비워 바로 반영되게 한다 (단순 트리거)
function onEdit() {
  try { CacheService.getScriptCache().removeAll(['public', 'recommend', 'forms']); } catch (err) { /* 무시 */ }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('담임 도우미')
    .addItem('빠진 탭과 머리글 만들기', 'setup')
    .addItem('사이트 캐시 비우기', 'onEdit')
    .addToUi();
}

function userError_(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

// ───────── 읽기

function readPublic_() {
  const data = cached_('public', function () {
    const s = readSettings_();
    return {
      settings: { year: s.year, admissionYear: s.admissionYear, school: s.school, classes: s.classes },
      months: readRows_('months'),
      tasks: readRows_('tasks'),
      events: readRows_('events'),
      resources: readResources_(false),
      updatedAt: new Date().toISOString(),
    };
  });
  // 권장과목 표는 커서 따로 캐시한다
  data.recommend = cached_('recommend', function () { return readRows_('recommend'); });
  return data;
}

function cached_(key, build, seconds) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const value = build();
  try {
    cache.put(key, JSON.stringify(value), seconds || CACHE_SECONDS);
  } catch (err) {
    console.warn(err); // 캐시는 키 하나에 100KB 제한이 있다. 실패해도 응답은 정상
  }
  return value;
}

// 자료 탭의 '공개 범위'가 '교사용'이면 공개 응답에서 링크를 뺀다.
// 칸이 비어 있으면 구글 드라이브·문서 링크는 교사용, 그 밖의 링크는 공개로 본다.
function readResources_(withPrivate) {
  return readRows_('resources').map(function (r) {
    const url = String(r.url || '').trim();
    const scope = String(r.scope || '').trim() || (/docs\.google\.com|drive\.google\.com/.test(url) ? '교사용' : '공개');
    const out = { id: r.id, name: r.name, cat: r.cat, desc: r.desc, url: url };
    if (scope === '교사용' && !withPrivate) { out.url = ''; out.locked = true; }
    return out;
  });
}

function readSettings_() {
  const out = { year: '', admissionYear: '', school: '', classes: [], code: '' };
  readRows_('settings').forEach(function (row) {
    const key = SETTING_KEYS[row.key];
    if (!key) return;
    out[key] = key === 'classes'
      ? String(row.value).split(/[,\s]+/).filter(String)
      : String(row.value).trim();
  });
  return out;
}

function fmtAt_(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), AT_FORMAT) : String(v || '');
}

// 머리글 이름으로 열을 찾아 객체 배열로 돌려준다. 날짜는 yyyy-MM-dd 문자열로 바꾼다.
function readRows_(kind) {
  const tab = TABS[kind];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab.name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const tz = Session.getScriptTimeZone();
  const cols = values[0].map(function (h) { return tab.headers[String(h).trim()] || null; });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = {};
    let filled = false;
    cols.forEach(function (key, c) {
      if (!key) return;
      let v = values[r][c];
      if (v instanceof Date) {
        if (key === 'at') v = fmtAt_(v);
        else if (key === 'time') v = Utilities.formatDate(v, tz, 'HH:mm');
        else v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      if (v !== '' && v !== null) filled = true;
      row[key] = v;
    });
    if (filled) rows.push(row);
  }
  return rows;
}

function readProgress_() {
  return readRows_('progress').map(function (p) {
    return { cls: String(p.cls), task: String(p.task), done: p.done === true, memo: String(p.memo || ''), at: String(p.at || '') };
  });
}

// ───────── 체크 저장

// 진행 탭의 필수 머리글 위치를 찾는다. 빠지거나 겹치면 쓰지 않고 멈춘다
function progressCols_(sheet) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  const cols = {};
  Object.keys(TABS.progress.headers).forEach(function (name) {
    const at = [];
    header.forEach(function (h, i) { if (h === name) at.push(i + 1); });
    if (!at.length) throw userError_("'진행' 탭에 「" + name + '」 머리글이 없습니다. 머리글을 고친 뒤 다시 시도해 주세요.');
    if (at.length > 1) throw userError_("'진행' 탭에 「" + name + '」 머리글이 두 번 있습니다. 하나만 남겨 주세요.');
    cols[TABS.progress.headers[name]] = at[0];
  });
  cols.width = lastCol;
  return cols;
}

// 업무 키가 업무 탭에 있는 업무인지, 반복 업무면 달이 맞는지 확인한다
function validTaskKey_(task) {
  const m = String(task).match(/^([\w.\-]{1,40})(?:@(\d{1,2}))?$/);
  if (!m) return false;
  const months = {};
  // '3월'처럼 숫자 뒤의 '월'만 뗀다('매월'은 그대로)
  readRows_('tasks').forEach(function (t) { months[String(t.id).trim()] = String(t.month).trim().replace(/^0?(\d{1,2})\s*월$/, '$1'); });
  if (!(m[1] in months)) return false;
  const repeat = months[m[1]] === '매월';
  if (m[2]) return repeat && REPEAT_MONTHS.indexOf(m[2]) >= 0;
  return !repeat;
}

// 바뀐 칸(patch)만 고친다. 시트의 수정 시각이 화면이 알던 값(prevAt)과 다르면
// 다른 사람이 먼저 고친 것으로 보고 저장하지 않고 최신 내용을 돌려준다.
function saveCheck_(body, settings) {
  const cls = String(body.cls || '').trim();
  const task = String(body.task || '').trim();
  const patch = body.patch || {};
  if (settings.classes.indexOf(cls) < 0) return { ok: false, error: '설정 탭의 반 목록에 없는 반입니다: ' + cls };
  if (!validTaskKey_(task)) return { ok: false, error: '업무 탭에 없는 업무이거나 반복 업무의 달이 맞지 않습니다: ' + task };
  if (!('done' in patch) && !('memo' in patch)) return { ok: false, error: '바꿀 내용이 없습니다.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getTab_('progress');
    const cols = progressCols_(sheet);
    const last = sheet.getLastRow();
    let row = 0;
    if (last >= 2) {
      const clsVals = sheet.getRange(2, cols.cls, last - 1, 1).getDisplayValues();
      const taskVals = sheet.getRange(2, cols.task, last - 1, 1).getDisplayValues();
      for (let i = 0; i < clsVals.length; i++) {
        if (clsVals[i][0] === cls && taskVals[i][0] === task) { row = i + 2; break; }
      }
    }
    if (row) {
      const current = readEntry_(sheet, cols, row, cls, task);
      if (String(body.prevAt || '') !== current.at) return { ok: false, conflict: true, error: '다른 화면에서 먼저 고쳤습니다.', entry: current };
    } else {
      row = sheet.getLastRow() + 1;
      sheet.getRange(row, cols.cls).setNumberFormat('@').setValue(cls);
      sheet.getRange(row, cols.task).setNumberFormat('@').setValue(task);
      sheet.getRange(row, cols.done).insertCheckboxes().setValue(false);
    }
    if ('done' in patch) sheet.getRange(row, cols.done).setValue(patch.done === true);
    // 앞의 ' 는 메모를 수식이나 숫자로 해석하지 않고 글자 그대로 저장하게 한다
    if ('memo' in patch) {
      const memo = String(patch.memo || '').slice(0, MAX_MEMO);
      sheet.getRange(row, cols.memo).setValue(memo ? "'" + memo : '');
    }
    sheet.getRange(row, cols.at).setValue(new Date());
    SpreadsheetApp.flush();
    return { ok: true, entry: readEntry_(sheet, cols, row, cls, task) };
  } finally {
    lock.releaseLock();
  }
}

// 저장된 값을 다시 읽어 돌려준다(수정 시각을 시트에 저장된 그대로 맞추기 위해)
function readEntry_(sheet, cols, row, cls, task) {
  return {
    cls: cls, task: task,
    done: sheet.getRange(row, cols.done).getValue() === true,
    memo: String(sheet.getRange(row, cols.memo).getValue() || ''),
    at: fmtAt_(sheet.getRange(row, cols.at).getValue()),
  };
}

// ───────── 폼 응답 요약 (숫자만)

// 응답 건수, 학생 수(중복 확인 열 기준, 재제출은 가장 최근 응답), 학번 빈 응답 수,
// 날짜별 학생 수(같은 학생의 같은 날짜는 1명)를 센다.
function summarizeForms_(force, settings) {
  const build = function () {
    const tz = Session.getScriptTimeZone();
    const year = Number(settings.year) || new Date().getFullYear();
    return readRows_('forms').map(function (f) {
      const out = {
        name: String(f.name || '이름 없는 폼'), cls: String(f.cls || ''), desc: String(f.desc || ''),
        target: Number(f.target) || 0, uniqueKey: String(f.uniqueKey || ''), countedAt: new Date().toISOString(),
      };
      try {
        const ref = String(f.sheet || '').trim();
        if (!ref) throw new Error('응답 시트 주소가 비어 있습니다.');
        const book = /^https?:/.test(ref) ? SpreadsheetApp.openByUrl(ref) : SpreadsheetApp.openById(ref);
        const sheet = f.tab ? book.getSheetByName(String(f.tab)) : book.getSheets()[0];
        if (!sheet) throw new Error('탭을 찾지 못했습니다: ' + f.tab);
        const values = sheet.getDataRange().getValues();
        const header = values[0].map(String);
        const rows = values.slice(1).filter(function (r) { return r[0] !== '' && r[0] !== null; });
        out.responses = rows.length;

        let latest = null;
        rows.forEach(function (r) { if (r[0] instanceof Date && (!latest || r[0] > latest)) latest = r[0]; });
        if (latest) out.latest = latest.toISOString();

        const key = String(f.dateKey || '').trim();
        const dateCols = [];
        if (key) header.forEach(function (h, i) { if (h.indexOf(key) >= 0) dateCols.push(i); });

        const uniqueCol = findCol_(header, f.uniqueKey);
        let counted = rows;
        if (uniqueCol >= 0) {
          const byId = {};
          let blank = 0;
          rows.forEach(function (r, i) {
            const id = String(r[uniqueCol] == null ? '' : r[uniqueCol]).replace(/\s/g, '');
            if (!id) { blank++; return; }
            const prev = byId[id];
            const t = r[0] instanceof Date ? r[0].getTime() : i;
            if (!prev || t >= prev.t) byId[id] = { r: r, t: t };
          });
          out.students = Object.keys(byId).length;
          out.unidentified = blank;
          counted = Object.keys(byId).map(function (k) { return byId[k].r; });
          out.dateBasis = 'students';
        } else {
          out.students = null; // 학번 열이 없으면 학생 수를 알 수 없다
          out.dateBasis = 'responses';
        }

        if (dateCols.length) {
          const dates = {};
          let inferred = false; let invalid = 0;
          counted.forEach(function (r) {
            const seen = {};
            dateCols.forEach(function (c) {
              if (r[c] === '' || r[c] === null) return;
              const d = toISODate_(r[c], tz, year);
              if (!d) { invalid++; return; }
              if (d.inferred) inferred = true;
              seen[d.iso] = true;
            });
            Object.keys(seen).forEach(function (iso) { dates[iso] = (dates[iso] || 0) + 1; });
          });
          out.dates = dates;
          out.inferredYear = inferred;
          out.invalidDates = invalid;
        }
      } catch (err) {
        out.error = '읽지 못했습니다: ' + err.message;
      }
      return out;
    });
  };
  if (force) {
    const fresh = build();
    try { CacheService.getScriptCache().put('forms', JSON.stringify(fresh), FORM_CACHE_SECONDS); } catch (err) { console.warn(err); }
    return fresh;
  }
  return cached_('forms', build, FORM_CACHE_SECONDS);
}

function findCol_(header, keyword) {
  const k = String(keyword || '').trim();
  if (!k) return -1;
  for (let i = 0; i < header.length; i++) if (header[i].indexOf(k) >= 0) return i;
  return -1;
}

// 날짜 값 또는 "2027-10-18", "10월 18일", "10/18" 같은 글자를 yyyy-MM-dd 로 바꾼다.
// 연도가 없으면 학년도 기준(3~12월은 그해, 1~2월은 다음 해)으로 붙이고 inferred 로 표시한다. 없는 날짜는 버린다.
function toISODate_(v, tz, schoolYear) {
  if (v instanceof Date) return { iso: Utilities.formatDate(v, tz, 'yyyy-MM-dd'), inferred: false };
  const s = String(v || '');
  let y; let mo; let d; let inferred = false;
  let m = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else {
    m = s.match(/(\d{1,2})\s*[월./-]\s*(\d{1,2})/);
    if (!m) return null;
    mo = Number(m[1]); d = Number(m[2]);
    y = mo >= 3 ? schoolYear : schoolYear + 1;
    inferred = true;
  }
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { iso: y + '-' + pad_(mo) + '-' + pad_(d), inferred: inferred };
}

function pad_(n) { return ('0' + Number(n)).slice(-2); }

// ───────── 권장과목 탭 처음 채우기

// 사이트에 들어 있는 권장과목 표를 비어 있는 '권장과목' 탭에 한 번 채운다. 내용이 있으면 덮어쓰지 않는다
function seedRecommend_(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_RECOMMEND_ROWS) return { ok: false, error: '보낼 내용이 올바르지 않습니다.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getTab_('recommend');
    if (sheet.getLastRow() > 1) return { ok: false, error: "'권장과목' 탭에 이미 내용이 있습니다. 시트에서 직접 고쳐 주세요." };
    const width = Object.keys(TABS.recommend.headers).length;
    const values = rows.map(function (r) {
      const out = [];
      for (let i = 0; i < width; i++) {
        const v = String((r || [])[i] == null ? '' : r[i]).slice(0, 2000);
        // 수식으로 해석되지 않게 앞에 ' 를 붙인다
        out.push(/^[=+\-@]/.test(v) ? "'" + v : v);
      }
      return out;
    });
    sheet.getRange(2, 1, values.length, width).setNumberFormat('@').setValues(values);
    sheet.setColumnWidths(1, 2, 180).setColumnWidths(3, 3, 320).setColumnWidth(6, 260).setColumnWidths(8, 2, 280);
    CacheService.getScriptCache().removeAll(['public', 'recommend']);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, count: rows.length };
}

// ───────── 학년 코드

// 맞는 코드는 항상 통과한다. 틀린 코드에만 짧은 지연을 둔다.
// (전체 공유 카운터로 막으면 한 사람의 실수로 모든 선생님이 막히므로 쓰지 않는다)
// 공유 코드는 보안 경계로 약하다: 12자 이상 무작위로 정하고, 유출되면 설정 탭에서 바로 바꾼다.
function checkCode_(code, expected) {
  if (!expected) return "시트 '설정' 탭에서 학년 코드를 먼저 정해 주세요.";
  if (sameText_(code, expected)) return '';
  Utilities.sleep(WRONG_CODE_DELAY_MS);
  return '학년 코드가 맞지 않습니다.';
}

// 길이와 관계없이 끝까지 비교한다
function sameText_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ───────── 시트 정리

// 메뉴 '담임 도우미 > 빠진 탭과 머리글 만들기'. 있는 탭과 내용은 건드리지 않는다.
function setup() {
  Object.keys(TABS).forEach(function (kind) { getTab_(kind); });
  SpreadsheetApp.getActiveSpreadsheet().toast('빠진 탭과 머리글을 만들었습니다.', '담임 도우미');
}

function getTab_(kind) {
  const tab = TABS[kind];
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(tab.name);
  if (!sheet) {
    sheet = book.insertSheet(tab.name);
    const headers = Object.keys(tab.headers);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eefc');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
