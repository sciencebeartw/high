#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractBalancedBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `找不到 ${marker}`);
  const braceStart = source.indexOf('{', start);
  assert.notStrictEqual(braceStart, -1, `${marker} 缺少函式區塊`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let regex = false;
  let regexClass = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (regex) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '[') regexClass = true;
      else if (char === ']') regexClass = false;
      else if (char === '/' && !regexClass) regex = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/') {
      const previous = source.slice(braceStart, index).trimEnd().slice(-1);
      if (!previous || '({[=,:;!?&|'.includes(previous)) {
        regex = true;
        regexClass = false;
        continue;
      }
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${marker} 區塊沒有結束`);
}

function checkIncludes(source, fragment, message) {
  assert.ok(source.includes(fragment), message || `缺少 ${fragment}`);
}

// Firebase SDK 與 named app：避免和同網域 Dashboard 的 Auth persistence 互相登出。
const authSdkIndex = html.indexOf('firebase-auth.js');
const functionsSdkIndex = html.indexOf('firebase-functions.js');
const appInitIndex = html.indexOf("firebase.initializeApp(firebaseConfig, highFirebaseAppName)");
assert.ok(authSdkIndex > -1 && functionsSdkIndex > -1 && appInitIndex > functionsSdkIndex,
  'Auth / Functions SDK 必須先載入，再初始化高中 named app');
checkIncludes(html, "const highFirebaseAppName = 'high-app'", '高中 Auth 必須使用隔離的 named app');
checkIncludes(html, 'const db = highFirebaseApp.database()', 'RTDB 必須使用 named app');
checkIncludes(html, 'const highAuth = highFirebaseApp.auth()', 'Auth 必須使用 named app');
checkIncludes(html, 'const highFunctions = highFirebaseApp.functions()', 'Functions 必須使用 named app');
assert.ok(!/firebase\.(?:database|auth|functions)\(\)/.test(html), '不得意外回退到 default Firebase app');

// 學生／老師登入只能走 callable -> custom token -> 精確節點 listener。
const studentLogin = extractBalancedBlock(html, 'getStudentData: async function');
const callableLoginIndex = studentLogin.indexOf("httpsCallable('createHighSession')");
const customTokenIndex = studentLogin.indexOf('signInWithCustomToken(session.firebaseCustomToken)');
const exactPathIndex = studentLogin.indexOf("session.role === 'student' ? '/high/students/' : '/high/teachers/'");
assert.ok(callableLoginIndex > -1 && customTokenIndex > callableLoginIndex && exactPathIndex > customTokenIndex,
  '登入順序必須是 callable -> custom token -> exact student/teacher read');
checkIncludes(studentLogin, 'firebase.auth.Auth.Persistence.NONE', '學生／老師密碼登入不可留下持久 Auth');
assert.ok(!studentLogin.includes('/high/loginIndex/'), '瀏覽器不得讀取 loginIndex');
assert.ok(!studentLogin.includes('studentMatchesPassword'), '瀏覽器不得驗證公開明碼密碼');
checkIncludes(studentLogin, 'doLogout().then(function()', '身分節點消失時必須清除畫面與 Auth，不能保留舊資料');
checkIncludes(html, 'placeholder="學生姓名／老師登入帳號"', '老師登入必須提示使用精確登入帳號');

// 管理員只能使用 Google Auth + /admins 驗證後的 session。
const adminLogin = extractBalancedBlock(html, 'async function doAdminGoogleLogin');
checkIncludes(adminLogin, 'new firebase.auth.GoogleAuthProvider()', '管理員必須使用 Google Auth');
checkIncludes(adminLogin, 'establishGoogleAdminSession()', 'Google 登入後必須建立受保護 admin session');
const adminSession = extractBalancedBlock(html, 'async function establishGoogleAdminSession');
checkIncludes(adminSession, "httpsCallable('createHighAdminSession')", '管理員必須由 callable 驗證 /admins');
const adminPreview = extractBalancedBlock(html, 'getStudentDataByAdmin: async function');
checkIncludes(adminPreview, "db.ref('/high/students/' + directKey)", '上帝視角只能精確讀取選定學生');
assert.ok(!adminPreview.includes('/high/loginIndex/'), '上帝視角不得以 loginIndex 猜學生');

// 成績只能走受保護 callable；queue kick 僅帶精確 queueKey，不可觸發完整同步。
const submitScore = extractBalancedBlock(html, 'async function submitScoreUI');
checkIncludes(submitScore, "httpsCallable('submitHighScore')", '成績回報必須走 callable');
checkIncludes(submitScore, "currentHighSession.role !== 'student'", '非學生與上帝視角必須 fail closed');
checkIncludes(submitScore, 'gradeIndex: i', '成績 callable 必須帶目前 gradeIndex');
checkIncludes(submitScore, 'exam: exam', '成績 callable 必須帶目前 exam 供後端核對');
assert.ok(!submitScore.includes('db.ref().update'), '瀏覽器不得直接寫成績或 queue');
assert.ok(!html.includes('/high/scoreQueue/'), '前端不得直接讀寫 scoreQueue');
const kickQueue = extractBalancedBlock(html, 'function kickScoreQueueProcessor');
checkIncludes(kickQueue, '{ queueKey: queueKey || "" }', 'queue kick 只能帶精確 queueKey');
assert.ok(!kickQueue.includes('syncAfter'), '外部 queue kick 禁止要求完整同步');

// GAS action 一律附 Firebase ID token；只有冪等 queue kick 可重試一次。
const postAction = extractBalancedBlock(html, 'async function doPostAction');
checkIncludes(postAction, 'user.getIdToken()', 'GAS action 必須取得目前 Firebase ID token');
checkIncludes(postAction, 'firebaseIdToken: firebaseIdToken', 'GAS body 必須附 firebaseIdToken');
checkIncludes(postAction, 'action === "process_score_queue"', '只有 queue processor 可啟用 retry');
checkIncludes(postAction, '? Math.max(0, Math.min(1', 'queue retry 最多一次');
assert.ok(!postAction.includes('adminPassword'), '前端不得保存或傳送管理密碼');

// 修改密碼只能由登入中的學生本人發動，老師與管理員皆 fail closed。
const changePassword = extractBalancedBlock(html, 'function doChangePwd');
checkIncludes(changePassword, "currentHighSession.role !== 'student'", '修改密碼只允許學生本人');
const studentView = extractBalancedBlock(html, 'function enterStudentView');
checkIncludes(studentView, "currentHighSession.role === 'student'", '非學生畫面不得顯示修改密碼按鈕');

// 登出與錯誤處理必須真正撤銷本頁 Auth 狀態，且不可保留密碼。
const logout = extractBalancedBlock(html, 'async function doLogout');
checkIncludes(logout, 'highAuth.signOut()', '登出必須清除 Firebase Auth');
checkIncludes(logout, 'currentHighSession = null', '登出必須清除 protected session state');
['gPass', 'adminToken', 'local-bypass', 'studentMatchesPassword', 'normalizeLoginPassword'].forEach(fragment => {
  assert.ok(!html.includes(fragment), `不得保留舊公開登入機制：${fragment}`);
});

// XSS：所有公告用 DOM text node，外連限制 HTTP(S)，資料 template 經 escapeHtml。
const announcements = extractBalancedBlock(html, 'function showAnnouncements');
checkIncludes(announcements, 'title.textContent', '公告標題必須以 textContent 顯示');
checkIncludes(announcements, 'appendLinkifiedText', '公告內容必須走安全 linkifier');
const linkifier = extractBalancedBlock(html, 'function appendLinkifiedText');
checkIncludes(linkifier, "parsed.protocol !== 'http:'", '公告連結只能允許 HTTP');
checkIncludes(linkifier, "parsed.protocol !== 'https:'", '公告連結只能允許 HTTPS');
checkIncludes(linkifier, "link.rel = 'noopener noreferrer'", '外連必須隔離 opener');
checkIncludes(linkifier, 'document.createTextNode', '非連結公告內容必須建立文字節點');
assert.ok(!/onclick="[^"\n]*\$\{/.test(html), '動態資料不得插入 inline onclick');
assert.strictEqual((html.match(/function switchTab\s*\(/g) || []).length, 1, 'switchTab 只能保留一份');
assert.ok(!/\balert\s*\(/.test(html), '不得使用原生 alert');
assert.ok(!/\bconfirm\s*\(/.test(html), '不得使用原生 confirm');

const escapeHtmlSource = extractBalancedBlock(html, 'function escapeHtml');
const escapeHtml = vm.runInNewContext(`(${escapeHtmlSource})`);
assert.strictEqual(escapeHtml(0), '0', '0 分不得被 escape helper 轉成空字串');
assert.strictEqual(
  escapeHtml(`顏文字 ( ´▽\` )ﾉ <img src=x onerror="globalThis.pwned=true">`),
  '顏文字 ( ´▽` )ﾉ &lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;',
  '顏文字必須保留，HTML payload 必須顯示為純文字'
);

