/**
 * Cane Permit Tracker — Google Apps Script backend
 * ------------------------------------------------
 * Data lives in a Google Sheet (created for you) and photos in a Drive folder.
 *
 * SETUP (once):
 *   1. Change ADMIN_USERNAME and ADMIN_TEMP_PASSWORD below.
 *   2. In the editor, choose the function "setup" and click Run. Authorise when asked.
 *      The log shows the spreadsheet URL.
 *   3. Deploy > New deployment > Web app:
 *        Execute as: Me        Who has access: Anyone
 *      Copy the Web app URL into index.html (API_URL).
 *   4. Sign in on the page as the admin with the temporary password; you will be asked to change it.
 *
 * After editing this script, use Deploy > Manage deployments > Edit > New version so the URL
 * serves the new code.
 */

var ADMIN_USERNAME = 'admin';
var ADMIN_TEMP_PASSWORD = 'ChangeMe-2026';

var TOKEN_DAYS = 30;        // how long a sign-in lasts
var HASH_ROUNDS = 1000;     // password hashing work factor

var ROLES = ['admin', 'scout', 'checker', 'permits', 'zoning'];
var STATUS_LABEL = {
  submitted: 'Awaiting data check', returned: 'Returned for correction', rejected: 'Rejected',
  pushed: 'Pushed to ERP', permit_issued: 'Permit issued', zoned: 'Zoned'
};
var DEFAULT_CONFIG = {
  cbcs: ['Chamgiwadu', 'Geem', 'Moita', 'Oloontare', 'Oyani', 'Factory (direct)'],
  zones: [], areas: [], sublocations: [], acreageUnit: 'acres'
};

var SHEETS = {
  users: ['username', 'name', 'email', 'roles', 'salt', 'hash', 'mustChange', 'active', 'createdAt', 'createdBy', 'lastLogin', 'passwordChangedAt'],
  entries: ['id', 'status', 'statusLabel', 'farmerName', 'phone', 'idNumber', 'plotLR', 'acreage', 'trips', 'sublocation', 'area', 'cbc',
    'pinLat', 'pinLng', 'pinAccuracy', 'pinSource', 'agreedAt', 'createdBy', 'createdAt', 'updatedAt',
    'checkResult', 'checkBy', 'checkAt', 'checkNote', 'erpRef',
    'permitNumber', 'permitBy', 'permitAt',
    'zoneInspected', 'zonePolygon', 'zone', 'zoneCbc', 'linearDistanceKm', 'zoneNote', 'zoneBy', 'zoneAt',
    'images', 'history'],
  config: ['key', 'value']
};

/* ===================== HTTP entry points ===================== */

