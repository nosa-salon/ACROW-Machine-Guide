
function getButtonDepartment(buttonId){
  const b = (state.buttons || []).find(x => x.id === buttonId);
  return b ? (b.department || '') : '';
}
function matchesDepartment(item, filter){
  if (!filter) return true;
  const dept = item && (item.stage || item.department) ? (item.stage || item.department) : getButtonDepartment(item && (item.buttonId || item.button_id));
  return dept === filter;
}
function getSelectedDepartment(){
  const el = document.getElementById('departmentFilter');
  return el ? el.value : '';
}

/* ===== ACROW ENTRY PASSWORD GATE =====
   Shared entry password requested by the owner.
   NOTE: This is a client-side access gate, not Firebase security.
*/
(function(){
  const gate=document.getElementById("loginScreen");
  const enter=document.getElementById("enterAppBtn");
  const input=document.getElementById("acrowPassword");
  const error=document.getElementById("acrowPasswordError");
  const ENTRY_PASSWORD="226633";

  if(!gate || !enter || !input) return;

  function showError(msg){
    if(error) error.textContent=msg;
    input.classList.add("acrow-password-invalid");
    setTimeout(()=>input.classList.remove("acrow-password-invalid"),450);
  }

  function openSystem(){
    document.body.classList.remove("acrow-app-locked");
    gate.classList.add("acrow-hide");
    setTimeout(function(){
      if(gate.parentNode) gate.remove();
    },380);
  }

  function tryEnter(){
    const value=String(input.value||"").trim();
    if(value===ENTRY_PASSWORD){
      if(error) error.textContent="";
      openSystem();
    }else{
      showError("❌ كلمة المرور غير صحيحة");
      input.focus();
      input.select();
    }
  }

  enter.addEventListener("click",tryEnter);
  input.addEventListener("keydown",function(e){
    if(e.key==="Enter"){
      e.preventDefault();
      tryEnter();
    }
  });

  setTimeout(()=>input.focus(),120);
})();


const DB_NAME="ACROW_MACHINE_GUIDE_V4", DB_VER=2, BUTTONS="buttons", FAULTS="faults", STAGES="stages";

let db, currentFilter="all", scanner=null, searchTimer=null, editingButtonImage=null, editingFaultImage=null;

/* ===== Firebase Realtime Database Cloud Sync =====
   Firebase Web SDK is loaded dynamically from Google's official CDN.
   Local IndexedDB remains the fast/offline cache.
*/
const CLOUD_KEY="ACROW_MACHINE_GUIDE_FIREBASE_CONFIG";
let cloud={enabled:false,app:null,auth:null,db:null,ref:null,onValue:null,remove:null,set:null,connected:false,uid:null};

