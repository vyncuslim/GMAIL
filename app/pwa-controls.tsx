"use client";

import { Bell, BellOff, Check, Download, LoaderCircle, RefreshCw, Send, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  disableCurrentDevicePush,
  getPushConfiguration,
  getPushSubscriptionStatus,
  notificationsOptedOut,
  PushClientError,
  publicKeyBytes,
  pushErrorMessage,
  registerMailServiceWorker,
  removePushSubscription,
  savePushSubscription,
  sendPushTest,
  subscriptionUsesKey,
  type PushConfiguration,
} from "@/lib/push-client";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type Phase = "checking" | "off" | "on" | "denied" | "unsupported" | "install-needed" | "renew" | "unavailable" | "error";

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const descriptions: Record<Phase, string> = {
  checking: "正在连接通知服务…",
  off: "尚未开启此设备的新邮件通知。",
  on: "此设备已订阅新邮件通知。关闭网页后也可接收推送。",
  denied: "通知权限已被拒绝，请在浏览器或系统设置中允许此网站发送通知。",
  unsupported: "当前浏览器不支持网页推送。请使用更新版本的 Safari、Chrome 或 Edge。",
  "install-needed": "在 iPhone 或 iPad 上，请先添加到主屏幕，再从主屏幕图标打开并开启通知。",
  renew: "通知服务密钥已更新，请重新连接此设备。",
  unavailable: "通知服务尚未启用，请稍后重试。",
  error: "通知连接未完成，请重试。",
};

