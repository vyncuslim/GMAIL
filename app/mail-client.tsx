"use client";

import {
  Archive,
  ArrowLeft,
  Clock3,
  FileText,
  Forward,
  Inbox,
  LogOut,
  Mail,
  MailOpen,
  Menu,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MAIL_DOMAINS, type MailDomain, isAllowedSender, isDomainAddress, normalizeAddress, decodeMailId, getMailAccount, extractEmail, migrateLegacyAddress } from "@/lib/mail-domains";

import { buildReplyPlan, replyIdentity, sameThreadCandidate } from "@/lib/mail-reply";
import { getMailIdentity, validatePhotoUrl } from "@/lib/mail-identities";
import { disableCurrentDevicePush } from "@/lib/push-client";
import { loginDestination, notificationDestination } from "@/lib/navigation";
import MailAvatar, { MailIdentitySettingsContext } from "./mail-avatar";
import PwaControls from "./pwa-controls";

type Direction = "inbox" | "sent";
type MailboxFilter = MailDomain | "all" | "sleepsomno.com";
type AccountState = "connected" | "unconfigured" | "error" | "checking";
const isLegacyRootRecipient = (value: unknown) => normalizeAddress(value).some((email) => email.split("@")[1] === "sleepsomno.com");
type MailItem = {
  id: string;
  direction: Direction;
  from: any;
  to: any;
  mailboxTo?: string[];
  message_id?: string;
  subject: string;
  date: string;
};
type MailMeta = {
  folder?: "inbox" | "sent" | "archive" | "spam" | "trash";
  read?: boolean;
  starred?: boolean;
  labels?: string[];
  hidden?: boolean;
};
type Draft = {
  id: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  includeSignature?: boolean;
  updatedAt: string;
  inReplyTo?: string;
  references?: string;
  replyMode?: "reply" | "replyAll";
  replySource?: { id: string; direction: Direction };
  copyAttachmentsFrom?: { id: string; direction: Direction };
};
type Folder = "inbox" | "starred" | "sent" | "drafts" | "archive" | "spam" | "trash" | "all";

const META_KEY = "vmail_meta_v2";
const DRAFT_KEY = "vmail_drafts_v2";
const LABEL_KEY = "vmail_labels_v2";
const LAST_FROM_KEY = "vmail_last_from";

