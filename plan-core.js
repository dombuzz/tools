// Gemeinsame Logik fuer Plan.html und persunal.html: PDF-Parser (VimBiz «Team Published Shifts by Month»),
// Dienst-Codes (SPARTEN), Namenskuerzel/Aliase, Datumshilfen und das SharePoint-Bookmarklet.
// Klassisches Script (globale Deklarationen); muss nach /vendor/pdfjs/pdf.min.js und vor dem Seiten-Script geladen werden.

// pages: [{width, items:[{str,x,y,w}]}]  (y grows upward, PDF coords)
function parsePlan(pages, SVC){
  const MONTHS={januar:1,februar:2,"märz":3,maerz:3,april:4,mai:5,juni:6,juli:7,august:8,september:9,oktober:10,november:11,dezember:12};
  const entries=[], other=[]; const people=new Set();
  for(const pg of pages){
    // split multi-token items into tokens with estimated positions
    const toks=[];
    for(const it of pg.items){
      const s=it.str; if(!s.trim()) continue;
      const re=/\S+/g; let m;
      while((m=re.exec(s))){
        const f0=m.index/s.length, f1=(m.index+m[0].length)/s.length;
        toks.push({t:m[0],x:it.x+it.w*f0,cx:it.x+it.w*(f0+f1)/2,y:it.y,raw:it});
      }
    }
    // month headers
    const heads=[];
    for(const tk of toks){
      const mo=MONTHS[tk.t.toLowerCase()]; if(!mo) continue;
      const yr=toks.find(o=>/^20\d\d$/.test(o.t)&&Math.abs(o.y-tk.y)<3&&o.x<tk.x&&tk.x-o.x<80);
      if(!yr) continue;
      const nums=toks.filter(o=>/^\d{1,2}$/.test(o.t)&&Math.abs(o.y-tk.y)<4&&o.x>tk.x);
      const cols={}; for(const n of nums){const d=+n.t; if(d>=1&&d<=31&&!(d in cols)) cols[d]=n.cx;}
      if(Object.keys(cols).length<20) continue;
      const xs=Object.values(cols).sort((a,b)=>a-b);
      heads.push({y:tk.y,year:+yr.t,month:mo,cols,firstX:xs[0],step:(xs[xs.length-1]-xs[0])/(xs.length-1)});
    }
    if(!heads.length) continue;
    heads.sort((a,b)=>b.y-a.y);
    const blockOf=y=>{let b=null;for(const h of heads){if(h.y>y+1){b=h}}return b;}; // lowest header above y
    for(const h of heads){
      const inB=toks.filter(o=>blockOf(o.y)===h);
      // name lines: raw items left of the grid
      const lines=[]; const seen=new Set(); const nameItems=new Set(); const oth={};
      for(const o of inB){
        const it=o.raw; if(seen.has(it)) continue; seen.add(it);
        if(it.x<pg.width*0.02||it.x+it.w>h.firstX-h.step*0.35) continue;
        const s=it.str.trim();
        if(!/[A-Za-zÄÖÜäöüé]/.test(s)||/^\+|\d{3}/.test(s)) continue;
        if(/RTR plan|^20\d\d|^(Pages|Printed|By|Team|Shift)\b/i.test(s)) continue;
        if(/^[a-zäöüè]{2,3}$/.test(s)&&it.x<pg.width*0.03) continue; // Kürzel
        lines.push(it); nameItems.add(it);
      }
      lines.sort((a,b)=>b.y-a.y);
      const rows=[];
      for(const it of lines){
        const prev=rows[rows.length-1];
        if(prev&&prev.y-it.y<h.step*0.6&&prev.lastY-it.y<h.step*0.6){prev.parts.push(it.str.trim());prev.lastY=it.y}
        else rows.push({y:it.y,lastY:it.y,parts:[it.str.trim()]});
      }
      if(!rows.length) continue;
      for(const r of rows) r.name=r.parts.join(" ").replace(/\s*,\s*/g,", ").replace(/-\s+/g,"-").replace(/\s+/g," ").replace(/,\s*$/,"");
      // Zeile fuer unbekannte Zelltexte: Zellen sind hoch (Name oben, Text mittig) -> naechste Namenszeile ueber dem Text, max. ein Zeilenabstand
      const gaps=rows.slice(1).map((r,i)=>rows[i].y-r.y).sort((a,b)=>a-b), gap=gaps.length?gaps[gaps.length>>1]:h.step*3;
      const rowBelow=y=>{let best=null;for(const r of rows){if(r.y+6>=y&&(!best||r.y<best.y))best=r} return best&&best.y-y<gap?best:null;};
      const rowOf=y=>{let best=null,bd=1e9;for(const r of rows){const d=Math.abs(r.y-y);if(d<bd){bd=d;best=r}}return bd<h.step*1.2?best:null;};
      for(const o of inB){
        const known=SVCL.has(o.t.toLowerCase());
        if(!known&&(nameItems.has(o.raw)||/^[-–—·.,:;_]+$/.test(o.t)||/^\d{1,2}:\d{2}$/.test(o.t))) continue; // Name, Satzzeichen, Uhrzeit (8:00)
        if(o.x<h.firstX-h.step*0.6) continue;
        let day=null,bd=1e9; for(const [d,x] of Object.entries(h.cols)){const dd=Math.abs(x-o.cx);if(dd<bd){bd=dd;day=+d}}
        if(bd>h.step*0.6) continue;
        const date=(d=>`${h.year}-${String(h.month).padStart(2,"0")}-${String(d).padStart(2,"0")}`)(day);
        if(!known){ // Text in der Zelle, der kein bekannter Dienst-Code ist (z. B. 0130 = nicht verfuegbar)
          const r=rowBelow(o.y); if(!r) continue;
          (oth[r.name+"|"+date]??={name:r.name,date,toks:[]}).toks.push(o); continue;
        }
        const r=rowOf(o.y); if(!r) continue; const name=r.name;
        people.add(name);
        entries.push({date,svc:o.t,name});
      }
      for(const g of Object.values(oth)){ g.toks.sort((a,b)=>Math.abs(a.y-b.y)>2?b.y-a.y:a.x-b.x); other.push({date:g.date,name:g.name,text:g.toks.map(t=>t.t).join(" ")}); }
    }
  }
  return {entries,people:[...people],other};
}

