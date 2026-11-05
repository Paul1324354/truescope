/* TrueScope – Einstellungen für Aussehen, Schrift und Vorlesen.
   Wird auf jeder Seite ganz oben im <head> geladen, damit nichts aufblitzt.
   Gespeichert wird nur im Browser: mit Zustimmung („Einstellungen merken“ in der Cookie-Auswahl) dauerhaft
   in localStorage, sonst nur für diesen Tab in sessionStorage. */
(function(){
  "use strict";
  var KEY = "ts-settings", CKEY = "ts-consent";
  var DEF = { v:1, theme:"auto", size:"m", bright:100, contrast:"normal", font:"normal", links:false, motion:"auto",
              rate:1, voice:"", readBtns:true, autoRead:false };
  var ENUM = { theme:["auto","light","dark"], size:["s","m","l","xl"], contrast:["normal","high"], font:["normal","easy"], motion:["auto","reduce"] };
  var html = document.documentElement, cur = null, subs = [];
  var mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;

  function consent(){ try{ var c = JSON.parse(localStorage.getItem(CKEY)); return c && c.v===1 ? c : null; }catch(e){ return null; } }
  function canKeep(){ var c = consent(); return !!(c && c.prefs); }
  function parse(s){ try{ var o = JSON.parse(s); return o && typeof o==="object" ? o : null; }catch(e){ return null; } }
  function clamp(n, lo, hi, d){ n = Number(n); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }
  function clean(s){
    var o = {}, k;
    for(k in DEF) o[k] = DEF[k];
    if(s) for(k in DEF) if(s[k]!==undefined) o[k] = s[k];
    for(k in ENUM) if(ENUM[k].indexOf(o[k])<0) o[k] = DEF[k];
    o.bright = Math.round(clamp(o.bright, 50, 100, 100) / 5) * 5;
    o.rate = Math.round(clamp(o.rate, 0.6, 1.6, 1) * 10) / 10;
    o.voice = typeof o.voice==="string" ? o.voice.slice(0, 200) : "";
    o.links = !!o.links; o.readBtns = o.readBtns!==false; o.autoRead = !!o.autoRead;
    o.v = 1;
    return o;
  }
  function load(){
    var s = null;
    try{ s = parse(localStorage.getItem(KEY)); }catch(e){}
    if(!s) try{ s = parse(sessionStorage.getItem(KEY)); }catch(e){}
    var o = clean(s);
    // älteres Hell/Dunkel aus dem Knopf in der Kopfzeile übernehmen
    if(!s){ try{ var t = localStorage.getItem("ts-theme"); if(t==='"light"'||t==='"dark"') o.theme = JSON.parse(t); }catch(e){} }
    return o;
  }
  function write(o){
    var s = JSON.stringify(o);
    try{
      if(canKeep()){ localStorage.setItem(KEY, s); try{ sessionStorage.removeItem(KEY); }catch(e){} }
      else { sessionStorage.setItem(KEY, s); try{ localStorage.removeItem(KEY); localStorage.removeItem("ts-theme"); }catch(e){} }
    }catch(e){}
  }
  function scheme(o){ return o.theme==="auto" ? (mq && mq.matches ? "dark" : "light") : o.theme; }
  function attr(name, on, val){ if(on) html.setAttribute(name, val); else html.removeAttribute(name); }
  function apply(o){
    attr("data-theme", o.theme!=="auto", o.theme);
    html.setAttribute("data-scheme", scheme(o));
    attr("data-size", o.size!=="m", o.size);
    attr("data-contrast", o.contrast==="high", "high");
    attr("data-font", o.font==="easy", "easy");
    attr("data-links", o.links, "u");
    attr("data-motion", o.motion==="reduce", "reduce");
    attr("data-saybtns", !o.readBtns, "off");
    attr("data-dim", o.bright<100, "");
    html.style.setProperty("--ts-dim", String((100 - o.bright) / 100));
  }
  function emit(){ for(var i=0;i<subs.length;i++){ try{ subs[i](cur); }catch(e){} } }

  // Regeln, die auf allen Seiten gleich sind (die Farben selbst legt jede Seite fest)
  var css =
    'html[data-size="s"]{font-size:93.75%}html[data-size="l"]{font-size:112.5%}html[data-size="xl"]{font-size:125%}' +
    // Helligkeit: eine dunkle Schicht über der Seite; Fenster (dialog) bekommen ihre eigene, weil sie darüber liegen
    'html[data-dim]::after{content:"";position:fixed;inset:0;background:#000;opacity:var(--ts-dim,0);pointer-events:none;z-index:2147483646}' +
    'html[data-dim] dialog[open]::after{content:"";position:absolute;inset:0;background:#000;opacity:var(--ts-dim,0);pointer-events:none;z-index:50}' +
    // Hoher Kontrast
    'html[data-contrast="high"][data-scheme="light"]{--ink:#000000;--ink-2:#0B1A1E;--muted:#24363B;--line:#7B8E93;--sunk:#DCE5E1;--accent:#055752;--rail-muted:#D2E7E4;--rail-line:rgba(232,243,241,.42)}' +
    'html[data-contrast="high"][data-scheme="dark"]{--bg:#000000;--surface:#081315;--sunk:#0C1B1E;--ink:#FFFFFF;--ink-2:#ECF5F3;--muted:#CADBD9;--line:#5A7B7F;--accent:#86EDE2;--rail:#000000;--rail-2:#0C1D20;--rail-muted:#D2E7E4;--rail-line:rgba(232,243,241,.42)}' +
    'html[data-contrast="high"] :focus-visible{outline-width:3px!important;outline-offset:3px!important}' +
    // Einfache Schrift: schlicht, breit, mehr Abstand
    'html[data-font="easy"] body,html[data-font="easy"] body *{font-family:Verdana,Tahoma,"Segoe UI",system-ui,sans-serif!important;font-stretch:100%!important;letter-spacing:.012em!important}' +
    'html[data-font="easy"] p,html[data-font="easy"] li{line-height:1.75!important;word-spacing:.06em}' +
    'html[data-links="u"] a{text-decoration:underline!important;text-underline-offset:3px}' +
    // Bewegung reduzieren
    'html[data-motion="reduce"] *,html[data-motion="reduce"] *::before,html[data-motion="reduce"] *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important}' +
    'html[data-saybtns="off"] .saybtn,html.nospeech .saybtn{display:none!important}';
  try{ var st = document.createElement("style"); st.id = "ts-a11y"; st.textContent = css; (document.head || html).appendChild(st); }catch(e){}

  cur = load(); apply(cur);
  if(mq){ var onMq = function(){ apply(cur); emit(); }; if(mq.addEventListener) mq.addEventListener("change", onMq); else if(mq.addListener) mq.addListener(onMq); }
  // Änderungen aus einem anderen Tab übernehmen
  window.addEventListener("storage", function(e){ if(e.key===KEY || e.key===CKEY){ cur = load(); apply(cur); emit(); } });
  // Zurück-Knopf: der Browser zeigt die Seite aus dem Zwischenspeicher, ohne dieses Skript neu auszuführen
  window.addEventListener("pageshow", function(e){ if(e.persisted){ cur = load(); apply(cur); emit(); } });

  window.TS = {
    defaults: function(){ return clean(null); },
    get: function(){ return cur; },
    set: function(patch){ var o = {}, k; for(k in cur) o[k] = cur[k]; for(k in patch) o[k] = patch[k]; cur = clean(o); write(cur); apply(cur); emit(); return cur; },
    reset: function(){ cur = clean(null); write(cur); apply(cur); emit(); return cur; },
    scheme: function(){ return scheme(cur); },
    canKeep: canKeep,
    // nach einer Änderung der Cookie-Auswahl am richtigen Ort speichern (dauerhaft oder nur für diesen Tab)
    persist: function(){ write(cur); emit(); },
    // „Einstellungen merken“ erlauben (gleich wie in der Cookie-Auswahl)
    allowKeep: function(){
      try{ localStorage.setItem(CKEY, JSON.stringify({v:1, prefs:true, at:Date.now()})); }catch(e){}
      write(cur); emit(); return canKeep();
    },
    on: function(fn){ subs.push(fn); }
  };
})();
