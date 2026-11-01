/**
 * Cane Permit Tracker v2 — Google Apps Script backend
 * ----------------------------------------------------
 * Data lives in a Google Sheet (created for you) and photos in a Drive folder.
 *
 * SETUP (once):
 *   1. Change ADMIN_USERNAME and ADMIN_TEMP_PASSWORD below.
 *   2. In the editor, choose the function "setup" and click Run. Authorise when asked.
 *      The log shows the spreadsheet URL.  (v2 creates a fresh spreadsheet and folder;
 *      a v1 spreadsheet, if any, is left untouched in Drive.)
 *   3. Deploy > New deployment > Web app:
 *        Execute as: Me        Who has access: Anyone
 *      Copy the Web app URL (ends in /exec) into index.html (API_URL).
 *   4. Sign in on the page as the admin with the temporary password; you will be asked to change it.
 *
 * After editing this script: Deploy > Manage deployments > Edit > Version: New version > Deploy.
 * The URL stays the same.
 */

const ADMIN_USERNAME = 'admin';
const ADMIN_TEMP_PASSWORD = 'Change-me-2026';

const APP_VERSION = '2.0';
const DATA_VERSION = 'v2';
const SPREADSHEET_NAME = 'Cane Permit Tracker v2';
const FOLDER_NAME = 'Cane Permit Tracker v2 photos';
const SESSION_DAYS = 14;

const ENTRY_COLS = ['id','status','createdAt','createdBy','updatedAt','farmerName','phone','idNumber','harvesterCode','harvesterName','plotLR','acreage','acreageHa','areaM2','trips','area','sublocation','cbc','nearestCbc','nearestDistanceKm','zone','zoneOut','centroidLat','centroidLng','polygon','bankCode','bankName','bankAccount','bankAccountName','bankBranch','images','agreedAt','termsVersion','privacyConsentAt','privacyVersion','erpRef','permitNumber','ccsClips','check','permit','zoning','history'];
const SHEETS = {
  users:      ['username','name','roles','passwordHash','salt','mustChange','active','createdAt','createdBy','lastLoginAt'],
  sessions:   ['token','username','createdAt','expiresAt'],
  entries:    ENTRY_COLS,
  config:     ['key','value'],
  cbcs:       ['name','lat','lng','active'],
  harvesters: ['code','name','phone','idNumber','active','addedBy','addedAt'],
  banks:      ['code','name','acctLength','active'],
};
const JSON_COLS = {polygon:1,images:1,check:1,permit:1,zoning:1,history:1};
const BOOL_COLS = {zoneOut:1,mustChange:1,active:1};
const NUM_COLS  = {acreage:1,acreageHa:1,areaM2:1,trips:1,nearestDistanceKm:1,centroidLat:1,centroidLng:1,lat:1,lng:1,acctLength:1};
const SCOUT_FIELDS = ['farmerName','phone','idNumber','harvesterCode','harvesterName','plotLR','acreage','acreageHa','areaM2','trips','area','sublocation','cbc','nearestCbc','nearestDistanceKm','zone','zoneOut','centroidLat','centroidLng','polygon','bankCode','bankName','bankAccount','bankAccountName','bankBranch','images','agreedAt','termsVersion','privacyConsentAt','privacyVersion'];
const ALL_ROLES = ['scout','checker','permits','zoning','admin'];

const DEFAULT_TERMS = 'I, {NAME} of ID no. {ID} hereby give an undertaking and warrant that the land which I intend to contract with the Miller for cane farming is free from any encumbrances, third party claims, rights or interests and or dispute(s) prejudicial to the Miller. I confirm that I have not contracted the said piece of land/sugarcane with any other Miller. I am aware that the Miller’s decision to enter into contract with me shall be based on my representations herein and that I shall indemnify the Miller for any loss and/or damage it may sustain by acting on my representations.';
const DEFAULT_PRIVACY = 'This application is committed to protecting your personal data in accordance with the Data Protection Act, 2019, Kenya’s primary statute on data protection, which gives effect to Article 31(c) and (d) of the Constitution of Kenya, 2010, guaranteeing every person’s right to privacy. Section 25 of the Act requires that personal data collected through this app is processed lawfully, fairly, and transparently, for specified and legitimate purposes, and kept accurate and up to date. We collect only the data necessary to deliver the app’s functionality, and we do not retain it longer than is reasonably required. Where applicable, we provide a privacy notice at or before the point of data collection, clearly stating the purpose of processing, the categories of data collected, retention periods, your rights as a data subject, and details of any cross-border transfers. Any processing of sensitive personal data generally requires your explicit consent. As required by the Act, we maintain appropriate technical and organizational safeguards to secure your data, and we are subject to oversight by the Office of the Data Protection Commissioner (ODPC), which enforces compliance, including a requirement to notify affected parties of any data breach within 72 hours. You retain the right to access, correct, delete, or restrict the processing of your personal data at any time, and may lodge a complaint with the ODPC if you believe your data has been mishandled.';
const DEFAULT_CONFIG = {
  zones:['A','B','C','D','E','F'], zoneIntervalKm:3, acreageUnit:'acres', areas:[], sublocations:[],
  termsText:DEFAULT_TERMS, termsVersion:'1', privacyText:DEFAULT_PRIVACY, privacyVersion:'1',
  bankAcctExactLength:true, requireBankCard:true, requireHarvester:true,
};