export default function PwaControls() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const configurationRef = useRef<PushConfiguration | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);
  const busyRef = useRef(false);
  const generationRef = useRef(0);

  const refreshSetup = useCallback(async () => {
    if (busyRef.current) return;
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    const appleDevice = isIOSDevice();
    const standalone = isInstalled();
    setIos(appleDevice);
    setInstalled(standalone);
    setFeedback("");
    setError("");
    setPhase("checking");
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      setPhase("unsupported");
      return;
    }
    // Register before any permission gesture; installation and offline fallback need no permission.
    const workerReady = registerMailServiceWorker();
    if (appleDevice && !standalone) {
      void workerReady.catch(() => {});
      setPhase("install-needed");
      return;
    }
    if (!("PushManager" in window) || !("Notification" in window)) {
      void workerReady.catch(() => {});
      setPhase("unsupported");
      return;
    }
    try {
      // Both are prepared now so clicking Enable can request permission immediately on iOS.
      const [registration, configuration] = await Promise.all([workerReady, getPushConfiguration()]);
      if (!current()) return;
      registrationRef.current = registration;
      configurationRef.current = configuration;
      if (!configuration.enabled) { setPhase("unavailable"); return; }
      if (Notification.permission === "denied") { setPhase("denied"); return; }
      const subscription = await registration.pushManager.getSubscription();
      if (!current()) return;
      subscriptionRef.current = subscription;
      if (!subscription || Notification.permission !== "granted") { setPhase("off"); return; }
      if (notificationsOptedOut()) {
        await removePushSubscription(subscription);
        if (current()) { subscriptionRef.current = null; setPhase("off"); }
        return;
      }
      if (!subscriptionUsesKey(subscription, configuration.publicKey)) { setPhase("renew"); return; }
      const status = await getPushSubscriptionStatus(subscription);
      if (!current()) return;
      // Browser permission alone does not mean the server has a registered device.
      if (!status.subscribed || !configuration.accounts.every((account) => status.accounts?.includes(account))) {
        await savePushSubscription(subscription, configuration.accounts);
      }
      if (current()) setPhase("on");
    } catch (failure) {
      if (current()) { setPhase("error"); setError(pushErrorMessage(failure)); }
    }
  }, []);

  useEffect(() => {
    void refreshSetup();
    const installable = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installedHandler = () => { setInstallPrompt(null); setInstalled(isInstalled()); setFeedback("浏览器已处理安装请求，请检查手机桌面是否出现邮箱图标。"); };
    const visibility = () => { if (document.visibilityState === "visible") void refreshSetup(); };
    const workerMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") void refreshSetup();
    };
    const preferenceChanged = (event: StorageEvent) => {
      if (event.key === "vmail_push_preference_v1") void refreshSetup();
    };
    window.addEventListener("beforeinstallprompt", installable);
    window.addEventListener("appinstalled", installedHandler);
    window.addEventListener("storage", preferenceChanged);
    document.addEventListener("visibilitychange", visibility);
    navigator.serviceWorker?.addEventListener("message", workerMessage);
    return () => {
      ++generationRef.current;
      window.removeEventListener("beforeinstallprompt", installable);
      window.removeEventListener("appinstalled", installedHandler);
      window.removeEventListener("storage", preferenceChanged);
      document.removeEventListener("visibilitychange", visibility);
      navigator.serviceWorker?.removeEventListener("message", workerMessage);
    };
  }, [refreshSetup]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function enableNotifications() {
    const registration = registrationRef.current;
    const configuration = configurationRef.current;
    if (busyRef.current || !registration || !configuration?.enabled) return;
    busyRef.current = true;
    ++generationRef.current;
    setBusy(true);
    setError("");
    setFeedback("");
    let createdSubscription: PushSubscription | null = null;
    try {
      // Keep this as the first asynchronous call in this click handler: Safari requires a gesture.
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        setPhase(permission === "denied" ? "denied" : "off");
        if (permission === "default") setFeedback("你尚未允许通知，可以稍后再次开启。");
        return;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !subscriptionUsesKey(subscription, configuration.publicKey)) {
        if (!await removePushSubscription(subscription)) throw new PushClientError("UNSUBSCRIBE_FAILED");
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKeyBytes(configuration.publicKey),
        });
        createdSubscription = subscription;
      }
      await savePushSubscription(subscription, configuration.accounts);
      subscriptionRef.current = subscription;
      setPhase("on");
      setFeedback("已开启此设备通知。新邮件到达时，系统会显示提醒。");
    } catch (failure) {
      if (createdSubscription) {
        try { await createdSubscription.unsubscribe(); } catch {}
      }
      subscriptionRef.current = null;
      setPhase(Notification.permission === "denied" ? "denied" : "error");
      setError(pushErrorMessage(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function disableNotifications() {
    if (busyRef.current) return;
    busyRef.current = true;
    ++generationRef.current;
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      await disableCurrentDevicePush();
      subscriptionRef.current = null;
      setPhase("off");
      setFeedback("已关闭此设备的新邮件通知。");
    } catch (failure) {
      setPhase("error");
      setError(pushErrorMessage(failure));
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function testNotification() {
    if (busyRef.current || !subscriptionRef.current) return;
    busyRef.current = true;
    ++generationRef.current;
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      await sendPushTest(subscriptionRef.current);
      setFeedback("已提交测试通知，请查看系统通知。");
    } catch (failure) { setError(pushErrorMessage(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function installApp() {
    if (!installPrompt) return;
    setError("");
    try {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      setInstallPrompt(null);
      setFeedback(result.outcome === "accepted" ? "安装请求已提交。若桌面没有图标，请打开安装诊断页检查。" : "已取消安装，之后仍可从浏览器菜单安装。");
    } catch { setInstallPrompt(null); setFeedback("请从浏览器菜单选择安装应用或添加到主屏幕。"); }
  }

  return (
    <div className="pwa-controls" ref={containerRef} lang="zh-CN">
      <button
        ref={triggerRef}
        className={`pwa-trigger${phase === "on" ? " pwa-trigger-active" : ""}`}
        aria-label="安装应用与通知设置"
        aria-expanded={open}
        aria-controls="mail-pwa-settings"
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title="安装与通知"
      >
        <Bell size={18} aria-hidden="true" />
        <span>安装与通知</span>
        {phase === "on" && <i className="pwa-indicator" aria-hidden="true" />}
      </button>
      {open && (
        <section id="mail-pwa-settings" className="pwa-panel" role="dialog" aria-labelledby="pwa-title" aria-busy={busy || phase === "checking"}>
          <div className="pwa-heading">
            <div><strong id="pwa-title">让邮箱随时在线</strong><p>安装应用 · 新邮件提醒</p></div>
            <button ref={closeRef} className="pwa-icon-button" aria-label="关闭设置" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={18} /></button>
          </div>
          <div className="pwa-section">
            <h2><Smartphone size={17} aria-hidden="true" />安装到此设备</h2>
            {installed ? (
              <p className="pwa-success"><Check size={16} aria-hidden="true" />正在使用已安装的应用</p>
            ) : installPrompt ? (
              <><p>从桌面或主屏幕直接打开邮箱。</p><button className="pwa-button" onClick={installApp}><Download size={16} />安装邮箱应用</button></>
            ) : ios ? (
              <p>使用 Safari 打开此网站，点“分享” →“添加到主屏幕” →“添加”。完成后，从主屏幕打开邮箱。</p>
            ) : (
              <p>在 Chrome 或 Edge 的地址栏或菜单中选择“安装应用”。Mac 的 Safari 可选择“文件” →“添加到程序坞”。</p>
            )}
          </div>
          <a href="/install" target="_blank" rel="noopener noreferrer" style={{display:"block",marginTop:10,color:"#0b57d0",fontSize:13}}>无法安装？打开安装诊断</a>
          <div className="pwa-section">
            <h2><Bell size={17} aria-hidden="true" />新邮件通知<span className={`pwa-status pwa-status-${phase}`}>{phase === "on" ? "已开启" : phase === "checking" ? "检查中" : "未开启"}</span></h2>
            <p>{descriptions[phase]}</p>
            <p className="pwa-privacy">覆盖个人邮箱与 Vynalth 企业邮箱。锁屏提醒仅显示新邮件提示，不显示发件人、主题或正文。</p>
            <div className="pwa-actions">
              {(phase === "off" || phase === "renew") && (
                <button className="pwa-button" disabled={busy} onClick={enableNotifications}>
                  {busy ? <LoaderCircle size={16} className="pwa-spin" /> : <Bell size={16} />}
                  {phase === "renew" ? "重新连接通知" : "开启此设备通知"}
                </button>
              )}
              {phase === "on" && <>
                <button className="pwa-button" disabled={busy} onClick={testNotification}><Send size={15} />发送测试通知</button>
                <button className="pwa-button pwa-secondary" disabled={busy} onClick={disableNotifications}><BellOff size={15} />关闭</button>
              </>}
              {["error", "denied", "unsupported", "install-needed", "unavailable"].includes(phase) && (
                <button className="pwa-button pwa-secondary" disabled={busy} onClick={() => void refreshSetup()}><RefreshCw size={15} />重新检查</button>
              )}
              {phase === "checking" && <span className="pwa-loading"><LoaderCircle size={16} className="pwa-spin" aria-hidden="true" />准备通知连接</span>}
            </div>
          </div>
          <div className="pwa-feedback" aria-live="polite" aria-atomic="true">
            {feedback && <p className="pwa-success">{feedback}</p>}
            {error && <p className="pwa-error" role="alert">{error}</p>}
          </div>
          <p className="pwa-footnote">通知需要联网，并受系统通知权限、省电及专注模式影响。退出登录会取消此设备的订阅。</p>
        </section>
      )}
    </div>
  );
}
