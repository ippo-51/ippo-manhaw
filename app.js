// ---- v5 App (with stronger clear & cache busting) ----
const DB_NAME='manhowatyDB_v5', DB_VERSION=1, IMG_STORE='images';
const CACHE_NAME='manhowaty-cache-v5';
let db=null;

// IndexedDB helpers
function openDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(IMG_STORE)){
        d.createObjectStore(IMG_STORE,{keyPath:'id'});
      }
    };
    req.onsuccess=e=>{ db=e.target.result; res(db); };
    req.onerror=e=>rej(e);
  });
}
function saveImage(id, blob){
  return new Promise(async (res,rej)=>{
    try{
      if(!db) await openDB();
      const tx=db.transaction([IMG_STORE],'readwrite');
      tx.objectStore(IMG_STORE).put({id, blob});
      tx.oncomplete=()=>res(true);
      tx.onerror=e=>rej(e);
    }catch(err){ rej(err); }
  });
}
function getImageBlob(id){
  return new Promise(async (res,rej)=>{
    try{
      if(!db) await openDB();
      const tx=db.transaction([IMG_STORE],'readonly');
      const req=tx.objectStore(IMG_STORE).get(id);
      req.onsuccess=()=>{
        const v=req.result;
        if(v && v.blob){ res(v.blob); } else res(null);
      };
      req.onerror=e=>rej(e);
    }catch(err){ rej(err); }
  });
}
async function getImageURL(id){
  const blob = await getImageBlob(id);
  return blob ? URL.createObjectURL(blob) : null;
}
function deleteImage(id){
  return new Promise(async (res,rej)=>{
    try{
      if(!db) await openDB();
      const tx=db.transaction([IMG_STORE],'readwrite');
      tx.objectStore(IMG_STORE).delete(id);
      tx.oncomplete=()=>res(true);
      tx.onerror=e=>rej(e);
    }catch(err){ rej(err); }
  });
}
function blobToDataURL(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL){
  const [meta, base64] = dataURL.split(',');
  const mime = meta.match(/data:(.*);base64/)[1];
  const bin = atob(base64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for(let i=0;i<len;i++) u8[i]=bin.charCodeAt(i);
  return new Blob([u8], {type:mime});
}

// Image resize/compress
const MAX_W = 1080, MAX_H = 1600, JPEG_Q = 0.85;
function loadImageFromBlob(blob){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}
async function resizeBlob(blob){
  try{
    const img = await loadImageFromBlob(blob);
    let w = img.naturalWidth, h = img.naturalHeight;
    const r = Math.min(1, MAX_W / w, MAX_H / h);
    const nw = Math.round(w * r), nh = Math.round(h * r);
    const canvas = document.createElement('canvas');
    canvas.width = nw; canvas.height = nh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, nw, nh);
    const dataURL = canvas.toDataURL('image/jpeg', JPEG_Q);
    const outBlob = dataURLToBlob(dataURL);
    URL.revokeObjectURL(img.src);
    return { blob: outBlob, dataURL };
  }catch(e){
    return { blob, dataURL: await blobToDataURL(blob) };
  }
}
async function fetchAndResize(url){
  try{
    const resp = await fetch(url, {mode:'cors'});
    const b = await resp.blob();
    return await resizeBlob(b);
  }catch(e){
    return { blob: null, dataURL: null };
  }
}

// App State
const lsKey="ippo_manhowaty_v5";
let data=[], editIndex=-1, deferredPrompt=null, pendingBlob=null, pendingDataURL='';

const el=s=>document.querySelector(s);
const listEl=el("#list"), emptyEl=el("#empty"), backdrop=el("#backdrop"), modalTitle=el("#modalTitle"),
preview=el("#preview"), imgFile=el("#imgFile"), imgUrl=el("#imgUrl"), title=el("#title"), chapter=el("#chapter"),
link=el("#link"), catSel=el("#category"), btnAdd=el("#btnAdd"), btnExport=el("#btnExport"), btnClear=el("#btnClear"),
importFile=el("#importFile"), btnSave=el("#save"), btnCancel=el("#cancel"), btnInstall=el("#btnInstall"),
toastEl=el("#toast");

function toast(m){ toastEl.textContent=m; toastEl.style.display="block"; setTimeout(()=>toastEl.style.display="none",2200); }

function load(){
  try{ const raw=localStorage.getItem(lsKey); data=raw?JSON.parse(raw):[]; }catch(e){ data=[]; }
  render();
}
function save(){ localStorage.setItem(lsKey, JSON.stringify(data)); }