/* Seed lists — edited later from the Admin tab */
const SEED_CBCS = [
  {name:'Chamgiwadu',lat:-0.889208,lng:34.609377,active:true},
  {name:'Nyaoke',lat:-0.799188,lng:34.605932,active:true},
  {name:'Geem',lat:-1.1454,lng:34.6364,active:true},
  {name:'Olalui',lat:-1.037082,lng:34.887953,active:true},
  {name:'Oyani',lat:-1.051671,lng:34.598069,active:true},
  {name:'Oloontare',lat:-0.983435,lng:34.629485,active:true},
  {name:'Moita',lat:-1.091949,lng:34.72811,active:true},
  {name:'Factory Weighbridge',lat:-1.327699,lng:34.738594,active:true},
];
const SEED_BANKS = [
  {code:"3", name:"ABSA BANK KENYA PLC", acctLength:10, active:true},
  {code:"26", name:"Access Bank Kenya PLC", acctLength:13, active:true},
  {code:"35", name:"African Banking Corporation Limited", acctLength:15, active:true},
  {code:"19", name:"Bank of Africa Kenya Limited", acctLength:10, active:true},
  {code:"6", name:"BANK OF BARODA(KENYA LTD)", acctLength:14, active:true},
  {code:"23", name:"Consolidated Bank of Kenya Ltd", acctLength:12, active:true},
  {code:"11", name:"COOPERATIVE BANK", acctLength:14, active:true},
  {code:"63", name:"DIAMOND TRUST BANK KENYA LIMITED", acctLength:10, active:true},
  {code:"68", name:"EQUITY BANK KENYA LTD", acctLength:13, active:true},
  {code:"70", name:"FAMILY BANK", acctLength:12, active:true},
  {code:"55", name:"GUARDIAN BANK", acctLength:10, active:true},
  {code:"61", name:"HFC GROUP/BANK", acctLength:12, active:true},
  {code:"57", name:"I&M BANK", acctLength:14, active:true},
  {code:"1", name:"KENYA COMMERCIAL BANK LIMITED (KCB)", acctLength:10, active:true},
  {code:"62", name:"Kenya Post Office Savings Bank", acctLength:13, active:true},
  {code:"51", name:"Kingdom Bank Limited", acctLength:13, active:true},
  {code:"12", name:"National Bank", acctLength:11, active:true},
  {code:"12", name:"NATIONAL BANK OF KENYA", acctLength:14, active:true},
  {code:"12", name:"NATIONAL BANK OF KENYA-2", acctLength:10, active:true},
  {code:"12", name:"NATIONAL BANK OF KENYA-3", acctLength:13, active:true},
  {code:"7", name:"NCBA", acctLength:10, active:true},
  {code:"60", name:"SBM Bank", acctLength:13, active:true},
  {code:"66", name:"Sidian Bank Limited", acctLength:14, active:true},
  {code:"31", name:"STANBIC BANK PLC", acctLength:13, active:true},
  {code:"2", name:"STANDARD CHARTERED BANK KENYA LTD", acctLength:13, active:true}
];
const SEED_HARVESTERS = [
  {code:"HARV009", name:"LAURA MMBONE", phone:"", idNumber:"", active:true},
  {code:"HARV010", name:"SAMSON ONGAKI RATEMO", phone:"", idNumber:"", active:true},
  {code:"HARV011", name:"GLADYS ALUS", phone:"", idNumber:"", active:true},
  {code:"HARV012", name:"TERESA NEKESA JUMA", phone:"", idNumber:"", active:true},
  {code:"HARV014", name:"WILFRED MAUTI OBRA", phone:"", idNumber:"", active:true},
  {code:"HARV015", name:"OLOWARU REGINA NASIEKU", phone:"", idNumber:"", active:true},
  {code:"HARV016", name:"LABAN TOME SARIKO", phone:"", idNumber:"", active:true},
  {code:"HARV017", name:"GABRIEL ROBI RIOBA", phone:"", idNumber:"", active:true},
  {code:"HARV019", name:"WILFRED NYANGARESI SAMUEL", phone:"", idNumber:"", active:true},
  {code:"HARV020", name:"JOICE NAYAU ESUPAT MURERO", phone:"", idNumber:"", active:true},
  {code:"HARV257", name:"Hellen M Okoko", phone:"", idNumber:"", active:true},
  {code:"HARV021", name:"Robert Kipsang Ngetich", phone:"", idNumber:"", active:true},
  {code:"HARV022", name:"Sempelai Francis", phone:"", idNumber:"", active:true},
  {code:"HARV023", name:"DANCAN ODIWUOR OWITI", phone:"", idNumber:"", active:true},
  {code:"HARV024", name:"GEORGE OYULA OCHOLLA", phone:"", idNumber:"", active:true},
  {code:"HARV025", name:"OKENGO GWARO JUSTUS", phone:"", idNumber:"", active:true},
  {code:"HARV026", name:"SELF HARVEST", phone:"", idNumber:"", active:true},
  {code:"HARV027", name:"SHARON MORAA NGOGE", phone:"", idNumber:"", active:true},
  {code:"HARV028", name:"DANIEL KAMANDA OYARO", phone:"", idNumber:"", active:true},
  {code:"HARV029", name:"ACHIRA GEOFFREY MOSIORI", phone:"", idNumber:"", active:true},
  {code:"HARV030", name:"WILSON ORANGI MOGWASI", phone:"", idNumber:"", active:true},
  {code:"HARV031", name:"RUTH MORAA OMBATI", phone:"", idNumber:"", active:true},
  {code:"HARV032", name:"AKUMA DOCTOR OMONDO", phone:"", idNumber:"", active:true},
  {code:"HARV033", name:"DAVID OSOGO OTONDI", phone:"", idNumber:"", active:true},
  {code:"HARV034", name:"EMILY ATIENO OWUOR", phone:"", idNumber:"", active:true},
  {code:"HARV035", name:"EUNITA NYABOKE NYAKEKE", phone:"", idNumber:"", active:true},
  {code:"HARV036", name:"FREDRICK MAAGA OGARO", phone:"", idNumber:"", active:true},
  {code:"HARV037", name:"GRACE MORAA NYAKWEBA", phone:"", idNumber:"", active:true},
  {code:"HARV038", name:"HAWA GEMEMA", phone:"", idNumber:"", active:true},
  {code:"HARV039", name:"JAPHETH OTIENO OWUOR", phone:"", idNumber:"", active:true},
  {code:"HARV040", name:"JEREMIAH MORARA ABUYA", phone:"", idNumber:"", active:true},
  {code:"HARV041", name:"JOSEPH ONGERI ONGERA", phone:"", idNumber:"", active:true},
  {code:"HARV042", name:"MIRIAM JEBIEGON", phone:"", idNumber:"", active:true},
  {code:"HARV043", name:"ONDEYO JEFFNEI MANDERE", phone:"", idNumber:"", active:true},
  {code:"HARV044", name:"ALFRED OKECH OCHICH", phone:"", idNumber:"", active:true},
  {code:"HARV045", name:"BENTA ATIENO", phone:"", idNumber:"", active:true},
  {code:"HARV046", name:"BRAMWEL MALOVA GUDWA", phone:"", idNumber:"", active:true},
  {code:"HARV047", name:"CICILIA NARIKULMURAN NTOME", phone:"", idNumber:"", active:true},
  {code:"HARV048", name:"FANUEL OTIENO OWITI", phone:"", idNumber:"", active:true},
  {code:"HARV049", name:"FREDRICK OCHIENG ADONGO", phone:"", idNumber:"", active:true},
  {code:"HARV050", name:"JOEL OMEDO WAGA", phone:"", idNumber:"", active:true},
  {code:"HARV051", name:"JOHN NTABO BISERA", phone:"", idNumber:"", active:true},
  {code:"HARV052", name:"PETER ANDAGO IMBUKA", phone:"", idNumber:"", active:true},
  {code:"HARV053", name:"SIMEON ADOYO OGONYO", phone:"", idNumber:"", active:true},
  {code:"HARV054", name:"ZACHAEUS OGUTU AJWANG", phone:"", idNumber:"", active:true},
  {code:"HARV055", name:"JARED MORARA OYARI", phone:"", idNumber:"", active:true},
  {code:"HARV056", name:"JOHN KAMAU MOSHINA", phone:"", idNumber:"", active:true},
  {code:"HARV057", name:"JOHN OMWOYO NYABOGA", phone:"", idNumber:"", active:true},
  {code:"HARV058", name:"JOSEPH NAIRENKE", phone:"", idNumber:"", active:true},
  {code:"HARV059", name:"PETER OBURE NYANGARA", phone:"", idNumber:"", active:true},
  {code:"HARV060", name:"RICHARD KIBAI OTURA", phone:"", idNumber:"", active:true},
  {code:"HARV061", name:"ROBERT GETACHI OBARA", phone:"", idNumber:"", active:true},
  {code:"HARV191", name:"SAMSON OMETE ATEMBA", phone:"", idNumber:"", active:true},
  {code:"HARV062", name:"Dancun Owiti", phone:"", idNumber:"", active:true},
  {code:"HARV063", name:"NAOMY NARIKU ILMURAN NTIWUAS", phone:"", idNumber:"", active:true},
  {code:"HARV064", name:"EMMANUEL OKENYE OMWANDO", phone:"", idNumber:"", active:true},
  {code:"HARV065", name:"TOM JOSEPH OMBASA", phone:"", idNumber:"", active:true},
  {code:"HARV066", name:"GRACE NYANSIABOKA MOKORO", phone:"", idNumber:"", active:true},
  {code:"HARV067", name:"GEORGE ODHIAMBO ONDITI", phone:"", idNumber:"", active:true},
  {code:"HARV068", name:"ERNEST NGOJE MAGAMBO", phone:"", idNumber:"", active:true},
  {code:"HARV069", name:"ALICE AKINYI OGUTU", phone:"", idNumber:"", active:true},
  {code:"HARV070", name:"DANIEL AYIENDA NYAEGA", phone:"", idNumber:"", active:true},
  {code:"HARV071", name:"BATHSHEBA NYABONYI NYAEGA", phone:"", idNumber:"", active:true},
  {code:"HARV072", name:"Serevius Ombui Masongo", phone:"", idNumber:"", active:true},
  {code:"HARV073", name:"Everline Kemunto Ondieki", phone:"", idNumber:"", active:true},
  {code:"HARV074", name:"GEORGE OWINO ONYANGO", phone:"", idNumber:"", active:true},
  {code:"HARV075", name:"Victor Owino Osunga", phone:"", idNumber:"", active:true},
  {code:"HARV076", name:"PHENNY BIYAKI NYANGOYA", phone:"", idNumber:"", active:true},
  {code:"HARV077", name:"PHILLEMON KIPRUTO BITOK", phone:"", idNumber:"", active:true},
  {code:"HARV078", name:"FRANCIS ALUDA NDERE", phone:"", idNumber:"", active:true},
  {code:"HARV079", name:"MARK KHAEMBA JUMA", phone:"", idNumber:"", active:true},
  {code:"HARV080", name:"LEKOKO JULIET TOYIE", phone:"", idNumber:"", active:true},
  {code:"HARV081", name:"ISAAC O OGIRI", phone:"", idNumber:"", active:true},
  {code:"HARV082", name:"CALEB ONYAMBU", phone:"", idNumber:"", active:true}
];