const SPARTEN={
  newsdesk:{name:"Newsdesk",blocks:[
    [["Online 1",["O1","O1So","O1Du"]],["Online 2",["O2"]],["Online 3",["O3"]],["Online 4",["O4"]],["Prod Online",["pOn"]]],
    [["Novitads 1",["N1"]],["Novitads 2",["N2"]]],
    [["Grafica",["graf"]]],
    [["Social",["soc1"]]]],
    // all = jeden Tag besetzt, wd = nur Montag–Freitag (am Wochenende nicht geplant)
    need:{"Online 1":"all","Online 2":"wd","Online 3":"wd","Online 4":"all","Prod Online":"wd"},
    // frei = Wochentage (getDay: 0 So, 6 Sa), an denen der Dienst normalerweise nicht geplant ist; leer statt «–», ausser der Plan nennt dennoch jemanden
    frei:{"Grafica":[0,6],"Social":[0]}},
  radio:{name:"Radio",blocks:[[
    ["Mod 1",["m1","m1_s"]],["Mod 2",["m2","m2_s","m2_d","mAcc"]],["Mod magazins",["m_ma"]],
    ["Prod radio 1",["p1","p1_s"]],["Prod radio 2",["p2","pV2"]],
    ["ReporterA radio",["rRad","rCGR"]],["Sport",["rSpo","rSph"]],
    ["Novitads 1",["N1"]],["Novitads 2",["N2"]]]]},
  televisiun:{name:"Televisiun",blocks:[[
    ["MSG moderaziun",["hMSG"]],["Minisguard",["pMSG","MSG"]],["MSG grafica & tagl",["gr_M","t_MS"]],
    ["TSG producziun",["pTSG"]],["TSG moderaziun",["mTSG"]],["TSG contribuziun",["cTSG","CGTS"]],
    ["Videonews",["vNew"]],["Tagl Telesguard",["t1_T","t2_T"]]]]},
  ondemand:{name:"On demand",blocks:[[
    ["Clic",["Clic"]],["Ils Dus Da Nus",["DusN","I2DN"]],["On demand divertiment",["oDdi"]],["On demand societad e cultura",["oDs&"]],
    ["Social",["soc1"]]]],
    frei:{"Social":[0]}}
,
  producers:{name:"Producers",blocks:[[
    ["Prod radio 1",["p1","p1_s"]],["Prod radio 2",["p2","pV2"]],
    ["Prod Online",["pOn"]],
    ["TSG producziun",["pTSG"]],["MSG producziun",["pMSG"]]]]}
};
const SVC=[...new Set(Object.values(SPARTEN).flatMap(s=>s.blocks.flat().flatMap(r=>r[1])))];
const SVCL=new Set(SVC.map(c=>c.toLowerCase()));

