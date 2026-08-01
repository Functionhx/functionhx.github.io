function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/[^a-zA-Z0-9]/g, "");
}

export function createUnlockPage(origins) {
  const nonce = randomNonce();
  const allowedOrigins = JSON.stringify(origins);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Magic · Spark Vault</title>
  <style nonce="${nonce}">
    :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f3;color:#191919}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,rgba(196,0,184,.08),transparent 42%),#f5f5f3}
    main{width:min(100%,420px);background:rgba(255,255,255,.88);border:1px solid rgba(0,0,0,.09);border-radius:24px;padding:30px;box-shadow:0 24px 70px rgba(0,0,0,.12);backdrop-filter:blur(18px)}
    .mark{font-family:Georgia,serif;font-style:italic;color:#c400b8;font-size:30px;line-height:1}h1{font-size:25px;margin:18px 0 8px;letter-spacing:-.03em}p{color:#666;line-height:1.65;margin:0 0 22px;font-size:14px}
    form{display:grid;gap:12px}label{font-size:13px;font-weight:650}input{width:100%;border:1px solid rgba(0,0,0,.14);border-radius:13px;padding:13px 14px;background:rgba(255,255,255,.72);color:inherit;font:inherit;outline:none}input:focus{border-color:#c400b8;box-shadow:0 0 0 3px rgba(196,0,184,.1)}
    #pin{font-size:28px;text-align:center;letter-spacing:.48em;padding-left:calc(14px + .48em);font-variant-numeric:tabular-nums}
    button{border:0;border-radius:13px;padding:12px 15px;background:#191919;color:#fff;font:inherit;font-weight:650;cursor:pointer}button:hover{opacity:.86}button:disabled{opacity:.5;cursor:wait}.quiet{background:transparent;color:#666;font-weight:500;padding:8px}.row{display:flex;gap:10px}.row>*{flex:1}
    [hidden]{display:none!important}.status{min-height:22px;margin:15px 0 0;color:#666;font-size:13px}.status[data-state=error]{color:#b42318}.status[data-state=success]{color:#087443}.recovery{font-size:12px;text-align:center;margin-top:8px}.recovery input{display:none}
    @media(prefers-color-scheme:dark){:root{background:#111;color:#f3f3f1}body{background:radial-gradient(circle at 50% 0,rgba(255,61,236,.12),transparent 42%),#111}main{background:rgba(28,28,28,.9);border-color:rgba(255,255,255,.12)}p,.quiet,.status{color:#aaa}input{background:#191919;border-color:rgba(255,255,255,.16)}button{background:#f3f3f1;color:#111}}
  </style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">ƒ</div>
  <section id="gate">
    <h1>进入私密空间</h1>
    <p>先通过快速访问门。真正的私密库还会要求独立口令与通行密钥。</p>
    <form id="pin-form">
      <label for="pin">3 位访问码</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{3}" maxlength="3" autocomplete="off" required autofocus>
      <button type="submit">打开</button>
      <button class="quiet" id="strong-unlock" type="button">使用通行密钥</button>
    </form>
  </section>
  <section id="unlock" hidden>
    <h1 id="unlock-title">双重解锁</h1>
    <p id="unlock-copy">口令只在本机参与派生密钥；通行密钥负责第二因子。二者都不会发送到服务器。</p>
    <form id="unlock-form">
      <label for="passphrase">独立私密库口令</label>
      <input id="passphrase" type="password" autocomplete="current-password" minlength="16" required>
      <div id="confirmation" hidden>
        <label for="passphrase-confirm">再次输入</label>
        <input id="passphrase-confirm" type="password" autocomplete="new-password" minlength="16">
      </div>
      <button id="unlock-submit" type="submit">验证通行密钥并解锁</button>
    </form>
    <label class="recovery quiet" for="recovery-file">使用离线恢复包</label>
    <input id="recovery-file" type="file" accept="application/json,.json">
    <button class="quiet" id="back" type="button">返回</button>
  </section>
  <p class="status" id="status" role="status" aria-live="polite"></p>
</main>
<script nonce="${nonce}">
(() => {
  "use strict";
  const allowedOrigins=${allowedOrigins};
  const parameters=new URLSearchParams(location.hash.slice(1));
  const session=parameters.get("session")||"";
  const requestedOrigin=parameters.get("site_origin")||"";
  const intent=parameters.get("intent")==="strong"?"strong":"";
  const sessionUser={id:Number(parameters.get("user_id")||0),login:parameters.get("user_login")||""};
  const target=allowedOrigins.includes(requestedOrigin)?requestedOrigin:allowedOrigins[0];
  history.replaceState(null,"",location.pathname);
  const gate=document.getElementById("gate");
  const unlock=document.getElementById("unlock");
  const status=document.getElementById("status");
  const form=document.getElementById("unlock-form");
  const passphrase=document.getElementById("passphrase");
  const confirmation=document.getElementById("confirmation");
  const confirmPassphrase=document.getElementById("passphrase-confirm");
  const submit=document.getElementById("unlock-submit");
  const encoder=new TextEncoder();
  const decoder=new TextDecoder();
  let keyring=null;
  let keyringSha="";
  let setup=false;
  let closeFallback=0;
  let pendingRequestId="";

  function bytesToBase64Url(bytes){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/g,"")}
  function base64UrlToBytes(value){const normalized=String(value).replace(/-/g,"+").replace(/_/g,"/");const binary=atob(normalized+"=".repeat((4-(normalized.length%4||4))%4));return Uint8Array.from(binary,c=>c.charCodeAt(0))}
  function randomBytes(length){return crypto.getRandomValues(new Uint8Array(length))}
  function setStatus(message,state=""){status.textContent=message;state?status.dataset.state=state:delete status.dataset.state}
  function post(payload){if(!window.opener||window.opener.closed)return false;pendingRequestId=bytesToBase64Url(randomBytes(18));payload.requestId=pendingRequestId;window.opener.postMessage(payload,target);closeFallback=setTimeout(()=>window.close(),1500);return true}
  window.addEventListener("message",event=>{if(event.origin!==target||event.source!==window.opener||event.data?.type!=="functionhx:spark-vault-ack")return;if(!pendingRequestId||event.data.requestId!==pendingRequestId)return;clearTimeout(closeFallback);window.close()});
  async function api(path,options={}){const headers={Accept:"application/json",Authorization:"Bearer "+session,...options.headers};let body;if(options.body!==undefined){headers["Content-Type"]="application/json";body=JSON.stringify(options.body)}const response=await fetch(path,{...options,body,headers,cache:"no-store"});const payload=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(payload.error?.message||"私密库请求失败");error.code=payload.error?.code;error.status=response.status;throw error}return payload}
  async function deriveKek(secret,prf,keyringValue){const passKey=await crypto.subtle.importKey("raw",encoder.encode(secret.normalize("NFKC")),"PBKDF2",false,["deriveBits"]);const passBits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:base64UrlToBytes(keyringValue.passphrase_salt),iterations:keyringValue.iterations},passKey,256));const material=new Uint8Array(passBits.length+prf.length);material.set(passBits);material.set(prf,passBits.length);const hkdf=await crypto.subtle.importKey("raw",material,"HKDF",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:base64UrlToBytes(keyringValue.combine_salt),info:encoder.encode("functionhx:spark-vault-root:v2")},hkdf,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
  async function wrapRoot(root,kek,iv){return new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode("functionhx:spark-vault-root:v2")},kek,root))}
  async function unwrapRoot(wrapped,kek,iv){return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:encoder.encode("functionhx:spark-vault-root:v2")},kek,wrapped))}
  async function evaluatePrf(credentialId,salt){const result=await navigator.credentials.get({publicKey:{challenge:randomBytes(32),allowCredentials:[{id:base64UrlToBytes(credentialId),type:"public-key"}],extensions:{prf:{eval:{first:salt}}},timeout:60000,userVerification:"required"}});const bytes=result?.getClientExtensionResults?.().prf?.results?.first;if(!bytes)throw new Error("这个通行密钥不支持 PRF 加密扩展，请使用新版 Chrome 与支持的通行密钥。");return new Uint8Array(bytes)}
  async function createCredential(salt){const credential=await navigator.credentials.create({publicKey:{attestation:"none",authenticatorSelection:{residentKey:"preferred",userVerification:"required"},challenge:randomBytes(32),pubKeyCredParams:[{alg:-7,type:"public-key"},{alg:-257,type:"public-key"}],rp:{name:"Magic Spark Vault"},timeout:60000,user:{displayName:"樊宇琛的私密 Spark",id:randomBytes(32),name:"Functionhx"},extensions:{prf:{eval:{first:salt}}}}});if(!credential)throw new Error("未创建通行密钥。");let first=credential.getClientExtensionResults?.().prf?.results?.first;const credentialId=bytesToBase64Url(new Uint8Array(credential.rawId));if(!first)first=await evaluatePrf(credentialId,salt);return{credentialId,prf:new Uint8Array(first)}}
  function downloadRecovery(ring,recoveryKey){const blob=new Blob([JSON.stringify({created_at:new Date().toISOString(),recovery_key:bytesToBase64Url(recoveryKey),type:"functionhx-spark-vault-recovery",version:2,keyring:ring},null,2)+"\\n"],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="magic-spark-vault-recovery.json";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
  async function setupVault(secret){if(secret.length<16)throw new Error("真实私密库口令至少需要 16 个字符。");if(secret!==confirmPassphrase.value)throw new Error("两次口令不一致。");const passphraseSalt=randomBytes(24);const combineSalt=randomBytes(24);const prfSalt=randomBytes(32);setStatus("正在创建通行密钥…");const credential=await createCredential(prfSalt);const ring={algorithm:"A256GCM+PBKDF2+WebAuthn-PRF",combine_salt:bytesToBase64Url(combineSalt),created_at:new Date().toISOString(),credential_id:credential.credentialId,iterations:600000,passphrase_salt:bytesToBase64Url(passphraseSalt),prf_salt:bytesToBase64Url(prfSalt),version:2};const kek=await deriveKek(secret,credential.prf,ring);const root=randomBytes(32);const wrapIv=randomBytes(12);ring.wrap_iv=bytesToBase64Url(wrapIv);ring.wrapped_root=bytesToBase64Url(await wrapRoot(root,kek,wrapIv));const recoveryKey=randomBytes(32);const recoveryCryptoKey=await crypto.subtle.importKey("raw",recoveryKey,{name:"AES-GCM"},false,["encrypt"]);const recoveryIv=randomBytes(12);ring.recovery_iv=bytesToBase64Url(recoveryIv);ring.recovery_wrapped_root=bytesToBase64Url(new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:recoveryIv,additionalData:encoder.encode("functionhx:spark-vault-recovery:v2")},recoveryCryptoKey,root)));setStatus("正在保存非敏感密钥封装…");const saved=await api("/api/keyring",{method:"PUT",body:{expectedSha:keyringSha,keyring:ring}});keyring=saved.keyring;downloadRecovery(keyring,recoveryKey);return root}
  async function unlockVault(secret){const prf=await evaluatePrf(keyring.credential_id,base64UrlToBytes(keyring.prf_salt));const kek=await deriveKek(secret,prf,keyring);return unwrapRoot(base64UrlToBytes(keyring.wrapped_root),kek,base64UrlToBytes(keyring.wrap_iv))}
  async function enterStrongUnlock(){gate.hidden=true;unlock.hidden=false;setStatus("正在检查密钥封装…");try{if(!session)throw new Error("GitHub 会话不存在，请返回网站重新登录。");const payload=await api("/api/keyring");keyring=payload.keyring||null;keyringSha=payload.sha||"";setup=!keyring;confirmation.hidden=!setup;confirmPassphrase.required=setup;document.getElementById("unlock-title").textContent=setup?"建立零知识私密库":"双重解锁";document.getElementById("unlock-copy").textContent=setup?"首次设置会创建通行密钥，并下载唯一的离线恢复包。服务器只保存无法单独解密的封装。":"口令与通行密钥缺一不可；二者都不会发送到服务器。";submit.textContent=setup?"创建并下载恢复包":"验证通行密钥并解锁";setStatus("");passphrase.focus()}catch(error){setStatus(error.message||"无法打开私密库。","error")}}
  document.getElementById("pin-form").addEventListener("submit",event=>{event.preventDefault();const pin=document.getElementById("pin").value;if(pin==="608"){setStatus("已打开私密空间。","success");if(!post({type:"functionhx:spark-vault-decoy"}))setStatus("无法返回原页面，请关闭窗口后重试。","error");return}setStatus("访问码不正确。","error")});
  document.getElementById("strong-unlock").addEventListener("click",enterStrongUnlock);
  document.getElementById("back").addEventListener("click",()=>{unlock.hidden=true;gate.hidden=false;setStatus("");document.getElementById("pin").focus()});
  form.addEventListener("submit",async event=>{event.preventDefault();submit.disabled=true;setStatus(setup?"正在建立多重防护…":"正在等待通行密钥…");try{const root=setup?await setupVault(passphrase.value):await unlockVault(passphrase.value);setStatus(setup?"私密库已建立，恢复包已下载。":"已安全解锁。","success");if(!post({root:bytesToBase64Url(root),session,type:"functionhx:spark-vault-unlocked",user:sessionUser}))setStatus("无法返回原页面，请关闭窗口后重试。","error")}catch(error){setStatus(error.name==="NotAllowedError"?"通行密钥验证已取消。":error.message||"解锁失败。","error")}finally{submit.disabled=false}});
  document.getElementById("recovery-file").addEventListener("change",async event=>{try{const file=event.target.files?.[0];if(!file)return;const kit=JSON.parse(await file.text());if(kit.type!=="functionhx-spark-vault-recovery"||kit.version!==2)throw new Error("恢复包格式不正确。");const recoveryKey=await crypto.subtle.importKey("raw",base64UrlToBytes(kit.recovery_key),{name:"AES-GCM"},false,["decrypt"]);const ring=kit.keyring;const root=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:base64UrlToBytes(ring.recovery_iv),additionalData:encoder.encode("functionhx:spark-vault-recovery:v2")},recoveryKey,base64UrlToBytes(ring.recovery_wrapped_root)));setStatus("已通过离线恢复包解锁。请尽快重新配置通行密钥。","success");if(!post({root:bytesToBase64Url(root),session,type:"functionhx:spark-vault-unlocked",user:sessionUser}))setStatus("无法返回原页面，请关闭窗口后重试。","error")}catch(error){setStatus(error.message||"无法读取恢复包。","error")}});
  if(intent==="strong")enterStrongUnlock();
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
    status: 200,
  });
}