function doGet() {
  return out({ ok: true, service: 'Cane Permit Tracker API', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out({ ok: false, error: 'Bad request' }); }
  try {
    var action = String(req.action || '');
    if (action === 'login') return out(login(req));
    var user = verifyToken(req.token);
    if (!user) return out({ ok: false, code: 'auth', error: 'Please sign in again.' });
    var ctx = { user: user, roles: user.roles, isAdmin: user.roles.indexOf('admin') >= 0 };
    var handler = ACTIONS[action];
    if (!handler) return out({ ok: false, error: 'Unknown action: ' + action });
    return out(handler(req, ctx));
  } catch (err) {
    return out({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== Actions ===================== */

var ACTIONS = {
  me: function (req, ctx) { return { ok: true, user: publicUser(ctx.user) }; },

  changePassword: function (req, ctx) {
    var u = ctx.user;
    if (!req.current || hashPassword(String(req.current), u.salt) !== u.hash) throw new Error('Current password is not correct.');
    var next = String(req.next || '');
    if (next.length < 8) throw new Error('New password must be at least 8 characters.');
    var now = nowISO();
    var salt = randomString(16);
    updateUserRow(u.username, { salt: salt, hash: hashPassword(next, salt), mustChange: false, passwordChangedAt: now });
    var fresh = findUser(u.username);
    return { ok: true, token: makeToken(fresh), user: publicUser(fresh) };
  },

  list: function (req, ctx) {
    var since = req.since ? String(req.since) : '';
    var now = nowISO();
    var all = readEntries();
    var entries = since ? all.filter(function (x) { return x.updatedAt > since; }) : all;
    var res = { ok: true, now: now, entries: entries, config: getConfig(), names: userNames(), total: all.length };
    if (ctx.isAdmin) res.users = readUsers().map(publicUser);
    return res;
  },

  getImages: function (req, ctx) {
    var refs = (Array.isArray(req.refs) ? req.refs : []).slice(0, 8);
    var images = {};
    refs.forEach(function (ref) {
      ref = String(ref);
      if (ref.indexOf('drive:') !== 0) return;
      try {
        var blob = DriveApp.getFileById(ref.slice(6)).getBlob();
        images[ref] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
      } catch (e) { images[ref] = null; }
    });
    return { ok: true, images: images };
  },

  getImage: function (req, ctx) {
    var ref = String(req.ref || '');
    if (ref.indexOf('drive:') !== 0) throw new Error('Unknown image reference.');
    var file = DriveApp.getFileById(ref.slice(6));
    var blob = file.getBlob();
    return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  },

  save: function (req, ctx) {
    requireRole(ctx, 'scout');
    var inp = req.entry || {};
    var now = nowISO();
    return withLock(function () {
      var existing = inp.id ? findEntry(String(inp.id)) : null;
      if (inp.id && !existing) throw new Error('Entry not found.');
      if (existing) {
        if (existing.createdBy !== ctx.user.username && !ctx.isAdmin) throw new Error('You can only edit your own entries.');
        if (existing.status !== 'submitted' && existing.status !== 'returned') throw new Error('This entry can no longer be edited.');
      }
      var id = existing ? existing.id : newId();
      var images = existing ? (existing.images || {}) : {};
      var kinds = ['idFront', 'idBack', 'farmerPhoto', 'signature'];
      var newSignature = false;
      var imgIn = inp.images || {};
      kinds.forEach(function (k) {
        var v = imgIn[k];
        if (v && typeof v === 'object' && v.data) {
          images[k] = storeImage(id, k, v.data, v.type || 'image/jpeg');
          if (k === 'signature') newSignature = true;
        } else if (typeof v === 'string' && v.indexOf('drive:') === 0) {
          images[k] = v;
        } else if (v === null) {
          delete images[k];
        }
      });
      var missing = kinds.filter(function (k) { return !images[k]; });
      if (missing.length) throw new Error('Missing: ' + missing.join(', '));
      var pin = inp.pin || {};
      if (pin.lat == null || pin.lng == null) throw new Error('Pin location is required.');
      var required = ['farmerName', 'phone', 'idNumber', 'plotLR', 'sublocation', 'area', 'cbc'];
      required.forEach(function (f) { if (!String(inp[f] || '').trim()) throw new Error('Missing: ' + f); });
      if (!(Number(inp.acreage) > 0)) throw new Error('Estimated acreage is required.');

      var history = existing ? (existing.history || []) : [];
      history.push({ at: now, by: ctx.user.username, action: existing ? 'Resubmitted after correction' : 'Captured in the field', note: '' });
      var entry = {
        id: id, status: 'submitted',
        farmerName: String(inp.farmerName).trim(), phone: String(inp.phone).trim(), idNumber: String(inp.idNumber).trim(),
        plotLR: String(inp.plotLR).trim(), acreage: Number(inp.acreage), trips: inp.trips === '' || inp.trips == null ? '' : Number(inp.trips),
        sublocation: String(inp.sublocation).trim(), area: String(inp.area).trim(), cbc: String(inp.cbc).trim(),
        pin: { lat: Number(pin.lat), lng: Number(pin.lng), accuracy: pin.accuracy == null ? '' : Number(pin.accuracy), source: pin.source || 'manual' },
        agreedAt: (existing && existing.agreedAt && !newSignature) ? existing.agreedAt : now,
        createdBy: existing ? existing.createdBy : ctx.user.username,
        createdAt: existing ? existing.createdAt : now, updatedAt: now,
        check: existing ? existing.check : null, permit: existing ? existing.permit : null, zoning: existing ? existing.zoning : null,
        images: images, history: history
      };
      writeEntry(entry);
      return { ok: true, entry: entry };
    });
  },

  check: function (req, ctx) {
    requireRole(ctx, 'checker');
    var result = String(req.result || '');
    var label = { pushed: 'Pushed to ERP', returned: 'Returned to scout', rejected: 'Rejected' }[result];
    if (!label) throw new Error('Unknown result.');
    var note = String(req.note || '').trim();
    if (result !== 'pushed' && !note) throw new Error('A note is required when returning or rejecting.');
    return withLock(function () {
      var e = mustFind(req.id);
      if (e.status !== 'submitted') throw new Error('This entry is not waiting for a data check.');
      var now = nowISO();
      e.status = result;
      e.check = { result: label, by: ctx.user.username, at: now, note: note, erpRef: String(req.erpRef || '').trim() };
      pushHistory(e, label, ctx.user.username, note, now);
      writeEntry(e);
      return { ok: true, entry: e };
    });
  },

  permit: function (req, ctx) {
    requireRole(ctx, 'permits');
    var number = String(req.number || '').trim();
    if (!number) throw new Error('Permit number is required.');
    return withLock(function () {
      var e = mustFind(req.id);
      if (e.status !== 'pushed') throw new Error('This entry is not ready for a permit.');
      var now = nowISO();
      e.status = 'permit_issued';
      e.permit = { number: number, by: ctx.user.username, at: now };
      pushHistory(e, 'Permit issued', ctx.user.username, number, now);
      writeEntry(e);
      return { ok: true, entry: e };
    });
  },

  zone: function (req, ctx) {
    requireRole(ctx, 'zoning');
    var z = req.zoning || {};
    var complete = !!req.complete;
    return withLock(function () {
      var e = mustFind(req.id);
      if (e.status !== 'permit_issued') throw new Error('This entry has no open permit.');
      var now = nowISO();
      var zoning = {
        inspected: !!z.inspected, polygonReceived: !!z.polygonReceived,
        zone: String(z.zone || '').trim(), cbc: String(z.cbc || '').trim(),
        linearDistance: z.linearDistance === '' || z.linearDistance == null ? '' : Number(z.linearDistance),
        note: String(z.note || '').trim(), by: ctx.user.username, at: now
      };
      if (complete) {
        var missing = [];
        if (!zoning.inspected) missing.push('field inspected');
        if (!zoning.polygonReceived) missing.push('polygon received');
        if (!zoning.zone) missing.push('zone');
        if (!zoning.cbc) missing.push('CBC');
        if (zoning.linearDistance === '' || isNaN(zoning.linearDistance)) missing.push('linear distance');
        if (missing.length) throw new Error('Still needed: ' + missing.join(', '));
        e.status = 'zoned';
      }
      e.zoning = zoning;
      pushHistory(e, complete ? 'Zoning complete' : 'Zoning updated', ctx.user.username,
        complete ? ('Zone ' + zoning.zone + ', CBC ' + zoning.cbc + ', ' + zoning.linearDistance + ' km') : '', now);
      writeEntry(e);
      return { ok: true, entry: e };
    });
  },

  /* ---- admin: users ---- */
  'users.add': function (req, ctx) {
    requireAdmin(ctx);
    var username = cleanUsername(req.username);
    var tempPassword = String(req.tempPassword || '');
    if (tempPassword.length < 6) throw new Error('Temporary password must be at least 6 characters.');
    var roles = cleanRoles(req.roles);
    if (!roles.length) throw new Error('Choose at least one role.');
    return withLock(function () {
      if (findUser(username)) throw new Error('Username "' + username + '" is already taken.');
      createUser({ username: username, name: String(req.name || '').trim() || username, email: String(req.email || '').trim(), roles: roles, tempPassword: tempPassword }, ctx.user.username);
      return { ok: true, users: readUsers().map(publicUser) };
    });
  },

  'users.update': function (req, ctx) {
    requireAdmin(ctx);
    var username = cleanUsername(req.username);
    return withLock(function () {
      var u = findUser(username);
      if (!u) throw new Error('User not found.');
      var patch = {};
      if (req.roles != null) {
        var roles = cleanRoles(req.roles);
        if (!roles.length) throw new Error('Choose at least one role.');
        if (username === ctx.user.username && roles.indexOf('admin') < 0) throw new Error('You cannot remove your own admin role.');
        patch.roles = roles.join(',');
      }
      if (req.name != null) patch.name = String(req.name).trim() || u.name;
      if (req.email != null) patch.email = String(req.email).trim();
      if (req.active != null) {
        if (username === ctx.user.username && !req.active) throw new Error('You cannot deactivate yourself.');
        patch.active = !!req.active;
      }
      updateUserRow(username, patch);
      return { ok: true, users: readUsers().map(publicUser) };
    });
  },

  'users.resetPassword': function (req, ctx) {
    requireAdmin(ctx);
    var username = cleanUsername(req.username);
    var tempPassword = String(req.tempPassword || '');
    if (tempPassword.length < 6) throw new Error('Temporary password must be at least 6 characters.');
    return withLock(function () {
      var u = findUser(username);
      if (!u) throw new Error('User not found.');
      var salt = randomString(16);
      updateUserRow(username, { salt: salt, hash: hashPassword(tempPassword, salt), mustChange: true, passwordChangedAt: nowISO() });
      return { ok: true, users: readUsers().map(publicUser) };
    });
  },

  'config.set': function (req, ctx) {
    requireAdmin(ctx);
    var cfg = Object.assign({}, getConfig());
    ['cbcs', 'zones', 'areas', 'sublocations'].forEach(function (k) {
      if (Array.isArray(req[k])) cfg[k] = req[k].map(function (s) { return String(s).trim(); }).filter(Boolean);
    });
    if (req.acreageUnit) cfg.acreageUnit = String(req.acreageUnit);
    setConfig(cfg);
    return { ok: true, config: cfg };
  }
};

/* ===================== Auth ===================== */

function login(req) {
  var username = cleanUsername(req.username);
  var password = String(req.password || '');
  var u = findUser(username);
  if (!u || !u.active || hashPassword(password, u.salt) !== u.hash) {
    Utilities.sleep(400);
    return { ok: false, error: 'Username or password is not correct.' };
  }
  updateUserRow(username, { lastLogin: nowISO() });
  return { ok: true, token: makeToken(u), user: publicUser(u) };
}

function hashPassword(password, salt) {
  var key = Utilities.newBlob(String(salt)).getBytes();
  var bytes = Utilities.newBlob(String(salt) + ':' + String(password)).getBytes();
  for (var i = 0; i < HASH_ROUNDS; i++) bytes = Utilities.computeHmacSha256Signature(bytes, key);
  return Utilities.base64Encode(bytes);
}

function secret() {
  var s = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!s) throw new Error('Run setup() first.');
  return s;
}
function sign(str) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(str, secret()));
}
function makeToken(u) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: u.username, exp: Date.now() + TOKEN_DAYS * 864e5, pv: u.passwordChangedAt || '' }));
  return payload + '.' + sign(payload);
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  var parts = token.split('.');
  if (sign(parts[0]) !== parts[1]) return null;
  var data;
  try { data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { return null; }
  if (!data || !data.u || data.exp < Date.now()) return null;
  var u = findUser(data.u);
  if (!u || !u.active) return null;
  if ((u.passwordChangedAt || '') !== (data.pv || '')) return null; // password changed since sign-in
  return u;
}
function requireRole(ctx, role) {
  if (ctx.isAdmin || ctx.roles.indexOf(role) >= 0) return;
  throw new Error('Your role does not allow this action.');
}
function requireAdmin(ctx) { if (!ctx.isAdmin) throw new Error('Administrators only.'); }

