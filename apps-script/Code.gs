/**
 * 고3 담임 업무 도우미 서버 (Google Apps Script)
 * 업무표 구글 시트 > 확장 프로그램 > Apps Script 에 이 파일 내용을 그대로 붙여 넣습니다.
 * 코드를 고친 뒤에는 "배포 > 배포 관리 > 편집 > 새 버전"으로 다시 배포해야 반영됩니다.
 *
 * 사이트가 읽는 탭: 설정, 월별 요약, 업무, 일정, 자료  (누구나 읽기 가능)
 * 학년 코드가 있어야 하는 것: 진행(체크 저장·읽기), 폼 요약(응답 수 집계)
 * 폼 요약은 응답 수와 날짜별 인원만 보내고, 학생 이름이나 연락처는 사이트로 보내지 않습니다.
 */

const CACHE_SECONDS = 60;       // 시트를 고치면 최대 이 시간 뒤에 사이트에 반영
const FORM_CACHE_SECONDS = 300; // 폼 요약 집계 결과를 다시 세는 간격
const MAX_MEMO = 500;
const MAX_WRONG_CODE_PER_MINUTE = 10;

// 탭 이름과 머리글. 사이트에서 쓰는 이름(오른쪽)과 시트 머리글(왼쪽)을 짝지어 둔다.
// 시트에서 열 순서를 바꿔도 머리글 이름만 같으면 동작한다.
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
  events: { name: '일정', headers: { '시작일': 'date', '종료일': 'end', '일정': 'title', '구분': 'type', '중요': 'star', '비고': 'note' } },
  resources: { name: '자료', headers: { 'ID': 'id', '이름': 'name', '분류': 'cat', '링크': 'url', '설명': 'desc' } },
  progress: { name: '진행', headers: { '반': 'cls', '업무 키': 'task', '완료': 'done', '메모': 'memo', '수정 시각': 'at' } },
  forms: {
    name: '폼 요약',
    headers: {
      '이름': 'name', '반': 'cls', '응답 시트 주소': 'sheet', '탭 이름': 'tab', '날짜 열 키워드': 'dateKey',
      '중복 확인 열 키워드': 'uniqueKey', '대상 인원': 'target', '설명': 'desc',
    },
  },
};

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
    if (body.action === 'forms') return json_({ ok: true, forms: summarizeForms_() });
    return json_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}

// 시트를 고치면 캐시를 비워 바로 반영되게 한다 (단순 트리거)
function onEdit() {
  try { CacheService.getScriptCache().remove('public'); } catch (err) { /* 무시 */ }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('담임 도우미')
    .addItem('빠진 탭과 머리글 만들기', 'setup')
    .addItem('사이트 캐시 비우기', 'onEdit')
    .addToUi();
}

// ───────── 읽기

function readPublic_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('public');
  if (cached) return JSON.parse(cached);

  const s = readSettings_();
  const data = {
    settings: { year: s.year, admissionYear: s.admissionYear, school: s.school, classes: s.classes },
    months: readRows_('months'),
    tasks: readRows_('tasks'),
    events: readRows_('events'),
    resources: readRows_('resources'),
    updatedAt: new Date().toISOString(),
  };
  try {
    cache.put('public', JSON.stringify(data), CACHE_SECONDS);
  } catch (err) {
    console.warn(err); // 캐시는 100KB 제한이 있다. 실패해도 응답은 정상
  }
  return data;
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
      if (v instanceof Date) v = Utilities.formatDate(v, tz, key === 'at' ? "yyyy-MM-dd'T'HH:mm:ssXXX" : 'yyyy-MM-dd');
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