export default function MailClient() {
  const [folder, setFolder] = useState<Folder>("inbox");
  const [labelFilter, setLabelFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState<MailboxFilter>("all");
  const [items, setItems] = useState<MailItem[]>([]);
  const [meta, setMeta] = useState<Record<string, MailMeta>>({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [thread, setThread] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [enterpriseState, setEnterpriseState] = useState<AccountState>("checking");
  const [personalPhotoUrl, setPersonalPhotoUrl] = useState("");
  const [compose, setCompose] = useState<any>(false);
  const [q, setQ] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const loadPromiseRef = useRef<Promise<MailItem[] | undefined> | null>(null);
  const notificationSequenceRef = useRef(0);
  const threadSequenceRef = useRef(0);
  const loadRef = useRef(load);
  const notificationRef = useRef(openNotification);
  loadRef.current = load;
  notificationRef.current = openNotification;

  useEffect(() => {
    let cancelled = false;
    try {
      setMeta(JSON.parse(localStorage.getItem(META_KEY) || "{}"));
      setDrafts(JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]"));
      setLabels(JSON.parse(localStorage.getItem(LABEL_KEY) || "[]"));
    } catch {}
    setHydrated(true);
    void load().then((loaded) => {
      if (!cancelled && loaded && new URL(window.location.href).searchParams.has("notification")) {
        void notificationRef.current(window.location.href, loaded);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let needsRefresh = false;
    const message = (event: MessageEvent) => {
      if (event.data?.type === "MAIL_NOTIFICATION_CLICK" && typeof event.data.url === "string") {
        void notificationRef.current(event.data.url);
      } else if (event.data?.type === "MAIL_RECEIVED") {
        if (document.visibilityState === "visible") void loadRef.current();
        else needsRefresh = true;
      }
    };
    const visible = () => {
      if (needsRefresh && document.visibilityState === "visible") {
        needsRefresh = false;
        void loadRef.current();
      }
    };
    navigator.serviceWorker.addEventListener("message", message);
    document.addEventListener("visibilitychange", visible);
    return () => {
      navigator.serviceWorker.removeEventListener("message", message);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(META_KEY, JSON.stringify(meta));
  }, [meta, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  }, [drafts, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(LABEL_KEY, JSON.stringify(labels));
  }, [labels, hydrated]);

  function load(): Promise<MailItem[] | undefined> {
    if (loadPromiseRef.current) return loadPromiseRef.current;
    const request = loadMailbox();
    loadPromiseRef.current = request;
    void request.finally(() => {
      if (loadPromiseRef.current === request) loadPromiseRef.current = null;
    });
    return request;
  }

  async function loadMailbox(): Promise<MailItem[] | undefined> {
    setLoading(true);
    setLoadError("");
    try {
      const [inboxRes, sentRes] = await Promise.all([
        fetch("/api/mail?folder=inbox", { cache: "no-store" }),
        fetch("/api/mail?folder=sent", { cache: "no-store" }),
      ]);
      if (inboxRes.status === 401 || sentRes.status === 401) {
        location.href = loginDestination(notificationDestination(new URLSearchParams(window.location.search).get("notification")));
        return;
      }

      const [inboxJson, sentJson] = await Promise.all([
        inboxRes.json().catch(() => ({})),
        sentRes.json().catch(() => ({})),
      ]);

      if (!inboxRes.ok) {
        throw new Error(inboxJson.error || `Inbox request failed (HTTP ${inboxRes.status})`);
      }
      if (!sentRes.ok) {
        throw new Error(sentJson.error || `Sent-mail request failed (HTTP ${sentRes.status})`);
      }
      if (!Array.isArray(inboxJson.items) || !Array.isArray(sentJson.items)) {
        throw new Error("Mail server returned an invalid response.");
      }

      const merged = [...inboxJson.items, ...sentJson.items] as MailItem[];
      setPersonalPhotoUrl(validatePhotoUrl(inboxJson.identitySettings?.personalPhotoUrl));
      merged.sort((a, b) => +new Date(b.date) - +new Date(a.date));
      setItems(merged);
      const state = inboxJson.accountStatus?.vynalth;
      setEnterpriseState(state === "connected" || state === "unconfigured" || state === "error" ? state : "error");
      const warnings = [...new Set([...(inboxJson.warnings || []), ...(sentJson.warnings || [])])];
      if (warnings.length) setLoadError(warnings.join(" · "));
      return merged;
    } catch (error) {
      setEnterpriseState("error");
      console.error("[Vyncuslim Mail] Failed to load mailbox", error);
      setLoadError(error instanceof Error ? error.message : "Failed to load mailbox.");
    } finally {
      setLoading(false);
    }
  }

  function keyOf(item: MailItem) {
    return `${item.direction}:${item.id}`;
  }

  function mailMeta(item: MailItem): MailMeta {
    return meta[keyOf(item)] || {};
  }

  function effectiveFolder(item: MailItem) {
    return mailMeta(item).folder || (item.direction === "sent" ? "sent" : "inbox");
  }

  const unreadCount = useMemo(
    () => items.filter((i) => i.direction === "inbox" && effectiveFolder(i) === "inbox" && !mailMeta(i).read).length,
    [items, meta],
  );

  const visibleItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      const m = mailMeta(item);
      if (m.hidden) return false;
      if (domainFilter === "sleepsomno.com") {
        if (item.direction !== "inbox" || decodeMailId(item.id)?.account !== "vynalth" || !isLegacyRootRecipient(item.to)) return false;
      } else if (domainFilter !== "all" && !isDomainAddress(item.direction === "sent" ? item.from : item.mailboxTo || item.to, domainFilter)) return false;
      const ef = effectiveFolder(item);
      let show = false;
      if (labelFilter) show = (m.labels || []).includes(labelFilter) && ef !== "trash";
      else if (folder === "inbox") show = item.direction === "inbox" && ef === "inbox";
      else if (folder === "sent") show = item.direction === "sent" && ef === "sent";
      else if (folder === "starred") show = !!m.starred && ef !== "trash";
      else if (folder === "archive") show = ef === "archive";
      else if (folder === "spam") show = ef === "spam";
      else if (folder === "trash") show = ef === "trash";
      else if (folder === "all") show = ef !== "spam" && ef !== "trash";
      else show = false;
      if (!show) return false;
      if (!needle) return true;
      return JSON.stringify([item.from, item.to, item.mailboxTo, item.subject]).toLowerCase().includes(needle);
    });
  }, [items, meta, folder, labelFilter, q, domainFilter]);

  const visibleDrafts = useMemo(() => {
    if (folder !== "drafts" || labelFilter) return [];
    const needle = q.trim().toLowerCase();
    return drafts
      .filter((d) => domainFilter === "all" || (domainFilter !== "sleepsomno.com" && isDomainAddress(d.from, domainFilter)))
      .filter((d) => !needle || JSON.stringify([d.from, d.to, d.cc, d.bcc, d.subject, d.text]).toLowerCase().includes(needle))
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [drafts, folder, labelFilter, q, domainFilter]);

  function setFolderView(next: Folder) {
    ++threadSequenceRef.current;
    setFolder(next);
    setLabelFilter("");
    setThread(null);
    setSelectedKeys(new Set());
  }

  function patchItems(targets: MailItem[], patch: Partial<MailMeta>) {
    setMeta((prev) => {
      const next = { ...prev };
      for (const item of targets) {
        const k = keyOf(item);
        next[k] = { ...(next[k] || {}), ...patch };
      }
      return next;
    });
    setSelectedKeys(new Set());
  }

  function selectedItems() {
    return items.filter((i) => selectedKeys.has(keyOf(i)));
  }

  function toggleSelection(item: MailItem) {
    const k = keyOf(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function addLabel(targets: MailItem[]) {
    const name = prompt("Label name");
    if (!name?.trim()) return;
    const clean = name.trim().slice(0, 40);
    if (!labels.includes(clean)) setLabels((prev) => [...prev, clean]);
    setMeta((prev) => {
      const next = { ...prev };
      for (const item of targets) {
        const k = keyOf(item);
        const current = next[k] || {};
        next[k] = { ...current, labels: Array.from(new Set([...(current.labels || []), clean])) };
      }
      return next;
    });
    setSelectedKeys(new Set());
  }

  function removeLabel(name: string) {
    setLabels((prev) => prev.filter((l) => l !== name));
    setMeta((prev) => {
      const next: Record<string, MailMeta> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = { ...v, labels: (v.labels || []).filter((l) => l !== name) };
      }
      return next;
    });
    if (labelFilter === name) setLabelFilter("");
  }

  async function openThread(item: MailItem, sourceItems: MailItem[] = items) {
    const sequence = ++threadSequenceRef.current;
    const account = decodeMailId(item.id)?.account;
    const related = sourceItems
      .filter((candidate) => !mailMeta(candidate).hidden && account && decodeMailId(candidate.id)?.account === account && sameThreadCandidate(item, candidate, account))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .slice(-20);

    patchItems(related.filter((i) => i.direction === "inbox"), { read: true });
    setThread({ subject: item.subject, loading: true, messages: [] });

    const details = await Promise.all(
      related.map(async (mail) => {
        const response = await fetch(`/api/mail/${mail.id}?direction=${mail.direction}`, { cache: "no-store" });
        const detail = await response.json();
        if (!response.ok) return { ...mail, unavailable: true, text: detail.error || "Message unavailable" };
        return { ...mail, ...detail, id: mail.id, direction: mail.direction };
      }),
    );
    if (sequence === threadSequenceRef.current) setThread({ subject: item.subject, loading: false, messages: details });
  }

  async function openNotification(value: string, loadedItems?: MailItem[]) {
    let url: URL;
    try { url = new URL(value, window.location.origin); } catch { return; }
    if (url.origin !== window.location.origin || url.pathname !== "/" || url.username || url.password) return;
    const id = url.searchParams.get("notification");
    if (id && (id.length > 160 || !decodeMailId(id))) return;
    const sequence = ++notificationSequenceRef.current;
    setFolderView("inbox");
    setDomainFilter("all");
    setQ("");
    // Preserve a safe return target if loading discovers that the session has expired.
    if (id) history.replaceState(history.state, "", `/?notification=${encodeURIComponent(id)}`);
    const loaded = loadedItems || await load();
    if (!loaded || sequence !== notificationSequenceRef.current) return;
    const target = id && loaded.find((item) => item.direction === "inbox" && item.id === id && !mailMeta(item).hidden);
    if (target) {
      try { await openThread(target, loaded); }
      catch { setLoadError("暂时无法打开这封邮件，请在收件箱中重试。"); }
    } else if (id) {
      setLoadError("收件箱已更新；这封邮件暂未出现在列表中，请稍后刷新。");
    }
    if (sequence === notificationSequenceRef.current) {
      const current = new URL(window.location.href);
      current.searchParams.delete("notification");
      history.replaceState(history.state, "", `${current.pathname}${current.search}${current.hash}`);
    }
  }

  function newCompose(initial: Partial<Draft> = {}) {
    const id = initial.id || crypto.randomUUID();
    setCompose({
      id,
      from: initial.from || (domainFilter === "sleepsomno.com" ? "vyncuslim@vynalthai.com" : domainFilter !== "all" ? (domainFilter.endsWith("vynalthai.com") ? "vyncuslim@" : "vyncus@") + domainFilter : ""),
      to: initial.to || "",
      cc: initial.cc || "",
      bcc: initial.bcc || "",
      subject: initial.subject || "",
      text: initial.text || "",
      includeSignature: initial.includeSignature,
      inReplyTo: initial.inReplyTo,
      references: initial.references,
      replyMode: initial.replyMode,
      replySource: initial.replySource,
      copyAttachmentsFrom: initial.copyAttachmentsFrom,
    });
  }

  function saveDraft(draft: Draft) {
    const hasContent = [draft.from, draft.to, draft.cc, draft.bcc, draft.subject, draft.text].some((x) => x.trim());
    setDrafts((prev) => {
      const without = prev.filter((d) => d.id !== draft.id);
      return hasContent ? [...without, draft] : without;
    });
  }

  function discardDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    if (compose?.id === id) setCompose(false);
  }

  const knownFromAddresses = useMemo(() => {
    const set = new Set<string>(["vyncus@vyncuslim.com", "hello@vyncuslim.com", "vyncus@mail.vyncuslim.com", "vyncuslim@vynalthai.com", "vyncuslim@mail.vynalthai.com", "hello@vynalthai.com", "support@vynalthai.com"]);
    for (const item of items) {
      for (const addr of [...normalizeAddress(item.from), ...normalizeAddress(item.mailboxTo || item.to)]) {
        if (isAllowedSender(addr)) set.add(addr.toLowerCase());
      }
    }
    const last = typeof window !== "undefined" ? localStorage.getItem(LAST_FROM_KEY) : "";
    if (last && isAllowedSender(last)) set.add(last);
    return Array.from(set).sort();
  }, [items]);

  return (
    <MailIdentitySettingsContext.Provider value={{ personalPhotoUrl }}>
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Menu size={20} />
          <div className="mail-mark small">M</div>
          <strong>Vyncuslim Mail</strong>
        </div>
        <div className="search">
          <Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" />
        </div>
        <button className="icon-btn" onClick={load} title="Refresh"><RefreshCw size={18} /></button>
        <PwaControls />
        <button
          className="icon-btn"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            let pushCleanupFailed = false;
            try { await disableCurrentDevicePush(); }
            catch { pushCleanupFailed = true; }
            try {
              const response = await fetch("/api/auth/logout", { method: "POST" });
              if (!response.ok) throw new Error("Sign out failed. Please try again.");
              location.href = pushCleanupFailed ? loginDestination("/", "notifications") : "/login";
            } catch {
              setLoadError("退出登录失败，请保持联网后重试。");
              setSigningOut(false);
            }
          }}
          title="Sign out"
        >
          <LogOut size={18} />
        </button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <button className="compose-btn" onClick={() => newCompose()}><PenSquare size={19} />Compose</button>
          <nav>
            <NavButton active={!labelFilter && folder === "inbox"} icon={<Inbox size={18} />} label="Inbox" count={unreadCount} onClick={() => setFolderView("inbox")} />
            <NavButton active={!labelFilter && folder === "starred"} icon={<Star size={18} />} label="Starred" onClick={() => setFolderView("starred")} />
            <NavButton active={!labelFilter && folder === "sent"} icon={<Send size={18} />} label="Sent" onClick={() => setFolderView("sent")} />
            <NavButton active={!labelFilter && folder === "drafts"} icon={<FileText size={18} />} label="Drafts" count={drafts.length} onClick={() => setFolderView("drafts")} />
            <NavButton active={!labelFilter && folder === "archive"} icon={<Archive size={18} />} label="Archive" onClick={() => setFolderView("archive")} />
            <NavButton active={!labelFilter && folder === "spam"} icon={<ShieldAlert size={18} />} label="Spam" onClick={() => setFolderView("spam")} />
            <NavButton active={!labelFilter && folder === "trash"} icon={<Trash2 size={18} />} label="Trash" onClick={() => setFolderView("trash")} />
            <NavButton active={!labelFilter && folder === "all"} icon={<Mail size={18} />} label="All mail" onClick={() => setFolderView("all")} />
          </nav>

          <div className="label-title"><span>Labels</span><button onClick={() => {
            const name = prompt("New label");
            if (name?.trim() && !labels.includes(name.trim())) setLabels((prev) => [...prev, name.trim().slice(0, 40)]);
          }}>+</button></div>
          <div className="label-list">
            {labels.map((name) => (
              <div className={labelFilter === name ? "label-row active" : "label-row"} key={name}>
                <button onClick={() => { setLabelFilter(name); setThread(null); }}><Tag size={15} /><span>{name}</span></button>
                <button className="label-remove" onClick={() => removeLabel(name)}>×</button>
              </div>
            ))}
          </div>

          <div className="account">
            <label htmlFor="mail-domain-filter">Mailbox domain</label><br />
            <select id="mail-domain-filter" aria-label="Mailbox domain" value={domainFilter} onChange={(event) => { setDomainFilter(event.target.value as MailboxFilter); setThread(null); setSelectedKeys(new Set()); }}>
              <option value="all">All domains</option>
              {MAIL_DOMAINS.map((domain) => <option key={domain} value={domain}>@{domain}</option>)}
              <option value="sleepsomno.com">@sleepsomno.com (legacy inbox)</option>
            </select><br /><small>Private domain webmail · Resend</small>
            <p role="status" style={{ fontSize: 12, marginTop: 8 }}>Vynalth AI inbox: {({ connected: "Connected", unconfigured: "Configuration required", error: "Connection failed", checking: "Checking…" } as const)[enterpriseState]}</p>
          </div>
        </aside>

        <section className="content">
          {thread ? (
            <ThreadView
              thread={thread}
              meta={meta}
              back={() => setThread(null)}
              onCompose={newCompose}
              onArchive={() => {
                const targets = items.filter((i) => thread.messages?.some((m: any) => m.id === i.id && m.direction === i.direction));
                patchItems(targets, { folder: "archive" });
                setThread(null);
              }}
              onTrash={() => {
                const targets = items.filter((i) => thread.messages?.some((m: any) => m.id === i.id && m.direction === i.direction));
                patchItems(targets, { folder: "trash" });
                setThread(null);
              }}
            />
          ) : (
            <>
              <div className="list-head">
                <div className="list-title">
                  <strong>{labelFilter || folderTitle(folder)}</strong>
                  <span>{folder === "drafts" ? visibleDrafts.length : visibleItems.length}</span>
                </div>
                {selectedKeys.size ? (
                  <div className="bulk-actions">
                    <span>{selectedKeys.size} selected</span>
                    <button title="Archive" onClick={() => patchItems(selectedItems(), { folder: "archive" })}><Archive size={17} /></button>
                    <button title="Mark unread" onClick={() => patchItems(selectedItems(), { read: false })}><Mail size={17} /></button>
                    <button title="Mark read" onClick={() => patchItems(selectedItems(), { read: true })}><MailOpen size={17} /></button>
                    <button title="Star" onClick={() => patchItems(selectedItems(), { starred: true })}><Star size={17} /></button>
                    <button title="Label" onClick={() => addLabel(selectedItems())}><Tag size={17} /></button>
                    <button title="Spam" onClick={() => patchItems(selectedItems(), { folder: "spam" })}><ShieldAlert size={17} /></button>
                    <button title="Trash" onClick={() => patchItems(selectedItems(), { folder: "trash" })}><Trash2 size={17} /></button>
                    {folder === "trash" && <button title="Delete forever" onClick={() => patchItems(selectedItems(), { hidden: true })}>Delete forever</button>}
                  </div>
                ) : (
                  <button className="quiet-btn" onClick={load}><RefreshCw size={16} />Refresh</button>
                )}
              </div>

              <div className="mail-list">
                {loading && <div className="empty">Loading mail…</div>}
                {!loading && loadError && (
                  <div className="empty">
                    <Mail size={34} />
                    <p>{loadError}</p>
                    <button className="quiet-btn" onClick={load}><RefreshCw size={16} />Try again</button>
                  </div>
                )}

                {!loading && folder === "drafts" && visibleDrafts.map((draft) => (
                  <div className="mail-row draft-row" key={draft.id}>
                    <button className="row-main" onClick={() => setCompose(draft)}>
                      <div className="sender"><span className="draft-badge">Draft</span>{draft.to || "No recipient"}</div>
                      <div className="subject">{draft.subject || "(no subject)"} <span className="snippet">— {draft.text.slice(0, 90)}</span></div>
                      <time>{formatDate(draft.updatedAt)}</time>
                    </button>
                    <button className="row-trash" onClick={() => discardDraft(draft.id)} title="Delete draft"><Trash2 size={16} /></button>
                  </div>
                ))}

                {!loading && folder !== "drafts" && visibleItems.map((item) => {
                  const m = mailMeta(item);
                  const selected = selectedKeys.has(keyOf(item));
                  return (
                    <div className={`mail-row ${m.read || item.direction === "sent" ? "read" : "unread"} ${selected ? "selected" : ""}`} key={keyOf(item)}>
                      <input className="row-check" type="checkbox" checked={selected} onChange={() => toggleSelection(item)} aria-label="Select message" />
                      <button
                        className={m.starred ? "star-btn starred" : "star-btn"}
                        onClick={() => patchItems([item], { starred: !m.starred })}
                        title="Star"
                      ><Star size={17} fill={m.starred ? "currentColor" : "none"} /></button>
                      <button className="row-main" onClick={() => openThread(item)}>
                        <div className="sender-with-avatar">
                          <MailAvatar value={item.direction === "inbox" ? item.from : item.to} size={28} />
                          <div className="sender">{item.direction === "inbox" ? address(item.from) : address(item.to)}{decodeMailId(item.id)?.account === "vynalth" && <span className="tiny-label">Vynalth AI</span>}{item.direction === "inbox" && isLegacyRootRecipient(item.to) && <span className="tiny-label">SleepSomno</span>}</div>
                        </div>
                        <div className="subject">
                          {item.subject}
                          {(m.labels || []).map((label) => <span className="tiny-label" key={label}>{label}</span>)}
                        </div>
                        <time>{formatDate(item.date)}</time>
                      </button>
                    </div>
                  );
                })}

                {!loading && !loadError && folder !== "drafts" && visibleItems.length === 0 && <EmptyFolder folder={folder} />}
                {!loading && !loadError && folder === "drafts" && visibleDrafts.length === 0 && <EmptyFolder folder="drafts" />}
              </div>
            </>
          )}
        </section>
      </div>

      {compose && (
        <Composer
          key={compose.id}
          initial={compose}
          knownFrom={knownFromAddresses}
          onSave={saveDraft}
          onDiscard={discardDraft}
          close={() => setCompose(false)}
          sent={() => {
            discardDraft(compose.id);
            setCompose(false);
            load();
          }}
        />
      )}
    </main>
    </MailIdentitySettingsContext.Provider>
  );
}

function NavButton({ active, icon, label, count, onClick }: any) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span className="nav-label">{label}</span>{count ? <b className="nav-count">{count}</b> : null}</button>;
}

function EmptyFolder({ folder }: { folder: string }) {
  return <div className="empty"><Mail size={34} /><p>No messages in {folderTitle(folder as Folder).toLowerCase()}.</p></div>;
}

function ThreadView({ thread, back, onCompose, onArchive, onTrash }: any) {
  return <div className="thread-view">
    <div className="thread-toolbar">
      <button className="icon-btn" onClick={back}><ArrowLeft size={19} /></button>
      <button className="icon-btn" title="Archive" onClick={onArchive}><Archive size={18} /></button>
      <button className="icon-btn" title="Trash" onClick={onTrash}><Trash2 size={18} /></button>
    </div>
    <h2>{thread.subject || "(no subject)"}</h2>
    {thread.loading ? <div className="empty">Loading conversation…</div> : thread.messages.map((message: any) => (
      <MessageCard key={`${message.direction}:${message.id}`} message={message} onCompose={onCompose} />
    ))}
  </div>;
}

function MessageCard({ message, onCompose }: any) {
  const [showRemoteImages, setShowRemoteImages] = useState(false);
  const fromAddr = address(message.from);
  const toAddr = address(message.to);
  const mappedTo = address(message.mailboxTo);
  const messageAccount = decodeMailId(message.id)?.account;
  const replyFrom = messageAccount ? replyIdentity(message, messageAccount)[0] || "" : "";
  const canReply = Boolean(messageAccount && !message.unavailable && buildReplyPlan(message, messageAccount, false).canReply);
  const externalImages = typeof message.html === "string" && /<img[^>]+src=["']https?:\/\//i.test(message.html);

  function quote() {
    const body = message.text || stripHtml(message.html || "");
    return `\n\nOn ${formatDate(message.received_at || message.created_at || message.date)}, ${fromAddr} wrote:\n${body.split("\n").map((l: string) => "> " + l).join("\n")}`;
  }

  function reply(all: boolean) {
    if (!messageAccount || !canReply) return;
    const plan = buildReplyPlan(message, messageAccount, all);
    onCompose({
      from: plan.from,
      to: plan.to.join(", "),
      cc: plan.cc.join(", "),
      bcc: "",
      subject: prefixSubject(message.subject, "Re:"),
      text: quote(),
      inReplyTo: plan.inReplyTo,
      references: plan.references,
      replyMode: all ? "replyAll" : "reply",
      replySource: { id: message.id, direction: message.direction },
    });
  }

  function forward() {
    const body = message.text || stripHtml(message.html || "");
    onCompose({
      from: replyFrom,
      to: "",
      cc: "",
      bcc: "",
      subject: prefixSubject(message.subject, "Fwd:"),
      text: `\n\n---------- Forwarded message ----------\nFrom: ${fromAddr}\nTo: ${toAddr}\nDate: ${formatDate(message.received_at || message.created_at || message.date)}\nSubject: ${message.subject || "(no subject)"}\n\n${body}`,
      copyAttachmentsFrom: { id: message.id, direction: message.direction },
    });
  }

  return <article className="message-card">
    <div className="message-head">
      <MailAvatar value={message.from} />
      <div className="message-who">
        <b>{fromAddr}</b>
        <span>to {toAddr}{message.cc?.length ? `, cc ${address(message.cc)}` : ""}</span>
        {mappedTo && mappedTo !== toAddr && <span>Vynalth mailbox: {mappedTo}</span>}
      </div>
      <time>{formatDate(message.received_at || message.created_at || message.date)}</time>
    </div>

    {externalImages && !showRemoteImages && (
      <button className="image-warning" onClick={() => setShowRemoteImages(true)}>
        Remote images are blocked for privacy. Show images
      </button>
    )}

    <EmailBody html={message.html} text={message.text} allowRemoteImages={showRemoteImages} />

    {!!message.attachments?.length && (
      <div className="attachments">
        {message.attachments.map((a: any) => (
          <a
            key={a.id}
            href={`/api/mail/${message.id}/attachments/${a.id}?direction=${message.direction}`}
            target="_blank"
            rel="noreferrer"
          >
            <Paperclip size={15} /><span>{a.filename || "attachment"}</span><small>{formatBytes(a.size)}</small>
          </a>
        ))}
      </div>
    )}

    <div className="message-actions">
      <button disabled={!canReply} onClick={() => reply(false)}><Reply size={17} />Reply</button>
      <button disabled={!canReply} onClick={() => reply(true)}><ReplyAll size={17} />Reply all</button>
      <button disabled={!replyFrom || message.unavailable} onClick={forward}><Forward size={17} />Forward</button>
      {!canReply && <small role="status">No authorized reply address or recipient is available for this message.</small>}
    </div>
  </article>;
}

function EmailBody({ html, text, allowRemoteImages }: any) {
  if (html) {
    const srcDoc = prepareEmailHtml(String(html), allowRemoteImages);
    return <iframe className="email-frame" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} title="Email body" />;
  }
  return <div className="message-body plain">{text || "No message body."}</div>;
}

function Composer({ initial, knownFrom, onSave, onDiscard, close, sent }: any) {
  const [from, setFrom] = useState(migrateLegacyAddress(initial.from || ""));
  const [to, setTo] = useState(initial.to || "");
  const [cc, setCc] = useState(initial.cc || "");
  const [bcc, setBcc] = useState(initial.bcc || "");
  const [subject, setSubject] = useState(initial.subject || "");
  const [text, setText] = useState(initial.text || "");
  const [includeSignature, setIncludeSignature] = useState(initial.includeSignature !== false);
  const [files, setFiles] = useState<File[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef<any>(null);
  const inFlight = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isReply = Boolean(initial.replySource || initial.inReplyTo);
  const identitySettings = useContext(MailIdentitySettingsContext);
  const identity = getMailIdentity(from, identitySettings);
  useEffect(() => {
    if (isReply) { bodyRef.current?.focus(); bodyRef.current?.setSelectionRange(0, 0); }
  }, [isReply]);

  useEffect(() => {
    if (!initial.from) {
      const saved = localStorage.getItem(LAST_FROM_KEY);
      if (saved) setFrom(migrateLegacyAddress(saved));
    }
  }, [initial.from]);

  function saveNow() {
    clearTimeout(saveTimer.current);
    onSave({ id: initial.id, from, to, cc, bcc, subject, text, includeSignature, updatedAt: new Date().toISOString(), inReplyTo: initial.inReplyTo, references: initial.references, replyMode: initial.replyMode, replySource: initial.replySource, copyAttachmentsFrom: initial.copyAttachmentsFrom });
  }
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { if (!inFlight.current) saveNow(); }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [from, to, cc, bcc, subject, text, includeSignature]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    clearTimeout(saveTimer.current);
    setSending(true);
    setError("");
    try {
      const migratedFrom = migrateLegacyAddress(from);
      if (!isAllowedSender(migratedFrom)) {
        throw new Error("From must use one of your four supported personal or Vynalth AI domains.");
      }

      const toAddresses = splitAddressInput(to).map(migrateLegacyAddress);
      const ccAddresses = splitAddressInput(cc).map(migrateLegacyAddress);
      const bccAddresses = splitAddressInput(bcc).map(migrateLegacyAddress);
      if (!toAddresses.length) {
        throw new Error("Add at least one recipient.");
      }
      const invalidRecipient = [...toAddresses, ...ccAddresses, ...bccAddresses].find(
        (value) => !extractEmail(value),
      );
      if (invalidRecipient) {
        throw new Error(`Invalid recipient address: ${invalidRecipient}`);
      }

      const totalSize = files.reduce((n, f) => n + f.size, 0);
      if (totalSize > 4 * 1024 * 1024) throw new Error("Web uploads are limited to 4 MB total on this Vercel route.");
      if (scheduledAt && +new Date(scheduledAt) <= Date.now()) throw new Error("Scheduled time must be in the future.");

      const attachments = await Promise.all(files.map(fileToAttachment));
      const response = await fetch("/api/mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: migratedFrom,
          to: toAddresses,
          cc: ccAddresses,
          bcc: bccAddresses,
          subject,
          text,
          includeSignature,
          attachments,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          inReplyTo: initial.inReplyTo,
          references: initial.references,
          replySource: initial.replySource,
          copyAttachmentsFrom: initial.copyAttachmentsFrom,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || "Send failed");
      localStorage.setItem(LAST_FROM_KEY, extractPlainEmail(migratedFrom));
      sent();
    } catch (err: any) {
      setError(err.message || "Send failed");
      saveNow();
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return <form className="composer" onSubmit={submit} noValidate>
    <div className="composer-head">
      <strong>{initial.replyMode === "replyAll" ? "Reply all" : isReply ? "Reply" : initial.copyAttachmentsFrom ? "Forward" : "New message"}</strong>
      <div>
        <button type="button" disabled={sending} title="Discard" onClick={() => { clearTimeout(saveTimer.current); onDiscard(initial.id); }}><Trash2 size={17} /></button>
        <button type="button" disabled={sending} title="Close and save draft" onClick={() => { saveNow(); close(); }}><X size={18} /></button>
      </div>
    </div>

    <div className="compose-content">
    <div className="compose-fields">
      <label><span>From</span><div className="sender-field"><MailAvatar value={from} size={28} /><input list="from-addresses" value={from} readOnly={Boolean(initial.replySource)} onChange={(e) => setFrom(e.target.value)} placeholder="you@vyncuslim.com or you@vynalthai.com" autoComplete="email" /></div></label>
      <datalist id="from-addresses">{knownFrom.map((a: string) => <option value={a} key={a} />)}</datalist>
      {[from, ...splitAddressInput(to), ...splitAddressInput(cc), ...splitAddressInput(bcc)].some((value) => migrateLegacyAddress(value) !== value) && (
        <p role="status" style={{ margin: "6px 12px", fontSize: 12 }}>Legacy sleepsomno addresses will be converted to their matching Vynalth AI addresses before sending.</p>
      )}
      <label><span>To</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" autoComplete="email" /></label>
      <label><span>Cc</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional, comma separated" /></label>
      <label><span>Bcc</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Optional, comma separated" /></label>
      <input className="subject-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
    </div>

    <textarea ref={bodyRef} className="compose-body" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />

    <div className="signature-settings">
      <label><input type="checkbox" checked={includeSignature} onChange={(event) => setIncludeSignature(event.target.checked)} />Include logo / photo signature</label>
      {includeSignature && identity && <div className="signature-preview" aria-label="Email signature preview">
        {identity.imageSrc && <img src={identity.imageSrc} alt={identity.imageAlt} width={48} height={identity.kind === "personal" ? 60 : 48} referrerPolicy="no-referrer" />}
        <div><strong>{identity.displayName}</strong><span>{identity.email}</span><a href={identity.website} target="_blank" rel="noreferrer">{identity.kind === "company" ? "Vynalth AI website" : "Vyncus Lim website"}</a></div>
      </div>}
      {includeSignature && identity?.kind === "personal" && !identity.imageSrc && <small>Personal photo is not configured yet. This signature includes your name and address.</small>}
      <small>{includeSignature && !identity ? "Choose a supported From address to preview its signature. " : ""}Signature images appear in the message body. Inbox avatars depend on the recipient’s email provider.</small>
    </div>

    {!!files.length && <div className="compose-files">{files.map((f, i) => (
      <span key={`${f.name}-${i}`}><Paperclip size={13} />{f.name}<button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>×</button></span>
    ))}</div>}
    </div>

    <div className="schedule-row">
      <Clock3 size={15} />
      <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
      {scheduledAt && <button type="button" onClick={() => setScheduledAt("")}>Clear schedule</button>}
    </div>

    <div className="composer-foot">
      <button className="send-btn" disabled={sending}>{sending ? "Sending…" : scheduledAt ? "Schedule send" : isReply ? "Send reply" : "Send"}</button>
      <label className="attach-btn" title="Attach files">
        <Paperclip size={18} />
        <input type="file" multiple hidden onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, 20))} />
      </label>
      <span className="autosave">Draft autosaved</span>
      {error && <span className="error">{error}</span>}
    </div>
  </form>;
}