/* ===================== Users ===================== */

function readUsers() {
  return readSheet('users').map(function (r) {
    r.roles = String(r.roles || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    r.active = truthy(r.active); r.mustChange = truthy(r.mustChange);
    return r;
  });
}
function findUser(username) {
  var u = cleanUsername(username);
  var all = readUsers();
  for (var i = 0; i < all.length; i++) if (all[i].username === u) return all[i];
  return null;
}
function publicUser(u) {
  return { username: u.username, name: u.name, email: u.email, roles: u.roles, active: u.active, mustChange: u.mustChange, createdAt: u.createdAt, lastLogin: u.lastLogin };
}
function userNames() {
  var m = {};
  readUsers().forEach(function (u) { m[u.username] = u.name || u.username; });
  return m;
}
function createUser(o, by) {
  var salt = randomString(16);
  var now = nowISO();
  appendRow('users', {
    username: o.username, name: o.name, email: o.email || '', roles: o.roles.join(','),
    salt: salt, hash: hashPassword(o.tempPassword, salt), mustChange: true, active: true,
    createdAt: now, createdBy: by, lastLogin: '', passwordChangedAt: now
  });
}
function updateUserRow(username, patch) {
  var sh = sheet('users'); var cols = SHEETS.users;
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === username) {
      Object.keys(patch).forEach(function (k) {
        var c = cols.indexOf(k); if (c >= 0) sh.getRange(r + 1, c + 1).setValue(patch[k]);
      });
      return;
    }
  }
  throw new Error('User not found.');
}
function cleanUsername(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9._@-]/g, ''); }
function cleanRoles(arr) { return (Array.isArray(arr) ? arr : String(arr || '').split(',')).map(function (s) { return String(s).trim(); }).filter(function (r) { return ROLES.indexOf(r) >= 0; }); }

