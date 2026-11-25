"use client";

import { useEffect, useRef, useState } from "react";
import { registerMailServiceWorker } from "@/lib/push-client";

type PromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type Check = "checking" | "ok" | "error";

function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function checkIcon(path: string, size: number) {
  const response = await fetch(path, { credentials: "omit", redirect: "error", cache: "no-store" });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) throw new Error("icon response");
  const bitmap = await createImageBitmap(await response.blob());
  try { if (bitmap.width !== size || bitmap.height !== size) throw new Error("icon dimensions"); }
  finally { bitmap.close(); }
}

async function checkManifest() {
  const response = await fetch("/manifest.webmanifest", { credentials: "omit", redirect: "error", cache: "no-store" });
  if (!response.ok || !response.headers.get("content-type")?.includes("manifest+json")) throw new Error("manifest response");
  const m = await response.json();
  if (m.id !== "/" || m.scope !== "/" || m.display !== "standalone" || !m.name ||
    m.start_url !== "/install?launch=1" ||
    ![192, 512].every(size => m.icons?.some((icon: { sizes: string; src: string; purpose?: string }) =>
      icon.sizes === size + "x" + size && icon.src === "/icons/mail-" + size + ".png" && icon.purpose === "any"))) throw new Error("manifest fields");
}

export default function InstallPage() {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [secure, setSecure] = useState<Check>("checking");
  const [manifest, setManifest] = useState<Check>("checking");
  const [icons, setIcons] = useState<Check>("checking");
  const [worker, setWorker] = useState<Check>("checking");
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [android, setAndroid] = useState(false);
  const checking = useRef(0);

  function runChecks() {
    const id = ++checking.current;
    const apply = (set: (value: Check) => void, task: Promise<unknown>) => {
      set("checking");
      void task.then(() => { if (id === checking.current) set("ok"); }, () => { if (id === checking.current) set("error"); });
    };
    setSecure(window.isSecureContext && location.protocol === "https:" ? "ok" : "error");
    apply(setManifest, checkManifest());
    apply(setIcons, Promise.all([checkIcon("/icons/mail-192.png", 192), checkIcon("/icons/mail-512.png", 512)]));
    apply(setWorker, registerMailServiceWorker());
  }

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as PromptEvent); };
    const onInstalled = () => { setPrompt(null); setInstalled(standalone()); setMessage("浏览器已确认安装请求。请检查主屏幕上的 Vyncuslim Mail 图标。"); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const runningAsApp = standalone();
    setAndroid(/Android/i.test(navigator.userAgent));
    setInstalled(runningAsApp);
    if (runningAsApp && new URLSearchParams(location.search).get("launch") === "1") {
      location.replace("/");
    } else { runChecks(); }
    return () => { ++checking.current; window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      setMessage(result.outcome === "accepted"
        ? "安装请求已提交，不代表 Android 安装已经完成。请查看主屏幕；若失败，仍可使用网页版和后台通知。"
        : "安装已取消，可从 Chrome 菜单再次尝试。");
    } catch { setMessage("浏览器无法启动安装。请从 Chrome 菜单安装或创建快捷方式。"); }
    finally { setPrompt(null); setBusy(false); }
  }

  const status = { checking: "检查中", ok: "通过", error: "未通过" };
  const checks: [string, Check][] = [["安全连接", secure], ["应用配置", manifest], ["应用图标", icons], ["Service Worker", worker]];
  return <main className="login-shell" lang="zh-CN" style={{padding:"24px 12px"}}>
    <section className="login-card" style={{maxWidth:460,width:"100%",padding:28,alignItems:"stretch",gap:14}}>
      <img src="/icons/mail-192.png" width={64} height={64} alt="" style={{alignSelf:"center",borderRadius:14}}/>
      <h1 style={{fontSize:22,textAlign:"center"}}>Vyncuslim Mail</h1>
      <p style={{textAlign:"center"}}>安装邮箱应用 · 设备兼容性检查</p>
      <div style={{border:"1px solid #e2e5e9",borderRadius:12,padding:"12px 14px",display:"grid",gap:10}}>
        {checks.map(([label,value]) => <div key={label} style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span>{label}</span><strong style={{color:value==="ok"?"#137333":value==="error"?"#b3261e":"#747775"}}>{status[value]}</strong></div>)}
        <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span>浏览器安装状态</span><strong>{installed?"独立应用":prompt?"可发起安装":"由浏览器决定"}</strong></div>
      </div>
      {prompt && !installed && <button type="button" disabled={busy} onClick={install}>{busy?"正在请求安装…":"安装邮箱应用"}</button>}
      <a href="/" style={{display:"block",padding:"12px",textAlign:"center",background:"#0b57d0",borderRadius:10,color:"white",fontWeight:600,textDecoration:"none"}}>打开邮箱</a>
      <button type="button" onClick={runChecks} style={{background:"#eaf1fb",color:"#0b57d0"}}>重新检查安装条件</button>
      <p role="status" aria-live="polite" style={{fontSize:13,lineHeight:1.65}}>{message || (installed?"当前正在独立应用窗口中运行。":"若浏览器没有提供安装按钮，请使用浏览器自己的菜单。")}</p>
      {android && <div style={{fontSize:13,lineHeight:1.7,color:"#444746"}}>
        <strong>Android / ColorOS 安装失败？</strong>
        <p style={{margin:"6px 0"}}>请使用 Chrome 正式版打开此页，点右上角 ⋮ → 安装应用或安装并创建快捷方式。更新 Chrome 和 Google Play 服务，确认手机有可用存储空间。若安装仍失败，可选择创建快捷方式（如果 Chrome 提供），或直接打开邮箱开启通知；无需卸载 Chrome 或清除数据。</p>
      </div>}
      <p style={{fontSize:12,lineHeight:1.65}}>此页面不需要登录，不会读取邮件。后台通知可在已登录的邮箱中开启；Android 不要求先安装 WebAPK。以上检查不代表系统最终安装或推送成功。</p>
    </section>
  </main>;
}