function setCloudUI(state,title,text){
  const dot=$("cloudDot"), badge=$("cloudStatusBadge"), st=$("cloudStatusTitle"), tx=$("cloudStatusText");
  if(dot){dot.className="cloud-dot "+(state==="on"?"on":state==="busy"?"busy":"off")}
  if(badge){badge.className="cloud-badge "+(state==="on"?"on":state==="busy"?"busy":"off");badge.textContent=state==="on"?"متصل":state==="busy"?"جاري الاتصال":"غير متصل"}
  if(st)st.textContent=title||"السحابة";
  if(tx)tx.textContent=text||"";
}
const DEFAULT_FIREBASE_CONFIG={
  apiKey:"AIzaSyClsXgHj6-7kNoxKoRkaqXJVLjfzX31tpw",
  authDomain:"acrow-machine-guide.firebaseapp.com",
  databaseURL:"https://acrow-machine-guide-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"acrow-machine-guide",
  storageBucket:"acrow-machine-guide.firebasestorage.app",
  messagingSenderId:"968582995602",
  appId:"1:968582995602:web:0da1946187b4275cc6504b"
};
function getSavedFirebaseConfig(){
  try{
    const saved=JSON.parse(localStorage.getItem(CLOUD_KEY)||"null");
    return saved&&saved.apiKey&&saved.projectId&&saved.appId
      ? {...DEFAULT_FIREBASE_CONFIG,...saved}
      : DEFAULT_FIREBASE_CONFIG;
  }catch(e){return DEFAULT_FIREBASE_CONFIG}
}
function saveFirebaseConfig(cfg){
  localStorage.setItem(CLOUD_KEY,JSON.stringify({...DEFAULT_FIREBASE_CONFIG,...cfg}))
}
async function loadFirebaseModules(){
  const appMod=await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");
  const authMod=await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
  const dbMod=await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js");
  return {...appMod,...authMod,...dbMod};
}
async function connectCloud(cfg,announce=true){
  setCloudUI("busy","جاري الاتصال بالسحابة…","يتم تسجيل الدخول والمزامنة.");
  try{
    const M=await loadFirebaseModules();
    const app=(()=>{
      try{return M.getApp("ACROWMachineGuide")}
      catch(e){return M.initializeApp({...DEFAULT_FIREBASE_CONFIG,...cfg},"ACROWMachineGuide")}
    })();
    const auth=M.getAuth(app);
    const cred=await M.signInAnonymously(auth);
    const r=M.ref(M.getDatabase(app),"acrowMachineGuide");
    cloud={enabled:true,app,auth,db:M.getDatabase(app),ref:r,onValue:M.onValue,remove:M.remove,set:M.set,connected:true,uid:cred.user.uid,mods:M};
    saveFirebaseConfig(cfg);
    await initialCloudMerge();
    attachCloudListeners();
    setCloudUI("on","السحابة متصلة","المزامنة الفورية مفعلة على هذا الجهاز.");
    if(announce)toast("☁️ تم الاتصال بالسحابة والمزامنة");
    return true;
  }catch(e){
    console.error("Firebase:",e);
    cloud.connected=false;
    setCloudUI("off","تعذر الاتصال بالسحابة",friendlyFirebaseError(e));
    if(announce)alert("تعذر الاتصال بقاعدة Firebase:\\n"+friendlyFirebaseError(e));
    return false;
  }
}
function friendlyFirebaseError(e){
  const c=e?.code||"";
  if(c.includes("auth/operation-not-allowed"))return "فعّل Anonymous في Firebase Authentication.";
  if(c.includes("permission-denied"))return "راجع Security Rules الخاصة بـ Realtime Database.";
  if(c.includes("database"))return "تأكد من databaseURL وإنشاء Realtime Database.";
  return e?.message||"تحقق من إعدادات Firebase والإنترنت.";
}
async function initialCloudMerge(){
  if(!cloud.connected)return;
  const snap=await cloud.mods.get(cloud.ref);
  const remote=snap.exists()?snap.val():null;
  const localB=await getAll(BUTTONS), localF=await getAll(FAULTS);
  const hasRemote=remote && ((remote.buttons&&Object.keys(remote.buttons).length)||(remote.faults&&Object.keys(remote.faults).length)||(remote.stages&&Object.keys(remote.stages).length));
  if(hasRemote){
    await replaceLocalFromCloud(remote);
  }else if(localB.length||localF.length){
    await pushAllLocalToCloud(localB,localF,await getAll(STAGES));
  }
}
async function replaceLocalFromCloud(remote){
  const rb=remote?.buttons||{}, rf=remote?.faults||{}, rs=remote?.stages||{};
  const lb=await getAll(BUTTONS), lf=await getAll(FAULTS), ls=await getAll(STAGES);
  for(const b of lb)await del(BUTTONS,b.id);
  for(const f of lf)await del(FAULTS,f.id);
  for(const s of ls)await del(STAGES,s.id);
  for(const b of Object.values(rb))await put(BUTTONS,b);
  for(const f of Object.values(rf))await put(FAULTS,f);
  for(const s of Object.values(rs))await put(STAGES,s);
  await ensureStagesFromButtons();
  await refreshStats();await populateFaultButtons();await populateStageSelects();await renderStages();await renderManage();await doSearch();
}
async function pushAllLocalToCloud(bs,fs,ss=[]){
  const data={buttons:{},faults:{},stages:{}};
  bs.forEach(x=>data.buttons[x.id]=x);
  fs.forEach(x=>data.faults[x.id]=x);
  ss.forEach(x=>data.stages[x.id]=x);
  await cloud.mods.set(cloud.ref,data);
}
function attachCloudListeners(){
  if(!cloud.connected)return;
  cloud.onValue(cloud.mods.ref(cloud.db,"acrowMachineGuide/buttons"),async snap=>{
    const data=snap.val()||{};
    const local=await getAll(BUTTONS), incoming=new Set(Object.keys(data));
    for(const b of local)if(!incoming.has(b.id))await del(BUTTONS,b.id);
    for(const b of Object.values(data))await put(BUTTONS,b);
    await refreshStats();await populateFaultButtons();await renderManage();await doSearch();
  });
  cloud.onValue(cloud.mods.ref(cloud.db,"acrowMachineGuide/faults"),async snap=>{
    const data=snap.val()||{};
    const local=await getAll(FAULTS), incoming=new Set(Object.keys(data));
    for(const f of local)if(!incoming.has(f.id))await del(FAULTS,f.id);
    for(const f of Object.values(data))await put(FAULTS,f);
    await refreshStats();await renderManage();await doSearch();
  });
  cloud.onValue(cloud.mods.ref(cloud.db,"acrowMachineGuide/stages"),async snap=>{
    const data=snap.val()||{};
    const local=await getAll(STAGES), incoming=new Set(Object.keys(data));
    for(const s of local)if(!incoming.has(s.id))await del(STAGES,s.id);
    for(const s of Object.values(data))await put(STAGES,s);
    await ensureStagesFromButtons();await populateStageSelects();await renderStages();await doSearch();
  });
}
async function cloudPut(type,obj){
  if(!cloud.connected)return;
  try{await cloud.mods.set(cloud.mods.ref(cloud.db,`acrowMachineGuide/${type}/${obj.id}`),obj)}
  catch(e){console.error(e);toast("⚠️ تم الحفظ محليًا لكن تعذر رفعه للسحابة")}
}
async function cloudDelete(type,id){
  if(!cloud.connected)return;
  try{await cloud.mods.remove(cloud.mods.ref(cloud.db,`acrowMachineGuide/${type}/${id}`))}
  catch(e){console.error(e);toast("⚠️ تم الحذف محليًا لكن تعذر الحذف من السحابة")}
}
function openCloudModal(){
  const m=$("cloudModal");m.classList.remove("hidden");
  const cfg=getSavedFirebaseConfig();
  if(cfg)$("firebaseConfigInput").value=JSON.stringify(cfg,null,2);
}
function closeCloudModal(){ $("cloudModal").classList.add("hidden") }
async function connectFromUI(){
  let cfg;
  try{cfg=JSON.parse($("firebaseConfigInput").value.trim())}catch(e){alert("الصق Firebase Web Config بصيغة JSON صحيحة.");return}
  cfg={...DEFAULT_FIREBASE_CONFIG,...cfg};
  if(!cfg.apiKey||!cfg.projectId||!cfg.appId||!cfg.databaseURL){alert("الـ Firebase Config ناقص. تأكد من إعدادات Firebase.");return}
  await connectCloud(cfg,true);
}
function disconnectCloud(){
  cloud.connected=false;cloud.enabled=false;localStorage.removeItem(CLOUD_KEY);
  setCloudUI("off","السحابة غير مفعلة","تم فصل إعداد Firebase من هذا الجهاز. البيانات المحلية لم تُحذف.");
  toast("تم فصل السحابة من هذا الجهاز");
}


