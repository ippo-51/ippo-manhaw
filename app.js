// ---- IndexedDB helpers ----
const DB_NAME='manhowatyDB_v3', DB_VERSION=1, IMG_STORE='images';
let db=null;
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
async function urlToDataURL(url){
  try{
    const resp = await fetch(url, {mode:'cors'});
    const blob = await resp.blob();
    return await blobToDataURL(blob);
  }catch(e){ return null; }
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

// ---- App State ----
const lsKey="ippo_manhowaty_v3";
let data=[], editIndex=-1, deferredPrompt=null, pendingBlob=null;

const el=s=>document.querySelector(s);
const listEl=el("#list"), emptyEl=el("#empty"), backdrop=el("#backdrop"), modalTitle=el("#modalTitle"),
preview=el("#preview"), imgFile=el("#imgFile"), imgUrl=el("#imgUrl"), title=el("#title"), chapter=el("#chapter"),
link=el("#link"), catSel=el("#category"), btnAdd=el("#btnAdd"), btnExport=el("#btnExport"), btnClear=el("#btnClear"),
importFile=el("#importFile"), btnSave=el("#save"), btnCancel=el("#cancel"), btnInstall=el("#btnInstall"),
toastEl=el("#toast");

function toast(m){ toastEl.textContent=m; toastEl.style.display="block"; setTimeout(()=>toastEl.style.display="none",2000); }

function load(){
  try{ const raw=localStorage.getItem(lsKey); data=raw?JSON.parse(raw):[]; }catch(e){ data=[]; }
  render();
}
function save(){ localStorage.setItem(lsKey, JSON.stringify(data)); }

function showModal(edit=false, idx=-1){
  backdrop.style.display='flex';
  modalTitle.textContent=edit?'تعديل مانهوا':'إضافة مانهوا';
  editIndex=edit?idx:-1; pendingBlob=null;
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

function readFileAsBlob(file){ return new Promise((res,rej)=>{ try{ res(file); }catch(e){ rej(e); } }); }

imgFile.addEventListener('change', async () => {
  const f=imgFile.files[0]; if(!f) return;
  pendingBlob = await readFileAsBlob(f);
  preview.src = URL.createObjectURL(pendingBlob);
  imgUrl.value='';
});
imgUrl.addEventListener('input', ()=>{
  pendingBlob=null;
  preview.src = imgUrl.value || '';
});

function makeId(){ return 'it_' + Date.now() + '_' + Math.random().toString(16).slice(2); }

async function upsertItem(item, idx=-1){
  if(pendingBlob){
    const id = item.imgKey || makeId();
    await saveImage(id, pendingBlob);
    item.imgKey = id; item.imgUrl = '';
    item.imgData = await blobToDataURL(pendingBlob);
  }else if(item.imgUrl){
    const d = await urlToDataURL(item.imgUrl);
    item.imgData = d || item.imgData || '';
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
        if(it.imgKey) await deleteImage(it.imgKey);
        data.splice(i,1); save(); render();
      }
    });
    actions.appendChild(btnPlus); actions.appendChild(btnCopy); actions.appendChild(btnEdit); actions.appendChild(btnDel);

    meta.appendChild(ttl); meta.appendChild(row1); meta.appendChild(actions);
    card.appendChild(th); card.appendChild(meta);
    listEl.appendChild(card);
  }
}

// --- Backup with embedded images ---
btnExport.addEventListener('click', async ()=>{
  const out = [];
  for(const it of data){
    const entry = {...it};
    if(it.imgKey && !it.imgData){
      const b = await getImageBlob(it.imgKey);
      entry.imgData = b ? await blobToDataURL(b) : (it.imgData || '');
    }
    if(!entry.imgData && it.imgUrl){
      const d = await urlToDataURL(it.imgUrl);
      entry.imgData = d || '';
    }
    out.push(entry);
  }
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='manhowaty_backup_with_images.json'; a.click(); URL.revokeObjectURL(a.href);
  toast('تم حفظ النسخة (تشمل الصور)');
});

// --- Import (restore images) ---
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

btnClear.addEventListener('click', ()=>{
  if(confirm('متأكد؟ سيُمسح كل شيء (البيانات + الصور).')){
    data=[]; save(); render();
    indexedDB.deleteDatabase(DB_NAME);
    toast('تم مسح الكل'); setTimeout(()=>location.reload(), 500);
  }
});
backdrop.addEventListener('click', e=>{ if(e.target===backdrop) hideModal(); });

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