function showModal(edit=false, idx=-1){
  backdrop.style.display='flex';
  modalTitle.textContent=edit?'تعديل مانهوا':'إضافة مانهوا';
  editIndex=edit?idx:-1; pendingBlob=null; pendingDataURL='';
  if(edit){
    const it=data[idx];
    preview.src='';
    if(it.imgData){ preview.src = it.imgData; }
    else if(it.imgUrl){ preview.src=it.imgUrl; }
    else if(it.imgKey){ getImageURL(it.imgKey).then(u=>{ if(u) preview.src=u; }); }
    imgFile.value=''; imgUrl.value=''; title.value=it.title||''; chapter.value=it.chapter??''; link.value=it.link||'';
    catSel.value = it.category || "";
  }else{
    preview.src=''; imgFile.value=''; imgUrl.value=''; title.value=''; chapter.value=''; link.value=''; catSel.value="";
  }
  title.focus();
}
function hideModal(){ backdrop.style.display='none'; }

imgFile.addEventListener('change', async () => {
  const f=imgFile.files[0]; if(!f) return;
  const { blob, dataURL } = await resizeBlob(f);
  pendingBlob = blob; pendingDataURL = dataURL;
  preview.src = dataURL;
  imgUrl.value='';
});
imgUrl.addEventListener('change', async ()=>{
  if(!imgUrl.value.trim()){ return; }
  const { blob, dataURL } = await fetchAndResize(imgUrl.value.trim());
  if (blob && dataURL){
    pendingBlob = blob; pendingDataURL = dataURL;
    preview.src = dataURL;
  }else{
    pendingBlob=null; pendingDataURL=''; preview.src=imgUrl.value.trim();
  }
});

function makeId(){ return 'it_' + Date.now() + '_' + Math.random().toString(16).slice(2); }

async function upsertItem(item, idx=-1){
  if(pendingBlob){
    const id = item.imgKey || makeId();
    await saveImage(id, pendingBlob);
    item.imgKey = id; item.imgUrl = '';
    item.imgData = pendingDataURL || await blobToDataURL(pendingBlob);
  }else if(item.imgUrl){
    const { dataURL } = await fetchAndResize(item.imgUrl);
    item.imgData = dataURL || item.imgData || '';
  }else if(item.imgData){
    // keep
  }else{
    item.imgKey = item.imgKey || '';
    item.imgUrl = '';
    item.imgData = '';
  }
  if(idx>=0) data[idx]=item; else data.unshift(item);
  save(); render(); hideModal();
}

btnSave.addEventListener('click', async ()=>{
  const t=title.value.trim(); if(!t){ alert('أدخل عنوان المانهوا'); title.focus(); return; }
  const ch=Number(chapter.value||0); const lk=link.value.trim();
  let base=editIndex>=0 ? {...data[editIndex]} : {};
  const item = {
    id: base.id || makeId(),
    title: t,
    chapter: isNaN(ch)?0:ch,
    link: lk,
    category: catSel.value || "",
    imgKey: base.imgKey || '',
    imgUrl: imgUrl.value.trim() || base.imgUrl || '',
    imgData: base.imgData || '',
    addedAt: base.addedAt || Date.now()
  };
  await upsertItem(item, editIndex);
});

btnCancel.addEventListener('click', hideModal);
btnAdd.addEventListener('click', ()=>showModal(false));