// RTDB 可能把稀疏 grades 回成 object；gradeIndex 必須保留原始數字 key，不能 Object.values 壓縮。
const normalizeGradesSource = extractBalancedBlock(html, 'function normalizeGradeEntries');
const normalizeGradeEntries = vm.runInNewContext(`(${normalizeGradesSource})`);
const sparseGrades = normalizeGradeEntries({ 2: { examRaw: '英文大題三' }, 8: { examRaw: '英文大題九' } });
assert.strictEqual(sparseGrades.length, 9, '稀疏 grades 長度必須保留最大原始索引');
assert.strictEqual(sparseGrades[2].examRaw, '英文大題三', 'gradeIndex 2 不可被壓縮');
assert.strictEqual(sparseGrades[8].examRaw, '英文大題九', 'gradeIndex 8 不可被壓縮');
assert.strictEqual(sparseGrades[0], undefined, '未存在的 gradeIndex 不得被補成另一筆成績');
checkIncludes(html, 'res.grades = normalizeGradeEntries(res.grades)', '學生資料載入必須保留 grades 原始索引');

// 台灣本地日期與手機可用性契約。
const scrollToday = extractBalancedBlock(html, 'function scrollToTodayList');
checkIncludes(scrollToday, 'formatLocalDate(new Date())', '今日定位必須使用本地日期');
assert.ok(!scrollToday.includes('toISOString'), '台灣凌晨不可使用 UTC 日期定位');
checkIncludes(html, 'height: 100vh;', 'iOS 舊版需要 100vh fallback');
checkIncludes(html, 'height: 100dvh;', '現代瀏覽器應使用動態 viewport');
assert.ok(!html.includes('user-scalable=no'), '不可禁止使用者縮放');
checkIncludes(html, '.score-row {', '成績列 RWD 樣式不可遺失');
checkIncludes(html, 'flex-wrap: wrap;', '窄螢幕成績列必須可換行');

// 所有 inline scripts 都要能被 JavaScript parser 接受。
const scripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
scripts.forEach((match, index) => {
  assert.doesNotThrow(() => new Function(match[1]), `inline script ${index + 1} 語法錯誤`);
});

console.log('✅ High Auth / XSS / score queue frontend contract passed');