/* ===================== Entries ===================== */

function readEntries() { return readSheet('entries').map(rowToEntry); }
function findEntry(id) {
  var all = readEntries();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}
function mustFind(id) { var e = findEntry(String(id || '')); if (!e) throw new Error('Entry not found.'); return e; }
function pushHistory(e, action, by, note, at) {
  e.history = e.history || [];
  e.history.push({ at: at, by: by, action: action, note: note || '' });
  e.updatedAt = at;
}
function rowToEntry(r) {
  var e = {
    id: String(r.id), status: String(r.status), farmerName: r.farmerName, phone: String(r.phone), idNumber: String(r.idNumber), plotLR: String(r.plotLR),
    acreage: r.acreage === '' ? '' : Number(r.acreage), trips: r.trips === '' ? '' : Number(r.trips),
    sublocation: r.sublocation, area: r.area, cbc: r.cbc,
    pin: r.pinLat === '' ? null : { lat: Number(r.pinLat), lng: Number(r.pinLng), accuracy: r.pinAccuracy === '' ? null : Number(r.pinAccuracy), source: r.pinSource },
    agreedAt: iso(r.agreedAt), createdBy: r.createdBy, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    check: r.checkAt ? { result: r.checkResult, by: r.checkBy, at: iso(r.checkAt), note: r.checkNote, erpRef: r.erpRef } : null,
    permit: r.permitNumber ? { number: String(r.permitNumber), by: r.permitBy, at: iso(r.permitAt) } : null,
    zoning: r.zoneAt ? { inspected: truthy(r.zoneInspected), polygonReceived: truthy(r.zonePolygon), zone: r.zone, cbc: r.zoneCbc, linearDistance: r.linearDistanceKm === '' ? '' : Number(r.linearDistanceKm), note: r.zoneNote, by: r.zoneBy, at: iso(r.zoneAt) } : null,
    images: parseJSON(r.images, {}), history: parseJSON(r.history, [])
  };
  return e;
}
function entryToRow(e) {
  var c = e.check || {}, p = e.permit || {}, z = e.zoning || {}, pin = e.pin || {};
  return {
    id: e.id, status: e.status, statusLabel: STATUS_LABEL[e.status] || e.status,
    farmerName: e.farmerName, phone: e.phone, idNumber: e.idNumber, plotLR: e.plotLR, acreage: e.acreage, trips: e.trips,
    sublocation: e.sublocation, area: e.area, cbc: e.cbc,
    pinLat: pin.lat == null ? '' : pin.lat, pinLng: pin.lng == null ? '' : pin.lng, pinAccuracy: pin.accuracy == null ? '' : pin.accuracy, pinSource: pin.source || '',
    agreedAt: e.agreedAt || '', createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: e.updatedAt,
    checkResult: c.result || '', checkBy: c.by || '', checkAt: c.at || '', checkNote: c.note || '', erpRef: c.erpRef || '',
    permitNumber: p.number || '', permitBy: p.by || '', permitAt: p.at || '',
    zoneInspected: z.at ? !!z.inspected : '', zonePolygon: z.at ? !!z.polygonReceived : '', zone: z.zone || '', zoneCbc: z.cbc || '',
    linearDistanceKm: z.linearDistance == null ? '' : z.linearDistance, zoneNote: z.note || '', zoneBy: z.by || '', zoneAt: z.at || '',
    images: JSON.stringify(e.images || {}), history: JSON.stringify(e.history || [])
  };
}
function writeEntry(e) {
  var sh = sheet('entries'); var cols = SHEETS.entries;
  var row = entryToRow(e);
  var values = cols.map(function (k) { return row[k] == null ? '' : row[k]; });
  var ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var r = 1; r < ids.length; r++) {
    if (String(ids[r][0]) === e.id) { sh.getRange(r + 1, 1, 1, cols.length).setValues([values]); return; }
  }
  sh.appendRow(values);
}
function storeImage(entryId, kind, base64, type) {
  var folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
  var ext = type === 'image/png' ? 'png' : 'jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), type, entryId + '-' + kind + '-' + Date.now() + '.' + ext);
  var file = folder.createFile(blob);
  return 'drive:' + file.getId();
}