/* ===================== web app entry points ===================== */
function doGet() {
  return out_({ok:true, app:'Cane Permit Tracker', version:APP_VERSION, note:'POST JSON {action:...} to use the API.'});
}
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ok:false, error:'Bad request body'}); }
  try {
    if (!props_().getProperty('ssId') || props_().getProperty('dataVersion') !== DATA_VERSION) {
      return out_({ok:false, error:'The backend is not set up yet: open the Apps Script project and run setup() first.'});
    }
    const data = route_(req);
    return out_({ok:true, data:data, serverTime:new Date().toISOString()});
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    return out_({ok:false, error:msg.replace(/^AUTH:/,''), code:msg.indexOf('AUTH:')===0?'AUTH':undefined});
  }
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function route_(req) {
  const a = String(req.action || '');
  if (a === 'ping') return {pong:true, version:APP_VERSION};
  if (a === 'login') return login_(req);
  const me = auth_(req.token);
  switch (a) {
    case 'me': return {me:publicUser_(me)};
    case 'logout': return logout_(req.token);
    case 'changePassword': return changePassword_(me, req);
    case 'bootstrap': return bootstrap_(me);
    case 'entries': return {entries:entriesSince_(req.since)};
    case 'saveEntry': return saveEntry_(me, req.entry);
    case 'uploadImage': return uploadImage_(me, req);
    case 'getImage': return getImage_(req.fileId);
    case 'checkEntry': return checkEntry_(me, req);
    case 'permitEntry': return permitEntry_(me, req);
    case 'zoneEntry': return zoneEntry_(me, req);
    case 'addUser': return addUser_(me, req);
    case 'updateUser': return updateUser_(me, req);
    case 'resetPassword': return resetPassword_(me, req);
    case 'saveConfig': return saveConfig_(me, req.config);
    case 'saveList': return saveList_(me, req.list, req.rows);
    default: throw new Error('Unknown action: ' + a);
  }
}