const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const norm=v=>String(v??"").toLowerCase().normalize("NFKC").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/ـ/g,"").replace(/[\u064B-\u065F\u0670]/g,"").trim();
const uid=()=>Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("show"),2200)}
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VER);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(BUTTONS)){const s=d.createObjectStore(BUTTONS,{keyPath:"id"});s.createIndex("machine","machine");s.createIndex("name","name");s.createIndex("code","code")}if(!d.objectStoreNames.contains(FAULTS)){const s=d.createObjectStore(FAULTS,{keyPath:"id"});s.createIndex("buttonId","buttonId");s.createIndex("code","code");s.createIndex("name","name")}if(!d.objectStoreNames.contains(STAGES)){const s=d.createObjectStore(STAGES,{keyPath:"id"});s.createIndex("name","name")}};r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function getAll(name){return new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function put(name,obj){return new Promise((res,rej)=>{const r=store(name,"readwrite").put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})}
function del(name,id){return new Promise((res,rej)=>{const r=store(name,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function ensureStagesFromButtons(){
  const [bs, existing] = await Promise.all([getAll(BUTTONS), getAll(STAGES)]);
  const names = new Set(existing.map(s=>String(s.name||"").trim()).filter(Boolean));
  for(const b of bs){
    const name = String(b.stage || b.department || "").trim();
    if(name && !names.has(name)){
      const obj={id:"stage-"+uid(),name,createdAt:Date.now(),updatedAt:Date.now()};
      await put(STAGES,obj);
      names.add(name);
    }
    // Keep old data working while moving to the new "stage" field.
    if(name && !b.stage){
      b.stage=name;
      await put(BUTTONS,b);
    }
  }
}
async function getStageNames(){
  const ss=await getAll(STAGES);
  return ss.map(s=>String(s.name||"").trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ar'));
}
async function populateStageSelects(){
  const names=await getStageNames();
  const bSel=$("bStage"), fSel=$("stageFilter");
  if(bSel){
    const current=bSel.value;
    bSel.innerHTML='<option value="">— اختر المرحلة —</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if(current && names.includes(current)) bSel.value=current;
  }
  if(fSel){
    const current=fSel.value;
    fSel.innerHTML='<option value="">كل المراحل</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if(current && names.includes(current)) fSel.value=current;
  }
}
async function renderStages(){
  const box=$("stageList"); if(!box)return;
  const stages=await getAll(STAGES);
  stages.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),'ar'));
  box.innerHTML=stages.length?stages.map(s=>`<div class="stage-item"><span>🧩 ${esc(s.name)}</span><button class="small-btn danger" onclick="deleteStage('${s.id}')">🗑️</button></div>`).join(""):`<p class="muted">لا توجد مراحل مضافة بعد.</p>`;
}
async function addStage(){
  const input=$("newStageName");
  const name=String(input?.value||"").trim();
  if(!name){toast("اكتب اسم المرحلة أولًا");input?.focus();return}
  const names=await getStageNames();
  if(names.some(x=>norm(x)===norm(name))){toast("هذه المرحلة موجودة بالفعل");input.focus();return}
  const obj={id:"stage-"+uid(),name,createdAt:Date.now(),updatedAt:Date.now()};
  await put(STAGES,obj);
  await cloudPut("stages",obj);
  input.value="";
  await populateStageSelects();
  await renderStages();
  toast("تم حفظ المرحلة");
}
async function deleteStage(id){
  const ss=await getAll(STAGES), s=ss.find(x=>x.id===id);
  if(!s)return;
  const bs=await getAll(BUTTONS);
  const used=bs.filter(b=>String(b.stage||b.department||"")===String(s.name)).length;
  const msg=used?`المرحلة "${s.name}" مستخدمة في ${used} زر. هل تريد حذفها من قائمة المراحل؟ ستظل بيانات الأزرار كما هي.`:`هل تريد حذف المرحلة "${s.name}"؟`;
  if(!confirm(msg))return;
  await del(STAGES,id);
  await cloudDelete("stages",id);
  await populateStageSelects();
  await renderStages();
  toast("تم حذف المرحلة من القائمة");
}

async function seed(){const bs=await getAll(BUTTONS);if(bs.length)return;const b={id:uid(),machine:"ماكينة 999",screen:"Main Screen",name:"START",number:"1",code:"M999-START",desc:"زر بدء دورة التشغيل.",image:"",createdAt:Date.now()};await put(BUTTONS,b);await put(FAULTS,{id:uid(),buttonId:b.id,code:"F001",name:"مثال عطل",desc:"مثال توضيحي يمكن تعديله أو حذفه.",solution:"1. أوقف الماكينة بأمان.\n2. افحص سبب العطل.\n3. نفذ الإجراء المناسب.\n4. أعد التشغيل بعد التأكد من السلامة.",image:"",createdAt:Date.now()})}
async function readFile(file){return new Promise((res,rej)=>{if(!file)return res("");const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file)})}
function resetButton(){ $("buttonFormEl").reset();$("buttonId").value="";editingButtonImage=null;$("bImagePreview").innerHTML="";if($("bStage"))$("bStage").value=""}
function resetFault(){ $("faultFormEl").reset();$("faultId").value="";editingFaultImage=null;$("fImagePreview").innerHTML=""}
async function refreshStats(){const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]);$("statMachines").textContent=new Set(bs.map(x=>x.machine).filter(Boolean)).size;$("statButtons").textContent=bs.length;$("statFaults").textContent=fs.length;$("statImages").textContent=bs.filter(x=>x.image).length+fs.filter(x=>x.image).length}
function buttonById(bs,id){return bs.find(x=>x.id===id)}
async function populateFaultButtons(){const bs=await getAll(BUTTONS);$("fButton").innerHTML=bs.sort((a,b)=>a.name.localeCompare(b.name)).map(b=>`<option value="${esc(b.id)}">${esc(b.machine)} — ${esc(b.name)}${b.code?" — "+esc(b.code):""}</option>`).join("")}
function matchButton(b,q){const s=[b.machine,b.screen,b.stage,b.department,b.name,b.number,b.code,b.desc].map(norm).join(" ");return !q||s.includes(norm(q))}
function matchFault(f,bs,q){const b=buttonById(bs,f.buttonId);const s=[f.code,f.name,f.desc,f.solution,b?.machine,b?.screen,b?.name,b?.number,b?.code].map(norm).join(" ");return !q||s.includes(norm(q))}
async function doSearch(q=$("globalSearch").value){q=q.trim();const stageFilter=String($("stageFilter")?.value||"");const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]);const stageOf=b=>String(b?.stage||b?.department||"");let out=[];if(currentFilter!=="fault")bs.filter(b=>(!stageFilter||stageOf(b)===stageFilter)&&matchButton(b,q)).slice(0,80).forEach(b=>out.push({type:"button",data:b}));if(currentFilter!=="button")fs.filter(f=>{const b=buttonById(bs,f.buttonId);return (!stageFilter||stageOf(b)===stageFilter)&&matchFault(f,bs,q)}).slice(0,120).forEach(f=>out.push({type:"fault",data:f,button:buttonById(bs,f.buttonId)}));$("resultCount").textContent=out.length?`(${out.length})`:"";$("searchStatus").textContent=q?`تم العثور على ${out.length} نتيجة`:(stageFilter?`المرحلة: ${stageFilter}`:"اكتب كلمة للبحث…");renderResults(out)}
function renderResults(out){const box=$("results");if(!out.length){box.className="results empty";box.innerHTML=`<div class="empty-icon">🔎</div><h3>لا توجد نتائج</h3><p>جرّب اسم الزر أو رقم الـ Fault أو كلمة من وصف المشكلة.</p>`;return}box.className="results";box.innerHTML=out.map((x,i)=>x.type==="button"?buttonCard(x.data):faultCard(x.data,x.button)).join("")}
function buttonCard(b){return `<article class="card"><span class="tag">🔘 زر</span><h4>${esc(b.name)}</h4><div class="meta">🏭 ${esc(b.machine)}<br>🧩 ${esc(b.stage||b.department||"—")}<br>🖥 ${esc(b.screen||"—")}<br>🔢 ${esc(b.number||"—")} &nbsp; Code: ${esc(b.code||"—")}</div><div class="card-actions"><button class="small-btn" onclick="showButton('${b.id}')">فتح التفاصيل</button><button class="small-btn" onclick="showQR('${esc(b.code||b.id)}','button','${b.id}')">QR / Barcode</button></div></article>`}
function faultCard(f,b){return `<article class="card"><span class="tag">🔧 Fault</span><h4>${esc(f.code)} — ${esc(f.name)}</h4><div class="meta">🔘 ${esc(b?.name||"غير مرتبط")}<br>🏭 ${esc(b?.machine||"—")}<br>${esc(f.desc||"")}</div><div class="card-actions"><button class="small-btn" onclick="showFault('${f.id}')">طريقة الحل</button><button class="small-btn" onclick="showQR('${esc(f.code||f.id)}','fault','${f.id}')">QR / Barcode</button></div></article>`}