/* ===================== Config ===================== */

function getConfig() {
  var cfg = Object.assign({}, DEFAULT_CONFIG);
  readSheet('config').forEach(function (r) { cfg[r.key] = parseJSON(r.value, r.value); });
  return cfg;
}
function setConfig(cfg) {
  var sh = sheet('config');
  sh.clearContents();
  var rows = [['key', 'value']];
  Object.keys(cfg).forEach(function (k) { rows.push([k, JSON.stringify(cfg[k])]); });
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
}

/* ===================== Sheet helpers ===================== */

function ss() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() first.');
  return SpreadsheetApp.openById(id);
}
function sheet(name) {
  var sh = ss().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup() again.');
  return sh;
}
function readSheet(name) {
  var sh = sheet(name); var cols = SHEETS[name];
  var last = sh.getLastRow(); if (last < 2) return [];
  var data = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return data.filter(function (row) { return String(row[0]) !== ''; }).map(function (row) {
    var o = {}; cols.forEach(function (k, i) { o[k] = row[i]; }); return o;
  });
}
function appendRow(name, obj) {
  var cols = SHEETS[name];
  sheet(name).appendRow(cols.map(function (k) { return obj[k] == null ? '' : obj[k]; }));
}
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== Utilities ===================== */

function nowISO() { return new Date().toISOString(); }
function iso(v) { if (v instanceof Date) return v.toISOString(); return v == null ? '' : String(v); }
function truthy(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function parseJSON(s, fallback) { if (s === '' || s == null) return fallback; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { return fallback; } }
function newId() { return Date.now().toString(36) + '-' + randomString(6); }
function randomString(n) {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; var s = '';
  for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/* ===================== One-time setup ===================== */

function setup() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheet;
  if (props.getProperty('SPREADSHEET_ID')) spreadsheet = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  else { spreadsheet = SpreadsheetApp.create('Cane Permit Tracker'); props.setProperty('SPREADSHEET_ID', spreadsheet.getId()); }
  Object.keys(SHEETS).forEach(function (name) {
    var sh = spreadsheet.getSheetByName(name);
    if (!sh) { sh = spreadsheet.insertSheet(name); sh.appendRow(SHEETS[name]); sh.setFrozenRows(1); }
    sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat('@');
  });
  var def = spreadsheet.getSheetByName('Sheet1');
  if (def && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(def);
  if (!props.getProperty('FOLDER_ID')) props.setProperty('FOLDER_ID', DriveApp.createFolder('Cane Permit Tracker photos').getId());
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (sheet('config').getLastRow() < 2) setConfig(DEFAULT_CONFIG);
  if (!findUser(ADMIN_USERNAME)) {
    createUser({ username: cleanUsername(ADMIN_USERNAME), name: 'Administrator', email: '', roles: ['admin'], tempPassword: ADMIN_TEMP_PASSWORD }, 'setup');
    Logger.log('Admin user "' + cleanUsername(ADMIN_USERNAME) + '" created with the temporary password from the script.');
  }
  Logger.log('Setup complete.\nSpreadsheet: ' + spreadsheet.getUrl() + '\nNow deploy as a Web app (Execute as Me, Anyone) and paste the URL into index.html.');
}