async function render(){
  listEl.innerHTML='';
  if(!data.length){ emptyEl.style.display='block'; return; }
  emptyEl.style.display='none';

  for (let i=0;i<data.length;i++){
    const it=data[i];
    const card=document.createElement('div'); card.className='card';
    const th=document.createElement('div'); th.className='thumb';
    const img=document.createElement('img');
    let hasImage=false;
    if(it.imgData){ img.src = it.imgData; hasImage=true; }
    else if(it.imgUrl){ img.src = it.imgUrl; hasImage=true; }
    else if(it.imgKey){ const u = await getImageURL(it.imgKey); if(u){ img.src=u; hasImage=true; } }
    if(hasImage){ th.appendChild(img); } else { th.innerHTML='<div class="muted">لا يوجد غلاف</div>'; }

    const meta=document.createElement('div'); meta.className='meta';
    const ttl=document.createElement('div'); ttl.className='title'; ttl.textContent=it.title || '(بدون عنوان)';
    const row1=document.createElement('div'); row1.className='row';
    const kpis=document.createElement('div'); kpis.className='kpis';
    const k1=document.createElement('div'); k1.className='kpi'; k1.textContent='شابتر: ' + (it.chapter??0);
    kpis.appendChild(k1);
    if((it.category||"").trim()!==""){
      const kc=document.createElement('div'); kc.className='kpi'; kc.textContent=it.category; kpis.appendChild(kc);
    }
    const a=document.createElement('a'); a.href=it.link||'#'; a.target='_blank'; a.className='link'; a.textContent=it.link?'فتح الرابط':'—';
    row1.appendChild(kpis); row1.appendChild(a);

    const actions=document.createElement('div'); actions.className='actions';
    const btnPlus=document.createElement('button'); btnPlus.textContent='+1 شابتر';
    btnPlus.addEventListener('click', ()=>{ it.chapter=(it.chapter||0)+1; save(); render(); });
    const btnCopy=document.createElement('button'); btnCopy.textContent='📋 نسخ';
    btnCopy.addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(it.title||""); toast('تم نسخ الاسم'); }
      catch(e){
        const ta=document.createElement('textarea'); ta.value=it.title||""; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('تم نسخ الاسم');
      }
    });
    const btnEdit=document.createElement('button'); btnEdit.className='secondary'; btnEdit.textContent='تعديل';
    btnEdit.addEventListener('click', ()=> showModal(true, i));
    const btnDel=document.createElement('button'); btnDel.className='danger'; btnDel.textContent='حذف';
    btnDel.addEventListener('click', async ()=>{
      if(confirm('حذف المانهوا؟')){
        if(it.imgKey){ await deleteImage(it.imgKey); }
        data.splice(i,1); save(); render();
      }
    });
    actions.appendChild(btnPlus); actions.appendChild(btnCopy); actions.appendChild(btnEdit); actions.appendChild(btnDel);

    meta.appendChild(ttl); meta.appendChild(row1); meta.appendChild(actions);
    card.appendChild(th); card.appendChild(meta);
    listEl.appendChild(card);
  }
}

// Backup with embedded images
btnExport.addEventListener('click', async ()=>{
  const out = [];
  for(const it of data){
    const entry = {...it};
    if(it.imgKey && !it.imgData){
      const b = await getImageBlob(it.imgKey);
      entry.imgData = b ? await blobToDataURL(b) : (it.imgData || '');
    }
    out.push(entry);
  }
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='manhowaty_backup_v5.json'; a.click(); URL.revokeObjectURL(a.href);
  toast('تم حفظ النسخة (تشمل الصور)');
});

// Import
importFile.addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=async ()=>{
    try{
      const arr=JSON.parse(r.result);
      if(Array.isArray(arr)){
        for(const it of arr){
          if(it.imgData && !it.imgKey){
            const blob = dataURLToBlob(it.imgData);
            const id = 'it_' + Date.now() + '_' + Math.random().toString(16).slice(2);
            await saveImage(id, blob);
            it.imgKey = id;
          }
        }
        data = arr; save(); render(); toast('تم الاسترجاع (مع الصور)');
      } else alert('صيغة الملف غير صحيحة');
    }catch(err){ alert('تعذّر قراءة الملف'); }
  };
  r.readAsText(f);
});

// Clear all (data + images + caches + SW)
btnClear.addEventListener('click', async ()=>{
  if(!confirm('متأكد؟ سيُمسح كل شيء (البيانات + الصور + الكاش) وتُعاد تهيئة التطبيق.')) return;
  try{
    data=[]; save(); localStorage.removeItem(lsKey);
    indexedDB.deleteDatabase(DB_NAME);
    if ('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.filter(k=>k.includes('manhowaty-cache')).map(k=>caches.delete(k)));
    }
    if (navigator.serviceWorker){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    toast('تم المسح الكامل. يُعاد التحميل...');
    setTimeout(()=>location.reload(true), 800);
  }catch(e){
    alert('صار خطأ أثناء المسح. جرّب تحديث الصفحة.');
  }
});

// PWA install prompt
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); deferredPrompt=e; btnInstall.style.display='inline-block';
});
btnInstall.addEventListener('click', async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  const {outcome}=await deferredPrompt.userChoice;
  deferredPrompt=null; btnInstall.style.display='none'; toast(outcome==='accepted'?'تم التثبيت':'تم الإلغاء');
});

openDB().then(load);