const DAYS=["Gli","Ma","Me","Gie","Ve","So","Du"];
const WD=["Dumengia","Glindesdi","Mardi","Mesemna","Gievgia","Venderdi","Sonda"]; // index = Date.getDay()
const MONTHS=["schaner","favrer","mars","avrigl","matg","zercladur","fanadur","avust","settember","october","november","december"];
const pad=n=>String(n).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseIso=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const addDays=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
const monday=d=>addDays(d,-((d.getDay()+6)%7));
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/864e5+1)/7)}
const fmt=d=>d.getDate()+"."+(d.getMonth()+1)+".";

const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

// ---- Aliase: liegen als Cloudflare-Secret (PLAN_ALIASES) auf dem Worker, nicht im öffentlichen Repo.
// Abruf nur mit Zugangscode; die Plandaten verlassen den Browser nie (es geht nur der Code raus).
const PLAN_API="https://fragrant-grass-c193.zappa-pfadi.workers.dev";
function aliasData(){try{const a=JSON.parse(store.get("plan-alias")||"null");if(a&&a.map&&Array.isArray(a.rules))return a}catch(e){}return{map:{},rules:[]}}
async function loadAliases(code){
  const r=await fetch(PLAN_API+"/plan-alias",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
  if(r.status===401) throw new Error("Code falsch");
  if(!r.ok) throw new Error("Aliase nicht verfügbar");
  const d=await r.json(); store.set("plan-alias",JSON.stringify({map:d.map||{},rules:d.rules||[]})); store.set("plan-alias-code",code);
}

let DISP={};
function shortNames(names){
  // Zusätze im Plan entfernen: «(Firma) », « (RTR)», « z»
  const clean=n=>n.replace(/^\([^)]*\)\s*/,"").replace(/\s*\(RTR\)\s*$/,"").replace(/\s+z$/,"").trim();
  const sur=n=>(n=clean(n),(n.includes(",")?n.split(",")[0]:n.split(" ")[0]).trim());
  const first=n=>(n=clean(n),n.includes(",")?n.split(",").slice(1).join(","):n.split(" ").slice(1).join(" ")).trim()||sur(n);
  const al=n=>{const A=aliasData();if(A.map[n])return A.map[n];for(const [re,v] of A.rules){try{if(new RegExp(re).test(clean(n)))return v}catch(e){}}return undefined}; // Aliase kommen aus dem Cloudflare-Secret PLAN_ALIASES (nicht im Repo)
  const first0=first; const firstA=n=>al(n)||first0(n);
  const cnt={}; names.forEach(n=>cnt[firstA(n)]=(cnt[firstA(n)]||0)+1);
  const out={}; names.forEach(n=>{const f=firstA(n);out[n]=al(n)?f:cnt[f]>1?`${f} ${sur(n)[0]}.`:f}); DISP={}; names.forEach(n=>DISP[n]=sur(n)+", "+firstA(n).replace(/\s+[A-ZÄÖÜ]\.$/,"")); // Anzeige im Auswahlfeld
  return out; // Namen aus ALIAS bleiben immer ohne Zusatz
}

async function pdfEntries(file){
  if(!window.pdfjsLib) throw new Error("La biblioteca da PDF n'ha betg pudì vegnir chargiada. Chargia danovamain la pagina ed emprova anc ina giada.");
  pdfjsLib.GlobalWorkerOptions.workerSrc="/vendor/pdfjs/pdf.worker.min.js";
  const doc=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){
    const pg=await doc.getPage(i); const vp=pg.getViewport({scale:1}); const tc=await pg.getTextContent();
    pages.push({width:vp.width,items:tc.items.map(it=>({str:it.str,x:it.transform[4],y:it.transform[5],w:it.width}))});
  }
  const res=parsePlan(pages,SVC); const en=res.entries; en.other=res.other; return en; // other: unbekannte Zelltexte (nur von persunal.html genutzt)
}

