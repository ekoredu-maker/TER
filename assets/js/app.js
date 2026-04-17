(() => {
const DB_NAME = 'trip_settlement_manager_v1';
  const DB_VERSION = 1;
  const STORES = ['trips','settlements','receipts','settings'];

  const tabs = [
    {id:'dashboard', label:'대시보드'},
    {id:'import', label:'출장 가져오기'},
    {id:'settlement', label:'여비정산'},
    {id:'calendar', label:'스케줄'},
    {id:'receipts', label:'영수증'},
    {id:'backup', label:'백업/복원'}
  ];

  const state = {
    db: null,
    trips: [],
    settlements: [],
    receipts: [],
    settings: {
      orgName: '교육과',
      kmRate: 200,
      defaultApplicant: '',
      defaultPosition: '',
      defaultWorkplace: '',
      signatureDataUrl: '',
      receiptRequiredTypes: '주유/하이패스/기타',
      note: '현재 버전은 기관별 세부 여비 규정 전체를 자동 판정하지 않고, 업로드·정산 초안·증빙 관리·출력에 중점을 둔 시안입니다.'
    },
    activeTab: 'dashboard',
    tripFilter: '',
    selectedTripId: '',
    selectedSettlementId: '',
    calendarCursor: new Date(),
    importPreview: [],
    importWarnings: [],
    dayFilter: '',
    receiptFilterSettlementId: '',
    ui: {
      dirty: false,
      dirtySettlementId: '',
      lastSavedAt: '',
    },
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(v){
    return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function uid(prefix='id'){ return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
  function localYmd(dateObj){
    if(!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth()+1).padStart(2,'0');
    const dd = String(dateObj.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function today(){ return localYmd(new Date()); }
  function nowStamp(){ return new Date().toISOString(); }
  function asNum(v){ const n = Number(String(v).replace(/,/g,'')); return isNaN(n) ? 0 : n; }
  function money(v){ return asNum(v).toLocaleString('ko-KR'); }
  function formatBytes(bytes){
    const n = Number(bytes || 0);
    if(!n) return '0 B';
    const units = ['B','KB','MB','GB'];
    let i = 0; let value = n;
    while(value >= 1024 && i < units.length - 1){ value /= 1024; i += 1; }
    return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }
  function ymdToKorean(v){
    if(!v) return '';
    if(v instanceof Date && !Number.isNaN(v.getTime())){
      return localYmd(v).replace(/-/g,'.');
    }
    const s = maybeDate(v);
    if(s) return s.replace(/-/g,'.');
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return v;
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }
  function monthKey(v){ return (v || '').slice(0,7); }
  function formatDateTime(date, time){ return [date ? ymdToKorean(date) : '', time || ''].filter(Boolean).join(' '); }
  function normalizeText(v){ return String(v ?? '').replace(/\s+/g,'').replace(/[()~\-_:./]/g,'').toLowerCase(); }
  function maybeDate(v){
    if(!v) return '';
    if(v instanceof Date && !Number.isNaN(v.getTime())) return localYmd(v);
    const s = String(v).trim();
    let m = s.match(/(20\d{2})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})/);
    if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }
  function maybeTime(v){
    if(!v) return '';
    if(v instanceof Date && !Number.isNaN(v.getTime())) return `${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}`;
    const s = String(v).trim();
    const m = s.match(/(\d{1,2})[:시](\d{2})?/);
    if(m) return `${String(m[1]).padStart(2,'0')}:${String(m[2] || '00').padStart(2,'0')}`;
    return '';
  }
  function extractPeriodInfo(raw){
    const s = String(raw || '').replace(/\n/g,' ').replace(/\s+/g,' ').trim();
    const dates = [...s.matchAll(/(20\d{2})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})/g)].map(m => `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`);
    const times = [...s.matchAll(/(\d{1,2})[:시](\d{2})?/g)].map(m => `${String(m[1]).padStart(2,'0')}:${String(m[2] || '00').padStart(2,'0')}`);
    return {
      startDate: dates[0] || '',
      endDate: dates[1] || dates[0] || '',
      startTime: times[0] || '',
      endTime: times[1] || times[0] || ''
    };
  }
  function safeFileName(name){
    return String(name || 'backup').replace(/[\\/:*?"<>|]+/g,'_');
  }
  function addDays(dateStr, days){
    if(!dateStr) return '';
    const d = new Date(`${dateStr}T00:00:00`);
    if(Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return localYmd(d);
  }
  function diffDays(fromDate, toDate){
    if(!fromDate || !toDate) return 0;
    const a = new Date(`${fromDate}T00:00:00`);
    const b = new Date(`${toDate}T00:00:00`);
    if(Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.floor((b - a) / 86400000);
  }
  function dateInRange(dateStr, startDate, endDate){
    if(!dateStr) return false;
    const target = new Date(`${dateStr}T00:00:00`);
    const start = new Date(`${(startDate || dateStr)}T00:00:00`);
    const end = new Date(`${(endDate || startDate || dateStr)}T00:00:00`);
    if(Number.isNaN(target.getTime()) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return target >= start && target <= end;
  }

  function formatStamp(v){
    if(!v) return '-';
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return String(v);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
  }
  function currentTrip(){
    if(state.selectedTripId) return getTrip(state.selectedTripId) || null;
    const s = currentSettlement?.();
    return s ? getTrip(s.tripId) : null;
  }
  function hasUnsavedChanges(){
    return !!(state.ui.dirty && state.ui.dirtySettlementId);
  }
  function markDirty(settlementId){
    state.ui.dirty = true;
    state.ui.dirtySettlementId = settlementId || state.ui.dirtySettlementId || '';
    updateTopIndicators();
  }
  function markSaved(settlement){
    state.ui.dirty = false;
    state.ui.dirtySettlementId = '';
    state.ui.lastSavedAt = settlement?.updatedAt || nowStamp();
    updateTopIndicators();
  }
  function clearDirtyIfMatches(settlementId){
    if(state.ui.dirtySettlementId && settlementId && state.ui.dirtySettlementId === settlementId){
      state.ui.dirty = false;
      state.ui.dirtySettlementId = '';
    }
    updateTopIndicators();
  }
  function confirmLeaveIfDirty(message){
    if(!hasUnsavedChanges()) return true;
    return window.confirm(message || '저장하지 않은 변경이 있습니다. 이동하면 현재 입력 중인 내용이 저장되지 않을 수 있습니다. 계속할까요?');
  }
  function updateTopIndicators(){
    const savePill = $('#saveStatePill');
    const lastSavedPill = $('#lastSavedPill');
    const activeTripPill = $('#activeTripPill');
    const trip = state.selectedTripId ? getTrip(state.selectedTripId) : null;
    if(savePill){
      if(hasUnsavedChanges()){
        savePill.textContent = '저장상태: 입력 중(미저장 변경 있음)';
        savePill.className = 'pill status-dirty';
      }else{
        savePill.textContent = '저장상태: 저장된 변경 없음';
        savePill.className = 'pill status-ok';
      }
    }
    if(lastSavedPill){
      lastSavedPill.textContent = `마지막 저장: ${formatStamp(state.ui.lastSavedAt)}`;
    }
    if(activeTripPill){
      activeTripPill.textContent = trip ? `선택 출장: ${trip.name || '미상'} · ${ymdToKorean(trip.startDate || '')}` : '선택 출장: 없음';
    }
  }
  function openHelpModal(){
    $('#helpModal')?.classList.remove('hidden');
    $('#helpModal')?.setAttribute('aria-hidden','false');
  }
  function closeHelpModal(){
    $('#helpModal')?.classList.add('hidden');
    $('#helpModal')?.setAttribute('aria-hidden','true');
  }
  function bindGlobalUI(){
    $('#helpOpenBtn')?.addEventListener('click', openHelpModal);
    $('#helpCloseBtn')?.addEventListener('click', closeHelpModal);
    $('#helpCloseTopBtn')?.addEventListener('click', closeHelpModal);
    $('#helpModal')?.addEventListener('click', (e) => {
      if(e.target.id === 'helpModal') closeHelpModal();
    });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') closeHelpModal();
    });
    window.addEventListener('beforeunload', (e) => {
      if(!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    });
    updateTopIndicators();
  }
  function validateSettlement(settlement){
    const issues = [];
    if(!settlement) return issues;
    if(!String(settlement.name || '').trim()) issues.push('성명이 비어 있습니다.');
    if(!String(settlement.position || '').trim()) issues.push('직급이 비어 있습니다.');
    if(!String(settlement.startDate || '').trim()) issues.push('시작일이 비어 있습니다.');
    if(!String(settlement.destination || '').trim()) issues.push('출장지가 비어 있습니다.');
    if(!String(settlement.movementMode || '').trim()) issues.push('출장지 옆의 이동구분에서 자가용 또는 대중교통을 선택해 주세요.');
    if(!String(settlement.routeType || '').trim()) issues.push('출장지 옆의 왕복/편도 구분을 선택해 주세요.');
    if(!String(settlement.mealProvidedFlag || '').trim()) issues.push('식사 제공 여부를 선택해 주세요.');
    if(!String(settlement.receiptMode || '').trim()) issues.push('영수증 처리 방식을 선택해 주세요.');
    if(settlement.status === 'done' && !String(settlement.settlementDate || '').trim()) issues.push('정산완료 상태인 경우 정산일자를 입력해 주세요.');
    (settlement.privateCars || []).forEach((row, idx) => {
      const hasAny = [row.date,row.from,row.to,row.km,row.fuel,row.toll,row.parking,row.other,row.manualAmount,row.driver,row.remark].some(v => String(v || '').trim() !== '');
      if(!hasAny) return;
      if(!String(row.from || '').trim()) issues.push(`자가용 ${idx+1}행의 출발지가 비어 있습니다.`);
      if(!String(row.to || '').trim()) issues.push(`자가용 ${idx+1}행의 도착지가 비어 있습니다.`);
    });
    (settlement.publicTransport || []).forEach((row, idx) => {
      const hasAny = [row.date,row.transport,row.from,row.to,row.grade,row.amount,row.remark].some(v => String(v || '').trim() !== '');
      if(!hasAny) return;
      if(!String(row.from || '').trim()) issues.push(`대중교통 ${idx+1}행의 출발지가 비어 있습니다.`);
      if(!String(row.to || '').trim()) issues.push(`대중교통 ${idx+1}행의 도착지가 비어 있습니다.`);
    });
    if(settlement.movementMode === 'private' && !(settlement.privateCars || []).length){
      issues.push('이동구분이 자가용인데 자가용 운임 행이 없습니다.');
    }
    if(settlement.movementMode === 'public' && !(settlement.publicTransport || []).length){
      issues.push('이동구분이 대중교통인데 대중교통 행이 없습니다.');
    }
    if(settlement.receiptMode === 'attached' && receiptsBySettlement(settlement.id).length === 0){
      issues.push('영수증을 프로그램에 첨부한다고 선택했지만, 첨부된 영수증이 없습니다.');
    }
    return issues;
  }

  async function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        STORES.forEach(store => {
          if(!db.objectStoreNames.contains(store)){
            db.createObjectStore(store, {keyPath:'id'});
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAll(storeName){
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbPut(storeName, value){
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbPutBulk(storeName, values){
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if(!items.length) return;
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('bulk put aborted'));
    });
  }
  async function dbDelete(storeName, id){
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbClear(storeName){
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadState(){
    state.db = await openDB();
    state.trips = (await dbGetAll('trips')).sort((a,b) => (b.startDate || '').localeCompare(a.startDate || ''));
    state.settlements = await dbGetAll('settlements');
    state.receipts = await dbGetAll('receipts');
    const settingsRows = await dbGetAll('settings');
    const saved = settingsRows.find(r => r.id === 'default');
    if(saved) state.settings = {...state.settings, ...saved.value};
    state.settlements = state.settlements.map(s => normalizeSettlementShape(s));
  }

  async function saveSettings(){
    await dbPut('settings', {id:'default', value: state.settings});
  }
  function renderSignaturePreview(){
    const box = $('#signaturePreviewBox');
    if(!box) return;
    box.innerHTML = state.settings.signatureDataUrl ? `<img src="${state.settings.signatureDataUrl}" alt="등록 서명">` : '<span class="small">등록된 서명이 없습니다.</span>';
  }
  async function handleSignatureFile(file){
    if(!file) return;
    if(!String(file.type || '').startsWith('image/')){
      alert('서명은 이미지 파일로 등록해 주세요.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      state.settings.signatureDataUrl = String(reader.result || '');
      renderSignaturePreview();
      await saveSettings();
      alert('서명이 등록되었습니다.');
    };
    reader.readAsDataURL(file);
  }

  function buildTabs(){
    const box = $('#tabs');
    box.innerHTML = tabs.map(t => `<button class="tab-btn ${t.id===state.activeTab?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('');
    $$('.tab-btn', box).forEach(btn => btn.addEventListener('click', () => {
      if(btn.dataset.tab === state.activeTab) return;
      if(!confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 다른 탭으로 이동할까요?')) return;
      state.activeTab = btn.dataset.tab;
      render();
    }));
  }

  function tripSettlement(tripId){
    return state.settlements.find(s => s.tripId === tripId);
  }
  function getTrip(id){ return state.trips.find(t => t.id === id); }
  function getSettlement(id){ return state.settlements.find(s => s.id === id); }
  function receiptsBySettlement(settlementId){ return state.receipts.filter(r => r.settlementId === settlementId); }
  function isPdfReceipt(item){
    const mime = String(item?.mimeType || '').toLowerCase();
    const name = String(item?.fileName || '').toLowerCase();
    return mime.includes('pdf') || name.endsWith('.pdf');
  }
  function receiptPreviewHtml(item){
    if(isPdfReceipt(item)){
      return `<div class="receipt-thumb pdf"><div class="pdf-mark">PDF</div><div class="pdf-name">${escapeHtml(item.fileName || 'document.pdf')}</div></div>`;
    }
    return `<img src="${item.dataUrl}" alt="receipt">`;
  }


  function parseMealProvidedSource(text){
    const raw = String(text || '').trim();
    if(!raw) return {flag:'', note:''};
    const compact = raw.replace(/\s+/g,'');
    if(/미제공|없음|x|×|no/i.test(compact)) return {flag:'no', note:raw};
    if(/제공|중식|석식|조식|식사/i.test(compact)) return {flag:'yes', note:raw};
    return {flag:'', note:raw};
  }
  function normalizePrivateCarRow(row){
    const next = {...row};
    if(next.autoManaged === undefined) next.autoManaged = false;
    delete next.roundTripChoice;
    return next;
  }
  function normalizePublicTransportRow(row){
    const next = {...row};
    if(next.autoManaged === undefined) next.autoManaged = false;
    return next;
  }
  function inferRouteType(settlement){
    const privateRows = (settlement?.privateCars || []).filter(row => [row.from,row.to,row.date,row.driver,row.remark,row.km,row.fuel,row.toll,row.parking,row.other,row.manualAmount].some(v => String(v || '').trim() !== ''));
    const publicRows = (settlement?.publicTransport || []).filter(row => [row.transport,row.from,row.to,row.grade,row.amount,row.remark,row.date].some(v => String(v || '').trim() !== ''));
    const hasMultiline = [...privateRows, ...publicRows].some(row => [row.from,row.to].some(v => String(v || '').includes('\n')));
    if(hasMultiline || privateRows.length >= 2 || publicRows.length >= 2) return 'round';
    if(privateRows.length === 1 || publicRows.length === 1) return 'oneway';
    return '';
  }
  function inferMovementMode(settlement){
    const hasPrivate = (settlement?.privateCars || []).some(row => !row.autoManaged || [row.km,row.fuel,row.toll,row.parking,row.other,row.manualAmount,row.driver,row.remark,row.from,row.to,row.date].some(v => String(v || '').trim() !== ''));
    const hasPublic = (settlement?.publicTransport || []).some(row => !row.autoManaged || [row.transport,row.from,row.to,row.grade,row.amount,row.remark,row.date].some(v => String(v || '').trim() !== ''));
    if(hasPrivate && !hasPublic) return 'private';
    if(hasPublic && !hasPrivate) return 'public';
    return '';
  }
  function buildRouteSegments(settlement){
    const workplace = String(settlement?.workplace || state.settings.defaultWorkplace || settlement?.dept || '').trim();
    const destination = String(settlement?.destination || '').trim();
    const routeType = String(settlement?.routeType || '').trim();
    if(!workplace && !destination) return [];
    if(routeType === 'round'){
      return [
        {from:workplace, to:destination, remark:'왕복'},
        {from:destination, to:workplace, remark:'왕복'}
      ];
    }
    if(routeType === 'oneway'){
      return [{from:workplace, to:destination, remark:''}];
    }
    return [];
  }
  function applyRouteToPrivateRow(row, settlement, segmentIndex=0){
    const segment = buildRouteSegments(settlement)[segmentIndex] || {from:'', to:'', remark:''};
    row.from = segment.from;
    row.to = segment.to;
    row.remark = segment.remark;
    row.date = settlement?.startDate || row.date || '';
    if(!String(row.driver || '').trim() || row.autoManaged) row.driver = settlement?.name || state.settings.defaultApplicant || '';
  }
  function applyRouteToPublicRow(row, settlement, segmentIndex=0){
    const segment = buildRouteSegments(settlement)[segmentIndex] || {from:'', to:'', remark:''};
    row.from = segment.from;
    row.to = segment.to;
    row.remark = segment.remark;
    row.date = settlement?.startDate || row.date || '';
  }
  function makePrivateCarRow(settlement, autoManaged=true){
    const row = {id:uid('pc'), date:settlement?.startDate || '', from:'', to:'', km:'', fuel:'', toll:'', parking:'', other:'', manualAmount:'', driver:settlement?.name || state.settings.defaultApplicant || '', remark:'', autoManaged};
    if(autoManaged) applyRouteToPrivateRow(row, settlement, 0);
    return row;
  }
  function makePublicTransportRow(settlement, autoManaged=true){
    const row = {id:uid('pt'), date:settlement?.startDate || '', transport:'', from:'', to:'', grade:'', amount:'', remark:'', autoManaged};
    if(autoManaged) applyRouteToPublicRow(row, settlement, 0);
    return row;
  }
  function pruneAutoManagedRowsByMovement(settlement){
    const mode = String(settlement?.movementMode || '').trim();
    settlement.privateCars = (settlement.privateCars || []).map(normalizePrivateCarRow);
    settlement.publicTransport = (settlement.publicTransport || []).map(normalizePublicTransportRow);
    if(mode === 'private'){
      settlement.publicTransport = settlement.publicTransport.filter(row => !row.autoManaged);
    }else if(mode === 'public'){
      settlement.privateCars = settlement.privateCars.filter(row => !row.autoManaged);
    }
  }
  function mergeAutoManagedRows(existingRows, settlement, mode){
    const segments = buildRouteSegments(settlement);
    const manualRows = (existingRows || []).filter(row => !row.autoManaged);
    const autoRows = (existingRows || []).filter(row => row.autoManaged);
    const nextAutoRows = segments.map((segment, idx) => {
      const row = mode === 'private'
        ? normalizePrivateCarRow(autoRows[idx] || makePrivateCarRow(settlement, true))
        : normalizePublicTransportRow(autoRows[idx] || makePublicTransportRow(settlement, true));
      row.autoManaged = true;
      if(mode === 'private') applyRouteToPrivateRow(row, settlement, idx);
      else applyRouteToPublicRow(row, settlement, idx);
      return row;
    });
    return [...nextAutoRows, ...manualRows];
  }
  function ensureTransportRowsForRoute(settlement){
    if(!settlement || !String(settlement.routeType || '').trim() || !String(settlement.movementMode || '').trim()) return;
    pruneAutoManagedRowsByMovement(settlement);
    if(settlement.movementMode === 'private'){
      settlement.privateCars = mergeAutoManagedRows(settlement.privateCars, settlement, 'private');
    }
    if(settlement.movementMode === 'public'){
      settlement.publicTransport = mergeAutoManagedRows(settlement.publicTransport, settlement, 'public');
    }
  }
  function normalizeSettlementShape(settlement){
    if(!settlement) return settlement;
    const meal = parseMealProvidedSource(settlement.mealProvided);
    if(!settlement.mealProvidedFlag) settlement.mealProvidedFlag = meal.flag;
    if(settlement.mealProvidedNote === undefined) settlement.mealProvidedNote = meal.note;
    if(settlement.receiptMode === undefined || settlement.receiptMode === null){
      settlement.receiptMode = receiptsBySettlement(settlement.id).length ? 'attached' : '';
    }
    if(settlement.includeReceiptIndex === undefined || settlement.includeReceiptIndex === null) settlement.includeReceiptIndex = false;
    if(settlement.settlementDate === undefined || settlement.settlementDate === null) settlement.settlementDate = '';
    if(!settlement.movementMode) settlement.movementMode = inferMovementMode(settlement);
    if(!settlement.routeType) settlement.routeType = inferRouteType(settlement);
    settlement.privateCars = (settlement.privateCars || []).map(normalizePrivateCarRow);
    settlement.publicTransport = (settlement.publicTransport || []).map(normalizePublicTransportRow);
    if(settlement.workplace === undefined || settlement.workplace === null) settlement.workplace = state.settings.defaultWorkplace || '';
    if(!settlement.position) settlement.position = state.settings.defaultPosition || settlement.position || '';
    if(!settlement.name) settlement.name = state.settings.defaultApplicant || settlement.name || '';
    return settlement;
  }
  function mealProvidedLabel(settlement){
    const note = String(settlement?.mealProvidedNote || '').trim();
    if(settlement?.mealProvidedFlag === 'yes') return note || '식사 제공';
    if(settlement?.mealProvidedFlag === 'no') return note || '식사 미제공';
    return note || settlement?.mealProvided || '';
  }
  function receiptModeLabel(mode, count=0){
    if(mode === 'attached') return `영수증 ${count}부 첨부`;
    if(mode === 'none') return '영수증 없음';
    if(mode === 'separate') return '영수증 별도 제출';
    return '';
  }

  function calcPrivateCarRow(row){
    const auto = asNum(row.km) * asNum(state.settings.kmRate) + asNum(row.fuel) + asNum(row.toll) + asNum(row.parking) + asNum(row.other);
    return row.manualAmount ? asNum(row.manualAmount) : auto;
  }
  function calcSettlementTotal(s){
    const lodging = asNum(s.lodgingActual);
    const privateTotal = (s.privateCars || []).reduce((sum,row) => sum + calcPrivateCarRow(row), 0);
    const publicTotal = (s.publicTransport || []).reduce((sum,row) => sum + asNum(row.amount), 0);
    const other = asNum(s.otherExpense);
    return lodging + privateTotal + publicTotal + other;
  }
  function getSettlementDeadlineInfo(settlement){
    if(!settlement || settlement.status === 'exempt') return null;
    const baseDate = settlement.endDate || settlement.startDate || '';
    if(!baseDate) return null;
    const dueDate = addDays(baseDate, 5);
    const enteredDate = String(settlement.settlementDate || '').trim();
    const todayStr = today();
    const overdueByToday = settlement.status !== 'done' && todayStr > dueDate;
    const lateByEnteredDate = !!enteredDate && enteredDate > dueDate;
    const remainingDays = diffDays(todayStr, dueDate);
    const overdueDays = todayStr > dueDate ? diffDays(dueDate, todayStr) : 0;
    let shortLabel = `기한 ${ymdToKorean(dueDate)}`;
    let message = `정산기한은 ${ymdToKorean(dueDate)}입니다. (출장 종료일 기준 5일 이내)`;
    let tone = 'ok';
    let warning = false;

    if(settlement.status === 'done'){
      if(!enteredDate){
        shortLabel = '정산일자 확인 필요';
        message = `정산완료 상태입니다. 실제 정산일자를 입력하면 기한(${ymdToKorean(dueDate)}) 준수 여부를 함께 확인할 수 있습니다.`;
        tone = 'soon';
      }else if(lateByEnteredDate){
        shortLabel = `기한 경과 (${diffDays(dueDate, enteredDate)}일)`;
        message = `입력한 정산일자 ${ymdToKorean(enteredDate)}가 기한 ${ymdToKorean(dueDate)}을 넘었습니다.`;
        tone = 'warning';
        warning = true;
      }else{
        shortLabel = `정산 ${ymdToKorean(enteredDate)}`;
        message = `정산일자 ${ymdToKorean(enteredDate)}로 기한 ${ymdToKorean(dueDate)} 이내 처리되었습니다.`;
      }
      return {baseDate, dueDate, enteredDate, overdueByToday:false, lateByEnteredDate, remainingDays, overdueDays, shortLabel, message, tone, warning};
    }

    if(enteredDate && lateByEnteredDate){
      shortLabel = `예정일 초과 (${diffDays(dueDate, enteredDate)}일)`;
      message = `입력한 정산일자 ${ymdToKorean(enteredDate)}가 기한 ${ymdToKorean(dueDate)}을 넘습니다. 다른 출장으로 지연되는 경우에도 정산일을 확인해 주세요.`;
      tone = 'warning';
      warning = true;
    }else if(overdueByToday){
      shortLabel = `기한 경과 (${overdueDays}일)`;
      message = `여비정산 기한이 지났습니다. 기한은 ${ymdToKorean(dueDate)}이며, 오늘 기준 ${overdueDays}일 경과했습니다.`;
      tone = 'warning';
      warning = true;
    }else if(enteredDate){
      shortLabel = `정산예정 ${ymdToKorean(enteredDate)}`;
      message = `입력한 정산일자 ${ymdToKorean(enteredDate)} 기준으로 기한 ${ymdToKorean(dueDate)} 이내입니다.`;
      tone = remainingDays <= 1 ? 'soon' : 'ok';
    }else{
      shortLabel = remainingDays >= 0 ? `기한까지 ${remainingDays}일` : `기한 ${ymdToKorean(dueDate)}`;
      message = `정산기한은 ${ymdToKorean(dueDate)}입니다. (출장 종료일 기준 5일 이내)`;
      tone = remainingDays <= 1 ? 'soon' : 'ok';
    }
    return {baseDate, dueDate, enteredDate, overdueByToday, lateByEnteredDate, remainingDays, overdueDays, shortLabel, message, tone, warning};
  }
  function settlementStatusLabel(s){
    if(!s) return '미정산';
    if(state.ui.dirty && state.ui.dirtySettlementId === s.id) return '작성중';
    const deadline = getSettlementDeadlineInfo(s);
    if(s.status === 'done') return '정산완료';
    if(s.status === 'exempt') return '정산불요';
    if(deadline?.warning) return '기한경과';
    return '미정산';
  }
  function settlementBadgeClass(s){
    if(!s) return 'wait';
    if(state.ui.dirty && state.ui.dirtySettlementId === s.id) return 'work';
    const deadline = getSettlementDeadlineInfo(s);
    if(s.status === 'done') return 'done';
    if(s.status === 'exempt') return 'exempt';
    if(deadline?.warning) return 'overdue';
    return 'wait';
  }
  function settlementAutoNote(trip){
    const notes = [];
    if(trip.tripType) notes.push(`출장종류: ${trip.tripType}`);
    if(trip.vehicleUse) notes.push(`공용차량 이용여부: ${trip.vehicleUse}`);
    if(trip.approvalStatus) notes.push(`결재상태: ${trip.approvalStatus}`);
    if(trip.durationText) notes.push(`원본 기간표시: ${trip.durationText}`);
    if(trip.settlementRequired === false) notes.push('원본 출장목적에 "여비부지급" 문구가 있어 정산 상태를 정산불요로 두었습니다.');
    return notes.join('\n');
  }

  function createDefaultSettlementFromTrip(trip){
    const rangeText = [trip.startDate ? ymdToKorean(trip.startDate) : '', trip.startTime || '', trip.endDate ? ymdToKorean(trip.endDate) : '', trip.endTime || ''].filter(Boolean).join(' ');
    const autoNote = settlementAutoNote(trip);
    const privateCars = [];
    return {
      id: uid('sett'),
      tripId: trip.id,
      dept: trip.dept || state.settings.orgName,
      workplace: state.settings.defaultWorkplace || '',
      position: trip.position || state.settings.defaultPosition || '',
      name: trip.name || state.settings.defaultApplicant || '',
      coTravelers: trip.coTravelers || '',
      startDate: trip.startDate || '',
      startTime: trip.startTime || '',
      endDate: trip.endDate || trip.startDate || '',
      endTime: trip.endTime || '',
      destination: trip.destination || '',
      purpose: trip.purpose || '',
      mealProvided: trip.mealProvided || '',
      mealProvidedFlag: parseMealProvidedSource(trip.mealProvided || '').flag,
      mealProvidedNote: parseMealProvidedSource(trip.mealProvided || '').note,
      movementMode: '',
      routeType: '',
      receiptMode: '',
      includeReceiptIndex: false,
      settlementDate: '',
      lodgingAdvance: '',
      lodgingActual: '',
      lodgingFriendNights: '',
      lodgingSharedNights: '',
      lodgingOverReason: '',
      applicantNote: autoNote,
      otherExpense: '',
      privateCars,
      publicTransport: [],
      status: trip.settlementRequired === false ? 'exempt' : 'draft',
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
      rangeText,
      tripType: trip.tripType || '',
      vehicleUse: trip.vehicleUse || '',
      approvalStatus: trip.approvalStatus || ''
    };
  }

  async function ensureSettlementForTrip(tripId){
    let settlement = tripSettlement(tripId);
    if(!settlement){
      const trip = getTrip(tripId);
      settlement = createDefaultSettlementFromTrip(trip);
      state.settlements.push(settlement);
      await dbPut('settlements', settlement);
    }
    return settlement;
  }

  function filteredTrips(){
    const kw = state.tripFilter.trim();
    let rows = [...state.trips];
    if(state.dayFilter){
      rows = rows.filter(t => dateInRange(state.dayFilter, t.startDate, t.endDate));
    }
    if(kw){
      rows = rows.filter(t => [t.name,t.position,t.purpose,t.destination,t.dept,t.startDate].join(' ').includes(kw));
    }
    return rows;
  }

  function renderDashboard(){
    const totalTrips = state.trips.length;
    const completed = state.settlements.filter(s => s.status === 'done').length;
    const exemptCount = state.settlements.filter(s => s.status === 'exempt').length;
    const pending = state.trips.filter(t => {
      const s = tripSettlement(t.id);
      return !s || s.status === 'draft';
    }).length;
    const overdueCount = state.settlements.filter(s => {
      const info = getSettlementDeadlineInfo(s);
      return !!(info && s.status !== 'done' && info.warning);
    }).length;
    const receiptCount = state.receipts.length;

    const byPerson = {};
    state.trips.forEach(t => {
      const key = t.name || '미지정';
      if(!byPerson[key]) byPerson[key] = {count:0, done:0, pending:0, exempt:0};
      byPerson[key].count += 1;
      const s = tripSettlement(t.id);
      if(s && s.status === 'done') byPerson[key].done += 1;
      else if(s && s.status === 'exempt') byPerson[key].exempt += 1;
      else byPerson[key].pending += 1;
    });

    const recent = [...state.trips].sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||'')).slice(0,8);

    $('#tab-dashboard').innerHTML = `
      <div class="stack-layout">
        <div class="stats">
          <div class="stat"><div class="label">총 출장 건수</div><div class="value">${totalTrips}</div><small>등록된 출장</small></div>
          <div class="stat"><div class="label">정산 완료</div><div class="value">${completed}</div><small>상태값 기준</small></div>
          <div class="stat"><div class="label">정산 불요</div><div class="value">${exemptCount}</div><small>여비부지급 등</small></div>
          <div class="stat"><div class="label">미정산</div><div class="value">${pending}</div><small>정산 필요</small></div>
          <div class="stat"><div class="label">기한 경과</div><div class="value">${overdueCount}</div><small>종료일+5일 기준</small></div>
          <div class="stat"><div class="label">첨부 영수증</div><div class="value">${receiptCount}</div><small>이미지·PDF 기준</small></div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="toolbar">
              <h2>최근 출장</h2>
              <div class="btn-row">
                <button class="btn secondary" id="goImportBtn">출장 가져오기</button>
                <button class="btn" id="goSettlementBtn">여비정산으로 이동</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>일자</th><th>성명</th><th>직급</th><th>출장목적</th><th>출장지</th><th>정산상태</th>
                  </tr>
                </thead>
                <tbody>
                  ${recent.length ? recent.map(t => {
                    const s = tripSettlement(t.id);
                    const deadline = getSettlementDeadlineInfo(s);
                    return `<tr data-trip-id="${t.id}" class="jump-settlement">
                      <td>${escapeHtml(ymdToKorean(t.startDate))}</td>
                      <td>${escapeHtml(t.name)}</td>
                      <td>${escapeHtml(t.position)}</td>
                      <td>${escapeHtml(t.purpose)}</td>
                      <td>${escapeHtml(t.destination)}</td>
                      <td><span class="badge ${settlementBadgeClass(s)}">${settlementStatusLabel(s)}</span>${deadline ? `<div class="small" style="margin-top:4px">${escapeHtml(deadline.shortLabel)}</div>` : ''}</td>
                    </tr>`;
                  }).join('') : `<tr><td colspan="6" class="center muted">등록된 출장 데이터가 없습니다.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h2>개인별 현황</h2>
            <div class="table-wrap">
              <table>
                <thead><tr><th>성명</th><th class="right">출장</th><th class="right">완료</th><th class="right">불요</th><th class="right">미정산</th></tr></thead>
                <tbody>
                  ${Object.entries(byPerson).length ? Object.entries(byPerson).sort((a,b)=>b[1].count-a[1].count).map(([name,v])=>`
                    <tr><td>${escapeHtml(name)}</td><td class="right">${v.count}</td><td class="right">${v.done}</td><td class="right">${v.exempt}</td><td class="right">${v.pending}</td></tr>
                  `).join('') : `<tr><td colspan="5" class="center muted">아직 출장 데이터가 없습니다.</td></tr>`}
                </tbody>
              </table>
            </div>
            <div class="divider"></div>
            <div class="notice">
              이 프로그램은 업로드한 출장 데이터를 기준으로 여비정산 초안을 만들고, 영수증과 일정을 함께 관리하도록 설계했습니다.
              기관별 실제 여비 계산 규정이 다르면 하단 설정값과 정산서 필드를 보정하여 사용하면 됩니다.
            </div>
          </div>
        </div>
      </div>
    `;

    $('#goImportBtn')?.addEventListener('click', () => {
      if(!confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 출장 가져오기 탭으로 이동할까요?')) return;
      state.activeTab='import'; render();
    });
    $('#goSettlementBtn')?.addEventListener('click', () => {
      if(!confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 여비정산 탭으로 이동할까요?')) return;
      state.activeTab='settlement'; render();
    });
    $$('.jump-settlement').forEach(row => row.addEventListener('click', async () => {
      const tripId = row.dataset.tripId;
      if(tripId !== state.selectedTripId && !confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 다른 출장건으로 이동할까요?')) return;
      const s = await ensureSettlementForTrip(tripId);
      state.selectedTripId = tripId;
      state.selectedSettlementId = s.id;
      state.activeTab = 'settlement';
      clearDirtyIfMatches(state.selectedSettlementId);
      render();
    }));
  }

  function renderImport(){
    $('#tab-import').innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h2>출장신청 데이터 가져오기</h2>
          <div class="notice">
            일반적인 출장신청 엑셀도 읽을 수 있지만, 이번에 올려주신 <b>출장 목록 그리드</b> 형식도 바로 인식하도록 보강했습니다.<br>
            <b>부서 / 신청자 / 출장종류 / 출장지 / 출장목적 / 출장기간 / 결재상태 / 삭제여부</b> 열을 우선 인식하고,
            <b>삭제건</b>과 <b>미완결 결재건</b>은 가져오기에서 자동 제외합니다.
          </div>
          <div class="form-grid" style="margin-top:12px">
            <div class="full">
              <label>출장신청 엑셀 업로드(.xlsx / .xlsm / .xls)</label>
              <input type="file" id="tripExcelFile" accept=".xlsx,.xlsm,.xls,.csv" />
            </div>
            <div>
              <label>기본 소속</label>
              <input type="text" id="settingsOrgName" value="${escapeHtml(state.settings.orgName)}" />
            </div>
            <div>
              <label>기본 근무지(자가용 출발지 기준)</label>
              <input type="text" id="settingsDefaultWorkplace" value="${escapeHtml(state.settings.defaultWorkplace || '')}" placeholder="예: 제천교육지원청" />
            </div>
            <div>
              <label>기본 직위(직급)</label>
              <input type="text" id="settingsDefaultPosition" value="${escapeHtml(state.settings.defaultPosition)}" />
            </div>
            <div>
              <label>기본 성명</label>
              <input type="text" id="settingsDefaultApplicant" value="${escapeHtml(state.settings.defaultApplicant)}" />
            </div>
            <div>
              <label>자가용 km 단가(원)</label>
              <input type="number" id="settingsKmRate" value="${escapeHtml(state.settings.kmRate)}" />
            </div>
            <div class="full">
              <label>서명 등록(출력 시 신청인 서명란 반영)</label>
              <div class="signature-box">
                <div class="signature-preview" id="signaturePreviewBox">${state.settings.signatureDataUrl ? `<img src="${state.settings.signatureDataUrl}" alt="등록 서명">` : '<span class="small">등록된 서명이 없습니다.</span>'}</div>
                <input type="file" id="signatureFile" accept="image/*" />
                <button type="button" class="btn secondary" id="clearSignatureBtn">서명 삭제</button>
              </div>
            </div>
          </div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn" id="saveSettingsBtn">기본값 저장</button>
            <button class="btn secondary" id="manualAddToggleBtn">수동 등록 열기</button>
          </div>

          <div id="manualTripBox" class="card hidden" style="margin-top:14px;background:#f8fbff">
            <h3>출장 수동 등록</h3>
            <div class="form-grid">
              <div><label>소속</label><input type="text" id="mDept" value="${escapeHtml(state.settings.orgName)}"></div>
              <div><label>직급</label><input type="text" id="mPosition" value="${escapeHtml(state.settings.defaultPosition || '')}"></div>
              <div><label>성명</label><input type="text" id="mName" value="${escapeHtml(state.settings.defaultApplicant || '')}"></div>
              <div><label>복수출장자</label><input type="text" id="mCoTravelers" placeholder="예: 홍길동, 김철수"></div>
              <div><label>근무지</label><input type="text" id="mWorkplace" value="${escapeHtml(state.settings.defaultWorkplace || '')}" placeholder="예: 제천교육지원청"></div>
              <div><label>시작일</label><input type="date" id="mStartDate" value="${today()}"></div>
              <div><label>시작시간</label><input type="time" id="mStartTime" value="09:00"></div>
              <div><label>종료일</label><input type="date" id="mEndDate" value="${today()}"></div>
              <div><label>종료시간</label><input type="time" id="mEndTime" value="18:00"></div>
              <div class="full"><label>출장지</label><input type="text" id="mDestination"></div>
              <div class="full"><label>출장목적</label><textarea id="mPurpose"></textarea></div>
              <div><label>식사 제공 여부</label><select id="mMealsFlag"><option value="">선택</option><option value="yes">제공</option><option value="no">미제공</option></select></div>
              <div class="full"><label>식사 제공 비고</label><input type="text" id="mMeals" placeholder="예: 중식 1식 제공 / 식사 미제공"></div>
            </div>
            <div class="btn-row" style="margin-top:12px">
              <button class="btn ok" id="manualSaveBtn">수동 출장 저장</button>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>가져오기 결과</h2>
          ${state.importWarnings.length ? `<div class="notice" style="margin-bottom:10px">${state.importWarnings.map(v=>`- ${escapeHtml(v)}`).join('<br>')}</div>` : `<div class="info">업로드한 파일을 읽으면 미리보기가 여기 표시됩니다.</div>`}
          <div class="table-wrap" style="margin-top:10px">
            <table>
              <thead>
                <tr><th>부서</th><th>성명</th><th>출장종류</th><th>출장일시</th><th>출장지</th><th>결재</th><th>출장목적</th></tr>
              </thead>
              <tbody>
                ${state.importPreview.length ? state.importPreview.map(r => `
                  <tr>
                    <td>${escapeHtml(r.dept)}</td>
                    <td>${escapeHtml(r.name)}</td>
                    <td>${escapeHtml(r.tripType || '')}</td>
                    <td>${escapeHtml(formatDateTime(r.startDate, r.startTime))}${r.endDate && (r.endDate !== r.startDate || r.endTime !== r.startTime) ? ` ~ ${escapeHtml(formatDateTime(r.endDate, r.endTime))}`:''}</td>
                    <td>${escapeHtml(r.destination)}</td>
                    <td>${escapeHtml(r.approvalStatus || '')}</td>
                    <td>${escapeHtml(r.purpose)}</td>
                  </tr>
                `).join('') : `<tr><td colspan="7" class="center muted">미리보기 데이터가 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ok" id="importSaveBtn" ${state.importPreview.length ? '' : 'disabled'}>가져온 출장 저장</button>
            <button class="btn secondary" id="importClearBtn">미리보기 비우기</button>
          </div>
          <div class="info" style="margin-top:10px">"신청자" 열은 출장자 이름으로 사용하고, "출장인원"은 복수출장자 정보로 메모합니다. 원본에 개인별 명단이 없으면 동행자 이름은 자동 분리되지 않습니다.</div>
        </div>
      </div>
    `;

    $('#tripExcelFile')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if(file) parseTripExcel(file);
    });
    $('#saveSettingsBtn')?.addEventListener('click', async () => {
      state.settings.orgName = $('#settingsOrgName').value.trim();
      state.settings.defaultWorkplace = $('#settingsDefaultWorkplace').value.trim();
      state.settings.defaultPosition = $('#settingsDefaultPosition').value.trim();
      state.settings.defaultApplicant = $('#settingsDefaultApplicant').value.trim();
      state.settings.kmRate = asNum($('#settingsKmRate').value);
      await saveSettings();
      alert('기본값을 저장했습니다.');
    });
    $('#signatureFile')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      await handleSignatureFile(file);
      e.target.value = '';
    });
    $('#clearSignatureBtn')?.addEventListener('click', async () => {
      if(!state.settings.signatureDataUrl){
        alert('등록된 서명이 없습니다.');
        return;
      }
      if(!confirm('등록된 서명을 삭제할까요?')) return;
      state.settings.signatureDataUrl = '';
      renderSignaturePreview();
      await saveSettings();
    });
    $('#manualAddToggleBtn')?.addEventListener('click', () => $('#manualTripBox').classList.toggle('hidden'));
    $('#manualSaveBtn')?.addEventListener('click', async () => {
      const trip = {
        id: uid('trip'),
        dept: $('#mDept').value.trim(),
        workplace: $('#mWorkplace').value.trim(),
        position: $('#mPosition').value.trim(),
        name: $('#mName').value.trim(),
        coTravelers: $('#mCoTravelers').value.trim(),
        startDate: $('#mStartDate').value,
        startTime: $('#mStartTime').value,
        endDate: $('#mEndDate').value,
        endTime: $('#mEndTime').value,
        destination: $('#mDestination').value.trim(),
        purpose: $('#mPurpose').value.trim(),
        mealProvided: $('#mMeals').value.trim(),
        mealProvidedFlag: $('#mMealsFlag').value,
        mealProvidedNote: $('#mMeals').value.trim(),
        source: 'manual',
        createdAt: nowStamp(),
        updatedAt: nowStamp()
      };
      if(!trip.name || !trip.startDate || !trip.destination || !trip.mealProvidedFlag){
        alert('성명, 시작일, 출장지, 식사 제공 여부는 입력해 주세요.');
        return;
      }
      state.trips.unshift(trip);
      await dbPut('trips', trip);
      const settlement = createDefaultSettlementFromTrip(trip);
      state.settlements.push(settlement);
      await dbPut('settlements', settlement);
      state.selectedTripId = trip.id;
      state.selectedSettlementId = settlement.id;
      markSaved(settlement);
      alert('출장과 정산 초안을 저장했습니다.');
      state.activeTab = 'settlement';
      render();
    });
    $('#importSaveBtn')?.addEventListener('click', saveImportedTrips);
    $('#importClearBtn')?.addEventListener('click', () => {
      state.importPreview = [];
      state.importWarnings = [];
      renderImport();
    });
  }

  function guessHeaderMapping(headerRow){
    const aliases = {
      orderNo: ['순번'],
      dept: ['소속','부서','기관','담당부서'],
      sourceDept: ['신청당시부서'],
      position: ['직급','직위'],
      name: ['성명','이름','출장자','직원명','신청자'],
      purpose: ['출장목적','목적','업무내용','출장내용'],
      period: ['출장기간','출장일시','일정','출장기간시각'],
      durationText: ['일수기간','일수/기간','기간'],
      startDate: ['시작일','출발일','출장시작일','출장일자','일자'],
      startTime: ['시작시간','출발시간'],
      endDate: ['종료일','도착일','출장종료일'],
      endTime: ['종료시간','도착시간'],
      destination: ['출장지','장소','방문지','도착지'],
      mealProvided: ['식사제공여부','식사제공','중식제공','제공식'],
      signer: ['서명또는날인','서명','날인'],
      coTravelers: ['복수출장자','동행자','동행출장자','출장인원'],
      tripType: ['출장종류'],
      vehicleUse: ['공용차량이용여부','공용차량_x000d_이용여부','공용차량'],
      approvalStatus: ['결재상태','승인상태'],
      deleteStatus: ['삭제여부']
    };
    const normalized = headerRow.map(normalizeText);
    const mapping = {};
    Object.entries(aliases).forEach(([key, arr]) => {
      const idx = normalized.findIndex(h => arr.some(a => h.includes(normalizeText(a))));
      if(idx >= 0) mapping[key] = idx;
    });
    return mapping;
  }

  function detectHeaderRow(rows){
    let best = {rowIndex:-1, score:-1, mapping:{}};
    for(let i=0;i<Math.min(rows.length, 20);i++){
      const row = rows[i].map(v => String(v ?? '').trim());
      const mapping = guessHeaderMapping(row);
      const score = Object.keys(mapping).length;
      if(score > best.score){
        best = {rowIndex:i, score, mapping};
      }
    }
    return best.score >= 4 ? best : null;
  }

  function extractCompanionInfo(raw, applicantName){
    const s = String(raw || '').trim();
    if(!s) return '';
    if(!applicantName) return s;
    if(s === applicantName) return '';
    if(s.includes(applicantName) && /외\s*\d+\s*명/.test(s)) return s;
    return s;
  }
  function isDeletedTrip(trip){
    const s = String(trip.deleteStatus || '').trim();
    return s && !/^미삭제$/i.test(s);
  }
  function isApprovedTrip(trip){
    const s = String(trip.approvalStatus || '').trim();
    if(!s) return true;
    return /완결|승인|결재완료/.test(s);
  }
  function needsSettlement(trip){
    return !/여비\s*부지급|정산\s*불요|여비없음/.test(String(trip.purpose || ''));
  }

  function rowToTrip(row, mapping, fileName){
    const rawPeriod = mapping.period !== undefined ? row[mapping.period] : '';
    const p = extractPeriodInfo(rawPeriod);
    const startDate = mapping.startDate !== undefined ? (maybeDate(row[mapping.startDate]) || p.startDate) : p.startDate;
    const endDate = mapping.endDate !== undefined ? (maybeDate(row[mapping.endDate]) || p.endDate || startDate) : (p.endDate || startDate);
    const startTime = mapping.startTime !== undefined ? (maybeTime(row[mapping.startTime]) || p.startTime) : p.startTime;
    const endTime = mapping.endTime !== undefined ? (maybeTime(row[mapping.endTime]) || p.endTime) : p.endTime;
    const name = mapping.name !== undefined ? String(row[mapping.name] || '').trim() : '';
    const coTravelersRaw = mapping.coTravelers !== undefined ? String(row[mapping.coTravelers] || '').trim() : '';

    const trip = {
      id: uid('trip'),
      orderNo: mapping.orderNo !== undefined ? String(row[mapping.orderNo] || '').trim() : '',
      dept: mapping.dept !== undefined ? String(row[mapping.dept] || '').trim() : state.settings.orgName,
      sourceDept: mapping.sourceDept !== undefined ? String(row[mapping.sourceDept] || '').trim() : '',
      position: mapping.position !== undefined ? String(row[mapping.position] || '').trim() : state.settings.defaultPosition,
      name,
      coTravelers: extractCompanionInfo(coTravelersRaw, name),
      startDate,
      startTime,
      endDate,
      endTime,
      destination: mapping.destination !== undefined ? String(row[mapping.destination] || '').trim() : '',
      purpose: mapping.purpose !== undefined ? String(row[mapping.purpose] || '').trim() : '',
      mealProvided: mapping.mealProvided !== undefined ? String(row[mapping.mealProvided] || '').trim() : '',
      signer: mapping.signer !== undefined ? String(row[mapping.signer] || '').trim() : '',
      tripType: mapping.tripType !== undefined ? String(row[mapping.tripType] || '').trim() : '',
      vehicleUse: mapping.vehicleUse !== undefined ? String(row[mapping.vehicleUse] || '').trim() : '',
      approvalStatus: mapping.approvalStatus !== undefined ? String(row[mapping.approvalStatus] || '').trim() : '',
      deleteStatus: mapping.deleteStatus !== undefined ? String(row[mapping.deleteStatus] || '').trim() : '',
      durationText: mapping.durationText !== undefined ? String(row[mapping.durationText] || '').trim() : '',
      source: fileName,
      createdAt: nowStamp(),
      updatedAt: nowStamp()
    };
    trip.settlementRequired = needsSettlement(trip);
    return trip;
  }

  async function parseTripExcel(file){
    if(typeof XLSX === 'undefined'){
      alert('엑셀 파서가 아직 준비되지 않았습니다. 인터넷 연결 후 다시 시도해 주세요.');
      return;
    }
    state.importWarnings = [];
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, {type:'array', cellDates:true});
    const firstSheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:false});
    const detected = detectHeaderRow(rows);
    if(!detected){
      state.importPreview = [];
      state.importWarnings = ['헤더 행을 찾지 못했습니다. 상단 20행 안에 "성명, 출장목적, 출장기간/일시, 출장지"가 포함되어 있는지 확인해 주세요.'];
      renderImport();
      return;
    }

    const preview = [];
    let blankStreak = 0;
    for(let i = detected.rowIndex + 1; i < rows.length; i++){
      const row = rows[i];
      if(!row || row.every(v => String(v ?? '').trim() === '')){
        blankStreak++;
        if(blankStreak >= 3) break;
        continue;
      }
      blankStreak = 0;
      const trip = rowToTrip(row, detected.mapping, file.name);
      if(!trip.name && !trip.purpose && !trip.destination) continue;
      if(!trip.name){
        state.importWarnings.push(`${i+1}행: 신청자/성명이 비어 있어 건너뜀`);
        continue;
      }
      if(!trip.startDate && !trip.destination) continue;
      if(isDeletedTrip(trip)){
        state.importWarnings.push(`${i+1}행: 삭제여부가 "${trip.deleteStatus}"라서 제외`);
        continue;
      }
      if(!isApprovedTrip(trip)){
        state.importWarnings.push(`${i+1}행: 결재상태가 "${trip.approvalStatus}"라서 제외`);
        continue;
      }
      if(trip.settlementRequired === false){
        state.importWarnings.push(`${i+1}행: 출장목적에 여비부지급 문구가 있어 정산불요로 표시`);
      }
      preview.push(trip);
    }
    state.importPreview = preview;
    if(!preview.length){
      state.importWarnings.push('인식된 출장 행이 없습니다.');
    }
    renderImport();
  }

  async function saveImportedTrips(){
    let savedCount = 0;
    const newTrips = [];
    const newSettlements = [];
    for(const trip of state.importPreview){
      const exists = state.trips.some(t =>
        t.name === trip.name &&
        t.startDate === trip.startDate &&
        t.destination === trip.destination &&
        t.purpose === trip.purpose
      );
      if(exists) continue;
      state.trips.push(trip);
      newTrips.push(trip);
      const settlement = createDefaultSettlementFromTrip(trip);
      state.settlements.push(settlement);
      newSettlements.push(settlement);
      savedCount++;
    }
    await dbPutBulk('trips', newTrips);
    await dbPutBulk('settlements', newSettlements);
    state.trips.sort((a,b) => (b.startDate || '').localeCompare(a.startDate || ''));
    alert(`${savedCount}건을 저장했습니다.`);
    if(savedCount){ state.ui.lastSavedAt = nowStamp(); updateTopIndicators(); }
    state.importPreview = [];
    state.importWarnings = [];
    render();
  }

  function currentSettlement(){
    if(state.selectedSettlementId){
      const s = getSettlement(state.selectedSettlementId);
      if(s) return normalizeSettlementShape(s);
    }
    if(state.selectedTripId){
      return normalizeSettlementShape(tripSettlement(state.selectedTripId));
    }
    if(state.trips[0]){
      const t = state.trips[0];
      state.selectedTripId = t.id;
      const s = tripSettlement(t.id);
      if(s) state.selectedSettlementId = s.id;
      return normalizeSettlementShape(s);
    }
    return null;
  }

  function makeTripListHtml(rows){
    return rows.length ? rows.map(t => {
      const s = tripSettlement(t.id);
      const deadline = getSettlementDeadlineInfo(s);
      return `
        <div class="list-item ${t.id === state.selectedTripId ? 'active':''}" data-trip-id="${t.id}">
          <div class="title">${escapeHtml(t.name || '미상')} · ${escapeHtml(ymdToKorean(t.startDate))}</div>
          <div class="meta">${escapeHtml(t.position || '')} | ${escapeHtml(t.destination || '')}</div>
          <div class="meta">${escapeHtml(t.purpose || '')}</div>
          ${deadline ? `<div class="meta">${escapeHtml(deadline.shortLabel)}</div>` : ''}
          <div style="margin-top:8px"><span class="badge ${settlementBadgeClass(s)}">${settlementStatusLabel(s)}</span></div>
        </div>
      `;
    }).join('') : `<div class="list-item"><div class="meta">등록된 출장이 없습니다.</div></div>`;
  }

  function syncSettlementFromForm(settlement){
    if(!settlement) return;
    const radioTouched = new Set();
    $$('[data-field]').forEach(el => {
      const key = el.dataset.field;
      if(!key) return;
      if(el.type === 'radio'){
        radioTouched.add(key);
        if(el.checked) settlement[key] = el.value;
        return;
      }
      settlement[key] = el.value;
    });
    radioTouched.forEach(key => {
      if(!$$(`[data-field="${key}"]`).some(el => el.checked)) settlement[key] = '';
    });
    $$('[data-private]').forEach(el => {
      const idx = Number(el.dataset.private);
      const key = el.dataset.key;
      if(Number.isInteger(idx) && settlement.privateCars?.[idx] && key){
        settlement.privateCars[idx][key] = el.value;
      }
    });
    $$('[data-public]').forEach(el => {
      const idx = Number(el.dataset.public);
      const key = el.dataset.key;
      if(Number.isInteger(idx) && settlement.publicTransport?.[idx] && key){
        settlement.publicTransport[idx][key] = el.value;
      }
    });
    settlement.mealProvided = mealProvidedLabel(settlement);
    if(String(settlement.routeType || '').trim() && String(settlement.movementMode || '').trim()) ensureTransportRowsForRoute(settlement);
    settlement.updatedAt = nowStamp();
  }

  function rerenderSettlementPreservingScroll(){
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    renderSettlement();
    window.scrollTo(0, top);
  }

  function syncSettlementFromVisibleForm(settlement){
    const panel = $('#tab-settlement');
    const printBtn = $('#printSettlementBtn');
    const panelActive = !!(panel && panel.classList.contains('active'));
    if(panelActive && printBtn) syncSettlementFromForm(settlement);
  }

  function renderSettlement(){
    const rows = filteredTrips();
    const settlement = currentSettlement();
    const trip = settlement ? getTrip(settlement.tripId) : null;
    const dueInfo = settlement ? getSettlementDeadlineInfo(settlement) : null;

    $('#tab-settlement').innerHTML = `
      <div class="grid">
        <div class="card">
          <div class="toolbar">
            <h2>출장 목록</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input type="search" id="tripFilterInput" placeholder="성명, 출장지, 목적 검색" value="${escapeHtml(state.tripFilter)}">
              <button class="btn secondary" id="clearDayFilterBtn" ${state.dayFilter ? '' : 'disabled'}>${state.dayFilter ? escapeHtml(state.dayFilter)+' 필터 해제' : '일자 필터 없음'}</button>
            </div>
          </div>
          <div class="list" id="tripListBox">${makeTripListHtml(rows)}</div>
        </div>

        <div class="card">
          ${settlement && trip ? `
            <div class="toolbar">
              <h2>여비정산 편집</h2>
              <div class="btn-row">
                <button class="btn secondary" id="addPrivateCarBtn">자가용 행 추가</button>
                <button class="btn secondary" id="addPublicBtn">대중교통 행 추가</button>
                <button class="btn teal" id="jumpReceiptBtn">영수증 관리</button>
                <button class="btn warn" id="printSettlementBtn">정산서·영수증 출력(A4)</button>
              </div>
            </div>
            <div class="success" style="margin-bottom:12px">
              출장자 <b>${escapeHtml(trip.name)}</b>, 출장일 <b>${escapeHtml(ymdToKorean(trip.startDate))}</b>, 출장지 <b>${escapeHtml(trip.destination)}</b> 기준 정산서입니다.${trip.tripType ? ` <span class="small">(${escapeHtml(trip.tripType)})</span>` : ""}
            </div>
            <div class="settlement-hint">
              <div class="steps">
                사용 순서: <b>출장 선택 → 정산 입력 → 정산 저장 → 영수증 첨부 → 출력</b><br>
                다른 출장이나 다른 탭으로 이동하기 전에는 저장상태를 한 번 확인해 주세요.
              </div>
              <button class="btn secondary" id="helpOpenLocalBtn" type="button">사용방법 보기</button>
            </div>
            <div class="live-status-row">
              <span class="badge ${state.ui.dirty && state.ui.dirtySettlementId === settlement.id ? 'work' : settlementBadgeClass(settlement)}">${state.ui.dirty && state.ui.dirtySettlementId === settlement.id ? '작성중' : settlementStatusLabel(settlement)}</span>
              <span class="small">마지막 저장: ${escapeHtml(formatStamp(settlement.updatedAt || state.ui.lastSavedAt || ''))}</span>
              <span class="small">첨부 영수증: ${receiptsBySettlement(settlement.id).length}건</span>
            </div>
            <div class="checklist">
              <strong>저장 전 자동 점검</strong>
              <ul>
                ${(validateSettlement(settlement).length ? validateSettlement(settlement).map(v => `<li>${escapeHtml(v)}</li>`).join('') : '<li>현재 입력 기준 필수항목 누락이 없습니다.</li>')}
              </ul>
            </div>
            ${dueInfo ? `<div class="${dueInfo.warning ? 'notice' : 'success'}" style="margin-top:12px">${escapeHtml(dueInfo.message)}${dueInfo.dueDate ? `<br><b>정산기한:</b> ${escapeHtml(ymdToKorean(dueInfo.dueDate))}` : ''}${settlement.settlementDate ? ` | <b>입력한 정산일자:</b> ${escapeHtml(ymdToKorean(settlement.settlementDate))}` : ''}</div>` : ''}

            <div class="deadline-panel">
              <div class="box">
                <label>정산기한 안내</label>
                <div class="value">${escapeHtml(dueInfo?.dueDate ? ymdToKorean(dueInfo.dueDate) : '-')}</div>
                <div class="hint">출장 종료일 기준 5일 이내 정산을 기준으로 관리합니다.</div>
              </div>
              <div class="box">
                <label>현재 상태</label>
                <div class="value">${escapeHtml(dueInfo?.shortLabel || '기한 계산 대기')}</div>
                <div class="hint">정산일자는 사용자가 직접 지정할 수 있습니다.</div>
              </div>
              <div>
                <label>정산일자(사용자 지정)</label>
                <input type="date" data-field="settlementDate" value="${escapeHtml(settlement.settlementDate || '')}">
              </div>
              <div>
                <button class="btn secondary" type="button" id="fillTodayBtn">오늘로 입력</button>
              </div>
            </div>

            <div class="form-grid">
              <div><label>소속</label><input type="text" data-field="dept" value="${escapeHtml(settlement.dept)}"></div>
              <div><label>근무지</label><input type="text" data-field="workplace" value="${escapeHtml(settlement.workplace || state.settings.defaultWorkplace || '')}" placeholder="예: 제천교육지원청"></div>
              <div><label>직급</label><input type="text" data-field="position" value="${escapeHtml(settlement.position)}"></div>
              <div><label>성명</label><input type="text" data-field="name" value="${escapeHtml(settlement.name)}"></div>
              <div class="full"><label>복수출장자</label><input type="text" data-field="coTravelers" value="${escapeHtml(settlement.coTravelers || '')}"></div>

              <div><label>시작일</label><input type="date" data-field="startDate" value="${escapeHtml(settlement.startDate)}"></div>
              <div><label>시작시간</label><input type="time" data-field="startTime" value="${escapeHtml(settlement.startTime)}"></div>
              <div><label>종료일</label><input type="date" data-field="endDate" value="${escapeHtml(settlement.endDate)}"></div>
              <div><label>종료시간</label><input type="time" data-field="endTime" value="${escapeHtml(settlement.endTime)}"></div>

              <div class="full">
                <div class="inline-trip-route">
                  <div>
                    <label>출장지</label>
                    <input type="text" data-field="destination" value="${escapeHtml(settlement.destination)}">
                  </div>
                  <div>
                    <label>이동구분 <span class="small">(필수)</span></label>
                    <div class="choice-inline">
                      <label><input type="radio" name="movementMode" data-field="movementMode" value="private" ${settlement.movementMode==='private' ? 'checked' : ''}> 자가용</label>
                      <label><input type="radio" name="movementMode" data-field="movementMode" value="public" ${settlement.movementMode==='public' ? 'checked' : ''}> 대중교통</label>
                    </div>
                  </div>
                  <div>
                    <label>왕복/편도 <span class="small">(필수)</span></label>
                    <div class="choice-inline">
                      <label><input type="radio" name="routeType" data-field="routeType" value="round" ${settlement.routeType==='round' ? 'checked' : ''}> 왕복</label>
                      <label><input type="radio" name="routeType" data-field="routeType" value="oneway" ${settlement.routeType==='oneway' ? 'checked' : ''}> 편도</label>
                    </div>
                  </div>
                </div>
              </div>
              <div><label>출장종류</label><input type="text" data-field="tripType" value="${escapeHtml(settlement.tripType || '')}"></div>
              <div><label>공용차량 이용여부</label><input type="text" data-field="vehicleUse" value="${escapeHtml(settlement.vehicleUse || '')}"></div>
              <div><label>결재상태</label><input type="text" data-field="approvalStatus" value="${escapeHtml(settlement.approvalStatus || '')}"></div>
              <div><label>식사 제공 여부 <span class="small">(필수)</span></label><select data-field="mealProvidedFlag"><option value="" ${!settlement.mealProvidedFlag ? 'selected' : ''}>선택</option><option value="yes" ${settlement.mealProvidedFlag==='yes' ? 'selected' : ''}>제공</option><option value="no" ${settlement.mealProvidedFlag==='no' ? 'selected' : ''}>미제공</option></select></div>
              <div><label>식사 제공 비고</label><input type="text" data-field="mealProvidedNote" value="${escapeHtml(settlement.mealProvidedNote || settlement.mealProvided || '')}" placeholder="예: 중식 1식 제공 / 식사 미제공"></div>
              <div><label>영수증 처리 방식 <span class="small">(필수)</span></label><select data-field="receiptMode"><option value="" ${!settlement.receiptMode ? 'selected' : ''}>선택</option><option value="attached" ${settlement.receiptMode==='attached' ? 'selected' : ''}>프로그램 첨부</option><option value="none" ${settlement.receiptMode==='none' ? 'selected' : ''}>영수증 없음</option><option value="separate" ${settlement.receiptMode==='separate' ? 'selected' : ''}>영수증 별도 제출</option></select></div>
              <div class="full"><label>출장목적</label><textarea data-field="purpose">${escapeHtml(settlement.purpose)}</textarea></div>

              <div><label>숙박비 지급받은 금액</label><input type="number" data-field="lodgingAdvance" value="${escapeHtml(settlement.lodgingAdvance)}"></div>
              <div><label>숙박비 실제 소요액</label><input type="number" data-field="lodgingActual" value="${escapeHtml(settlement.lodgingActual)}"></div>
              <div><label>친지집 등 숙박(박)</label><input type="number" data-field="lodgingFriendNights" value="${escapeHtml(settlement.lodgingFriendNights)}"></div>
              <div><label>공동숙박(박)</label><input type="number" data-field="lodgingSharedNights" value="${escapeHtml(settlement.lodgingSharedNights)}"></div>
              <div class="full"><label>초과지출/추가지급 사유</label><textarea data-field="lodgingOverReason">${escapeHtml(settlement.lodgingOverReason)}</textarea></div>
            </div>

            <div class="section-title"><h3>운임(자가용)</h3><div class="small">이동구분이 자가용으로 선택된 경우에만 왕복/편도 기준으로 행이 자동 생성됩니다. 왕복은 2행으로 나뉘며 비고에 왕복이 표시됩니다. 자동금액 = 거리×${money(state.settings.kmRate)}원 + 주유 + 하이패스 + 주차 + 기타</div></div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>일자</th><th>출발지<br><span class="small">(왕복 선택 시 2행 자동생성)</span></th><th>도착지<br><span class="small">(왕복 선택 시 2행 자동생성)</span></th><th class="right">거리</th><th class="right">주유</th><th class="right">하이패스</th><th class="right">주차</th><th class="right">기타</th><th class="right">수동금액</th><th class="right">계산금액</th><th>운전자</th><th>비고</th><th></th></tr>
                </thead>
                <tbody>
                  ${(settlement.privateCars || []).map((row, idx) => `
                    <tr>
                      <td><input type="date" data-private="${idx}" data-key="date" value="${escapeHtml(row.date)}"></td>
                      <td><textarea class="route-lines" rows="2" data-private="${idx}" data-key="from" placeholder="예) 제천교육지원청">${escapeHtml(row.from)}</textarea></td>
                      <td><textarea class="route-lines" rows="2" data-private="${idx}" data-key="to" placeholder="예) 충주교육지원청">${escapeHtml(row.to)}</textarea></td>
                      <td><input type="number" data-private="${idx}" data-key="km" value="${escapeHtml(row.km)}"></td>
                      <td><input type="number" data-private="${idx}" data-key="fuel" value="${escapeHtml(row.fuel)}"></td>
                      <td><input type="number" data-private="${idx}" data-key="toll" value="${escapeHtml(row.toll)}"></td>
                      <td><input type="number" data-private="${idx}" data-key="parking" value="${escapeHtml(row.parking)}"></td>
                      <td><input type="number" data-private="${idx}" data-key="other" value="${escapeHtml(row.other)}"></td>
                      <td><input type="number" data-private="${idx}" data-key="manualAmount" value="${escapeHtml(row.manualAmount)}" placeholder="비우면 자동"></td>
                      <td class="right">${money(calcPrivateCarRow(row))}</td>
                      <td><input type="text" data-private="${idx}" data-key="driver" value="${escapeHtml(row.driver)}"></td>
                      <td><input type="text" data-private="${idx}" data-key="remark" value="${escapeHtml(row.remark)}"></td>
                      <td><button class="btn secondary remove-private" data-idx="${idx}">삭제</button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <div class="section-title"><h3>대중교통</h3><div class="small">이동구분이 대중교통으로 선택된 경우에만 왕복/편도 기준으로 행이 자동 생성됩니다. 왕복은 2행으로 나뉘며 비고에 왕복이 표시됩니다. 교통편·등급·금액은 직접 입력합니다.</div></div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>일자</th><th>교통편</th><th>출발지</th><th>도착지</th><th>등급</th><th class="right">금액</th><th>비고</th><th></th></tr>
                </thead>
                <tbody>
                  ${(settlement.publicTransport || []).length ? settlement.publicTransport.map((row, idx) => `
                    <tr>
                      <td><input type="date" data-public="${idx}" data-key="date" value="${escapeHtml(row.date)}"></td>
                      <td><input type="text" data-public="${idx}" data-key="transport" value="${escapeHtml(row.transport)}"></td>
                      <td><textarea class="route-lines" rows="2" data-public="${idx}" data-key="from">${escapeHtml(row.from)}</textarea></td>
                      <td><textarea class="route-lines" rows="2" data-public="${idx}" data-key="to">${escapeHtml(row.to)}</textarea></td>
                      <td><input type="text" data-public="${idx}" data-key="grade" value="${escapeHtml(row.grade)}"></td>
                      <td><input type="number" data-public="${idx}" data-key="amount" value="${escapeHtml(row.amount)}"></td>
                      <td><input type="text" data-public="${idx}" data-key="remark" value="${escapeHtml(row.remark)}"></td>
                      <td><button class="btn secondary remove-public" data-idx="${idx}">삭제</button></td>
                    </tr>
                  `).join('') : `<tr><td colspan="8" class="center muted">대중교통 행이 없습니다.</td></tr>`}
                </tbody>
              </table>
            </div>

            <div class="form-grid" style="margin-top:14px">
              <div><label>기타 경비</label><input type="number" data-field="otherExpense" value="${escapeHtml(settlement.otherExpense)}"></div>
              <div><label>정산상태</label>
                <select data-field="status">
                  <option value="draft" ${settlement.status==='draft'?'selected':''}>미정산</option>
                  <option value="done" ${settlement.status==='done'?'selected':''}>정산완료</option>
                  <option value="exempt" ${settlement.status==='exempt'?'selected':''}>정산불요</option>
                </select>
              </div>
              <div class="full"><label>신청자 메모</label><textarea data-field="applicantNote">${escapeHtml(settlement.applicantNote)}</textarea></div>
            </div>

            <div class="section-title">
              <h3>합계</h3>
              <div class="btn-row">
                <button class="btn ok" id="saveSettlementBtn">정산 저장</button>
              </div>
            </div>
            <div class="kv">
              <div class="muted">자가용 합계</div><div>${money((settlement.privateCars || []).reduce((sum,row)=>sum+calcPrivateCarRow(row),0))} 원</div>
              <div class="muted">대중교통 합계</div><div>${money((settlement.publicTransport || []).reduce((sum,row)=>sum+asNum(row.amount),0))} 원</div>
              <div class="muted">숙박비 실소요</div><div>${money(settlement.lodgingActual)} 원</div>
              <div class="muted">기타 경비</div><div>${money(settlement.otherExpense)} 원</div>
              <div class="muted"><b>총 정산액</b></div><div><b>${money(calcSettlementTotal(settlement))} 원</b></div>
              <div class="muted">정산기한</div><div>${escapeHtml(dueInfo?.dueDate ? ymdToKorean(dueInfo.dueDate) : '-')}</div>
              <div class="muted">정산일자</div><div>${escapeHtml(settlement.settlementDate ? ymdToKorean(settlement.settlementDate) : '-')}</div>
              <div class="muted">영수증 처리</div><div>${escapeHtml(receiptModeLabel(settlement.receiptMode, receiptsBySettlement(settlement.id).length) || '미선택')}</div>
            </div>
          ` : `
            <div class="notice">위 출장목록에서 출장 1건을 선택하면 여비정산서 편집 화면이 열립니다.</div>
          `}
        </div>
      </div>
    `;

    $('#tripFilterInput')?.addEventListener('input', e => { state.tripFilter = e.target.value; renderSettlement(); });
    $('#clearDayFilterBtn')?.addEventListener('click', () => { state.dayFilter=''; renderSettlement(); });
    $$('.list-item[data-trip-id]').forEach(el => el.addEventListener('click', async () => {
      const tripId = el.dataset.tripId;
      if(tripId !== state.selectedTripId && !confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 다른 출장건으로 이동할까요?')) return;
      const s = await ensureSettlementForTrip(tripId);
      state.selectedTripId = tripId;
      state.selectedSettlementId = s.id;
      clearDirtyIfMatches(state.selectedSettlementId);
      renderSettlement();
    }));

    if(settlement){
      $$('[data-field]').forEach(el => {
        const apply = e => {
          const key = e.target.dataset.field;
          if(e.target.type === 'radio' && !e.target.checked) return;
          settlement[key] = e.target.value;
          if(key === 'mealProvidedFlag' || key === 'mealProvidedNote'){
            settlement.mealProvided = mealProvidedLabel(settlement);
          }
          if(key === 'status' && settlement.status === 'done' && !settlement.settlementDate){
            settlement.settlementDate = today();
          }
          const transportLinkedKeys = ['movementMode','routeType','destination','workplace','startDate','name'];
          const rerenderOnChangeKeys = ['movementMode','routeType','status','settlementDate','endDate'];
          if(transportLinkedKeys.includes(key)){
            ensureTransportRowsForRoute(settlement);
          }
          settlement.updatedAt = nowStamp();
          markDirty(settlement.id);
          const shouldRerender = rerenderOnChangeKeys.includes(key) || (e.type === 'change' && ['destination','workplace','startDate','name'].includes(key));
          if(shouldRerender){
            rerenderSettlementPreservingScroll();
          }
        };
        el.addEventListener('input', apply);
        el.addEventListener('change', apply);
      });
      $$('[data-private]').forEach(el => {
        const apply = e => {
          const idx = Number(e.target.dataset.private);
          const key = e.target.dataset.key;
          if(settlement.privateCars?.[idx]){
            settlement.privateCars[idx][key] = e.target.value;
            if(['from','to','date','driver'].includes(key)) settlement.privateCars[idx].autoManaged = false;
            settlement.updatedAt = nowStamp();
            markDirty(settlement.id);
          }
        };
        el.addEventListener('input', apply);
        el.addEventListener('change', apply);
      });
      $$('[data-public]').forEach(el => {
        const apply = e => {
          const idx = Number(e.target.dataset.public);
          const key = e.target.dataset.key;
          if(settlement.publicTransport?.[idx]){
            settlement.publicTransport[idx][key] = e.target.value;
            if(['from','to','date','transport','grade'].includes(key)) settlement.publicTransport[idx].autoManaged = false;
            settlement.updatedAt = nowStamp();
            markDirty(settlement.id);
          }
        };
        el.addEventListener('input', apply);
        el.addEventListener('change', apply);
      });
      $('.remove-private') && $$('.remove-private').forEach(btn => btn.addEventListener('click', () => {
        settlement.privateCars.splice(Number(btn.dataset.idx), 1);
        settlement.updatedAt = nowStamp();
        markDirty(settlement.id);
        rerenderSettlementPreservingScroll();
      }));
      $('.remove-public') && $$('.remove-public').forEach(btn => btn.addEventListener('click', () => {
        settlement.publicTransport.splice(Number(btn.dataset.idx), 1);
        settlement.updatedAt = nowStamp();
        markDirty(settlement.id);
        rerenderSettlementPreservingScroll();
      }));
      $('#addPrivateCarBtn')?.addEventListener('click', () => {
        settlement.privateCars.push(makePrivateCarRow(settlement, false));
        settlement.updatedAt = nowStamp();
        markDirty(settlement.id);
        rerenderSettlementPreservingScroll();
      });
      $('#addPublicBtn')?.addEventListener('click', () => {
        settlement.publicTransport.push(makePublicTransportRow(settlement, false));
        settlement.updatedAt = nowStamp();
        markDirty(settlement.id);
        rerenderSettlementPreservingScroll();
      });
      $('#fillTodayBtn')?.addEventListener('click', () => {
        settlement.settlementDate = today();
        settlement.updatedAt = nowStamp();
        markDirty(settlement.id);
        rerenderSettlementPreservingScroll();
      });
      $('#saveSettlementBtn')?.addEventListener('click', async () => {
        syncSettlementFromForm(settlement);
        const issues = validateSettlement(settlement);
        if(issues.length){
          alert('저장 전에 아래 항목을 확인해 주세요.\n\n- ' + issues.join('\n- '));
          return;
        }
        await dbPut('settlements', settlement);
        markSaved(settlement);
        alert('정산서를 저장했습니다.');
        render();
      });
      $('#jumpReceiptBtn')?.addEventListener('click', () => {
        if(!confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 저장하지 않고 영수증 관리로 이동할까요?')) return;
        state.receiptFilterSettlementId = settlement.id;
        state.activeTab = 'receipts';
        render();
      });
      $('#printSettlementBtn')?.addEventListener('click', async () => {
        syncSettlementFromForm(settlement);
        const issues = validateSettlement(settlement);
        if(issues.length){
          alert('출력 전에 아래 항목을 확인해 주세요.\n\n- ' + issues.join('\n- '));
          return;
        }
        await dbPut('settlements', settlement);
        markSaved(settlement);
        await safePrintSettlement(settlement);
      });
      $('#helpOpenLocalBtn')?.addEventListener('click', openHelpModal);
    }
  }

  function renderCalendar(){
    const base = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth(), 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const startCellDate = new Date(year, month, 1 - startWeekday);
    const days = Array.from({length:42}, (_,i) => new Date(startCellDate.getFullYear(), startCellDate.getMonth(), startCellDate.getDate()+i));
    const weekdayLabels = ['일','월','화','수','목','금','토'];

    function tripsOnDate(dateStr){
      return state.trips.filter(t => dateInRange(dateStr, t.startDate, t.endDate));
    }

    $('#tab-calendar').innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="calendar-controls">
            <div class="btn-row">
              <button class="btn secondary" id="prevMonthBtn">이전달</button>
              <button class="btn secondary" id="todayMonthBtn">이번달</button>
              <button class="btn secondary" id="nextMonthBtn">다음달</button>
            </div>
            <h2>${year}년 ${month+1}월 출장 일정</h2>
            <div class="btn-row">
              <button class="btn teal" id="exportIcsBtn">ICS 내보내기</button>
            </div>
          </div>
          <div class="calendar-grid">
            ${weekdayLabels.map(w => `<div class="weekday">${w}</div>`).join('')}
            ${days.map(d => {
              const ds = localYmd(d);
              const trips = tripsOnDate(ds);
              const isCurrentMonth = d.getMonth() === month;
              const isToday = ds === today();
              return `<div class="day-cell ${!isCurrentMonth ? 'muted-day':''} ${isToday?'today':''}" data-date="${ds}">
                <div class="day-num">${d.getDate()}</div>
                ${trips.slice(0,3).map(t => `<div class="day-trip">${escapeHtml(t.name)} · ${escapeHtml(t.destination)}</div>`).join('')}
                ${trips.length > 3 ? `<div class="small">+${trips.length - 3}건 더 있음</div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <h2>선택일 출장 목록</h2>
            <div class="small">${state.dayFilter ? escapeHtml(state.dayFilter) : '달력에서 날짜를 누르면 필터링됩니다.'}</div>
          </div>
          <div class="list">
            ${(state.dayFilter ? filteredTrips() : state.trips.slice(0,12)).map(t => {
              const s = tripSettlement(t.id);
              return `<div class="list-item move-from-calendar" data-trip-id="${t.id}">
                <div class="title">${escapeHtml(ymdToKorean(t.startDate))} · ${escapeHtml(t.name)}</div>
                <div class="meta">${escapeHtml(t.destination)} | ${escapeHtml(t.purpose)}</div>
                <div style="margin-top:8px"><span class="badge ${settlementBadgeClass(s)}">${settlementStatusLabel(s)}</span></div>
              </div>`;
            }).join('') || `<div class="muted">표시할 출장이 없습니다.</div>`}
          </div>
        </div>
      </div>
    `;

    $('#prevMonthBtn')?.addEventListener('click', () => { state.calendarCursor = new Date(year, month-1, 1); renderCalendar(); });
    $('#todayMonthBtn')?.addEventListener('click', () => { state.calendarCursor = new Date(); renderCalendar(); });
    $('#nextMonthBtn')?.addEventListener('click', () => { state.calendarCursor = new Date(year, month+1, 1); renderCalendar(); });
    $$('.day-cell[data-date]').forEach(cell => cell.addEventListener('click', () => {
      state.dayFilter = cell.dataset.date;
      renderCalendar();
    }));
    $$('.move-from-calendar').forEach(box => box.addEventListener('click', async () => {
      const tripId = box.dataset.tripId;
      if(tripId !== state.selectedTripId && !confirmLeaveIfDirty('저장하지 않은 변경이 있습니다. 다른 출장건으로 이동할까요?')) return;
      const s = await ensureSettlementForTrip(tripId);
      state.selectedTripId = tripId;
      state.selectedSettlementId = s.id;
      state.activeTab = 'settlement';
      clearDirtyIfMatches(state.selectedSettlementId);
      render();
    }));
    $('#exportIcsBtn')?.addEventListener('click', exportICS);
  }

  function renderReceipts(){
    const settlementOptions = state.settlements.map(s => {
      normalizeSettlementShape(s);
      const trip = getTrip(s.tripId);
      return `<option value="${s.id}" ${state.receiptFilterSettlementId === s.id ? 'selected':''}>${escapeHtml(`${trip?.name || ''} | ${ymdToKorean(trip?.startDate || '')} | ${trip?.destination || ''}`)}</option>`;
    }).join('');

    const current = state.receiptFilterSettlementId ? getSettlement(state.receiptFilterSettlementId) : null;
    if(current) normalizeSettlementShape(current);
    const filtered = state.receiptFilterSettlementId ? state.receipts.filter(r => r.settlementId === state.receiptFilterSettlementId) : state.receipts;

    $('#tab-receipts').innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h2>영수증 등록</h2>
          <div class="form-grid">
            <div class="full">
              <label>정산서 선택</label>
              <select id="receiptSettlementSelect">
                <option value="">전체 보기</option>
                ${settlementOptions}
              </select>
            </div>
            <div>
              <label>증빙 유형</label>
              <select id="receiptType">
                <option value="주유">주유</option>
                <option value="하이패스">하이패스</option>
                <option value="주차">주차</option>
                <option value="대중교통">대중교통</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div class="full">
              <label>파일 업로드(이미지/PDF, 여러 장 가능)</label>
              <input type="file" id="receiptFiles" accept="image/*,application/pdf" multiple />
            </div>
          </div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ok" id="saveReceiptsBtn">영수증 저장</button>
            <button class="btn warn" id="saveAndPrintReceiptsBtn">저장 후 바로 출력</button>
            <button class="btn secondary" id="printFromReceiptsBtn">선택 정산서 출력(A4)</button>
          </div>
          <div class="notice" style="margin-top:12px">
            ${current ? `현재 정산서 영수증 처리 방식: <b>${escapeHtml(receiptModeLabel(current.receiptMode, receiptsBySettlement(current.id).length) || '미선택')}</b><br>` : ''}
            ${current && getSettlementDeadlineInfo(current) ? `정산기한 안내: <b>${escapeHtml(getSettlementDeadlineInfo(current).shortLabel)}</b><br>` : ''}
            영수증이 없는 경우에는 여비정산 탭에서 <b>영수증 없음</b>을 선택하고, 종이 원본을 직접 붙여 제출할 경우에는 <b>영수증 별도 제출</b>을 선택하세요.
          </div>
          ${current ? `
            <div class="field-inline" style="margin-top:12px">
              <label><input type="checkbox" id="receiptIndexToggle" ${current.includeReceiptIndex ? 'checked' : ''}> 영수증이 여러 건일 때 첨부목록 1장을 함께 출력</label>
            </div>
          ` : ''}
        </div>

        <div class="card">
          <div class="toolbar">
            <h2>첨부 영수증 목록</h2>
            <div class="small">${filtered.length}건</div>
          </div>
          <div class="receipt-grid">
            ${filtered.length ? filtered.map(r => {
              const trip = getTrip(r.tripId);
              return `<div class="receipt-card">
                ${receiptPreviewHtml(r)}
                <div style="margin-top:10px;font-weight:800;color:#173a7a">${escapeHtml(r.type)}</div>
                <div class="small" style="margin-top:4px">${escapeHtml(trip?.name || '')} | ${escapeHtml(ymdToKorean(trip?.startDate || ''))}</div>
                <div class="small" style="margin-top:4px">${escapeHtml(r.fileName || '')}</div>
                <div class="small" style="margin-top:2px">${escapeHtml((r.mimeType || '').toUpperCase() || 'FILE')} · ${escapeHtml(formatBytes(r.size || 0))}</div>
                <div class="btn-row" style="margin-top:10px">
                  <button class="btn secondary open-receipt" data-id="${r.id}">새 창</button>
                  <button class="btn danger delete-receipt" data-id="${r.id}">삭제</button>
                </div>
              </div>`;
            }).join('') : `<div class="muted">등록된 영수증이 없습니다.</div>`}
          </div>
        </div>
      </div>
    `;

    $('#receiptSettlementSelect')?.addEventListener('change', e => { state.receiptFilterSettlementId = e.target.value; renderReceipts(); });
    $('#receiptIndexToggle')?.addEventListener('change', async e => {
      if(!current) return;
      current.includeReceiptIndex = !!e.target.checked;
      current.updatedAt = nowStamp();
      await dbPut('settlements', current);
      state.ui.lastSavedAt = current.updatedAt;
      updateTopIndicators();
    });
    $('#saveReceiptsBtn')?.addEventListener('click', () => saveReceiptFiles(false));
    $('#saveAndPrintReceiptsBtn')?.addEventListener('click', () => saveReceiptFiles(true));
    $('#printFromReceiptsBtn')?.addEventListener('click', async () => {
      const settlementId = $('#receiptSettlementSelect')?.value;
      if(!settlementId){
        alert('출력할 정산서를 먼저 선택해 주세요.');
        return;
      }
      const settlement = getSettlement(settlementId);
      normalizeSettlementShape(settlement);
      syncSettlementFromVisibleForm(settlement);
      const issues = validateSettlement(settlement);
      if(issues.length){
        alert('출력 전에 아래 항목을 확인해 주세요.\n\n- ' + issues.join('\n- '));
        return;
      }
      await dbPut('settlements', settlement);
      markSaved(settlement);
      await safePrintSettlement(settlement);
    });
    $$('.open-receipt').forEach(btn => btn.addEventListener('click', () => {
      const item = state.receipts.find(r => r.id === btn.dataset.id);
      if(item) window.open(item.dataUrl, '_blank');
    }));
    $$('.delete-receipt').forEach(btn => btn.addEventListener('click', async () => {
      if(!confirm('이 영수증을 삭제할까요?')) return;
      await dbDelete('receipts', btn.dataset.id);
      state.receipts = state.receipts.filter(r => r.id !== btn.dataset.id);
      render();
    }));
  }

  async function saveReceiptFiles(printAfter=false){
    const settlementId = $('#receiptSettlementSelect').value;
    const files = $('#receiptFiles').files;
    const type = $('#receiptType').value;
    if(!settlementId){
      alert('정산서를 먼저 선택해 주세요.');
      return;
    }
    if(!files || !files.length){
      alert('이미지 또는 PDF 파일을 선택해 주세요.');
      return;
    }
    const settlement = getSettlement(settlementId);
    normalizeSettlementShape(settlement);
    if(settlement.receiptMode && settlement.receiptMode !== 'attached'){
      const ok = confirm('현재 이 정산서의 영수증 처리 방식은 "' + receiptModeLabel(settlement.receiptMode) + '"입니다. 프로그램 첨부로 바꾸고 계속할까요?');
      if(!ok) return;
      settlement.receiptMode = 'attached';
      settlement.updatedAt = nowStamp();
      await dbPut('settlements', settlement);
    }
    for(const file of files){
      const dataUrl = await fileToDataURL(file);
      const item = {
        id: uid('receipt'),
        settlementId,
        tripId: settlement.tripId,
        type,
        fileName: file.name,
        mimeType: file.type || '',
        size: file.size,
        dataUrl,
        createdAt: nowStamp()
      };
      state.receipts.push(item);
      await dbPut('receipts', item);
    }
    settlement.receiptMode = 'attached';
    settlement.updatedAt = nowStamp();
    await dbPut('settlements', settlement);
    alert(printAfter ? '영수증을 저장했고 바로 출력합니다.' : '영수증을 저장했습니다.');
    state.ui.lastSavedAt = nowStamp();
    updateTopIndicators();
    $('#receiptFiles').value = '';
    if(printAfter){
      syncSettlementFromVisibleForm(settlement);
      const issues = validateSettlement(settlement);
      if(issues.length){
        alert('출력 전에 아래 항목을 확인해 주세요.\n\n- ' + issues.join('\n- '));
        render();
        return;
      }
      await safePrintSettlement(settlement);
    }
    render();
  }

  function fileToDataURL(file){
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderBackup(){
    $('#tab-backup').innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h2>전체 데이터 백업</h2>
          <div class="notice">
            출장, 정산, 영수증, 기본 설정을 하나의 JSON 파일로 내려받습니다.
            동일한 브라우저 환경이 아니어도 복원 탭에서 다시 불러올 수 있습니다.
          </div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ok" id="downloadBackupBtn">백업 파일 다운로드</button>
          </div>
        </div>
        <div class="card">
          <h2>데이터 복원 / 초기화</h2>
          <div class="form-grid">
            <div class="full"><label>백업 JSON 파일 선택</label><input type="file" id="restoreFile" accept=".json"></div>
          </div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn warn" id="restoreBtn">선택 파일로 복원</button>
            <button class="btn danger" id="resetAllBtn">전체 초기화</button>
          </div>
          <div class="info" style="margin-top:12px">
            복원 시 현재 브라우저의 기존 데이터는 모두 교체됩니다.
          </div>
        </div>
      </div>
    `;

    $('#downloadBackupBtn')?.addEventListener('click', downloadBackup);
    $('#restoreBtn')?.addEventListener('click', restoreBackup);
    $('#resetAllBtn')?.addEventListener('click', resetAllData);
  }

  async function downloadBackup(){
    const payload = {
      exportedAt: nowStamp(),
      settings: state.settings,
      trips: state.trips,
      settlements: state.settlements,
      receipts: state.receipts
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeFileName(`출장정산백업_${today()}.json`);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function restoreBackup(){
    const file = $('#restoreFile').files?.[0];
    if(!file){
      alert('복원할 JSON 파일을 선택해 주세요.');
      return;
    }
    if(!confirm('현재 데이터를 모두 지우고 백업으로 교체합니다. 계속할까요?')) return;
    const text = await file.text();
    const data = JSON.parse(text);
    await Promise.all(STORES.map(s => dbClear(s)));
    state.settings = {...state.settings, ...(data.settings || {})};
    await saveSettings();
    state.trips = data.trips || [];
    state.settlements = data.settlements || [];
    state.receipts = data.receipts || [];
    await dbPutBulk('trips', state.trips);
    await dbPutBulk('settlements', state.settlements);
    await dbPutBulk('receipts', state.receipts);
    alert('복원했습니다.');
    state.ui.dirty = false;
    state.ui.dirtySettlementId = '';
    state.ui.lastSavedAt = nowStamp();
    render();
  }

  async function resetAllData(){
    if(!confirm('모든 출장, 정산, 영수증 데이터를 삭제할까요?')) return;
    await Promise.all(STORES.map(s => dbClear(s)));
    state.trips = [];
    state.settlements = [];
    state.receipts = [];
    await saveSettings();
    alert('초기화했습니다.');
    state.ui.dirty = false;
    state.ui.dirtySettlementId = '';
    state.ui.lastSavedAt = nowStamp();
    render();
  }


  function escapeAttr(v){
    return String(v ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function nl2br(v){
    return escapeHtml(v || '').replace(/\n/g,'<br>');
  }
  function compactDate(v){
    if(!v) return '';
    const s = String(v);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g,'.');
    return s;
  }
  function compactTime(v){
    return v ? String(v) : '';
  }
  function splitCoTravelerNames(settlement){
    const raw = String(settlement.coTravelers || '').trim();
    const names = [];
    if(settlement.name) names.push(String(settlement.name).trim());
    if(raw){
      raw.split(/[\n,;/]+/).map(v => v.trim()).filter(Boolean).forEach(n => {
        if(!names.includes(n) && !/^\d+\s*명$/.test(n)) names.push(n);
      });
    }
    return names.filter(Boolean);
  }
  function buildTripApplicationPage(settlement){
    const trip = getTrip(settlement.tripId) || {};
    const travelers = splitCoTravelerNames(settlement);
    const rows = travelers.length ? travelers.map(n => ({
      position: settlement.position || trip.position || '',
      name: n,
      purpose: settlement.purpose || trip.purpose || '',
      range: `${compactDate(settlement.startDate)}부터 ${compactDate(settlement.endDate || settlement.startDate)}까지\n(${compactTime(settlement.startTime)}~${compactTime(settlement.endTime)})`,
      destination: settlement.destination || trip.destination || '',
      signer: n
    })) : [{
      position: settlement.position || trip.position || '',
      name: settlement.name || trip.name || '',
      purpose: settlement.purpose || trip.purpose || '',
      range: `${compactDate(settlement.startDate)}부터 ${compactDate(settlement.endDate || settlement.startDate)}까지\n(${compactTime(settlement.startTime)}~${compactTime(settlement.endTime)})`,
      destination: settlement.destination || trip.destination || '',
      signer: settlement.name || trip.name || ''
    }];
    while(rows.length < 8) rows.push({position:'',name:'',purpose:'',range:'',destination:'',signer:''});
    const docDate = compactDate((trip.createdAt || '').slice(0,10) || settlement.startDate || today());
    const moveNote = [
      settlement.vehicleUse ? `공용차량 이용여부: ${settlement.vehicleUse}` : '',
      settlement.movementMode ? `이동구분 ${settlement.movementMode==='private' ? '자가용' : '대중교통'}` : '',
      settlement.routeType ? `경로 ${settlement.routeType==='round' ? '왕복' : '편도'}` : '',
      (settlement.privateCars || []).length ? `자가용 ${settlement.privateCars.length}행` : '',
      (settlement.publicTransport || []).length ? `대중교통 ${settlement.publicTransport.length}행` : ''
    ].filter(Boolean).join(' / ');
    return `
      <div class="print-page">
        <div class="print-title">출 장 신 청 서</div>
        <table class="print-approval-table">
          <tr>
            <td class="print-center" style="width:6%;font-weight:700" rowspan="2">결<br>재</td>
            <td class="print-center print-box-title">장학사</td>
            <td class="print-center print-box-title">과장</td>
            <td class="print-center print-box-title">협조</td>
          </tr>
          <tr>
            <td class="print-center">${escapeHtml(settlement.name || trip.name || '')}</td>
            <td></td>
            <td></td>
          </tr>
        </table>
        <div class="print-doc-date">${escapeHtml(docDate)}</div>
        <div class="print-trip-head">다음과 같이 출장을 명함.</div>
        <table class="print-trip-table">
          <tr>
            <th style="width:11%">직 급</th>
            <th style="width:11%">성 명</th>
            <th>출 장 목 적</th>
            <th style="width:22%">출장기간</th>
            <th style="width:18%">출 장 지</th>
            <th style="width:12%">서명 또는 날인</th>
          </tr>
          ${rows.map(r => `
            <tr>
              <td class="print-center">${escapeHtml(r.position || '')}</td>
              <td class="print-center">${escapeHtml(r.name || '')}</td>
              <td>${nl2br(r.purpose || '')}</td>
              <td class="print-center">${nl2br(r.range || '')}</td>
              <td>${nl2br(r.destination || '')}</td>
              <td class="print-center">${escapeHtml(r.signer || '')}</td>
            </tr>
          `).join('')}
          <tr>
            <td class="print-box-title">이동 사항</td>
            <td colspan="5">${nl2br(moveNote || settlement.applicantNote || '')}</td>
          </tr>
          <tr>
            <td class="print-box-title">여 비 정 산</td>
            <td colspan="5">여비정산 신청서 별첨</td>
          </tr>
        </table>
      </div>
    `;
  }
  function buildSettlementFormPage(settlement){
    normalizeSettlementShape(settlement);
    const trip = getTrip(settlement.tripId) || {};
    const weekdayText = (v) => {
      if(!v) return '';
      const d = new Date(`${v}T00:00:00`);
      if(Number.isNaN(d.getTime())) return '';
      return `(${['일','월','화','수','목','금','토'][d.getDay()]})`;
    };
    const blankPrivate = () => ({date:'',from:'',to:'',km:'',driver:'',remark:'',fuel:'',toll:'',parking:'',other:'',manualAmount:''});
    const blankPublic = () => ({date:'',transport:'',from:'',to:'',grade:'',amount:'',remark:''});
    const privateRows = (settlement.privateCars || []).slice(0,4).map(r => ({...blankPrivate(), ...r}));
    const publicRows = (settlement.publicTransport || []).slice(0,5).map(r => ({...blankPublic(), ...r}));
    while(privateRows.length < 4) privateRows.push(blankPrivate());
    while(publicRows.length < 5) publicRows.push(blankPublic());

    const displayMoney = (v) => {
      const n = asNum(v);
      return n ? money(n) : '';
    };
    const routeModeTag = [
      settlement.movementMode === 'private' ? '자가용' : settlement.movementMode === 'public' ? '대중교통' : '',
      settlement.routeType === 'round' ? '왕복' : settlement.routeType === 'oneway' ? '편도' : ''
    ].filter(Boolean).join(' / ');
    const receiptCount = receiptsBySettlement(settlement.id).length;
    let receiptLine = '2. 영수증 1부.  끝.';
    if(settlement.receiptMode === 'attached') receiptLine = `2. 영수증 ${receiptCount || 1}부.  끝.`;
    if(settlement.receiptMode === 'none') receiptLine = '2. 영수증 없음.  끝.';
    if(settlement.receiptMode === 'separate') receiptLine = '2. 영수증 별도 제출.  끝.';
    const signHtml = state.settings.signatureDataUrl
      ? `<img class="xlsx-sign-image" src="${escapeAttr(state.settings.signatureDataUrl)}" alt="등록 서명">`
      : '(서명)';
    const submitDate = compactDate(settlement.settlementDate || '');
    const startDateText = settlement.startDate ? `${ymdToKorean(settlement.startDate)}${weekdayText(settlement.startDate)}` : '';
    const endDateText = settlement.endDate ? `${ymdToKorean(settlement.endDate)}${weekdayText(settlement.endDate)}` : startDateText;
    const mealText = mealProvidedLabel(settlement) || '';
    const privateBody = privateRows.map((r, idx) => {
      const active = [r.date,r.from,r.to,r.km,r.driver,r.remark,r.manualAmount,r.fuel,r.toll,r.parking,r.other].some(v => String(v || '').trim());
      return `
        <tr>
          ${idx === 0 ? '<td class="xlsx-side xlsx-transport-side" rowspan="9" style="width:4.5%">운<br>임</td><td class="xlsx-side xlsx-transport-stack" rowspan="4" style="width:5.5%">자<br>가<br>용</td>' : ''}
          <td class="xlsx-center" style="width:11%">${escapeHtml(ymdToKorean(r.date || ''))}</td>
          <td class="xlsx-fill xlsx-route" style="width:17.5%">${nl2br(r.from || '')}</td>
          <td class="xlsx-fill xlsx-route" style="width:17.5%">${nl2br(r.to || '')}</td>
          <td class="xlsx-center" style="width:11%">${escapeHtml(r.km || '')}</td>
          <td class="xlsx-center" style="width:14%">${active ? escapeHtml(displayMoney(calcPrivateCarRow(r))) : ''}</td>
          <td class="xlsx-center" style="width:10%">${escapeHtml(r.driver || settlement.name || trip.name || '')}</td>
          <td class="xlsx-center" style="width:8.5%">${escapeHtml(r.remark || '')}</td>
        </tr>`;
    }).join('');
    const publicBody = publicRows.map((r, idx) => {
      const amountNote = [displayMoney(r.amount), r.remark].filter(Boolean).join(' / ');
      return `
        <tr>
          ${idx === 0 ? '<td class="xlsx-side xlsx-transport-stack" rowspan="5" style="width:5.5%">대<br>중<br>교<br>통</td>' : ''}
          <td class="xlsx-center" style="width:11%">${escapeHtml(ymdToKorean(r.date || ''))}</td>
          <td class="xlsx-center" style="width:17.5%">${escapeHtml(r.transport || '')}</td>
          <td class="xlsx-center" style="width:17.5%">${escapeHtml(r.from || '')}</td>
          <td class="xlsx-center" style="width:17.5%">${escapeHtml(r.to || '')}</td>
          <td class="xlsx-center" style="width:14%">${escapeHtml(r.grade || '')}</td>
          <td class="xlsx-center xlsx-small" style="width:18.5%">${escapeHtml(amountNote)}</td>
        </tr>`;
    }).join('');

    return `
      <div class="print-page settlement-sheet">
        <div class="xlsx-sheet">
          <div class="xlsx-title">여비정산 신청서</div>
          <div class="xlsx-sheet-box">
            <table class="xlsx-form table-top">
              <colgroup>
                <col style="width:10%"><col style="width:25%"><col style="width:10%"><col style="width:23%"><col style="width:8%"><col style="width:24%">
              </colgroup>
              <tr>
                <td class="xlsx-label">소 속</td>
                <td class="xlsx-center xlsx-big">${escapeHtml(settlement.dept || '')}</td>
                <td class="xlsx-label">직급</td>
                <td class="xlsx-center xlsx-fill xlsx-big">${escapeHtml(settlement.position || '')}</td>
                <td class="xlsx-label">성 명</td>
                <td class="xlsx-center xlsx-fill xlsx-big">${escapeHtml(settlement.name || trip.name || '')}</td>
              </tr>
              <tr>
                <td class="xlsx-label">복수출장자</td>
                <td colspan="5">${escapeHtml(settlement.coTravelers || '')}</td>
              </tr>
            </table>

            <table class="xlsx-form">
              <colgroup>
                <col style="width:10%"><col style="width:13%"><col style="width:18%"><col style="width:4.5%"><col style="width:18%"><col style="width:36.5%">
              </colgroup>
              <tr>
                <td class="xlsx-side xlsx-big" rowspan="4">출 장<br>일 정</td>
                <td class="xlsx-label">출장일시</td>
                <td class="xlsx-fill xlsx-date-time">${escapeHtml(startDateText)} ${escapeHtml(settlement.startTime || '')}</td>
                <td class="xlsx-center xlsx-big">~</td>
                <td class="xlsx-fill xlsx-date-time">${escapeHtml(endDateText)} ${escapeHtml(settlement.endTime || '')}</td>
                <td></td>
              </tr>
              <tr>
                <td class="xlsx-label">출 장 지</td>
                <td class="xlsx-fill xlsx-purpose" colspan="4">${escapeHtml(settlement.destination || '')}${routeModeTag ? ` <span class="xlsx-small">(${escapeHtml(routeModeTag)})</span>` : ''}</td>
              </tr>
              <tr>
                <td class="xlsx-label">출장목적</td>
                <td class="xlsx-fill xlsx-purpose" colspan="4">${escapeHtml(settlement.purpose || '')}</td>
              </tr>
              <tr>
                <td class="xlsx-label">식사제공여부</td>
                <td class="xlsx-fill xlsx-purpose" colspan="4">${escapeHtml(mealText)}</td>
              </tr>
            </table>

            <table class="xlsx-form">
              <colgroup>
                <col style="width:10%"><col style="width:18%"><col style="width:22%"><col style="width:18%"><col style="width:20%"><col style="width:12%">
              </colgroup>
              <tr>
                <td class="xlsx-side xlsx-big" rowspan="3">숙 박 비</td>
                <td class="xlsx-label">상한액 또는<br>지급받은 금액</td>
                <td class="xlsx-center">${escapeHtml(displayMoney(settlement.lodgingAdvance))}</td>
                <td class="xlsx-label">실 제<br>소요액</td>
                <td class="xlsx-center">${escapeHtml(displayMoney(settlement.lodgingActual))}</td>
                <td class="xlsx-label">초과지출<br>사 유</td>
              </tr>
              <tr>
                <td class="xlsx-label">친지 집 등 숙박</td>
                <td class="xlsx-center">${settlement.lodgingFriendNights ? `(${escapeHtml(String(settlement.lodgingFriendNights))})박` : '(    )박'}</td>
                <td class="xlsx-label">공동숙박</td>
                <td class="xlsx-center">${settlement.lodgingSharedNights ? `(${escapeHtml(String(settlement.lodgingSharedNights))})박` : '(    )박'}</td>
                <td class="xlsx-label">공동숙박<br>추가지급</td>
              </tr>
              <tr>
                <td class="xlsx-center" colspan="4">${escapeHtml(settlement.lodgingOverReason || '')}</td>
                <td class="xlsx-label">신청자</td>
              </tr>
            </table>

            <table class="xlsx-form">
              <colgroup>
                <col style="width:4.5%"><col style="width:5.5%"><col style="width:11%"><col style="width:17.5%"><col style="width:17.5%"><col style="width:11%"><col style="width:14%"><col style="width:10%"><col style="width:8.5%">
              </colgroup>
              <tr>
                <td class="xlsx-side xlsx-big" rowspan="9">운<br>임</td>
                <td class="xlsx-side xlsx-transport-stack" rowspan="4">자<br>가<br>용</td>
                <td class="xlsx-label">일 자</td>
                <td class="xlsx-label">출발지</td>
                <td class="xlsx-label">도착지</td>
                <td class="xlsx-label">거리(km)</td>
                <td class="xlsx-label">금액</td>
                <td class="xlsx-label">운전자<br>성명</td>
                <td class="xlsx-label">비고</td>
              </tr>
              ${privateRows.map((r) => {
                const active = [r.date,r.from,r.to,r.km,r.driver,r.remark,r.manualAmount,r.fuel,r.toll,r.parking,r.other].some(v => String(v || '').trim());
                return `
                <tr>
                  <td class="xlsx-center">${escapeHtml(ymdToKorean(r.date || ''))}</td>
                  <td class="xlsx-fill xlsx-route">${nl2br(r.from || '')}</td>
                  <td class="xlsx-fill xlsx-route">${nl2br(r.to || '')}</td>
                  <td class="xlsx-center">${escapeHtml(r.km || '')}</td>
                  <td class="xlsx-center">${active ? escapeHtml(displayMoney(calcPrivateCarRow(r))) : ''}</td>
                  <td class="xlsx-center">${escapeHtml(r.driver || '')}</td>
                  <td class="xlsx-center">${escapeHtml(r.remark || '')}</td>
                </tr>`;
              }).join('')}
              <tr>
                <td class="xlsx-side xlsx-transport-stack" rowspan="5">대<br>중<br>교<br>통</td>
                <td class="xlsx-label">일 자</td>
                <td class="xlsx-label">교통편</td>
                <td class="xlsx-label">출발지</td>
                <td class="xlsx-label">도착지</td>
                <td class="xlsx-label" colspan="2">등 급</td>
                <td class="xlsx-label">금액·비고</td>
              </tr>
              ${publicBody}
            </table>

            <table class="xlsx-form">
              <tr>
                <td class="xlsx-note-box">「공무원여비규정」 제16조 제1항 및 제2항의 규정에 의하여 관계서류를 첨부하여<br>위와 같이 여비의 정산을 신청합니다.</td>
              </tr>
            </table>

            <table class="xlsx-form">
              <colgroup><col style="width:10%"><col style="width:90%"></colgroup>
              <tr>
                <td class="xlsx-label xlsx-big" rowspan="2">첨 부</td>
                <td class="xlsx-attach-cell">1. 출장신청서 1부.</td>
              </tr>
              <tr>
                <td class="xlsx-attach-cell">${escapeHtml(receiptLine)}</td>
              </tr>
            </table>

            <table class="xlsx-form xlsx-date-row">
              <tr><td>${escapeHtml(submitDate)}</td></tr>
            </table>

            <table class="xlsx-form table-bottom xlsx-sign-row">
              <colgroup><col style="width:28%"><col style="width:12%"><col style="width:10%"><col style="width:16%"><col style="width:14%"><col style="width:20%"></colgroup>
              <tr>
                <td></td>
                <td>신청인</td>
                <td>성명</td>
                <td>${escapeHtml(settlement.name || trip.name || '')}</td>
                <td>${signHtml}</td>
                <td></td>
              </tr>
            </table>
          </div>
        </div>
      </div>
    `;
  }
  function buildReceiptAppendixPages(settlement){
    normalizeSettlementShape(settlement);
    const items = receiptsBySettlement(settlement.id);
    if(!items.length) return '';
    const trip = getTrip(settlement.tripId) || {};
    const indexPage = items.length > 1 && settlement.includeReceiptIndex ? `
      <div class="print-page">
        <div class="print-title">영 수 증</div>
        <div class="print-page-subtitle">첨부 목록</div>
        <table class="print-receipt-index">
          <tr>
            <th style="width:10%">번호</th>
            <th style="width:16%">유형</th>
            <th>파일명</th>
            <th style="width:18%">출장자</th>
            <th style="width:18%">출장일자</th>
          </tr>
          ${items.map((r, i) => `
            <tr>
              <td class="print-center">${i+1}</td>
              <td class="print-center">${escapeHtml(r.type || '')}</td>
              <td>${escapeHtml(r.fileName || '')}</td>
              <td class="print-center">${escapeHtml(settlement.name || trip.name || '')}</td>
              <td class="print-center">${escapeHtml(ymdToKorean(trip.startDate || settlement.startDate || ''))}</td>
            </tr>
          `).join('')}
        </table>
        <div class="print-space"></div>
        <div class="print-footer-note">설정에서 첨부목록 출력을 켠 경우에만 목록을 함께 출력합니다. PDF 영수증은 브라우저에 따라 인쇄 결과가 다를 수 있습니다.</div>
      </div>
    ` : '';
    const pages = items.map((r, i) => {
      const isPdf = /pdf/i.test(r.mimeType || '') || /\.pdf$/i.test(r.fileName || '');
      const body = isPdf
        ? `<object class="print-receipt-frame" data="${escapeAttr(r.dataUrl)}" type="application/pdf"><div class="print-note">이 브라우저에서는 PDF 미리보기를 바로 출력하지 못합니다.\n파일명: ${escapeHtml(r.fileName || '')}</div></object>`
        : `<img class="print-receipt-image" src="${escapeAttr(r.dataUrl)}" alt="${escapeAttr(r.fileName || '')}">`;
      return `
        <div class="print-page">
          <div class="print-title">영 수 증</div>
          <div class="print-page-subtitle">${items.length > 1 ? `${i+1}. ` : ''}${escapeHtml(r.type || '기타')}</div>
          <div class="print-receipt-box">
            <div class="print-receipt-meta">
              <div>출장자: ${escapeHtml(settlement.name || trip.name || '')}</div>
              <div>출장일: ${escapeHtml(ymdToKorean(trip.startDate || settlement.startDate || ''))}</div>
            </div>
            <div class="print-receipt-meta">
              <div>파일명: ${escapeHtml(r.fileName || '')}</div>
              <div>${escapeHtml((r.mimeType || '').toUpperCase() || 'FILE')}</div>
            </div>
            <div class="print-receipt-image-wrap">${body}</div>
          </div>
        </div>
      `;
    }).join('');
    return indexPage + pages;
  }
  function buildPrintArea(settlement){
    const printArea = $('#printArea');
    if(!printArea) return '';
    printArea.style.display = 'block';
    printArea.innerHTML = [
      buildSettlementFormPage(settlement),
      settlement.receiptMode === 'attached' ? buildReceiptAppendixPages(settlement) : ''
    ].join('');
    return printArea.innerHTML;
  }

  function waitForPaint(){
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  async function waitForPrintResources(timeout=2500){
    const printArea = $('#printArea');
    if(!printArea) return;
    const images = Array.from(printArea.querySelectorAll('img'));
    if(!images.length) return;
    await Promise.all(images.map(img => new Promise(resolve => {
      if(img.complete && img.naturalWidth !== 0){ resolve(); return; }
      const timer = setTimeout(resolve, timeout);
      const done = () => { clearTimeout(timer); resolve(); };
      img.addEventListener('load', done, {once:true});
      img.addEventListener('error', done, {once:true});
    })));
  }

  async function safePrintSettlement(settlement){
    normalizeSettlementShape(settlement);
    const html = buildPrintArea(settlement);
    if(!html || !String(html).trim()){
      alert('출력 내용을 만들지 못했습니다. 다시 시도해 주세요.');
      return;
    }
    await waitForPaint();
    await waitForPrintResources();
    setTimeout(() => {
      try{
        window.focus();
        window.print();
      }catch(err){
        console.error(err);
        alert('출력 창을 여는 중 문제가 발생했습니다. 브라우저 인쇄 설정을 확인해 주세요.');
      }
    }, 80);
  }


  function exportICS(){
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Trip Settlement Manager//KO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    state.trips.forEach(t => {
      if(!t.startDate) return;
      const start = `${(t.startDate || '').replace(/-/g,'')}T${(t.startTime || '0900').replace(':','')}00`;
      const end = `${(t.endDate || t.startDate || '').replace(/-/g,'')}T${(t.endTime || '1800').replace(':','')}00`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${t.id}@trip-manager`);
      lines.push(`DTSTAMP:${today().replace(/-/g,'')}T000000`);
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
      lines.push(`SUMMARY:${icsEscape((t.name || '출장') + ' - ' + (t.destination || '출장지'))}`);
      lines.push(`DESCRIPTION:${icsEscape(t.purpose || '')}`);
      lines.push(`LOCATION:${icsEscape(t.destination || '')}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], {type:'text/calendar'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeFileName(`출장일정_${today()}.ics`);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function icsEscape(v){
    return String(v || '').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  }


  let deferredInstallPrompt = null;
  function bindPwaUI(){
    const installBtn = $('#installPwaBtn');
    if(installBtn && !installBtn.dataset.bound){
      installBtn.dataset.bound = '1';
      installBtn.addEventListener('click', async () => {
        if(deferredInstallPrompt){
          deferredInstallPrompt.prompt();
          try{ await deferredInstallPrompt.userChoice; }catch(_err){}
          deferredInstallPrompt = null;
          installBtn.hidden = true;
          return;
        }
        alert('브라우저 메뉴의 “앱 설치”, “홈 화면에 추가”, 또는 “바로가기 만들기” 기능을 이용해 주세요.');
      });
    }
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('service worker registration failed', err));
    }
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const installBtn = $('#installPwaBtn');
    if(installBtn) installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const installBtn = $('#installPwaBtn');
    if(installBtn) installBtn.hidden = true;
  });

  function render(){
    buildTabs();
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    $(`#tab-${state.activeTab}`)?.classList.add('active');
    renderDashboard();
    renderImport();
    renderSettlement();
    renderCalendar();
    renderReceipts();
    renderBackup();
    updateTopIndicators();
  }

  async function init(){
    await loadState();
    state.ui.lastSavedAt = [...state.settlements].sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]?.updatedAt || '';
    render();
    bindGlobalUI();
    bindPwaUI();
  }

  init().catch(err => {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend', `<div class="app"><div class="card" style="border-color:#fecaca;background:#fff1f2"><h2>초기화 오류</h2><pre class="mono">${escapeHtml(err.message || String(err))}</pre></div></div>`);
  });
})();