/* ===================== setup ===================== */
function setup() {
  const p = props_();
  let ssId = p.getProperty('ssId'), folderId = p.getProperty('folderId');
  if (!ssId || p.getProperty('dataVersion') !== DATA_VERSION) {
    const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    ssId = ss.getId();
    const folder = DriveApp.createFolder(FOLDER_NAME);
    folderId = folder.getId();
    p.setProperty('ssId', ssId); p.setProperty('folderId', folderId); p.setProperty('dataVersion', DATA_VERSION);
  }
  const ss = SpreadsheetApp.openById(ssId);
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const want = SHEETS[name];
    const have = sh.getLastColumn() ? sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String) : [];
    if (!have.length || !have[0]) { sh.getRange(1,1,1,want.length).setValues([want]); sh.setFrozenRows(1); }
    else { const missing = want.filter(c => have.indexOf(c) < 0); if (missing.length) sh.getRange(1, have.length+1, 1, missing.length).setValues([missing]); }
    sh.getRange(1,1,Math.max(sh.getMaxRows(),2),Math.max(sh.getMaxColumns(),want.length)).setNumberFormat('@');
  });
  const s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  // seed admin
  if (!readTable_('users').length) {
    const salt = Utilities.getUuid();
    appendRow_('users', {username:ADMIN_USERNAME.toLowerCase(), name:'Administrator', roles:'admin', passwordHash:hashPw_(ADMIN_TEMP_PASSWORD, salt), salt:salt, mustChange:true, active:true, createdAt:now_(), createdBy:'setup', lastLoginAt:''});
  }
  if (!readTable_('cbcs').length) replaceTable_('cbcs', SEED_CBCS);
  if (!readTable_('banks').length) replaceTable_('banks', SEED_BANKS);
  if (!readTable_('harvesters').length) replaceTable_('harvesters', SEED_HARVESTERS.map(h => Object.assign({addedBy:'setup', addedAt:now_()}, h)));
  const cfg = readConfig_(); const merged = Object.assign({}, DEFAULT_CONFIG, cfg); writeConfig_(merged);
  Logger.log('Setup complete.\nSpreadsheet: ' + ss.getUrl() + '\nPhotos folder: https://drive.google.com/drive/folders/' + folderId + '\nAdmin username: ' + ADMIN_USERNAME + ' (temporary password as set in the script)');
}

