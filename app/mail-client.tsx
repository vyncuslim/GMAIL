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
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Direction = "inbox" | "sent";
type MailItem = {
  id: string;
  direction: Direction;
  from: any;
  to: any;
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
  updatedAt: string;
  inReplyTo?: string;
  references?: string;
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
  const [items, setItems] = useState<MailItem[]>([]);
  const [meta, setMeta] = useState<Record<string, MailMeta>>({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [thread, setThread] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compose, setCompose] = useState<any>(false);
  const [q, setQ] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setMeta(JSON.parse(localStorage.getItem(META_KEY) || "{}"));
      setDrafts(JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]"));
      setLabels(JSON.parse(localStorage.getItem(LABEL_KEY) || "[]"));
    } catch {}
    setHydrated(true);
    load();
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

  async function load() {
    setLoading(true);
    try {
      const [inboxRes, sentRes] = await Promise.all([
        fetch("/api/mail?folder=inbox", { cache: "no-store" }),
        fetch("/api/mail?folder=sent", { cache: "no-store" }),
      ]);
      if (inboxRes.status === 401 || sentRes.status === 401) {
        location.href = "/login";
        return;
      }
      const [inboxJson, sentJson] = await Promise.all([inboxRes.json(), sentRes.json()]);
      const merged = [...(inboxJson.items || []), ...(sentJson.items || [])] as MailItem[];
      merged.sort((a, b) => +new Date(b.date) - +new Date(a.date));
      setItems(merged);
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
      return JSON.stringify([item.from, item.to, item.subject]).toLowerCase().includes(needle);
    });
  }, [items, meta, folder, labelFilter, q]);

  const visibleDrafts = useMemo(() => {
    if (folder !== "drafts" || labelFilter) return [];
    const needle = q.trim().toLowerCase();
    return drafts
      .filter((d) => !needle || JSON.stringify([d.from, d.to, d.cc, d.bcc, d.subject, d.text]).toLowerCase().includes(needle))
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [drafts, folder, labelFilter, q]);

  function setFolderView(next: Folder) {
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

  async function openThread(item: MailItem) {
    const subject = normalizeSubject(item.subject);
    const related = items
      .filter((candidate) => !mailMeta(candidate).hidden && normalizeSubject(candidate.subject) === subject)
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .slice(-20);

    patchItems(related.filter((i) => i.direction === "inbox"), { read: true });
    setThread({ subject: item.subject, loading: true, messages: [] });

    const details = await Promise.all(
      related.map(async (mail) => {
        const response = await fetch(`/api/mail/${mail.id}?direction=${mail.direction}`, { cache: "no-store" });
        const detail = await response.json();
        return { ...mail, ...detail, direction: mail.direction };
      }),
    );
    setThread({ subject: item.subject, loading: false, messages: details });
  }

  function newCompose(initial: Partial<Draft> = {}) {
    const id = initial.id || crypto.randomUUID();
    setCompose({
      id,
      from: initial.from || "",
      to: initial.to || "",
      cc: initial.cc || "",
      bcc: initial.bcc || "",
      subject: initial.subject || "",
      text: initial.text || "",
      inReplyTo: initial.inReplyTo,
      references: initial.references,
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
    const set = new Set<string>();
    for (const item of items) {
      for (const addr of [...allAddresses(item.from), ...allAddresses(item.to)]) {
        if (addr.toLowerCase().endsWith("@vyncuslim.com")) set.add(addr.toLowerCase());
      }
    }
    const last = typeof window !== "undefined" ? localStorage.getItem(LAST_FROM_KEY) : "";
    if (last) set.add(last);
    return Array.from(set).sort();
  }, [items]);

  return (
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
        <button
          className="icon-btn"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            location.href = "/login";
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

          <div className="account">@vyncuslim.com<br /><small>Private domain webmail · Resend</small></div>
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
                        <div className="sender">{item.direction === "inbox" ? address(item.from) : address(item.to)}</div>
                        <div className="subject">
                          {item.subject}
                          {(m.labels || []).map((label) => <span className="tiny-label" key={label}>{label}</span>)}
                        </div>
                        <time>{formatDate(item.date)}</time>
                      </button>
                    </div>
                  );
                })}

                {!loading && folder !== "drafts" && visibleItems.length === 0 && <EmptyFolder folder={folder} />}
                {!loading && folder === "drafts" && visibleDrafts.length === 0 && <EmptyFolder folder="drafts" />}
              </div>
            </>
          )}
        </section>
      </div>

      {compose && (
        <Composer
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
  const replyFrom = firstVyncuslimAddress(message.to) || firstVyncuslimAddress(message.from) || localStorage.getItem(LAST_FROM_KEY) || "";
  const messageId = message.message_id || headerValue(message.headers, "message-id");
  const previousRefs = headerValue(message.headers, "references");
  const references = [previousRefs, messageId].filter(Boolean).join(" ");
  const externalImages = typeof message.html === "string" && /<img[^>]+src=["']https?:\/\//i.test(message.html);

  function quote() {
    const body = message.text || stripHtml(message.html || "");
    return `\n\nOn ${formatDate(message.received_at || message.created_at || message.date)}, ${fromAddr} wrote:\n${body.split("\n").map((l: string) => "> " + l).join("\n")}`;
  }

  function reply(all: boolean) {
    const from = replyFrom;
    const sender = allAddresses(message.from);
    const originalTo = allAddresses(message.to);
    const originalCc = allAddresses(message.cc);
    const self = extractPlainEmail(from);
    const others = Array.from(new Set([...originalTo, ...originalCc].filter((x) => x.toLowerCase() !== self.toLowerCase() && !x.toLowerCase().endsWith("@vyncuslim.com"))));
    onCompose({
      from,
      to: sender.join(", "),
      cc: all ? others.join(", ") : "",
      bcc: "",
      subject: prefixSubject(message.subject, "Re:"),
      text: quote(),
      inReplyTo: messageId,
      references,
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
      <div className="avatar">{initials(fromAddr)}</div>
      <div className="message-who">
        <b>{fromAddr}</b>
        <span>to {toAddr}{message.cc?.length ? `, cc ${address(message.cc)}` : ""}</span>
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
      <button onClick={() => reply(false)}><Reply size={17} />Reply</button>
      <button onClick={() => reply(true)}><ReplyAll size={17} />Reply all</button>
      <button onClick={forward}><Forward size={17} />Forward</button>
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
  const [from, setFrom] = useState(initial.from || "");
  const [to, setTo] = useState(initial.to || "");
  const [cc, setCc] = useState(initial.cc || "");
  const [bcc, setBcc] = useState(initial.bcc || "");
  const [subject, setSubject] = useState(initial.subject || "");
  const [text, setText] = useState(initial.text || "");
  const [files, setFiles] = useState<File[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef<any>(null);

  useEffect(() => {
    if (!initial.from) {
      const saved = localStorage.getItem(LAST_FROM_KEY);
      if (saved) setFrom(saved);
    }
  }, [initial.from]);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSave({
        id: initial.id,
        from,
        to,
        cc,
        bcc,
        subject,
        text,
        updatedAt: new Date().toISOString(),
        inReplyTo: initial.inReplyTo,
        references: initial.references,
        copyAttachmentsFrom: initial.copyAttachmentsFrom,
      });
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [from, to, cc, bcc, subject, text]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const fromEmail = extractPlainEmail(from);
      if (!/^[^\\s@]+@vyncuslim\\.com$/i.test(fromEmail)) {
        throw new Error("From must be a valid @vyncuslim.com address.");
      }

      const toAddresses = splitAddressInput(to);
      const ccAddresses = splitAddressInput(cc);
      const bccAddresses = splitAddressInput(bcc);
      if (!toAddresses.length) {
        throw new Error("Add at least one recipient.");
      }
      const invalidRecipient = [...toAddresses, ...ccAddresses, ...bccAddresses].find(
        (value) => !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(extractPlainEmail(value)),
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
          from,
          to,
          cc,
          bcc,
          subject,
          text,
          attachments,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          inReplyTo: initial.inReplyTo,
          references: initial.references,
          copyAttachmentsFrom: initial.copyAttachmentsFrom,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Send failed");
      localStorage.setItem(LAST_FROM_KEY, extractPlainEmail(from));
      sent();
    } catch (err: any) {
      setError(err.message || "Send failed");
    } finally {
      setSending(false);
    }
  }

  return <form className="composer" onSubmit={submit} noValidate>
    <div className="composer-head">
      <strong>{initial.inReplyTo ? "Reply" : initial.copyAttachmentsFrom ? "Forward" : "New message"}</strong>
      <div>
        <button type="button" title="Discard" onClick={() => onDiscard(initial.id)}><Trash2 size={17} /></button>
        <button type="button" title="Close and save draft" onClick={close}><X size={18} /></button>
      </div>
    </div>

    <div className="compose-fields">
      <label><span>From</span><input list="from-addresses" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="you@vyncuslim.com" autoComplete="email" /></label>
      <datalist id="from-addresses">{knownFrom.map((a: string) => <option value={a} key={a} />)}</datalist>
      <label><span>To</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" autoComplete="email" /></label>
      <label><span>Cc</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional, comma separated" /></label>
      <label><span>Bcc</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Optional, comma separated" /></label>
      <input className="subject-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
    </div>

    <textarea className="compose-body" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />

    {!!files.length && <div className="compose-files">{files.map((f, i) => (
      <span key={`${f.name}-${i}`}><Paperclip size={13} />{f.name}<button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>×</button></span>
    ))}</div>}

    <div className="schedule-row">
      <Clock3 size={15} />
      <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
      {scheduledAt && <button type="button" onClick={() => setScheduledAt("")}>Clear schedule</button>}
    </div>

    <div className="composer-foot">
      <button className="send-btn" disabled={sending}>{sending ? "Sending…" : scheduledAt ? "Schedule send" : "Send"}</button>
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

function firstVyncuslimAddress(v: any) {
  return allAddresses(v).find((x) => x.toLowerCase().endsWith("@vyncuslim.com")) || "";
}

function splitAddressInput(value: string) {
  return value
    .split(/[;,\\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractPlainEmail(v: string) {
  return allAddresses(v)[0] || v.trim();
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

function initials(value: string) {
  const email = extractPlainEmail(value);
  return (email.split("@")[0].slice(0, 2) || "M").toUpperCase();
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
