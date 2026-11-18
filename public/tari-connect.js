"use strict";(()=>{var C=Object.defineProperty;var T=(e,t,o)=>t in e?C(e,t,{enumerable:!0,configurable:!0,writable:!0,value:o}):e[t]=o;var g=(e,t,o)=>T(e,typeof t!="symbol"?t+"":t,o);var L="https://chromewebstore.google.com/detail/tari-ootle-wallet/demkeckolenopkgnfbnpflkpbbdhpgkl",x="tari-connect:last-wallet",$=(()=>{try{return new URL(".",document.currentScript?.src||location.href).href}catch{return"https://universe.tari.mw/"}})(),u=()=>/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);function I(e){return`<svg viewBox="0 0 128 128" width="40" height="40" aria-hidden="true">
    <defs><linearGradient id="g${e}" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fc72ff"/><stop offset="1" stop-color="#a259ff"/></linearGradient></defs>
    <rect width="128" height="128" rx="28" fill="url(#g${e})"/>
    <path d="M18 60 Q58 30 98 60 Q58 90 18 60 Z" fill="#180a20"/><circle cx="58" cy="60" r="14" fill="url(#g${e})"/><circle cx="58" cy="60" r="5.5" fill="#180a20"/>
    ${e==="phone"?'<rect x="84" y="78" width="34" height="44" rx="7" fill="#17111f" stroke="#fff" stroke-width="5"/><rect x="96" y="112" width="10" height="3" rx="1.5" fill="#fff"/>':'<rect x="82" y="84" width="38" height="34" rx="7" fill="#17111f" stroke="#fff" stroke-width="5"/><path d="M90 96h22M90 106h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'}</svg>`}var U=`<img src="${$}tari-favicon.svg" width="40" height="40" alt="" style="border-radius:10px;background:#000">`;function v(){let e=window,t=e.tariUniverse??null,o=e.tari&&e.tari!==t?e.tari:null,r=[];if(t?.transport==="embedded")return r.push({id:"tari-universe",name:"Tari Universe",detail:"The wallet this app is running in",badge:"Connected app",provider:t}),r;let i=o?{id:"sapient-extension",name:"Sapient extension",detail:"Browser extension",badge:"Detected",provider:o}:{id:"sapient-extension",name:"Sapient extension",detail:u()?"Desktop Chrome, Brave or Edge":"Add to Chrome, Brave or Edge",badge:"Install",provider:null,installUrl:L},a=t?.transport==="walletconnect"?{id:"sapient-mobile",name:"Sapient for Android",detail:u()?"Opens the Sapient app":"Scan a QR code with your phone",badge:"WalletConnect",provider:t}:null;return u()?(a&&r.push(a),r.push(i)):(r.push(i),a&&r.push(a)),r}function O(){try{return localStorage.getItem(x)}catch{return null}}function P(e){try{localStorage.setItem(x,e)}catch{}}async function m(e){let t=e.provider,o=await t.request({method:"tari_requestAccounts"});return P(e.id),s={wallet:e.id,provider:t,accounts:o},s}var s=null,A=`
:host { all: initial; }
.backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(8, 4, 12, 0.6);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; animation: fade .15s ease-out; }
.card { width: 100%; max-width: 380px; background: var(--bg); color: var(--fg); border: 1px solid var(--line);
  border-radius: 22px; padding: 20px; box-shadow: 0 30px 80px rgba(0,0,0,.45); animation: rise .2s cubic-bezier(.2,.8,.2,1); }
:host([data-theme="dark"]) { --bg: #17111f; --fg: #f2f2f6; --muted: #9997a3; --line: #2c2338; --row: #1f1729; --rowh: #2a2036; }
:host([data-theme="light"]) { --bg: #ffffff; --fg: #17111f; --muted: #6b6676; --line: #e7e2ef; --row: #f7f4fb; --rowh: #efe8f8; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
h2 { margin: 0; font-size: 18px; }
.x { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); font-size: 20px; }
.x:hover { background: var(--row); }
.sub { margin: 0 0 14px; color: var(--muted); font-size: 13.5px; }
.list { display: flex; flex-direction: column; gap: 8px; }
.opt { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 64px; padding: 10px 12px; border-radius: 14px; background: var(--row); border: 1px solid var(--line); }
.opt:hover, .opt:focus-visible { background: var(--rowh); border-color: #a259ff; }
.opt[aria-busy="true"] { opacity: .7; cursor: progress; }
.meta { flex: 1; min-width: 0; }
.name { display: block; font-weight: 650; font-size: 15px; }
.detail { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.badge { font-size: 11.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap;
  background: rgba(162,89,255,.16); color: #b88aff; }
.badge.detected { background: rgba(48,164,108,.16); color: #34b37a; }
.badge.install { background: transparent; border: 1px solid var(--line); color: var(--muted); }
.last { display: inline-block; margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #b88aff; vertical-align: 1px; }
.err { margin-top: 12px; padding: 10px 12px; border-radius: 12px; font-size: 13px; background: rgba(229,72,77,.12); color: #e5484d; }
.foot { margin-top: 14px; text-align: center; color: var(--muted); font-size: 12px; }
.foot a { color: inherit; }
@keyframes fade { from { opacity: 0 } }
@keyframes rise { from { opacity: 0; transform: translateY(12px) scale(.98) } }
@media (max-width: 480px) { .backdrop { align-items: flex-end; padding: 0; }
  .card { max-width: none; border-radius: 22px 22px 0 0; padding-bottom: calc(20px + env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { .backdrop, .card { animation: none; } }
`;function w(e={}){let t=v();return t.length===1&&t[0].id==="tari-universe"?m(t[0]):new Promise((o,r)=>{let i=document.createElement("div");i.setAttribute("data-tari-connect",""),i.setAttribute("data-theme",e.theme==="light"?"light":"dark");let a=i.attachShadow({mode:"open"}),k=O(),E=t.map(n=>`<button class="opt" data-id="${n.id}" type="button">
          ${n.id==="tari-universe"?U:I(n.id==="sapient-mobile"?"phone":"ext")}
          <span class="meta"><span class="name">${n.name}${n.id===k&&n.provider?'<span class="last">LAST USED</span>':""}</span><span class="detail">${n.detail}</span></span>
          <span class="badge ${n.badge==="Detected"?"detected":n.badge==="Install"?"install":""}">${n.badge}</span>
        </button>`).join("");a.innerHTML=`<style>${A}</style>
      <div class="backdrop"><div class="card" role="dialog" aria-modal="true" aria-label="Connect a wallet">
        <header><h2>${e.title??"Connect a wallet"}</h2><button class="x" type="button" aria-label="Close">\xD7</button></header>
        <p class="sub">Choose how to connect to this app. Your keys stay in your wallet.</p>
        <div class="list">${E}</div>
        <div class="err" hidden></div>
        <div class="foot">Download Sapient at <a href="https://sapient.tari.mw" target="_blank" rel="noopener">sapient.tari.mw</a></div>
      </div></div>`,document.body.append(i);let c=a.querySelector(".err"),h=()=>{i.remove(),document.removeEventListener("keydown",b)},p=()=>{h();let n=new Error("The user closed the wallet picker.");n.code=4001,r(n)},b=n=>{n.key==="Escape"&&p()};document.addEventListener("keydown",b),a.querySelector(".x").addEventListener("click",p),a.querySelector(".backdrop").addEventListener("click",n=>{n.target===n.currentTarget&&p()}),a.querySelector(".opt")?.focus(),a.querySelectorAll(".opt").forEach(n=>{n.addEventListener("click",async()=>{let d=t.find(l=>l.id===n.dataset.id);if(!d.provider){d.installUrl&&window.open(d.installUrl,"_blank","noopener");return}c.hidden=!0,n.setAttribute("aria-busy","true"),i.style.display="none";try{let l=await m(d);h(),o(l)}catch(l){i.style.display="",n.removeAttribute("aria-busy");let S=l.code;c.textContent=S===4001?"Connection cancelled. Pick a wallet to try again.":l.message||"Couldn't connect.",c.hidden=!1}})})})}function R(){return s}async function y(){let e=s;s=null,e&&await e.provider.request({method:"tari_disconnect"}).catch(()=>{})}var W=`
:host { display: inline-block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
  min-height: 42px; padding: 0 18px; border-radius: 999px; font-weight: 650; font-size: 14.5px;
  background: linear-gradient(135deg, #fc72ff, #a259ff); color: #120b18; box-shadow: 0 6px 18px rgba(162,89,255,.35); }
button.connected { background: #1f1729; color: #f2f2f6; border: 1px solid #2c2338; box-shadow: none; }
button:focus-visible { outline: 2px solid #a259ff; outline-offset: 2px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #34b37a; }
`,f=class extends HTMLElement{constructor(){super(...arguments);g(this,"btn")}connectedCallback(){if(this.shadowRoot)return;let o=this.attachShadow({mode:"open"});o.innerHTML=`<style>${W}</style><button type="button" part="button"></button>`,this.btn=o.querySelector("button"),this.render(),this.btn.addEventListener("click",()=>void this.onClick())}render(){let o=this.getAttribute("label")||"Connect wallet";if(s){let r=s.accounts[0]??"",i=r.length>18?`${r.slice(0,10)}\u2026${r.slice(-6)}`:r;this.btn.className="connected",this.btn.innerHTML=`<span class="dot"></span>${i}`,this.btn.title="Connected. Click to disconnect."}else this.btn.className="",this.btn.textContent=o,this.btn.title=""}async onClick(){if(s){await y(),this.render(),this.dispatchEvent(new CustomEvent("tari-disconnect",{bubbles:!0,composed:!0}));return}try{let o=await w({theme:this.getAttribute("theme")||"dark"});this.render(),o.provider.on?.("disconnect",()=>{s=null,this.render()}),this.dispatchEvent(new CustomEvent("tari-connect",{detail:o,bubbles:!0,composed:!0}))}catch{}}};customElements.get("tari-connect-button")||customElements.define("tari-connect-button",f);window.TariConnect={open:w,discover:v,connection:R,disconnect:y};})();