/* ===================== storage helpers ===================== */
function props_() { return PropertiesService.getScriptProperties(); }
function now_() { return new Date().toISOString(); }
function ss_() { return SpreadsheetApp.openById(props_().getProperty('ssId')); }
function sheet_(name) { const sh = ss_().getSheetByName(name); if (!sh) throw new Error('Missing sheet ' + name + ' — run setup()'); return sh; }
function headers_(sh) { const n = sh.getLastColumn(); return n ? sh.getRange(1,1,1,n).getValues()[0].map(String) : []; }
function parseCell_(col, v) {
  if (v === '' || v === null || v === undefined) return JSON_COLS[col] ? null : (BOOL_COLS[col] ? false : (NUM_COLS[col] ? null : ''));
  if (JSON_COLS[col]) { try { return JSON.parse(v); } catch (e) { return null; } }
  if (BOOL_COLS[col]) return v === true || String(v).toLowerCase() === 'true';
  if (NUM_COLS[col]) { const n = Number(v); return isNaN(n) ? null : n; }
  return typeof v === 'string' ? v : String(v);
}
function cellOut_(col, v) {
  if (v === null || v === undefined) return '';
  if (JSON_COLS[col]) return JSON.stringify(v);
  if (BOOL_COLS[col]) return v ? 'true' : 'false';
  return String(v);
}
function readTable_(name) {
  const sh = sheet_(name); const h = headers_(sh); const n = sh.getLastRow();
  if (!h.length || n < 2) return [];
  const vals = sh.getRange(2,1,n-1,h.length).getValues();
  const rows = [];
  vals.forEach(r => { if (r.every(c => c === '' || c === null)) return; const o = {}; h.forEach((c,i) => { o[c] = parseCell_(c, r[i]); }); rows.push(o); });
  return rows;
}
function rowOut_(h, obj) { return h.map(c => cellOut_(c, obj[c])); }
function appendRow_(name, obj) {
  const sh = sheet_(name); const h = headers_(sh); const r = sh.getLastRow() + 1;
  const rng = sh.getRange(r,1,1,h.length); rng.setNumberFormat('@'); rng.setValues([rowOut_(h,obj)]);
}
function findRow_(sh, keyCol, keyVal) {
  const h = headers_(sh); const ci = h.indexOf(keyCol); if (ci < 0) return -1; const n = sh.getLastRow(); if (n < 2) return -1;
  const col = sh.getRange(2, ci+1, n-1, 1).getValues();
  for (let i = 0; i < col.length; i++) if (String(col[i][0]) === String(keyVal)) return i + 2;
  return -1;
}
function updateRow_(name, keyCol, keyVal, obj) {
  const sh = sheet_(name); const r = findRow_(sh, keyCol, keyVal); if (r < 0) throw new Error('Not found: ' + keyVal);
  const h = headers_(sh); const rng = sh.getRange(r,1,1,h.length); rng.setNumberFormat('@'); rng.setValues([rowOut_(h,obj)]);
}
function replaceTable_(name, rows) {
  const sh = sheet_(name); const h = headers_(sh);
  if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,Math.max(h.length,sh.getLastColumn())).clearContent();
  if (rows.length) { const rng = sh.getRange(2,1,rows.length,h.length); rng.setNumberFormat('@'); rng.setValues(rows.map(o => rowOut_(h,o))); }
}
function readConfig_() {
  const o = {}; readTable_('config').forEach(r => { try { o[r.key] = JSON.parse(r.value); } catch (e) { o[r.key] = r.value; } }); return o;
}
function writeConfig_(cfg) { replaceTable_('config', Object.keys(cfg).map(k => ({key:k, value:JSON.stringify(cfg[k])}))); }
function withLock_(fn) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== auth ===================== */
function hashPw_(pw, salt) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  return d.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function publicUser_(u) { return {username:u.username, name:u.name, roles:rolesOf_(u), mustChange:!!u.mustChange, active:u.active !== false}; }
function rolesOf_(u) { return String(u.roles || '').split(',').map(s => s.trim()).filter(r => ALL_ROLES.indexOf(r) >= 0); }
function hasRole_(u, r) { const rs = rolesOf_(u); return rs.indexOf('admin') >= 0 || rs.indexOf(r) >= 0; }
function need_(u, r) { if (!hasRole_(u, r)) throw new Error('You do not have the ' + r + ' role for this action.'); }
function findUser_(username) { return readTable_('users').find(u => String(u.username).toLowerCase() === String(username || '').toLowerCase()) || null; }
function login_(req) {
  const username = String(req.username || '').trim().toLowerCase(); const password = String(req.password || '');
  const u = findUser_(username);
  Utilities.sleep(300); // slows down guessing
  if (!u || u.active === false || hashPw_(password, u.salt) !== u.passwordHash) throw new Error('Wrong username or password.');
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g,'');
  const exp = new Date(Date.now() + SESSION_DAYS*86400000).toISOString();
  withLock_(() => {
    appendRow_('sessions', {token:token, username:u.username, createdAt:now_(), expiresAt:exp});
    purgeSessions_();
    u.lastLoginAt = now_(); updateRow_('users', 'username', u.username, u);
  });
  CacheService.getScriptCache().put('sess:' + token, u.username, 21600);
  return {token:token, me:publicUser_(u)};
}
function purgeSessions_() {
  const rows = readTable_('sessions'); const t = Date.now();
  const keep = rows.filter(r => new Date(r.expiresAt).getTime() > t);
  if (keep.length !== rows.length) replaceTable_('sessions', keep);
}
function auth_(token) {
  token = String(token || ''); if (!token) throw new Error('AUTH:Please sign in.');
  const cache = CacheService.getScriptCache();
  let username = cache.get('sess:' + token);
  if (!username) {
    const s = readTable_('sessions').find(r => r.token === token);
    if (!s || new Date(s.expiresAt).getTime() < Date.now()) throw new Error('AUTH:Your session has expired. Please sign in again.');
    username = s.username; cache.put('sess:' + token, username, 21600);
  }
  const u = findUser_(username);
  if (!u || u.active === false) throw new Error('AUTH:This account is not active.');
  return u;
}
function logout_(token) {
  CacheService.getScriptCache().remove('sess:' + token);
  withLock_(() => { const rows = readTable_('sessions').filter(r => r.token !== token); replaceTable_('sessions', rows); });
  return {ok:true};
}
function changePassword_(me, req) {
  const oldP = String(req.oldPassword || ''), newP = String(req.newPassword || '');
  if (hashPw_(oldP, me.salt) !== me.passwordHash) throw new Error('The current (or temporary) password is wrong.');
  if (newP.length < 8) throw new Error('The new password needs at least 8 characters.');
  const salt = Utilities.getUuid();
  withLock_(() => { me.salt = salt; me.passwordHash = hashPw_(newP, salt); me.mustChange = false; updateRow_('users', 'username', me.username, me); });
  return {ok:true};
}