async function showButton(id){
  const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]);
  const b=bs.find(x=>x.id===id); if(!b)return;
  const faults=fs.filter(f=>f.buttonId===id), code=b.code||b.id;
  $("detailSection").classList.remove("hidden");
  $("detail").innerHTML=`<div class="detail-wrap"><div class="detail-grid"><div>${b.image?`<img class="detail-image" src="${b.image}" alt="">`:`<div class="detail-image" style="height:200px;display:grid;place-items:center">🔘 لا توجد صورة</div>`}</div><div class="detail"><span class="tag">🔘 زر</span><h2>${esc(b.name)}</h2><p class="muted">🏭 ${esc(b.machine)} &nbsp; | &nbsp; 🧩 ${esc(b.stage||b.department||"—")} &nbsp; | &nbsp; 🖥 ${esc(b.screen||"—")} &nbsp; | &nbsp; 🔢 ${esc(b.number||"—")}</p><p>${esc(b.desc||"لا يوجد وصف.")}</p><p class="muted">🏷️ كود الوصول: <b>${esc(code)}</b></p><div class="detail-actions"><button class="btn primary" onclick="printButton('${b.id}')">🖨️ طباعة تفاصيل الزر</button><button class="btn" onclick="showQR('${esc(code)}','button','${b.id}')">▦ QR / Barcode</button><button class="btn danger" onclick="deleteButtonFromDetail('${b.id}')">🗑️ حذف الزر</button></div><h3>🔧 الأعطال المرتبطة (${faults.length})</h3>${faults.length?faults.map(f=>`<div class="fault-box"><h4>${esc(f.code)} — ${esc(f.name)}</h4><p>${esc(f.desc||"")}</p><div class="solution">${esc(f.solution||"لا توجد طريقة حل مسجلة.")}</div>${f.image?`<img class="detail-image" style="max-height:220px;margin-top:10px" src="${f.image}" alt="">`:""}<div class="card-actions"><button class="small-btn" onclick="editFault('${f.id}')">✏️ تعديل</button><button class="small-btn" onclick="printFault('${f.id}')">🖨️ طباعة</button><button class="small-btn" onclick="showQR('${esc(f.code||f.id)}','fault','${f.id}')">▦ QR</button><button class="small-btn danger" onclick="deleteFault('${f.id}');showButton('${b.id}')">🗑️ حذف</button></div></div>`).join(""):`<p class="muted">لا توجد أعطال مرتبطة بهذا الزر.</p>`}</div></div></div>`;
  $("detailSection").scrollIntoView({behavior:"smooth",block:"start"})
}
async function showFault(id){const fs=await getAll(FAULTS);const f=fs.find(x=>x.id===id);if(!f)return;await showButton(f.buttonId);setTimeout(()=>{$("detailSection").scrollIntoView({behavior:"smooth",block:"start"})},30)}
function openAdmin(){ $("adminSection").classList.remove("hidden");populateFaultButtons();populateStageSelects();renderStages();renderManage();$("adminSection").scrollIntoView({behavior:"smooth"})}
function closeAdmin(){ $("adminSection").classList.add("hidden")}
async function saveButton(e){e.preventDefault();const id=$("buttonId").value||uid();const old=(await getAll(BUTTONS)).find(x=>x.id===id);const file=$("bImage").files[0];const image=file?await readFile(file):(editingButtonImage??"");const stage=$("bStage").value.trim();const obj={id,machine:$("bMachine").value.trim(),screen:$("bScreen").value.trim(),stage,department:stage,name:$("bName").value.trim(),number:$("bNumber").value.trim(),code:$("bCode").value.trim(),desc:$("bDesc").value.trim(),image,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};await put(BUTTONS,obj);await cloudPut("buttons",obj);toast("تم حفظ الزر بنجاح");resetButton();await refreshStats();await populateFaultButtons();await renderManage();doSearch();$("globalSearch").focus()}
async function saveFault(e){e.preventDefault();const id=$("faultId").value||uid();const old=(await getAll(FAULTS)).find(x=>x.id===id);const file=$("fImage").files[0];const image=file?await readFile(file):(editingFaultImage??"");const obj={id,buttonId:$("fButton").value,code:$("fCode").value.trim(),name:$("fName").value.trim(),desc:$("fDesc").value.trim(),solution:$("fSolution").value.trim(),image,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};await put(FAULTS,obj);await cloudPut("faults",obj);toast("تم حفظ العطل بنجاح");resetFault();await refreshStats();await renderManage();doSearch()}
async function editButton(id){const bs=await getAll(BUTTONS),b=bs.find(x=>x.id===id);if(!b)return;$("buttonId").value=b.id;$("bMachine").value=b.machine||"";$("bScreen").value=b.screen||"";$("bStage").value=b.stage||b.department||"";$("bName").value=b.name||"";$("bNumber").value=b.number||"";$("bCode").value=b.code||"";$("bDesc").value=b.desc||"";editingButtonImage=b.image||"";$("bImagePreview").innerHTML=b.image?`<img src="${b.image}">`:"";switchAdminTab("buttonForm");openAdmin();$("bName").focus()}
async function editFault(id){const fs=await getAll(FAULTS),f=fs.find(x=>x.id===id);if(!f)return;$("faultId").value=f.id;await populateFaultButtons();$("fButton").value=f.buttonId;$("fCode").value=f.code||"";$("fName").value=f.name||"";$("fDesc").value=f.desc||"";$("fSolution").value=f.solution||"";editingFaultImage=f.image||"";$("fImagePreview").innerHTML=f.image?`<img src="${f.image}">`:"";switchAdminTab("faultForm");openAdmin();$("fName").focus()}
async function deleteButton(id){
  try{
    const bs=await getAll(BUTTONS);
    const button=bs.find(x=>String(x.id)===String(id));
    if(!button){toast("الزر غير موجود أو تم حذفه بالفعل");await renderManage();return}
    if(!confirm(`هل تريد حذف الزر "${button.name||button.code||button.id}"؟ سيتم حذف الأعطال المرتبطة به أيضًا.`))return;
    const fs=await getAll(FAULTS);
    const linked=fs.filter(x=>String(x.buttonId)===String(id));
    for(const f of linked) await del(FAULTS,f.id);
    await del(BUTTONS,id);
    await cloudDelete("buttons",id);
    for(const f of linked) await cloudDelete("faults",f.id);
    $("detailSection")?.classList.add("hidden");
    toast("✅ تم حذف الزر وجميع الأعطال المرتبطة به");
    await refreshStats();
    await populateFaultButtons();
    await renderManage();
    await doSearch();
  }catch(e){
    console.error("deleteButton:",e);
    toast("⚠️ حدث خطأ أثناء حذف الزر");
  }
}
async function deleteButtonFromDetail(id){ await deleteButton(id); }
async function deleteFault(id){if(!confirm("هل تريد حذف هذا العطل؟"))return;await del(FAULTS,id);await cloudDelete("faults",id);toast("تم حذف العطل");await refreshStats();await renderManage();doSearch()}
async function renderManage(){const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]),q=norm($("manageSearch")?.value||"");const rows=[];bs.forEach(b=>{if(!q||norm([b.machine,b.screen,b.name,b.code,b.number,b.desc].join(" ")).includes(q))rows.push(`<div class="manage-item"><div><b>🔘 ${esc(b.name)}</b><div class="muted">${esc(b.machine)} — المرحلة: ${esc(b.stage||b.department||"—")} — ${esc(b.screen||"—")} — QR: ${esc(b.code||"—")} — ${fs.filter(f=>f.buttonId===b.id).length} أعطال</div></div><div class="manage-actions"><button class="small-btn" onclick="editButton('${b.id}')">✏️</button><button class="small-btn" onclick="printButton('${b.id}')">🖨️</button><button class="small-btn" onclick="showQR('${esc(b.code||b.id)}','button','${b.id}')">▦</button><button class="small-btn danger" onclick="deleteButton('${b.id}')">🗑️</button></div></div>`)});fs.forEach(f=>{const b=bs.find(x=>x.id===f.buttonId);if(!q||norm([f.code,f.name,f.desc,f.solution,b?.name,b?.machine].join(" ")).includes(q))rows.push(`<div class="manage-item"><div><b>🔧 ${esc(f.code)} — ${esc(f.name)}</b><div class="muted">زر: ${esc(b?.name||"—")} — ${esc(b?.machine||"—")} — المرحلة: ${esc(b?.stage||b?.department||"—")}</div></div><div class="manage-actions"><button class="small-btn" onclick="editFault('${f.id}')">✏️</button><button class="small-btn" onclick="printFault('${f.id}')">🖨️</button><button class="small-btn" onclick="showQR('${esc(f.code||f.id)}','fault','${f.id}')">▦</button><button class="small-btn danger" onclick="deleteFault('${f.id}')">🗑️</button></div></div>`)});$("manageList").innerHTML=rows.length?rows.join(""):`<p class="muted">لا توجد بيانات.</p>`}
function switchAdminTab(id){document.querySelectorAll(".admin-tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));document.querySelectorAll(".admin-tab-content").forEach(x=>x.classList.toggle("hidden",x.id!==id))}
async function backup(){const [bs,fs,ss]=await Promise.all([getAll(BUTTONS),getAll(FAULTS),getAll(STAGES)]);const blob=new Blob([JSON.stringify({version:5,exportedAt:new Date().toISOString(),buttons:bs,faults:fs,stages:ss})],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="ACROW_Machine_Guide_Backup.json";a.click();URL.revokeObjectURL(a.href);toast("تم إنشاء النسخة الاحتياطية")}
async function restore(file){try{const obj=JSON.parse(await file.text());if(!Array.isArray(obj.buttons)||!Array.isArray(obj.faults))throw Error();for(const b of obj.buttons)await put(BUTTONS,b);for(const f of obj.faults)await put(FAULTS,f);if(Array.isArray(obj.stages)){for(const s of obj.stages)await put(STAGES,s)}else{await ensureStagesFromButtons()}if(cloud.connected)await pushAllLocalToCloud(await getAll(BUTTONS),await getAll(FAULTS),await getAll(STAGES));toast("تم استعادة البيانات");await refreshStats();await populateFaultButtons();await populateStageSelects();await renderStages();await renderManage();doSearch()}catch(e){alert("ملف النسخة الاحتياطية غير صحيح.")}}

function stableCodeForItem(item, prefix){
  if (!item) return '';
  if (item.code) return String(item.code);
  if (item.qrCode) return String(item.qrCode);
  if (item.barcode) return String(item.barcode);
  return String(prefix || 'ACROW') + '-' + String(item.id || '');
}

function showQR(code,type="button",id=""){
  const modal=$("qrModal"); modal.classList.remove("hidden");
  const qrBox=$("qrVisual"), barBox=$("barcodeVisual"); qrBox.innerHTML=""; barBox.innerHTML="";
  const label=type==="fault"?"العطل":"الزر";
  $("qrModalTitle").textContent=`▦ ${label} — QR / Barcode`;
  $("qrModalHint").textContent=`الكود: ${code} — يمكنك طباعته ولصقه للوصول السريع.`;
  $("scanResult").innerHTML=`${label}: <b>${esc(code)}</b>`;
  if(window.QRCode) new QRCode(qrBox,{text:String(code),width:190,height:190,correctLevel:QRCode.CorrectLevel.M});
  else qrBox.innerHTML=`<p class="muted">مكتبة QR لم تُحمّل بعد.</p>`;
  if(window.JsBarcode){const svg=document.createElement("svg");barBox.appendChild(svg);try{JsBarcode(svg,String(code),{format:"CODE128",displayValue:true,height:65,width:2,margin:8})}catch(e){barBox.innerHTML=`<p class="muted">تعذر إنشاء Barcode لهذا الكود.</p>`}}
  $("printQrBtn").onclick=()=>printCode(code,label);
}
function printCode(code,label="الزر"){
  const w=window.open("","_blank","width=700,height=800"); if(!w){alert("اسمح بالنوافذ المنبثقة للطباعة.");return}
  const qr=$("qrVisual").innerHTML, bar=$("barcodeVisual").innerHTML;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة ${esc(label)}</title><style>body{font-family:Arial,Tahoma;text-align:center;padding:30px;color:#111}h1{font-size:25px}.qr{margin:20px auto}.barcode{margin:20px auto}svg{max-width:95%}@media print{button{display:none}}</style></head><body><h1>ACROW Machine Guide</h1><h2>${esc(label)}</h2><p>كود الوصول: <b>${esc(code)}</b></p><div class="qr">${qr}</div><div class="barcode">${bar}</div><button onclick="window.print()">🖨️ طباعة</button><script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
async function printButton(id){
  const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]), b=(await getAll(BUTTONS)).find(x=>x.id===id);
  if(!b)return; const faults=fs.filter(f=>f.buttonId===id), code=b.code||b.id;
  const w=window.open("","_blank","width=900,height=900"); if(!w){alert("اسمح بالنوافذ المنبثقة للطباعة.");return}
  const faultsHtml=faults.length?faults.map(f=>`<section class="fault"><h3>${esc(f.code)} — ${esc(f.name)}</h3><p>${esc(f.desc||"")}</p><div class="solution">${esc(f.solution||"لا توجد طريقة حل مسجلة.")}</div>${f.image?`<img src="${f.image}" class="fault-img">`:""}</section>`).join(""):`<p>لا توجد أعطال مرتبطة بهذا الزر.</p>`;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(b.name)}</title><style>body{font-family:Arial,Tahoma;margin:30px;color:#111;line-height:1.7}h1{color:#182467;border-bottom:2px solid #182467;padding-bottom:10px}.meta{background:#f3f5f8;padding:12px;border-radius:8px}.img{max-width:280px;max-height:280px;object-fit:contain;border:1px solid #ddd}.fault{border:1px solid #ddd;border-radius:10px;padding:14px;margin:12px 0;break-inside:avoid}.solution{white-space:pre-line;background:#fff8e8;padding:10px}.fault-img{max-width:260px;max-height:220px;object-fit:contain}@media print{button{display:none}}</style></head><body><h1>🔘 تفاصيل الزر</h1>${b.image?`<img src="${b.image}" class="img">`:""}<h2>${esc(b.name)}</h2><div class="meta">🏭 الماكينة: ${esc(b.machine)}<br>🧩 المرحلة: ${esc(b.stage||b.department||"—")}<br>🖥 الشاشة / المنطقة: ${esc(b.screen||"—")}<br>🔢 رقم الزر: ${esc(b.number||"—")}<br>🏷️ كود الوصول: ${esc(code)}</div><h2>وصف ووظيفة الزر</h2><p>${esc(b.desc||"لا يوجد وصف.")}</p><h2>الأعطال المرتبطة (${faults.length})</h2>${faultsHtml}<button onclick="window.print()">🖨️ طباعة</button><script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
  w.document.close();
}
async function printFault(id){
  const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]), f=fs.find(x=>x.id===id);
  if(!f)return; const b=bs.find(x=>x.id===f.buttonId), code=f.code||f.id;
  const w=window.open("","_blank","width=800,height=850"); if(!w){alert("اسمح بالنوافذ المنبثقة للطباعة.");return}
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(f.name)}</title><style>body{font-family:Arial,Tahoma;margin:30px;color:#111;line-height:1.8}h1{color:#182467}.box{border:1px solid #ddd;border-radius:10px;padding:15px;margin:12px 0}.solution{white-space:pre-line;background:#fff8e8;padding:15px}.img{max-width:320px;max-height:260px;object-fit:contain}@media print{button{display:none}}</style></head><body><h1>🔧 تفاصيل العطل</h1><div class="box"><b>${esc(f.code)} — ${esc(f.name)}</b><br>🔘 الزر: ${esc(b?.name||"—")}<br>🏭 الماكينة: ${esc(b?.machine||"—")}<br>🏷️ كود الوصول: ${esc(code)}</div><h2>وصف المشكلة</h2><p>${esc(f.desc||"لا يوجد وصف.")}</p><h2>طريقة الحل</h2><div class="solution">${esc(f.solution||"لا توجد طريقة حل مسجلة.")}</div>${f.image?`<h2>الصورة</h2><img src="${f.image}" class="img">`:""}<button onclick="window.print()">🖨️ طباعة</button><script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
  w.document.close();
}
async function startScanner(){if(scanner)return;const modal=$("qrModal");modal.classList.remove("hidden");$("reader").innerHTML="";if(!window.Html5Qrcode){$("reader").innerHTML=`<p class="muted">ماسح QR يحتاج اتصال إنترنت لتحميل مكتبة الكاميرا أول مرة.</p>`;return}scanner=new Html5Qrcode("reader");try{await scanner.start({facingMode:"environment"},{fps:10,qrbox:220},async text=>{await scanner.stop();scanner.clear();scanner=null;modal.classList.add("hidden");const [bs,fs]=await Promise.all([getAll(BUTTONS),getAll(FAULTS)]);const b=bs.find(x=>x.code===text.trim()||x.id===text.trim());if(b){$("globalSearch").value=b.name;await showButton(b.id)}else{const f=fs.find(x=>x.code===text.trim());if(f)showFault(f.id);else{ $("globalSearch").value=text;doSearch(text);toast("تم قراءة QR لكن الكود غير مسجل");}}},()=>{});}catch(e){scanner=null;$("reader").innerHTML="<p class='muted'>تعذر تشغيل الكاميرا. تأكد من صلاحية الكاميرا واستخدام HTTPS أو localhost.</p>"}}
async function stopScanner(){if(scanner){try{await scanner.stop();scanner.clear()}catch(e){}scanner=null}}
async function init(){await openDB();await seed();await ensureStagesFromButtons();await refreshStats();await populateFaultButtons();await populateStageSelects();await renderStages();doSearch();setCloudUI("off","السحابة غير مفعلة","يمكنك ربط Firebase من زر ☁️ السحابة.");$("globalSearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>doSearch(),80)});$("clearSearch").onclick=()=>{$("globalSearch").value="";doSearch();$("globalSearch").focus()};$("scanBtn").onclick=startScanner;$("adminBtn").onclick=openAdmin;$("closeAdmin").onclick=closeAdmin;$("closeDetail").onclick=()=>$("detailSection").classList.add("hidden");$("backupBtn").onclick=backup;$("restoreInput").onchange=e=>e.target.files[0]&&restore(e.target.files[0]);$("buttonFormEl").onsubmit=saveButton;$("faultFormEl").onsubmit=saveFault;$("resetButtonForm").onclick=resetButton;$("addStageBtn").onclick=addStage;$("newStageName").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addStage()}});$("resetFaultForm").onclick=resetFault;$("manageSearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderManage,80)});document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentFilter=b.dataset.filter;doSearch()});document.querySelectorAll(".admin-tab").forEach(b=>b.onclick=()=>switchAdminTab(b.dataset.tab));$("bImage").onchange=async e=>{const x=await readFile(e.target.files[0]);$("bImagePreview").innerHTML=x?`<img src="${x}">`:""};$("fImage").onchange=async e=>{const x=await readFile(e.target.files[0]);$("fImagePreview").innerHTML=x?`<img src="${x}">`:""};$("cloudBtn").onclick=openCloudModal;
$("cloudConnectBtn").onclick=connectFromUI;
$("cloudDisconnectBtn").onclick=disconnectCloud;
$("cloudModal").querySelector("[data-close]").onclick=closeCloudModal;
const savedCloud=getSavedFirebaseConfig();
if(savedCloud)connectCloud(savedCloud,false);
document.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>{if(x.dataset.close==="qrModal"){stopScanner();$("qrModal").classList.add("hidden")}});$("closeQrBtn").onclick=()=>{stopScanner();$("qrModal").classList.add("hidden")}}
window.showButton=showButton;window.showFault=showFault;window.showQR=showQR;window.printButton=printButton;window.printFault=printFault;window.printCode=printCode;window.editButton=editButton;window.editFault=editFault;window.deleteButton=deleteButton;window.deleteButtonFromDetail=deleteButtonFromDetail;window.deleteFault=deleteFault;window.addStage=addStage;window.deleteStage=deleteStage;
init().catch(e=>{console.error(e);alert("حدث خطأ في تشغيل قاعدة البيانات المحلية. جرّب فتح المشروع من Chrome/Edge أو localhost.")});
