(() => {
  'use strict';

  let appToken = '';
  let available = false;

  function tokenFromUrl(){
    try{
      return new URL(location.href).searchParams.get('token') || '';
    }catch(_err){
      return '';
    }
  }

  async function jsonFetch(url, options={}){
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if(options.body && !headers.has('Content-Type')){
      headers.set('Content-Type', 'application/json');
    }
    if(appToken) headers.set('X-App-Token', appToken);
    const response = await fetch(url, {...options, headers, cache:'no-store'});
    const data = await response.json().catch(() => ({}));
    if(!response.ok){
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  async function bootstrap(){
    const supplied = tokenFromUrl();
    try{
      const health = await jsonFetch('/api/health');
      available = !!health.ok;
      if(available && supplied){
        const boot = await jsonFetch('/api/bootstrap?token=' + encodeURIComponent(supplied));
        appToken = boot.token || '';
        const url = new URL(location.href);
        url.searchParams.delete('token');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    }catch(_err){
      available = false;
      appToken = '';
    }
    updateIndicator();
    return {available, authenticated:!!appToken};
  }

  function updateIndicator(){
    const topbar = document.querySelector('.topbar');
    if(!topbar) return;
    let pill = document.getElementById('hybridEnginePill');
    if(!pill){
      pill = document.createElement('div');
      pill.id = 'hybridEnginePill';
      pill.className = 'pill';
      topbar.insertBefore(pill, topbar.firstChild);
    }
    if(available && appToken){
      pill.textContent = 'Python 엔진: 연결됨';
      pill.className = 'pill status-ok';
    }else if(available){
      pill.textContent = 'Python 엔진: 인증 필요';
      pill.className = 'pill status-dirty';
    }else{
      pill.textContent = '웹 모드';
      pill.className = 'pill status-empty';
    }
  }

  function requireHybrid(){
    if(!available || !appToken){
      throw new Error('Python 하이브리드 엔진에 연결되어 있지 않습니다.');
    }
  }

  async function listStore(store){
    requireHybrid();
    const data = await jsonFetch('/api/store/' + encodeURIComponent(store));
    return data.items || [];
  }

  async function putStore(store, value){
    requireHybrid();
    return jsonFetch('/api/store/put', {
      method:'POST',
      body:JSON.stringify({store, value})
    });
  }

  async function putBulk(store, values){
    requireHybrid();
    return jsonFetch('/api/store/put-bulk', {
      method:'POST',
      body:JSON.stringify({store, values})
    });
  }

  async function deleteStore(store, id){
    requireHybrid();
    return jsonFetch('/api/store/delete', {
      method:'POST',
      body:JSON.stringify({store, id})
    });
  }

  async function clearStore(store){
    requireHybrid();
    return jsonFetch('/api/store/clear', {
      method:'POST',
      body:JSON.stringify({store})
    });
  }

  function arrayBufferToBase64(buffer){
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for(let i=0;i<bytes.length;i+=chunk){
      binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
    }
    return btoa(binary);
  }

  async function parseExcel(file){
    requireHybrid();
    const buffer = await file.arrayBuffer();
    return jsonFetch('/api/excel/parse', {
      method:'POST',
      body:JSON.stringify({
        filename:file.name,
        dataBase64:arrayBufferToBase64(buffer)
      })
    });
  }

  async function uploadReceipt(file, meta={}){
    requireHybrid();
    const buffer = await file.arrayBuffer();
    return jsonFetch('/api/receipt/upload', {
      method:'POST',
      body:JSON.stringify({
        settlementId:meta.settlementId || '',
        tripId:meta.tripId || '',
        type:meta.type || '기타',
        filename:file.name,
        mimeType:file.type || '',
        dataBase64:arrayBufferToBase64(buffer)
      })
    });
  }

  function receiptUrl(id){
    requireHybrid();
    return '/api/receipt/file?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(appToken);
  }

  async function deleteReceipt(id){
    requireHybrid();
    return jsonFetch('/api/receipt/delete', {
      method:'POST',
      body:JSON.stringify({id})
    });
  }

  async function uploadSignature(file){
    requireHybrid();
    const buffer = await file.arrayBuffer();
    return jsonFetch('/api/signature/upload', {
      method:'POST',
      body:JSON.stringify({
        filename:file.name,
        mimeType:file.type || '',
        dataBase64:arrayBufferToBase64(buffer)
      })
    });
  }

  function signatureUrl(){
    requireHybrid();
    return '/api/signature/file?token=' + encodeURIComponent(appToken);
  }

  async function deleteSignature(){
    requireHybrid();
    return jsonFetch('/api/signature/delete', {
      method:'POST',
      body:'{}'
    });
  }

  function downloadBase64(dataBase64, mimeType, filename){
    const binary = atob(dataBase64 || '');
    const bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {type:mimeType || 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.bin';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generateHwpx(settlement, receiptCount=0, kmRate=200){
    requireHybrid();
    const data = await jsonFetch('/api/hwpx/generate', {
      method:'POST',
      body:JSON.stringify({settlement, receiptCount, kmRate})
    });
    if(data.dataBase64){
      downloadBase64(
        data.dataBase64,
        'application/vnd.hancom.hwpx',
        data.filename || '여비정산서.hwpx'
      );
    }
    return data;
  }

  async function validateSettlement(settlement, receiptCount=0){
    requireHybrid();
    return jsonFetch('/api/validate', {
      method:'POST',
      body:JSON.stringify({settlement, receiptCount})
    });
  }

  async function shutdown(){
    requireHybrid();
    return jsonFetch('/api/shutdown', {
      method:'POST',
      body:'{}'
    });
  }

  window.HybridAPI = {
    bootstrap,
    get available(){ return available; },
    get authenticated(){ return !!appToken; },
    listStore,
    putStore,
    putBulk,
    deleteStore,
    clearStore,
    parseExcel,
    uploadReceipt,
    receiptUrl,
    deleteReceipt,
    uploadSignature,
    signatureUrl,
    deleteSignature,
    generateHwpx,
    validateSettlement,
    shutdown
  };

  document.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch(console.warn);
  });
})();

/* Copyright 2026@박주가리교감 All rights reserved. */