/* ===================== bootstrap / entries ===================== */
function bootstrap_(me) {
  const admin = hasRole_(me, 'admin');
  const users = readTable_('users').map(u => admin ? publicUser_(u) : {username:u.username, name:u.name});
  return {
    me: publicUser_(me), config: Object.assign({}, DEFAULT_CONFIG, readConfig_()),
    cbcs: readTable_('cbcs'), harvesters: readTable_('harvesters'), banks: readTable_('banks'),
    users: users, entries: sortEntries_(readTable_('entries')), serverTime: now_(),
  };
}
function sortEntries_(list) { return list.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
function entriesSince_(since) {
  const all = readTable_('entries');
  if (!since) return sortEntries_(all);
  const t = new Date(since).getTime() - 2000;
  return sortEntries_(all.filter(e => new Date(e.updatedAt || e.createdAt).getTime() >= t));
}
function getEntry_(id) { const e = readTable_('entries').find(x => x.id === id); if (!e) throw new Error('Entry not found.'); return e; }
function hist_(e, by, action, note) { const h = Array.isArray(e.history) ? e.history : []; h.push({at:now_(), by:by, action:action, note:note || ''}); e.history = h; }
function saveEntry_(me, entry) {
  need_(me, 'scout');
  if (!entry || !entry.id) throw new Error('Missing entry.');
  const id = String(entry.id).replace(/[^\w-]/g, '');
  if (!entry.farmerName || !entry.idNumber || !entry.phone) throw new Error('Farmer name, ID number and phone are required.');
  if (!Array.isArray(entry.polygon) || entry.polygon.length < 3) throw new Error('A field polygon with at least 3 corners is required.');
  if (!entry.bankCode || !/^\d+$/.test(String(entry.bankAccount || ''))) throw new Error('Bank and a numeric account number are required.');
  const bank = readTable_('banks').find(b => String(b.code) === String(entry.bankCode));
  const cfg = Object.assign({}, DEFAULT_CONFIG, readConfig_());
  if (bank && bank.acctLength > 0) {
    const L = Number(bank.acctLength), n = String(entry.bankAccount).length;
    if (cfg.bankAcctExactLength !== false ? n !== L : n > L) throw new Error(bank.name + ' account numbers have ' + (cfg.bankAcctExactLength !== false ? '' : 'up to ') + L + ' digits.');
  }
  const imgs = entry.images || {};
  ['idFront','idBack','farmerPhoto','signature'].forEach(k => { if (!imgs[k]) throw new Error('Missing photo: ' + k); });
  if (cfg.requireBankCard !== false && !imgs.bankCard) throw new Error('Missing bank card photo.');
  if (cfg.requireHarvester !== false && !entry.harvesterCode) throw new Error('Harvester is required.');
  if (!entry.privacyConsentAt) throw new Error('Data protection consent is required.');
  if (!entry.agreedAt) throw new Error('Terms agreement is required.');
  return withLock_(() => {
    const sh = sheet_('entries'); const r = findRow_(sh, 'id', id);
    let e;
    if (r > 0) {
      e = getEntry_(id);
      const mine = e.createdBy === me.username;
      if (!mine && !hasRole_(me, 'admin')) throw new Error('You can only edit your own entries.');
      if (['submitted','returned'].indexOf(e.status) < 0) throw new Error('This entry can no longer be edited (status: ' + e.status + ').');
      SCOUT_FIELDS.forEach(k => { e[k] = entry[k]; });
      e.status = 'submitted'; e.updatedAt = now_();
      hist_(e, me.username, 'Resubmitted after correction', '');
      updateRow_('entries', 'id', id, e);
    } else {
      e = {id:id, status:'submitted', createdAt:now_(), createdBy:me.username, updatedAt:now_(), check:null, permit:null, zoning:null, history:[], erpRef:'', permitNumber:'', ccsClips:''};
      SCOUT_FIELDS.forEach(k => { e[k] = entry[k]; });
      hist_(e, me.username, 'Captured in the field', '');
      appendRow_('entries', e);
    }
    return {entry:e};
  });
}
function checkEntry_(me, req) {
  need_(me, 'checker');
  const result = String(req.result || ''); if (['pushed','returned','rejected'].indexOf(result) < 0) throw new Error('Bad result.');
  const note = String(req.note || '').trim(); if (result !== 'pushed' && !note) throw new Error('A note is required when returning or rejecting.');
  return withLock_(() => {
    const e = getEntry_(req.id); if (e.status !== 'submitted') throw new Error('This entry is not awaiting data check.');
    const label = {pushed:'Pushed to ERP', returned:'Returned to scout', rejected:'Rejected'}[result];
    e.check = {result:label, by:me.username, at:now_(), note:note, erpRef:String(req.erpRef || '').trim()};
    e.erpRef = e.check.erpRef; e.status = result; e.updatedAt = now_();
    hist_(e, me.username, label, note); updateRow_('entries', 'id', e.id, e); return {entry:e};
  });
}
function permitEntry_(me, req) {
  need_(me, 'permits');
  const no = String(req.permitNumber || '').trim(); if (!no) throw new Error('Permit number is required.');
  return withLock_(() => {
    const e = getEntry_(req.id); if (e.status !== 'pushed') throw new Error('This entry is not ready for a permit.');
    e.permit = {number:no, ccsClips:String(req.ccsClips || '').trim(), by:me.username, at:now_()};
    e.permitNumber = no; e.ccsClips = e.permit.ccsClips; e.status = 'permit_issued'; e.updatedAt = now_();
    hist_(e, me.username, 'Permit issued', no + (e.ccsClips ? ' · CCS clips: ' + e.ccsClips : '')); updateRow_('entries', 'id', e.id, e); return {entry:e};
  });
}
function zoneEntry_(me, req) {
  need_(me, 'zoning');
  const z = req.zoning || {}; const complete = !!req.complete;
  const zoning = {inspected:!!z.inspected, polygonQc:!!z.polygonQc, zone:String(z.zone || '').trim(), cbc:String(z.cbc || '').trim(), linearDistance:(z.linearDistance === null || z.linearDistance === undefined || z.linearDistance === '') ? null : Number(z.linearDistance), note:String(z.note || '').trim(), by:me.username, at:now_()};
  if (complete && (!zoning.inspected || !zoning.polygonQc || !zoning.zone || !zoning.cbc || zoning.linearDistance === null || isNaN(zoning.linearDistance))) throw new Error('Inspection, polygon QC, zone, CBC and linear distance are all required to complete zoning.');
  return withLock_(() => {
    const e = getEntry_(req.id); if (e.status !== 'permit_issued') throw new Error('This entry is not an open permit.');
    e.zoning = zoning; e.updatedAt = now_();
    if (complete) { e.status = 'zoned'; hist_(e, me.username, 'Zoning complete', 'Zone ' + zoning.zone + ', CBC ' + zoning.cbc + ', ' + zoning.linearDistance + ' km'); }
    else hist_(e, me.username, 'Zoning updated', zoning.note);
    updateRow_('entries', 'id', e.id, e); return {entry:e};
  });
}

/* ===================== images ===================== */
function folder_() { return DriveApp.getFolderById(props_().getProperty('folderId')); }
function uploadImage_(me, req) {
  need_(me, 'scout');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(req.dataUrl || ''));
  if (!m) throw new Error('Bad image data.');
  const kind = String(req.kind || 'photo').replace(/[^\w]/g, ''); const entryId = String(req.entryId || '').replace(/[^\w-]/g, '');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 4*1024*1024) throw new Error('Image too large.');
  const ext = m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg');
  const blob = Utilities.newBlob(bytes, m[1], entryId + '_' + kind + '_' + Date.now() + '.' + ext);
  const f = folder_().createFile(blob);
  return {fileId:f.getId()};
}
function getImage_(fileId) {
  fileId = String(fileId || '').replace(/[^\w-]/g, ''); if (!fileId) throw new Error('Missing file id.');
  const f = DriveApp.getFileById(fileId);
  const parents = f.getParents(); let ours = false; const folderId = props_().getProperty('folderId');
  while (parents.hasNext()) if (parents.next().getId() === folderId) ours = true;
  if (!ours) throw new Error('Not an app image.');
  const b = f.getBlob();
  return {dataUrl:'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes())};
}

/* ===================== admin ===================== */
function usersPublic_() { return readTable_('users').map(publicUser_); }
function addUser_(me, req) {
  need_(me, 'admin');
  const username = String(req.username || '').trim().toLowerCase(); const name = String(req.name || '').trim();
  const roles = (Array.isArray(req.roles) ? req.roles : []).filter(r => ALL_ROLES.indexOf(r) >= 0); const pw = String(req.tempPassword || '');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Invalid username.');
  if (!name) throw new Error('Name is required.'); if (!roles.length) throw new Error('At least one role is required.'); if (pw.length < 6) throw new Error('Temporary password too short.');
  return withLock_(() => {
    if (findUser_(username)) throw new Error('Username ' + username + ' already exists.');
    const salt = Utilities.getUuid();
    appendRow_('users', {username:username, name:name, roles:roles.join(','), passwordHash:hashPw_(pw, salt), salt:salt, mustChange:true, active:true, createdAt:now_(), createdBy:me.username, lastLoginAt:''});
    return {users:usersPublic_()};
  });
}
function updateUser_(me, req) {
  need_(me, 'admin');
  return withLock_(() => {
    const u = findUser_(req.username); if (!u) throw new Error('User not found.');
    if (req.name !== undefined) { const n = String(req.name).trim(); if (n) u.name = n; }
    if (Array.isArray(req.roles)) { const roles = req.roles.filter(r => ALL_ROLES.indexOf(r) >= 0); if (u.username === me.username && roles.indexOf('admin') < 0) throw new Error('You cannot remove your own admin role.'); u.roles = roles.join(','); }
    if (req.active !== undefined) { if (u.username === me.username && !req.active) throw new Error('You cannot deactivate yourself.'); u.active = !!req.active; if (!u.active) { const rows = readTable_('sessions').filter(r => r.username !== u.username); replaceTable_('sessions', rows); } }
    updateRow_('users', 'username', u.username, u);
    return {users:usersPublic_()};
  });
}
function resetPassword_(me, req) {
  need_(me, 'admin');
  const pw = String(req.tempPassword || ''); if (pw.length < 6) throw new Error('Temporary password too short.');
  return withLock_(() => {
    const u = findUser_(req.username); if (!u) throw new Error('User not found.');
    const salt = Utilities.getUuid(); u.salt = salt; u.passwordHash = hashPw_(pw, salt); u.mustChange = true;
    updateRow_('users', 'username', u.username, u);
    const rows = readTable_('sessions').filter(r => r.username !== u.username); replaceTable_('sessions', rows);
    return {users:usersPublic_()};
  });
}
function saveConfig_(me, cfg) {
  need_(me, 'admin');
  const next = Object.assign({}, DEFAULT_CONFIG, readConfig_());
  Object.keys(DEFAULT_CONFIG).forEach(k => { if (cfg && cfg[k] !== undefined) next[k] = cfg[k]; });
  next.zones = (Array.isArray(next.zones) ? next.zones : DEFAULT_CONFIG.zones).map(String).filter(Boolean);
  next.zoneIntervalKm = Number(next.zoneIntervalKm) > 0 ? Number(next.zoneIntervalKm) : 3;
  withLock_(() => writeConfig_(next));
  return {config:next};
}
function saveList_(me, list, rows) {
  need_(me, 'admin');
  if (!Array.isArray(rows)) throw new Error('Rows must be a list.');
  let clean;
  if (list === 'harvesters') {
    const seen = {};
    clean = rows.map(r => ({code:String(r.code || '').trim().toUpperCase(), name:String(r.name || '').trim(), phone:String(r.phone || '').trim(), idNumber:String(r.idNumber || '').trim(), active:r.active !== false, addedBy:r.addedBy || me.username, addedAt:r.addedAt || now_()})).filter(r => r.code && r.name);
    clean.forEach(r => { if (seen[r.code]) throw new Error('Duplicate harvester code ' + r.code); seen[r.code] = 1; });
  } else if (list === 'cbcs') {
    clean = rows.map(r => ({name:String(r.name || '').trim(), lat:Number(r.lat), lng:Number(r.lng), active:r.active !== false})).filter(r => r.name);
    clean.forEach(r => { if (isNaN(r.lat) || isNaN(r.lng) || Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180) throw new Error('Bad coordinates for ' + r.name); });
  } else if (list === 'banks') {
    clean = rows.map(r => ({code:String(r.code || '').trim(), name:String(r.name || '').trim(), acctLength:Number(r.acctLength) || 0, active:r.active !== false})).filter(r => r.code && r.name);
    clean.forEach(r => { if (!(r.acctLength > 0)) throw new Error('Account-number digit count missing for ' + r.name); });
  } else throw new Error('Unknown list.');
  withLock_(() => replaceTable_(list, clean));
  return {rows:readTable_(list)};
}
