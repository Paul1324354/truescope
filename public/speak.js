/* TrueScope – Vorlesen.
   Nutzt die Sprachausgabe des Browsers (Web Speech API): kein Server, kein KI-Kontingent.
   Texte werden in kurze Stücke geteilt, weil manche Browser lange Äußerungen nach etwa 15 Sekunden abbrechen.
   Pause heißt hier: anhalten und beim Weiterlesen das aktuelle Stück neu beginnen – das klappt auch am Handy zuverlässig. */
(function(){
  "use strict";
  var synth = window.speechSynthesis;
  var ok = !!(synth && window.SpeechSynthesisUtterance);
  if(!ok) document.documentElement.classList.add("nospeech");
  var voices = [], subs = [];
  var items = [], pos = 0, sub = 0, state = "idle", token = 0, meta = {title:"", key:""}, lastEl = null, timer = 0;

  function S(){ return (window.TS && TS.get()) || {rate:1, voice:""}; }
  function loadVoices(){ try{ voices = synth.getVoices() || []; }catch(e){ voices = []; } }
  function score(v){
    var s = 0, n = v.name || "";
    if(/natural|neural|online|premium|enhanced/i.test(n)) s += 40;
    if(/google/i.test(n)) s += 25;
    if(/de[-_]AT/i.test(v.lang)) s += 8; else if(/de[-_]DE/i.test(v.lang)) s += 6; else if(/de[-_]CH/i.test(v.lang)) s += 3;
    if(v["default"]) s += 2;
    return s;
  }
  function german(){ return voices.filter(function(v){ return /^de([-_]|$)/i.test(v.lang || ""); }).sort(function(a,b){ return score(b)-score(a); }); }
  function pick(){
    var want = S().voice, i;
    if(want) for(i=0;i<voices.length;i++) if(voices[i].voiceURI===want) return voices[i];
    return german()[0] || null;
  }
  if(ok){
    loadVoices();
    var vc = function(){ loadVoices(); emit("voices"); };
    if(synth.addEventListener) synth.addEventListener("voiceschanged", vc); else synth.onvoiceschanged = vc;
  }

  // Text in Stücke von höchstens etwa 220 Zeichen teilen, möglichst an Satzenden
  function chunks(text){
    text = String(text || "").replace(/\s+/g, " ").trim();
    if(!text) return [];
    var parts = text.match(/[^.!?…]+(?:[.!?…]+["“”»«')\]]*\s*|$)/g) || [text], out = [], cur = "";
    parts.forEach(function(p){ if(cur && (cur + p).length > 220){ out.push(cur.trim()); cur = p; } else cur += p; });
    if(cur.trim()) out.push(cur.trim());
    var res = [];
    out.forEach(function(c){
      while(c.length > 260){
        var i = c.lastIndexOf(", ", 240); if(i < 80) i = c.lastIndexOf(" ", 240); if(i < 1) i = 240;
        res.push(c.slice(0, i + 1).trim()); c = c.slice(i + 1).trim();
      }
      if(c) res.push(c);
    });
    return res;
  }
  function norm(list){
    return (list || []).map(function(it){ return {text:it.text, el:it.el, chunks:chunks(it.text)}; }).filter(function(it){ return it.chunks.length; });
  }

  function elOf(it){ if(!it) return null; try{ return typeof it.el==="function" ? it.el() : (it.el || null); }catch(e){ return null; } }
  function unmark(){ if(lastEl){ lastEl.classList.remove("ts-speaking"); lastEl = null; } }
  function mark(it, scroll){
    var el = elOf(it);
    if(el === lastEl) return;
    unmark();
    if(!el) return;
    el.classList.add("ts-speaking"); lastEl = el;
    if(scroll === false) return;
    var r = el.getBoundingClientRect(), h = window.innerHeight || 800;
    if(r.top < 70 || r.bottom > h - 120){
      var calm = document.documentElement.getAttribute("data-motion")==="reduce" || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
      try{ el.scrollIntoView({block:"center", behavior: calm ? "auto" : "smooth"}); }catch(e){ el.scrollIntoView(); }
    }
  }

  function info(){ return {state:state, pos:pos, total:items.length, title:meta.title, key:meta.key, rate:S().rate}; }
  function emit(type){ var i = info(); i.type = type || "state"; for(var k=0;k<subs.length;k++){ try{ subs[k](i); }catch(e){} } }

  function speakNow(){
    clearTimeout(timer);
    var my = ++token, it = items[pos];
    if(!it){ finish(); return; }
    mark(it);
    var u = new SpeechSynthesisUtterance(it.chunks[sub]);
    var v = pick();
    if(v){ u.voice = v; u.lang = v.lang; } else u.lang = "de-DE";
    u.rate = S().rate || 1;
    u.onend = function(){ if(my===token && state==="playing") advance(); };
    u.onerror = function(e){ if(my!==token || state!=="playing") return; if(e && (e.error==="interrupted" || e.error==="canceled")) return; advance(); };
    try{ synth.speak(u); }catch(e){ advance(); }
    // Chrome: manchmal hängt die Sprachausgabe im Pausenzustand
    try{ if(synth.paused) synth.resume(); }catch(e){}
  }
  // nach cancel() kurz warten, sonst verschlucken manche Browser das nächste Stück
  function later(){ clearTimeout(timer); timer = setTimeout(speakNow, 90); }
  function advance(){
    var it = items[pos];
    if(it && sub + 1 < it.chunks.length) sub++;
    else { pos++; sub = 0; }
    if(pos >= items.length){ finish(); return; }
    speakNow(); emit();
  }
  function hush(){ token++; clearTimeout(timer); try{ synth.cancel(); }catch(e){} }
  function finish(type){ hush(); unmark(); state = "idle"; items = []; pos = 0; sub = 0; emit(type || "end"); meta = {title:"", key:""}; }

  var API = {
    supported: ok,
    voices: function(){ return voices.slice(); },
    germanVoices: german,
    current: pick,
    chunks: chunks,
    info: info,
    on: function(fn){ subs.push(fn); },
    // list: [{text, el}] – el darf eine Funktion sein, die das Element jedes Mal neu sucht (Inhalte werden neu gezeichnet)
    play: function(list, opts){
      if(!ok) return false;
      hush(); unmark();
      items = norm(list); pos = 0; sub = 0;
      meta = {title:(opts && opts.title) || "", key:(opts && opts.key) || ""};
      if(!items.length){ state = "idle"; emit(); return false; }
      state = "playing"; speakNow(); emit("start");
      return true;
    },
    // weitere Abschnitte anhängen (z. B. wenn die Zusammenfassung erst nach dem Titel fertig wird)
    append: function(list, key){
      if(!ok || (key && key!==meta.key) || state==="idle") return false;
      var more = norm(list); if(!more.length) return false;
      var wasDone = pos >= items.length;
      items = items.concat(more);
      if(wasDone && state==="playing") speakNow();
      emit(); return true;
    },
    // alles nach dem aktuellen Abschnitt ersetzen
    replaceRest: function(list, key){
      if(!ok || (key && key!==meta.key) || state==="idle") return false;
      items = items.slice(0, pos + 1).concat(norm(list)); emit(); return true;
    },
    pause: function(){ if(state!=="playing") return; state = "paused"; hush(); emit(); },
    resume: function(){ if(state!=="paused") return; state = "playing"; later(); emit(); },
    toggle: function(){ if(state==="playing") API.pause(); else if(state==="paused") API.resume(); },
    next: function(){
      if(state==="idle") return;
      if(pos + 1 >= items.length){ finish(); return; }
      hush(); pos++; sub = 0;
      if(state==="playing") later(); else mark(items[pos]);
      emit();
    },
    prev: function(){
      if(state==="idle") return;
      hush(); if(sub===0 && pos > 0) pos--; sub = 0;
      if(state==="playing") later(); else mark(items[pos]);
      emit();
    },
    stop: function(){ if(state==="idle") return; finish("stop"); },
    // Tempo oder Stimme geändert: aktuelles Stück neu beginnen
    restart: function(){ if(state==="playing"){ hush(); later(); } emit(); },
    // nach dem Neuzeichnen einer Ansicht die Markierung wieder setzen
    refresh: function(){ if(state!=="idle"){ lastEl = null; mark(items[pos], false); } },
    sample: function(text){
      if(!ok) return false;
      API.play([{text: text || "Hallo! So klingt TrueScope, wenn es dir eine Meldung vorliest."}], {title:"Probe", key:"sample"});
      return true;
    }
  };
  window.addEventListener("pagehide", function(){ if(state!=="idle") finish(); });
  window.TSSpeak = API;
})();
