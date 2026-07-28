// تخزين بسيط بملفات JSON للتحذيرات والنقاط (يبقى محفوظ حتى بعد إعادة تشغيل البوت)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const WARNINGS_FILE = path.join(DATA_DIR, 'warnings.json');
const POINTS_FILE = path.join(DATA_DIR, 'points.json');
const BANNED_WORDS_FILE = path.join(DATA_DIR, 'banned-words.json');

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ============ التحذيرات ============
// الشكل: { "guildId": { "userId": [ { reason, by, date }, ... ] } }

function getWarnings(guildId, userId) {
  const data = readJSON(WARNINGS_FILE);
  return data[guildId]?.[userId] || [];
}

function addWarning(guildId, userId, reason, byTag) {
  const data = readJSON(WARNINGS_FILE);
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = [];
  data[guildId][userId].push({ reason, by: byTag, date: new Date().toISOString() });
  writeJSON(WARNINGS_FILE, data);
  return data[guildId][userId].length;
}

// يحذف تحذير برقمه (1-based). لو رقم فاضي يمسح كل تحذيرات العضو.
function removeWarning(guildId, userId, index) {
  const data = readJSON(WARNINGS_FILE);
  if (!data[guildId]?.[userId]) return false;

  if (!index) {
    delete data[guildId][userId];
    writeJSON(WARNINGS_FILE, data);
    return true;
  }

  const idx = index - 1;
  if (idx < 0 || idx >= data[guildId][userId].length) return false;
  data[guildId][userId].splice(idx, 1);
  writeJSON(WARNINGS_FILE, data);
  return true;
}

// يحذف عدد معيّن من التحذيرات (الأحدث أولًا). يرجع { removed, remaining }
function removeWarningsCount(guildId, userId, count) {
  const data = readJSON(WARNINGS_FILE);
  const list = data[guildId]?.[userId] || [];
  if (!list.length) return { removed: 0, remaining: 0 };

  const removed = Math.min(count, list.length);
  list.splice(list.length - removed, removed); // يشيل من الآخر (الأحدث)

  if (list.length === 0) delete data[guildId][userId];
  writeJSON(WARNINGS_FILE, data);
  return { removed, remaining: list.length };
}

function resetWarnings(guildId, userId) {
  const data = readJSON(WARNINGS_FILE);
  if (!data[guildId]) return;
  if (userId) delete data[guildId][userId];
  else data[guildId] = {};
  writeJSON(WARNINGS_FILE, data);
}

// ============ النقاط ============
// الشكل: { "guildId": { "userId": number } }

function getPoints(guildId, userId) {
  const data = readJSON(POINTS_FILE);
  return data[guildId]?.[userId] || 0;
}

function addPoints(guildId, userId, amount) {
  const data = readJSON(POINTS_FILE);
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = (data[guildId][userId] || 0) + amount;
  writeJSON(POINTS_FILE, data);
  return data[guildId][userId];
}

function setPoints(guildId, userId, amount) {
  const data = readJSON(POINTS_FILE);
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = amount;
  writeJSON(POINTS_FILE, data);
  return amount;
}

function resetPoints(guildId, userId) {
  const data = readJSON(POINTS_FILE);
  if (!data[guildId]) return;
  if (userId) delete data[guildId][userId];
  else data[guildId] = {};
  writeJSON(POINTS_FILE, data);
}

// ============ الكلمات الممنوعة (AutoMod) ============
// الشكل: { "guildId": ["كلمة1", "كلمة2", ...] }

function getBannedWords(guildId) {
  const data = readJSON(BANNED_WORDS_FILE);
  return data[guildId] || [];
}

function addBannedWord(guildId, word) {
  const data = readJSON(BANNED_WORDS_FILE);
  if (!data[guildId]) data[guildId] = [];
  const normalized = word.trim().toLowerCase();
  if (data[guildId].includes(normalized)) return false;
  data[guildId].push(normalized);
  writeJSON(BANNED_WORDS_FILE, data);
  return true;
}

function removeBannedWord(guildId, word) {
  const data = readJSON(BANNED_WORDS_FILE);
  if (!data[guildId]) return false;
  const normalized = word.trim().toLowerCase();
  const idx = data[guildId].indexOf(normalized);
  if (idx === -1) return false;
  data[guildId].splice(idx, 1);
  writeJSON(BANNED_WORDS_FILE, data);
  return true;
}

module.exports = {
  getWarnings, addWarning, removeWarning, removeWarningsCount, resetWarnings,
  getPoints, addPoints, setPoints, resetPoints,
  getBannedWords, addBannedWord, removeBannedWord,
};