function saveCheck_(body, settings) {
  const cls = String(body.cls || '').trim();
  const task = String(body.task || '').trim();
  if (settings.classes.indexOf(cls) < 0) return { ok: false, error: '설정 탭의 반 목록에 없는 반입니다: ' + cls };
  if (!/^[\w@.\-]{1,60}$/.test(task)) return { ok: false, error: '업무 키가 올바르지 않습니다.' };
  const done = body.done === true;
  const memo = String(body.memo || '').slice(0, MAX_MEMO);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getTab_('progress');
    const last = sheet.getLastRow();
    let row = 0;
    if (last >= 2) {
      const keys = sheet.getRange(2, 1, last - 1, 2).getDisplayValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === cls && keys[i][1] === task) { row = i + 2; break; }
      }
    }
    // 앞의 ' 는 입력값을 수식이나 숫자로 해석하지 않고 글자 그대로 저장하게 한다
    const values = ["'" + cls, "'" + task, done, memo ? "'" + memo : '', new Date()];
    if (row) {
      sheet.getRange(row, 1, 1, 5).setValues([values]);
    } else {
      sheet.appendRow(values);
      row = sheet.getLastRow();
      sheet.getRange(row, 3).insertCheckboxes();
      sheet.getRange(row, 3).setValue(done);
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// ───────── 폼 응답 요약 (숫자만)

function summarizeForms_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('forms');
  if (cached) return JSON.parse(cached);

  const tz = Session.getScriptTimeZone();
  const result = readRows_('forms').map(function (f) {
    const out = { name: String(f.name || '이름 없는 폼'), cls: String(f.cls || ''), desc: String(f.desc || ''), target: Number(f.target) || 0 };
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

      const uniqueCol = findCol_(header, f.uniqueKey);
      if (uniqueCol >= 0) {
        const seen = {};
        rows.forEach(function (r) { seen[String(r[uniqueCol]).replace(/\s/g, '')] = true; });
        out.unique = Object.keys(seen).length;
      } else {
        out.unique = rows.length;
      }

      let latest = null;
      rows.forEach(function (r) { if (r[0] instanceof Date && (!latest || r[0] > latest)) latest = r[0]; });
      if (latest) out.latest = latest.toISOString();

      const key = String(f.dateKey || '').trim();
      if (key) {
        const dateCols = [];
        header.forEach(function (h, i) { if (h.indexOf(key) >= 0) dateCols.push(i); });
        const dates = {};
        rows.forEach(function (r) {
          dateCols.forEach(function (c) {
            const d = toMonthDay_(r[c], tz);
            if (d) dates[d] = (dates[d] || 0) + 1;
          });
        });
        out.dates = dates;
      }
    } catch (err) {
      out.error = '읽지 못했습니다: ' + err.message;
    }
    return out;
  });
  try { cache.put('forms', JSON.stringify(result), FORM_CACHE_SECONDS); } catch (err) { console.warn(err); }
  return result;
}

function findCol_(header, keyword) {
  const k = String(keyword || '').trim();
  if (!k) return -1;
  for (let i = 0; i < header.length; i++) if (header[i].indexOf(k) >= 0) return i;
  return -1;
}

// 날짜 값 또는 "10월 18일", "10/18", "2027-10-18" 같은 글자를 "10-18" 로 바꾼다
function toMonthDay_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'MM-dd');
  const s = String(v || '');
  let m = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/(\d{1,2})\s*[월./-]\s*(\d{1,2})/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) return pad_(m[1]) + '-' + pad_(m[2]);
  return '';
}

function pad_(n) { return ('0' + Number(n)).slice(-2); }

// ───────── 학년 코드

function checkCode_(code, expected) {
  if (!expected) return "시트 '설정' 탭에서 학년 코드를 먼저 정해 주세요.";
  const cache = CacheService.getScriptCache();
  const wrong = Number(cache.get('wrong') || 0);
  if (wrong >= MAX_WRONG_CODE_PER_MINUTE) return '잘못된 시도가 많습니다. 1분 뒤에 다시 해 주세요.';
  if (code !== expected) {
    cache.put('wrong', String(wrong + 1), 60);
    return '학년 코드가 맞지 않습니다.';
  }
  return '';
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