function folderTitle(folder: Folder) {
  return ({
    inbox: "Inbox",
    starred: "Starred",
    sent: "Sent",
    drafts: "Drafts",
    archive: "Archive",
    spam: "Spam",
    trash: "Trash",
    all: "All mail",
  } as Record<Folder, string>)[folder];
}

function address(v: any): string {
  if (Array.isArray(v)) return v.map(address).join(", ");
  if (typeof v === "object" && v) return v.email || v.address || JSON.stringify(v);
  return v || "";
}

function allAddresses(v: any): string[] {
  if (Array.isArray(v)) return v.flatMap(allAddresses);
  if (typeof v === "object" && v) return allAddresses(v.email || v.address || "");
  if (typeof v !== "string") return [];
  return v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
}

function splitAddressInput(value: string) {
  return value
    .split(/[;,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractPlainEmail(v: string) {
  return extractEmail(v);
}

function normalizeSubject(s: string) {
  return (s || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase();
}

function prefixSubject(s: string, p: string) {
  return (s || "").toLowerCase().startsWith(p.toLowerCase()) ? s : `${p} ${s || ""}`;
}

function headerValue(headers: any, name: string) {
  if (!headers) return "";
  if (Array.isArray(headers)) {
    const found = headers.find((h: any) => String(h.name || h.key || "").toLowerCase() === name.toLowerCase());
    return found?.value || "";
  }
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name.toLowerCase()) return String(v || "");
  return "";
}

function stripHtml(html: string) {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

function prepareEmailHtml(html: string, allowRemoteImages: boolean) {
  let safe = html;
  if (!allowRemoteImages) {
    safe = safe.replace(/(<img\b[^>]*?\bsrc\s*=\s*["'])https?:\/\/[^"']*(["'][^>]*>)/gi, '$1about:blank$2');
  }
  safe = safe.replace(/<base\b[^>]*>/gi, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{font-family:Arial,sans-serif;color:#202124;line-height:1.55;margin:0;padding:4px 0;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body>${safe}</body></html>`;
}

function formatDate(v: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: new Date(v).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(v));
  } catch {
    return "";
  }
}

function formatBytes(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function fileToAttachment(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return {
    filename: file.name,
    content: dataUrl.split(",")[1] || "",
    contentType: file.type || undefined,
  };
}
