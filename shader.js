// WebGL-Effekte für tools.dombuzz.ch – ohne Bibliothek, ein gemeinsamer Zeichenkontext für alle Effekte der Seite.
// Hintergrund (Canvas hinter der Seite, per Attribut am <body>):
//   <body data-shader="labA">   Lab-Übersicht: orange Glut statt Millimeterpapier und Warnband
//   <body data-shader="e4d">    404-Seite: Blockfehler
//   <body data-shader="soA|soB|soC|soM|soT">   Social (Prototypen): seitenfüllend, dunkel Rot auf Schwarz, hell Rot auf Weiss – A «Nebelraster», B «Auflösung», C «Bokeh» (Nebel + Raster)
//   <body data-shader="rcE" data-shader-origin="rec">   Audio-Recorder: Blob um das Element mit dieser ID, folgt dem Pegel
// Aufnahme-Pegel: dbzShader.level(0..1, übersteuert)  (0 = still, 1 = Vollausschlag)
// Dank-Moment: dbzShader.spark(element)   (diffuser Schimmer um das Element, z. B. «Gea»-Herz)
// Lade-Glanz: Knopf mit data-dbz-glint; aria-busy="true" setzen, solange etwas rechnet, danach entfernen → Abschlusswelle
// Hält an, wenn der Tab verdeckt ist; bei «Bewegung reduzieren» steht der Hintergrund still, Dank und Glanz entfallen.
(function () {
  'use strict';
  if (window.dbzShader) return;
  var d = document, root = d.documentElement;
  var RM = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- GLSL ---------------- */
  var VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}';
  var PRE = [
    '#version 300 es', 'precision highp float;', 'precision highp int;',
    'uniform vec2 uRes;uniform vec2 uCss;uniform float uDpr;uniform float uTime;uniform float uLight;',
    'uniform float uLevel;uniform float uClip;uniform float uH[24];uniform vec2 uOrg;',
    'uniform float uT;uniform float uState;uniform vec4 uBox;uniform vec3 uTint;uniform float uAmp;',
    'out vec4 o;', 'const float PI=3.14159265;',
    'float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}',
    'float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vn(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return v;}',
    'vec3 ORG(){return mix(vec3(1.,.604,.235),vec3(.9,.47,.07),uLight);}',
    'vec3 ACC(){return mix(vec3(1.,.302,.392),vec3(.816,.157,.263),uLight);}',
    'vec4 outA(vec3 c,float a){a=clamp(a,0.,1.);return vec4(c*a,a);}',
    'float sdRR(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}',
    ''].join('\n');

  var SH = {};

  // Lab-Übersicht: Glut – verwirbeltes Orange, am oberen Rand heller
  SH.labA = [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);',
    ' float t=uTime*.05;',
    ' vec2 q=vec2(fbm(p*1.5+vec2(0.,t)),fbm(p*1.5+vec2(5.2,1.3)-t));',
    ' float f=fbm(p*1.3+2.2*q+vec2(t*.6,-t*.4));',
    ' float dtop=(1.-uv.y)*uCss.y;',
    ' float glow=exp(-dtop/60.)*(.5+.9*f);',
    ' float body=smoothstep(.45,.92,f)*.24;',
    ' float k=clamp(glow+body,0.,.85)*mix(1.,.7,uLight);',
    ' k+=(h21(gl_FragCoord.xy+fract(uTime))-.5)*.012;',
    ' vec3 hot=mix(vec3(1.,.84,.55),vec3(1.,.72,.32),uLight);',
    ' vec3 c=mix(ORG(),hot,smoothstep(.5,.85,k)*.5);',
    ' o=outA(c,k);',
    '}'].join('\n');

  // Social (Prototypen): Nebel + Raster. Dunkel: Rot auf Schwarz, hell: Rot auf Weiss. Titelbereich oben links und Kopf der Seite bewusst ruhig.
  var SOP = [
    'vec3 K0(){return mix(vec3(.05,.05,.056),vec3(1.),uLight);}',
    'vec3 RD(){return mix(vec3(.78,.09,.17),vec3(.9,.2,.3),uLight);}',
    'vec3 RH(){return mix(vec3(1.,.302,.392),vec3(.816,.157,.263),uLight);}',
    // ruhiger Bereich: oben allgemein, oben links (Titel) besonders; px = Pixel (CSS), y von unten
    'float calmP(vec2 px){float yt=uCss.y-px.y;',
    ' float t=exp(-pow((px.x-170.)/460.,2.))*exp(-pow((yt-100.)/150.,2.));',
    ' return mix(.55,1.,smoothstep(1.,.2,px.y/uCss.y))*(1.-.8*t);}',
    // Nebel: 0..1, grosse weiche Wolkenfelder
    'float fogF(vec2 uv,float t){float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);',
    ' float f=fbm(p*.85+vec2(t,-t*.6)+fbm(p*.6-t)*1.3);float k=smoothstep(.22,.95,f);return k*k*(3.-2.*k);}',
    // schräg gestelltes Punktraster: f = Lage in der Zelle (-.5..+.5), cpx = Zellmitte in Pixeln
    'void cellOf(float cs,float a,out vec2 f,out vec2 cpx){',
    ' vec2 px=gl_FragCoord.xy/uDpr;mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));',
    ' vec2 g=R*px/cs;vec2 id=floor(g);f=fract(g)-.5;cpx=transpose(R)*((id+.5)*cs);}',
    'vec4 fin(vec3 c,vec2 fc){c+=(h21(fc+fract(uTime))-.5)*.008;return vec4(clamp(c,0.,1.),1.);}',
    ''].join('\n');

  // A «Nebelraster»: Punktgrösse folgt der Nebeldichte – dichter Nebel = grosse Punkte, dazu ein leises Glühen
  SH.soA = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float t=uTime*.02;',
    ' vec2 f,cp;cellOf(14.,.38,f,cp);',
    ' float fc=fogF(cp/uCss,t)*calmP(cp);',
    ' float fg=fogF(uv,t)*calmP(gl_FragCoord.xy/uDpr);',
    ' float rad=clamp(fc*1.15,0.,1.)*.5;',
    ' float dm=smoothstep(rad+.07,rad-.07,length(f))*step(.04,rad);',
    ' vec3 c=mix(K0(),RD(),clamp(fg*.5*mix(1.35,.85,uLight),0.,1.));',
    ' vec3 col=mix(RD(),RH(),smoothstep(.35,.9,fc));',
    ' c=mix(c,col,dm*mix(.9,.8,uLight));',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  // B «Auflösung»: Punkte nur am Rand der Nebelfelder – sie lösen sich im dichten Nebel auf und laufen im Freien aus
  SH.soB = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float t=uTime*.02;',
    ' vec2 f,cp;cellOf(14.,.38,f,cp);',
    ' float fr=fogF(cp/uCss,t);',
    ' float edge=pow(4.*fr*(1.-fr),.9)*calmP(cp);',
    ' float rad=clamp(edge,0.,1.)*.5;',
    ' float dm=smoothstep(rad+.07,rad-.07,length(f))*step(.04,rad);',
    ' float fg=fogF(uv,t)*calmP(gl_FragCoord.xy/uDpr);',
    ' vec3 c=mix(K0(),RD(),clamp(fg*.66*mix(1.35,.85,uLight),0.,1.));',
    ' vec3 col=mix(RD(),RH(),smoothstep(.3,.8,edge));',
    ' c=mix(c,col,dm*mix(.85,.75,uLight));',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  // C «Bokeh»: grosses, unscharfes Raster wie Lichter ausser Fokus über dem Nebel
  SH.soC = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float t=uTime*.02;',
    ' vec2 f,cp;cellOf(34.,.38,f,cp);',
    ' float fc=pow(fogF(cp/uCss,t),.75)*calmP(cp);',
    ' float rad=clamp(fc,0.,1.)*.46;',
    ' float dm=smoothstep(rad+.34,rad-.2,length(f))*step(.03,rad);',
    ' float fg=fogF(uv,t)*calmP(gl_FragCoord.xy/uDpr);',
    ' vec3 c=mix(K0(),RD(),clamp(fg*.5*mix(1.35,.85,uLight),0.,1.));',
    ' c=mix(c,mix(RD(),RH(),.5),dm*mix(.62,.5,uLight));',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  // Marmor (Giessfarbe mit Glitzer): verwirbelte Strömung, helle Schaumlinien, feine Glitzerpunkte entlang der Wirbel.
  // soM in den Seitenfarben (dunkel Rot/Schwarz, hell Weiss/Rot), soT als Referenz in Petrol und Gold.
  function marble(pal) { return SOP + [
    pal,
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;float t=uTime*.012;',
    ' vec2 p=vec2(uv.x*asp,uv.y)*1.7;',
    ' vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));',
    ' vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.6),fbm(p+3.*q+vec2(8.3,2.8)-t*.6));',
    ' float f=fbm(p+3.2*r);',
    ' float calm=calmP(gl_FragCoord.xy/uDpr);',
    ' float s=sin((f*9.+r.x*4.)*1.0+t*8.);float ridge=pow(1.-abs(s),6.);',
    ' float body=smoothstep(.2,.85,f);',
    ' vec3 c=mix(M0(),mix(M1(),M2(),smoothstep(.35,.9,f)),body);',
    ' c=mix(c,M3(),ridge*smoothstep(.3,.8,f)*.7*calm);',
    ' c=mix(c,M0(),(1.-calm)*.45*(1.-body));',
    // Glitzer
    ' vec2 px=gl_FragCoord.xy/uDpr;vec2 id=floor(px/3.);float h=h21(id);',
    ' float dens=(ridge*.9+body*.25)*smoothstep(.25,.7,f)*calm;',
    ' vec2 cf=fract(px/3.)-.5;float sp=step(1.-.24*dens,h)*smoothstep(.5,.2,length(cf));',
    ' float tw=.65+.35*sin(uTime*1.6+h*60.);',
    ' c=mix(c,G(),sp*tw*.9);',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n'); }
  SH.soM = marble([
    'vec3 M0(){return mix(vec3(.05,.04,.05),vec3(.97,.95,.95),uLight);}',
    'vec3 M1(){return mix(vec3(.42,.05,.11),vec3(.93,.55,.6),uLight);}',
    'vec3 M2(){return mix(vec3(.78,.09,.17),vec3(.85,.2,.3),uLight);}',
    'vec3 M3(){return mix(vec3(1.,.55,.6),vec3(1.),uLight);}',
    'vec3 G(){return mix(vec3(1.,.8,.75),vec3(.72,.1,.2),uLight);}'].join('\n'));
  SH.soT = marble([
    'vec3 M0(){return vec3(.012,.062,.056);}',
    'vec3 M1(){return vec3(.02,.18,.168);}',
    'vec3 M2(){return vec3(.065,.4,.375);}',
    'vec3 M3(){return vec3(.62,.86,.82);}',
    'vec3 G(){return vec3(.95,.78,.4);}'].join('\n'));

  // Prototypen für eine vierte Auswahl: U «Aurora» (Violett/Cyan), H «Höhenlinien» (Mint), L «Lava» (Magenta/Violett)
  SH.soU = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);float t=uTime*.02;',
    ' float calm=calmP(gl_FragCoord.xy/uDpr);',
    ' float w=fbm(vec2(p.x*1.1,t))*2.4+fbm(p*.8+vec2(t,0.))*1.3;',
    ' float y1=.62+.16*sin(p.x*1.6+w+t*4.);float y2=.40+.14*sin(p.x*1.2+w*1.3-t*3.+2.);',
    ' float st=.55+.45*fbm(vec2(p.x*9.+w,uv.y*1.5+t*3.));',
    ' float i1=exp(-pow((uv.y-y1)/.2,2.))*st, i2=exp(-pow((uv.y-y2)/.26,2.))*(.4+.6*st);',
    ' i1*=calm; i2*=calm;',
    ' vec3 v=vec3(.55,.25,1.),c2=vec3(.1,.85,.8);',
    ' vec3 base=mix(vec3(.02,.025,.06),vec3(1.),uLight);',
    ' vec3 c=base+mix(v*i1*.9+c2*i2*.75,vec3(0.),uLight);',
    ' c=mix(c,mix(base,mix(v,c2,.5)*.9+.1,.55),uLight*clamp(i1+i2,0.,1.)*.75);',
    ' c+=mix(vec3(0.),vec3(.05,.03,.09),1.-uLight)*fbm(p*1.5+t);',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  SH.soH = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);float t=uTime*.015;',
    ' float calm=calmP(gl_FragCoord.xy/uDpr);',
    ' float f=fbm(p*1.15+vec2(t,-t*.7)+fbm(p*.7-t)*.9);',
    ' float k=f*18.;float fr=fract(k);float dl=min(fr,1.-fr);',
    ' float maj=step(mod(floor(k+.5),5.),.5);',
    ' float ln=(1.-smoothstep(.0,.07+.05*maj,dl))*(.45+.55*maj);',
    ' vec3 bgD=mix(vec3(.02,.05,.04),vec3(.04,.16,.12),smoothstep(.2,.8,f));',
    ' vec3 bg=mix(bgD,mix(vec3(1.),vec3(.88,.97,.92),smoothstep(.2,.8,f)),uLight);',
    ' vec3 lc=mix(vec3(.35,.95,.7),vec3(.05,.5,.36),uLight);',
    ' vec3 c=mix(bg,lc,ln*calm*mix(.8,.7,uLight));',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  SH.soL = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);float t=uTime*.05;',
    ' float calm=calmP(gl_FragCoord.xy/uDpr);',
    ' float F=0.;',
    ' for(int i=0;i<6;i++){float fi=float(i);',
    '  vec2 c=vec2(asp*(.5+.42*sin(t*(.6+.17*fi)+fi*2.1)),.5+.4*cos(t*(.5+.13*fi)+fi*1.7));',
    '  float r=.1+.045*fract(fi*.37+.2);vec2 d=p-c;F+=r*r/(dot(d,d)+1e-4);}',
    ' F*=calm;',
    ' float body=smoothstep(.85,1.25,F);float glow=smoothstep(.15,1.,F);',
    ' vec3 bg=mix(vec3(.05,.02,.07),vec3(1.,.97,.99),uLight);',
    ' vec3 cb=mix(vec3(.45,.12,.85),vec3(1.,.28,.62),smoothstep(.9,2.2,F));',
    ' vec3 c=mix(bg,mix(vec3(.3,.07,.5),vec3(.96,.7,.88),uLight),glow*.7);',
    ' c=mix(c,mix(cb,mix(cb,vec3(1.),.35),uLight*.0),body*mix(.95,.8,uLight));',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  // Mischung Aurora + Höhenlinien: K = Linien überall schwach, im Polarlicht leuchtend; J = Linien nur im Polarlicht sichtbar
  function aurLines(only) { return SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);float t=uTime*.007;',
    ' float calm=calmP(gl_FragCoord.xy/uDpr);',
    ' float w=fbm(vec2(p.x*1.1,t))*2.4+fbm(p*.8+vec2(t,0.))*1.3;',
    ' float y1=.62+.16*sin(p.x*1.3+w*.8+t*2.);float y2=.40+.14*sin(p.x*1.0+w*1.0-t*1.5+2.);',
    ' float st=.7+.3*fbm(vec2(p.x*4.+w,uv.y*1.2+t*1.2));',
    ' float i1=exp(-pow((uv.y-y1)/.2,2.))*st*calm, i2=exp(-pow((uv.y-y2)/.26,2.))*(.4+.6*st)*calm;',
    ' vec3 v=vec3(.27,.15,.52),c2=vec3(.66,.68,.74);',
    ' vec3 base=mix(vec3(.02,.025,.06),vec3(1.),uLight);',
    ' vec3 glowc=v*i1*.6+c2*i2*.4;',
    ' vec3 c=base+mix(glowc,vec3(0.),uLight);',
    ' c=mix(c,mix(base,mix(v,c2,.5)*.9+.1,.5),uLight*clamp(i1+i2,0.,1.)*.6);',
    // Höhenlinien über dem Feld
    ' float f=fbm(p*1.15+vec2(t*.7,-t*.5)+fbm(p*.7-t*.7)*.9);',
    ' float k=f*16.;float fr=fract(k);float dl=min(fr,1.-fr);',
    ' float maj=step(mod(floor(k+.5),5.),.5);',
    ' float ln=(1.-smoothstep(.0,.11+.05*maj,dl))*(.4+.4*maj);',
    ' float lit=clamp(i1+i2,0.,1.);',
    ' float amt=' + (only ? 'smoothstep(.12,.7,lit)' : '(.18+.62*smoothstep(.1,.8,lit))') + ';',
    ' vec3 lc=mix(mix(v,c2,i2/(i1+i2+.001))*.95+.05,mix(v,c2,.5)*.55,uLight);',
    ' c=mix(c,lc,ln*amt*calm*mix(.6,.55,uLight));',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n'); }
  SH.soK = aurLines(false);
  SH.soJ = aurLines(true);

  // Neue ruhige Prototypen für die vierte Auswahl: P «Seide», Q «Berge», R «Tinte»
  SH.soP = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);float t=uTime*.006;',
    ' float calm=mix(1.,calmP(gl_FragCoord.xy/uDpr),.8);',
    ' float w=fbm(p*.8+vec2(t,-t*.6))*3.2;',
    ' float f=sin(p.x*2.1+p.y*1.3+w);float g=sin(p.x*1.2-p.y*2.2+w*1.4+1.7);',
    ' float sh=.5+.5*f*.7+.5*g*.3;',
    ' float sheen=pow(smoothstep(.55,1.,.5+.5*f),3.)*.55+pow(smoothstep(.7,1.,.5+.5*g),4.)*.3;',
    ' vec3 dk=mix(vec3(.02,.018,.045),vec3(.17,.1,.34),sh*sh);',
    ' dk+=vec3(.62,.62,.72)*sheen*.5*calm;',
    ' vec3 lt=mix(vec3(.98,.97,1.),vec3(.8,.77,.9),sh*.9)+vec3(-.04)*sheen;',
    ' vec3 c=mix(dk,lt,uLight);',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  SH.soQ = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;float t=uTime*.004;',
    ' vec3 skyT=mix(vec3(.02,.02,.06),vec3(.93,.93,.99),uLight), skyH=mix(vec3(.26,.16,.4),vec3(.98,.9,.96),uLight);',
    ' vec3 c=mix(skyH,skyT,smoothstep(.2,.95,uv.y));',
    ' for(int i=0;i<5;i++){float fi=float(i);',
    '  float x=uv.x*asp*(1.2+.35*fi)+t*(1.2+.5*fi)+fi*9.3;',
    '  float h=.56-.1*fi+.11*(fbm(vec2(x,fi*3.1))-.5);',
    '  float m=smoothstep(h+.003,h-.003,uv.y);',
    '  float depth=fi/4.;',
    '  vec3 far=mix(vec3(.2,.13,.33),vec3(.84,.8,.93),uLight), near=mix(vec3(.018,.016,.04),vec3(.6,.56,.74),uLight);',
    '  vec3 lc=mix(far,near,depth);',
    '  lc=mix(lc,skyH,.3*(1.-depth)*smoothstep(0.,.35,h-uv.y));',
    '  c=mix(c,lc,m);}',
    ' o=fin(c,gl_FragCoord.xy);',
    '}'].join('\n');

  SH.soR = SOP + [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float asp=uCss.x/uCss.y;vec2 p=vec2(uv.x*asp,uv.y);float t=uTime*.006;',
    ' float calm=mix(1.,calmP(gl_FragCoord.xy/uDpr),.75);',
    // Tinte im Wasser: mehrfach verwirbeltes Feld, feine Fäden am Rand der Schwaden
    ' vec2 q=vec2(fbm(p*1.2+vec2(t,-t*.5)),fbm(p*1.2+vec2(5.2,1.3)-t*.6));',
    ' vec2 r=vec2(fbm(p*1.5+3.2*q+vec2(1.7,9.2)+t*.4),fbm(p*1.5+3.2*q+vec2(8.3,2.8)-t*.4));',
    ' float f=fbm(p*1.1+3.6*r);',
    ' float fil=fbm(p*5.5+r*4.+t)-.5;',
    ' float d=f+.2*fil*smoothstep(.3,.6,f)-(1.-calm)*.25;',
    ' float ink=smoothstep(.48,.6,d);',
    ' float core=smoothstep(.55,.85,d);',
    ' float rim=smoothstep(.44,.52,d)*(1.-smoothstep(.52,.66,d));',
    // dunkel: leuchtende Tinte auf dunklem Wasser, hell: tiefe Indigo-Tinte auf hellem Wasser
    ' vec3 wD=mix(vec3(.02,.02,.05),vec3(.04,.035,.09),fbm(p*.8-t)),',
    '      iD=mix(vec3(.2,.12,.42),vec3(.46,.36,.75),core), eD=vec3(.7,.62,.95);',
    ' vec3 cD=mix(wD,iD,ink*(.55+.45*core));cD+=eD*rim*.16;',
    ' vec3 wL=mix(vec3(.985,.98,1.),vec3(.93,.92,.98),fbm(p*.8-t)),',
    '      iL=mix(vec3(.5,.44,.78),vec3(.16,.1,.4),core), eL=vec3(.4,.34,.7);',
    ' vec3 cL=mix(wL,iL,ink*(.6+.4*core));cL=mix(cL,eL,rim*.18);',
    ' o=fin(mix(cD,cL,uLight),gl_FragCoord.xy);',
    '}'].join('\n');

  // 404-Seite: Blockfehler – Rechtecke blitzen auf wie ein defektes Display, die Textspalte bleibt ruhig
  SH.e4d = [
    'void main(){',
    ' vec2 px=gl_FragCoord.xy/uDpr;float t=uTime;',
    ' vec2 g=floor(px/vec2(28.,22.));float tt=floor(t*6.);',
    ' float on=step(.965,h21(g+tt*3.1));',
    ' vec2 g2=floor(px/vec2(75.,52.));float on2=step(.93,h21(g2+floor(t*3.)*5.7+9.));',
    ' float row=step(.985,h11(floor(px.y/10.)+floor(t*12.)*7.))*.5;',
    ' float x=px.x-.5*uCss.x;float y=uCss.y-px.y;',
    ' float mid=1.-.65*exp(-pow(x/300.,2.))*exp(-pow((y-330.)/330.,2.));',
    ' float k=(on*.4+on2*.2+row)*mid;',
    ' o=outA(ACC(),clamp(k,0.,.8)*mix(1.,.85,uLight));',
    '}'].join('\n');

  // Audio-Recorder: Blob – wabernde Blase um den Aufnahmeknopf, wächst mit dem Pegel, ein zweiter Ring hinkt hinterher
  SH.rcE = [
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes;float t=uTime;float L=uLevel;',
    ' vec2 p=(uv-uOrg)*uCss;float r=length(p);float a=atan(p.y,p.x);',
    ' float R=44.+100.*L;',
    ' float wob=1.+L*(.22*sin(a*5.+t*3.)+.14*sin(a*3.-t*2.3)+.08*sin(a*8.+t*5.));',
    ' float d=r-R*wob;',
    ' float L2=uH[7];float R2=44.+100.*L2;float d2=r-R2*(1.+L2*.2*sin(a*4.-t*1.7));',
    ' float k=exp(-max(d,0.)/60.)*.5*step(0.,d)+step(d,0.)*.22+exp(-abs(d)/5.2)*.7;',
    ' k+=exp(-abs(d2)/5.8)*.35;',
    ' k*=smoothstep(.01,.08,L);',
    ' vec3 lc=mix(ACC(),vec3(1.,.2,.2),uClip);',
    ' o=outA(lc,clamp(k,0.,.9)*mix(1.,.8,uLight));',
    '}'].join('\n');

  // Dank-Moment: Schimmer – weiches Aufleuchten, rauchiger Ring und grosse unscharfe Lichtpunkte
  SH.dkG = [
    'void main(){',
    ' vec2 p=gl_FragCoord.xy/uDpr-uCss*.5;float t=uT;',
    ' if(t<0.||t>3.){o=vec4(0.);return;}',
    ' float r=length(p);',
    ' vec3 c1=ACC();vec3 c2=mix(vec3(1.,.78,.4),vec3(.85,.5,.05),uLight);',
    ' float e=1.-exp(-t*2.2);',
    ' float bloom=exp(-r/(34.+90.*e))*exp(-t*1.5)*.55;',
    ' float n=fbm(p/110.*1.6+vec2(t*.35,-t*.25));',
    ' float R=(30.+120.*e)*(.85+.3*n);',
    ' float ring=exp(-pow((r-R)/(26.+30.*e),2.))*smoothstep(0.,.25,t)*exp(-max(t-.4,0.)*1.5)*(.35+.65*n);',
    ' vec3 acc=c1*bloom*.9+mix(c1,c2,.5)*ring*.5;float al=bloom+ring*.5;',
    ' for(int i=0;i<12;i++){',
    '  float fi=float(i);float a=h11(fi*1.7)*6.2832;float sp=40.+90.*h11(fi*2.9+1.);',
    '  float life=1.6+1.2*h11(fi*4.1);float ph=t/life;if(ph>1.) continue;',
    '  vec2 pos=vec2(cos(a),sin(a))*sp*(1.-exp(-t*1.6))+vec2(0.,22.*t);',
    '  float rad=10.+22.*h11(fi*6.3);float dd=length(p-pos)/rad;',
    '  float v=exp(-dd*dd*1.8)*sin(ph*PI)*.24;',
    '  vec3 cc=h11(fi*8.1)<.5?c1:c2;acc+=cc*v;al+=v;',
    ' }',
    ' al*=smoothstep(310.,240.,r);',
    ' o=outA(acc/max(al*1.2,1e-3)*1.0,al);',
    '}'].join('\n');

  // Lade-Glanz: schräger Lichtstreif läuft über den Knopf; beim Fertigwerden eine Welle von der Mitte nach aussen
  SH.ldAB = [
    'void main(){',
    ' if(uState<.5){o=vec4(0.);return;}',
    ' vec2 bp=gl_FragCoord.xy/uDpr;bp.y=uCss.y-bp.y;',
    ' vec2 lp=bp-uBox.z;vec2 c=lp-uBox.xy*.5;',
    ' float sd=sdRR(c,uBox.xy*.5,uBox.w);float ins=smoothstep(.6,-.6,sd);',
    ' float W=uBox.x;float k=0.;',
    ' if(uState<1.5){',
    '  float u=lp.x-lp.y*.55;float ph=fract(uT/1.1);float ctr=mix(-50.,W+50.,ph);',
    '  k=exp(-pow((u-ctr)/24.,2.))*.5+exp(-pow((u-ctr)/70.,2.))*.12;',
    ' }else{',
    '  float q=length(c/(uBox.xy*.5));float R=uT*2.6;',
    '  k=exp(-pow((q-R)/.14,2.))*exp(-uT*2.2)*.7+.18*exp(-uT*5.);',
    ' }',
    ' o=outA(uTint,k*ins*uAmp);',
    '}'].join('\n');

  /* ---------------- WebGL-Kern ---------------- */
  var glc, gl, progs = {}, items = [], raf = 0, LIGHT = 0;
  function initGL() {
    if (gl) return true;
    if (gl === false) return false;
    try {
      glc = d.createElement('canvas');
      gl = glc.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    } catch (e) { gl = null; }
    if (!gl) { gl = false; return false; }
    glc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); gl = false; items.slice().forEach(kill); }, false);
    return true;
  }
  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(key) {
    if (progs[key] !== undefined) return progs[key];
    var P = null;
    try {
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, PRE + SH[key])); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      P = { p: p, loc: {} };
    } catch (e) { if (window.console) console.warn('dbzShader ' + key + ': ' + e.message); }
    progs[key] = P; return P;
  }
  function setU(P, name, v) {
    var l = P.loc[name]; if (l === undefined) l = P.loc[name] = gl.getUniformLocation(P.p, name);
    if (l === null) return;
    if (typeof v === 'number') gl.uniform1f(l, v);
    else if (name === 'uH') gl.uniform1fv(l, v);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }

  /* Pegel (Recorder): weich nachgeführt, dazu ein Verlauf der letzten 2,4 s */
  var AU = { target: 0, level: 0, clip: false, hist: new Float32Array(24), lastHist: 0, lastT: 0 };
  function updAudio(now) {
    var dt = Math.min(.1, (now - (AU.lastT || now)) / 1000); AU.lastT = now;
    var tau = AU.target > AU.level ? .016 : .13;
    AU.level += (AU.target - AU.level) * (1 - Math.exp(-dt / tau));
    if (now - AU.lastHist >= 100) { AU.lastHist = now; for (var i = 23; i > 0; i--) AU.hist[i] = AU.hist[i - 1]; AU.hist[0] = AU.level; }
  }

  function render(it, now) {
    var sz = it.size(); if (!sz) return false;
    var cw = sz[0], ch = sz[1]; if (cw < 1 || ch < 1) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, it.maxDpr) * it.scale;
    var w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    var P = prog(it.key); if (!P) { kill(it); return false; }
    if (it.cv.width !== w || it.cv.height !== h) { it.cv.width = w; it.cv.height = h; }
    if (glc.width < w || glc.height < h) { glc.width = Math.max(glc.width, w); glc.height = Math.max(glc.height, h); }
    gl.viewport(0, 0, w, h); gl.useProgram(P.p);
    setU(P, 'uRes', [w, h]); setU(P, 'uCss', [cw, ch]); setU(P, 'uDpr', w / cw);
    setU(P, 'uTime', it.still ? 14 : (now - it.t0) / 1000 + it.seed);
    setU(P, 'uLight', LIGHT); setU(P, 'uLevel', AU.level); setU(P, 'uClip', AU.clip ? 1 : 0); setU(P, 'uH', AU.hist);
    if (it.u) { var ex = it.u(now, cw, ch); for (var k in ex) setU(P, k, ex[k]); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    it.ctx.clearRect(0, 0, w, h);
    it.ctx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, w, h);
    return true;
  }
  function kill(it) {
    it.dead = true; var i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
    if (it.cv.parentNode) it.cv.parentNode.removeChild(it.cv);
    if (it.onKill) it.onKill();
  }
  function frame(now) {
    raf = 0;
    if (d.hidden || gl === false) return;
    updAudio(now);
    var any = false;
    items.slice().forEach(function (it) {
      if (it.dead) return;
      var act = it.active ? it.active(now) : true;
      if (act === 'end') { kill(it); return; }
      if (!act) return;
      any = true;
      if (now - it.last >= it.minDt) { it.last = now; render(it, now); if (it.firstDone) { it.firstDone = 0; if (it.onFirst) it.onFirst(); } }
    });
    if (any) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && !d.hidden) raf = requestAnimationFrame(frame); }
  d.addEventListener('visibilitychange', function () { if (!d.hidden) { AU.lastT = 0; items.forEach(function (it) { it.last = 0; }); wake(); } });

  function mkCanvas(css) {
    var cv = d.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); cv.style.cssText = css;
    return cv;
  }
  function add(cv, key, o) {
    var it = { cv: cv, ctx: cv.getContext('2d'), key: key, scale: 1, maxDpr: 2, minDt: 0, last: 0, t0: performance.now(), seed: 0, firstDone: 1 };
    for (var k in o) it[k] = o[k];
    items.push(it); wake(); return it;
  }

  /* ---------------- Theme ---------------- */
  function readTheme() {
    var l = (window.dbzTheme ? window.dbzTheme() : root.dataset.theme) === 'light' ? 1 : 0;
    try {
      var m = getComputedStyle(d.body).backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3 && (m.length < 4 || +m[3] > .5)) l = (.2126 * m[0] + .7152 * m[1] + .0722 * m[2]) / 255 > .5 ? 1 : 0;
    } catch (e) {}
    LIGHT = l;
  }
  window.addEventListener('dbz-theme', function () { readTheme(); stillDirty(); });

  /* ---------------- Hintergrund ---------------- */
  var bgItem = null;
  function stillDirty() { if (bgItem && bgItem.still) { bgItem.need = 1; wake(); } }
  function bg(key) {
    if (bgItem || !SH[key] || !initGL()) return;
    var still = RM.matches;
    if (key === 'rcE' && still) return; // Pegelanzeige ohne Bewegung: weglassen, die Balken zeigen den Pegel
    var cv = mkCanvas('position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block');
    cv.style.visibility = 'hidden';
    d.body.insertBefore(cv, d.body.firstChild); root.classList.add('dbz-sh');
    var orgSel = d.body.getAttribute('data-shader-origin'), orgEl = orgSel && d.getElementById(orgSel);
    var so = /^so[A-C]$|^so[MTUHLKJPQR]$/.test(key), heavy = key === 'labA';
    bgItem = add(cv, key, {
      scale: key === 'soC' ? .5 : so ? .75 : heavy ? .5 : 1, maxDpr: so ? 1 : 1.5, minDt: heavy || so ? 33 : 0, still: still, need: 1,
      size: function () { return [window.innerWidth, window.innerHeight]; },
      active: function () {
        if (key === 'rcE') return AU.level > .003 || AU.target > .003 || AU.clearPending ? true : false;
        return still ? !!this.need : true;
      },
      u: function () {
        if (this.need) this.need = 0;
        if (key === 'rcE') {
          AU.clearPending = AU.level > .003;
          if (!orgEl) return {};
          var r = orgEl.getBoundingClientRect();
          return { uOrg: [(r.left + r.width / 2) / window.innerWidth, 1 - (r.top + r.height / 2) / window.innerHeight] };
        }
        return {};
      },
      onFirst: function () { cv.style.visibility = ''; }
    });
    window.addEventListener('resize', stillDirty);
  }

  /* ---------------- Dank-Moment ---------------- */
  function spark(el) {
    if (RM.matches || !el || !initGL()) return;
    readTheme();
    var r = el.getBoundingClientRect(), S = 640;
    var cv = mkCanvas('position:fixed;left:' + (r.left + r.width / 2 - S / 2) + 'px;top:' + (r.top + r.height / 2 - S / 2) + 'px;width:' + S + 'px;height:' + S + 'px;z-index:10000;pointer-events:none;display:block');
    d.body.appendChild(cv);
    add(cv, 'dkG', {
      maxDpr: 1.5, minDt: 16,
      size: function () { return [S, S]; },
      active: function (now) { return (now - this.t0) / 1000 > 3 ? 'end' : true; },
      u: function (now) { return { uT: (now - this.t0) / 1000 }; }
    });
  }

  /* ---------------- Lade-Glanz ---------------- */
  var glints = new WeakMap();
  function setGlint(btn, on) {
    if (RM.matches || !initGL()) return;
    var g = glints.get(btn);
    if (!g) {
      if (!on) return;
      var M = 2, cv = mkCanvas('position:fixed;z-index:60;pointer-events:none;display:none');
      d.body.appendChild(cv);
      g = { state: 0, t0: 0 };
      g.it = add(cv, 'ldAB', {
        maxDpr: 2, minDt: 16,
        size: function () {
          var r = btn.getBoundingClientRect();
          if (!r.width || !r.height || !btn.isConnected) return null;
          cv.style.left = (r.left - M) + 'px'; cv.style.top = (r.top - M) + 'px';
          cv.style.width = (r.width + 2 * M) + 'px'; cv.style.height = (r.height + 2 * M) + 'px';
          return [r.width + 2 * M, r.height + 2 * M];
        },
        active: function (now) {
          if (g.state === 2 && now - g.t0 > 1400) { g.state = 0; cv.style.display = 'none'; return false; }
          return g.state > 0;
        },
        u: function (now) {
          var cs = getComputedStyle(btn), rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, btn.offsetHeight / 2);
          var m = cs.backgroundColor.match(/[\d.]+/g), lum = LIGHT ? 1 : 0;
          if (m && m.length >= 3 && (m.length < 4 || +m[3] > .2)) lum = (.2126 * m[0] + .7152 * m[1] + .0722 * m[2]) / 255 > .6 ? 1 : 0; else lum = LIGHT;
          return { uBox: [btn.offsetWidth, btn.offsetHeight, M, rad], uState: g.state, uT: (now - g.t0) / 1000,
            uTint: lum ? [.82, .16, .26] : [1, 1, 1], uAmp: lum ? .55 : 1 };
        },
        onKill: function () { glints.delete(btn); }
      });
      glints.set(btn, g);
    }
    var now = performance.now();
    if (on && g.state !== 1) { readTheme(); g.state = 1; g.t0 = now; g.it.cv.style.display = 'block'; wake(); }
    else if (!on && g.state === 1) { g.state = 2; g.t0 = now; wake(); }
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      var b = m.target;
      if (b.nodeType === 1 && b.hasAttribute('data-dbz-glint')) setGlint(b, b.getAttribute('aria-busy') === 'true');
    });
  }).observe(d, { attributes: true, attributeFilter: ['aria-busy'], subtree: true });

  window.dbzShader = {
    level: function (v, clip) {
      AU.target = v > 0 ? Math.min(1, v) : 0; AU.clip = !!clip;
      if (AU.target > .003) wake();
    },
    spark: spark,
    bg: bg,
    setBg: function (key) { if (bgItem) { kill(bgItem); bgItem = null; } if (key) bg(key); else root.classList.remove('dbz-sh'); },
    // Wählbarer Hintergrund: <body data-shader-set="soA,soT"> – Zahnrad-Menü (theme.js) schaltet durch die Liste und «aus»; Wahl in dbz-bg gespeichert
    choices: function () { var v = d.body && d.body.getAttribute('data-shader-set'); return v ? v.split(',') : []; },
    current: function () { return curBg; },
    pick: function (k) { pickBg(k, true); },
    init: function () { if (!bgItem) auto(); }, // nach dem Setzen von data-shader-set (theme.js) erneut auswerten
    cycle: function () {
      var set = window.dbzShader.choices(); if (!set.length) return;
      var i = curBg === 'off' ? set.length : set.indexOf(curBg), n = (i + 1) % (set.length + 1);
      pickBg(n < set.length ? set[n] : 'off', true);
    }
  };

  var curBg = 'off';
  function pickBg(k, store) {
    curBg = k;
    if (store) { try { localStorage.setItem('dbz-bg', k); } catch (e) {} }
    window.dbzShader.setBg(k === 'off' ? null : k);
    window.dispatchEvent(new CustomEvent('dbz-bg', { detail: k }));
  }
  function auto() {
    readTheme();
    var set = window.dbzShader.choices();
    if (set.length) {
      var sv = ''; try { sv = localStorage.getItem('dbz-bg') || ''; } catch (e) {}
      pickBg(sv === 'off' ? 'off' : set.indexOf(sv) >= 0 ? sv : (d.body.getAttribute('data-shader-default') || 'off'), false);
      return;
    }
    var k = d.body && d.body.getAttribute('data-shader');
    if (k) bg(k);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', auto); else auto();
})();