// SharePoint-Bookmarklet. Auf SharePoint: zeigt die Zielseite (path) als Vollbild-Overlay im selben Tab und schickt ihr die PDFs per postMessage.
// Blockiert SharePoint den Frame (CSP) oder meldet sich die Seite nicht binnen 6 s, wird stattdessen wie frueher ein neues Fenster geoeffnet.
// Ausserhalb von SharePoint fuehrt der Klick zuerst zum Arbeitsplan auf SharePoint.
// Hinweis: Chrome dekodiert javascript:-URLs einmal -> '%' im Quelltext als %25 schreiben (hier nur in LIST).
const BM_LIST="https://srgssr.sharepoint.com/sites/intranet-rtr-content-docs/DL003/Forms/AllItems.aspx?id=%252Fsites%252Fintranet%252Drtr%252Dcontent%252Ddocs%252FDL003%252F1%255Fradio%255Fonline%252Epdf&parent=%252Fsites%252Fintranet%252Drtr%252Dcontent%252Ddocs%252FDL003";
const BM_SRC="(()=>{\nif(location.hostname!=='srgssr.sharepoint.com'){location.href='@LIST@';return}\nconst T='https://tools.dombuzz.ch',P='@PATH@',B='https://srgssr.sharepoint.com/sites/intranet-rtr-content-docs/DL003/',F=['1_radio_online.pdf','2_televisiun_ondemand.pdf'];\nlet res=null,ready=false,sent=false,tgt=null,ov=null,fb=false;\nconst t0=document.title;let tt=P==='/Plan'?'Plans da teams':'Persunal',ti=null;const rs=()=>{clearInterval(ti);document.title=t0};const meta=m=>{if(m.title){tt=String(m.title);document.title=tt}};\nconst go=()=>{if(sent||!ready||!res)return;sent=true;const files=res.filter(x=>x.buf),errs=res.filter(x=>x.err).map(x=>x.name+': '+x.err);tgt.postMessage({type:'planonline-pdfs',files,errs},T,files.map(x=>x.buf));removeEventListener('message',h);document.removeEventListener('securitypolicyviolation',v)};\nconst h=e=>{if(e.origin===T&&tgt&&e.source===tgt){if(e.data&&e.data.type==='planonline-meta')meta(e.data);else if(e.data==='planonline-ready'){ready=true;go()}}};\nconst pop=()=>{if(fb||ready)return;fb=true;rs();if(ov){ov.remove();ov=null}const w=window.open(T+P+'#sharepoint','plan');if(!w){alert('PlanOnline: il browser ha blocc\u00e0 la nova fanestra. Permetta fanestras pop-up per SharePoint.');return}tgt=w};\nconst v=e=>{if(/frame|child/.test(e.violatedDirective))pop()};\naddEventListener('message',h);document.addEventListener('securitypolicyviolation',v);\ntry{ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#121214';const f=document.createElement('iframe');f.src=T+P+'#sharepoint';f.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0';const x=document.createElement('button');x.textContent='\u2715';x.setAttribute('aria-label','Serrar');x.style.cssText='position:absolute;bottom:14px;right:14px;z-index:1;font:18px/1 system-ui;width:36px;height:36px;border-radius:18px;border:1px solid #555;background:#26262a;color:#fff;cursor:pointer';x.onclick=()=>{fb=true;rs();ov.remove();removeEventListener('message',h)};ov.append(f,x);document.body.append(ov);tgt=f.contentWindow;document.title=tt;ti=setInterval(()=>{if(document.title!==tt)document.title=tt},500);setTimeout(pop,6000)}catch(e){pop()}\nPromise.all(F.map(n=>fetch(B+n,{credentials:'include',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer()}).then(buf=>({name:n,buf}),e=>({name:n,err:String(e.message||e)})))).then(r=>{res=r;go()})\n})()";
function bookmarkletHref(path){return "javascript:"+BM_SRC.replace(/\n/g,"").replace("@LIST@",BM_LIST).replace("@PATH@",path)}

// Plan mitnehmen: Plans da teams und Persunal reichen den gelesenen Plan ueber sessionStorage weiter (nur in diesem Tab, nicht dauerhaft).
const HANDOFF="planonline-handoff";
function saveHandoff(sources,others){try{sessionStorage.setItem(HANDOFF,JSON.stringify({sources,others}))}catch(e){}}
function loadHandoff(){try{const j=JSON.parse(sessionStorage.getItem(HANDOFF)||"null");return j&&j.sources&&Object.keys(j.sources).length?j:null}catch(e){return null}}

// Im SharePoint-Overlay (iframe) sollen Links auf andere Seiten von tools.dombuzz.ch den ganzen Tab wechseln,
// damit die Adressleiste nicht bei SharePoint stehen bleibt.
if(window.top!==window) document.addEventListener("click",e=>{
  const a=e.target.closest&&e.target.closest("a[href]");
  if(!a||a.target||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey) return;
  let u; try{u=new URL(a.href,location.href)}catch(_){return}
  if(u.origin===location.origin&&!/^\/(plan|persunal)\/?$/i.test(u.pathname)){ e.preventDefault(); try{window.top.location.href=u.href}catch(_){location.href=u.href} }
});
