"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Archive, ChevronLeft, Inbox, LogOut, Mail, Menu, PenSquare, RefreshCw, Search, Send, Trash2, X } from "lucide-react";

type Item = { id:string; direction:"inbox"|"sent"; from:any; to:any; subject:string; date:string };
type Folder = "inbox" | "sent";

export default function MailClient() {
  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [compose, setCompose] = useState<any>(false);

  async function load(next = folder) {
    setLoading(true);
    setSelected(null);
    const r = await fetch(`/api/mail?folder=${next}`, { cache: "no-store" });
    if (r.status === 401) return location.href = "/login";
    const j = await r.json();
    setItems(j.items || []);
    setLoading(false);
  }

  useEffect(() => { load(folder); }, [folder]);

  async function open(item: Item) {
    setSelected({ ...item, loading: true });
    const r = await fetch(`/api/mail/${item.id}?direction=${item.direction}`, { cache: "no-store" });
    const j = await r.json();
    setSelected({ ...item, ...j, loading: false });
  }

  const filtered = useMemo(() => items.filter(i => {
    const hay = JSON.stringify([i.from, i.to, i.subject]).toLowerCase();
    return hay.includes(q.toLowerCase());
  }), [items, q]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><Menu size={20}/><div className="mail-mark small">M</div><strong>Vyncuslim Mail</strong></div>
        <div className="search"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search mail"/></div>
        <button className="icon-btn" onClick={()=>load()} title="Refresh"><RefreshCw size={18}/></button>
        <button className="icon-btn" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST"});location.href="/login"}} title="Sign out"><LogOut size={18}/></button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <button className="compose-btn" onClick={()=>setCompose({})}><PenSquare size={19}/> Compose</button>
          <nav>
            <button className={folder==="inbox"?"active":""} onClick={()=>setFolder("inbox")}><Inbox size={18}/>Inbox</button>
            <button className={folder==="sent"?"active":""} onClick={()=>setFolder("sent")}><Send size={18}/>Sent</button>
            <button disabled><Archive size={18}/>Archive <span>soon</span></button>
            <button disabled><Trash2 size={18}/>Trash <span>soon</span></button>
          </nav>
          <div className="account">@vyncuslim.com<br/><small>Domain mailbox · Powered by Resend</small></div>
        </aside>

        <section className="content">
          {selected ? (
            <MessageView message={selected} back={()=>setSelected(null)} onReply={(m:any)=>setCompose(m)} />
          ) : (
            <>
              <div className="list-head"><strong>{folder==="inbox"?"Inbox":"Sent"}</strong><span>{filtered.length} messages</span></div>
              <div className="mail-list">
                {loading && <div className="empty">Loading mail…</div>}
                {!loading && filtered.length===0 && <div className="empty"><Mail size={34}/><p>No mail here yet.</p></div>}
                {filtered.map(item => (
                  <button className="mail-row" key={item.id} onClick={()=>open(item)}>
                    <div className="sender">{folder==="inbox" ? address(item.from) : address(item.to)}</div>
                    <div className="subject">{item.subject}</div>
                    <time>{formatDate(item.date)}</time>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {compose && <Composer initial={compose} close={()=>setCompose(false)} sent={()=>{setCompose(false); if(folder==="sent") load("sent");}}/>}
    </main>
  );
}

function MessageView({message, back, onReply}:{message:any;back:()=>void;onReply:(m:any)=>void}) {
  const replyFrom = firstVyncuslimAddress(message.to) || firstVyncuslimAddress(message.from);
  return <div className="message-view">
    <button className="icon-btn back" onClick={back}><ChevronLeft size={20}/></button>
    <h2>{message.subject || "(no subject)"}</h2>
    <div className="message-meta"><b>{address(message.from)}</b><span>to {address(message.to)}</span><time>{formatDate(message.created_at || message.date)}</time></div>
    {message.loading ? <div className="empty">Loading message…</div> :
      <div className="message-body" dangerouslySetInnerHTML={{__html: message.html || escapeHtml(message.text || "No body")}} />}
    <button className="reply-btn" onClick={()=>onReply({
      from: replyFrom,
      to: address(message.from),
      subject: prefixSubject(message.subject,"Re:"),
      text:"\n\n"
    })}>Reply</button>
  </div>
}

function Composer({initial, close, sent}:{initial:any;close:()=>void;sent:()=>void}) {
  const [from,setFrom]=useState(initial?.from||"");
  const [to,setTo]=useState(initial?.to||"");
  const [subject,setSubject]=useState(initial?.subject||"");
  const [text,setText]=useState(initial?.text||"");
  const [sending,setSending]=useState(false);
  const [error,setError]=useState("");

  useEffect(() => {
    if (!initial?.from) {
      const saved = localStorage.getItem("vmail_last_from");
      if (saved) setFrom(saved);
    }
  }, [initial?.from]);

  async function submit(e:FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    const r=await fetch("/api/mail",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({from,to,subject,text})
    });
    const j=await r.json().catch(()=>({}));
    setSending(false);
    if(!r.ok) return setError(j.error||"Send failed");
    localStorage.setItem("vmail_last_from", from);
    sent();
  }

  return <form className="composer" onSubmit={submit}>
    <div className="composer-head"><strong>New message</strong><button type="button" onClick={close}><X size={18}/></button></div>
    <input
      type="email"
      placeholder="From — e.g. me@vyncuslim.com"
      value={from}
      onChange={e=>setFrom(e.target.value)}
      pattern="[^@\\s]+@vyncuslim\\.com"
      title="Use an @vyncuslim.com address"
      required
    />
    <input type="email" placeholder="To" value={to} onChange={e=>setTo(e.target.value)} required/>
    <input placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)}/>
    <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Write a message…"/>
    <div className="composer-foot"><button className="send-btn" disabled={sending}>{sending?"Sending…":"Send"}</button>{error&&<span className="error">{error}</span>}</div>
  </form>
}

function address(v:any) {
  if(Array.isArray(v)) return v.map(address).join(", ");
  if(typeof v==="object" && v) return v.email || v.address || JSON.stringify(v);
  return v || "";
}

function allAddresses(v:any): string[] {
  if(Array.isArray(v)) return v.flatMap(allAddresses);
  if(typeof v==="object" && v) return allAddresses(v.email || v.address || "");
  if(typeof v!=="string") return [];
  const matches = v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches || [];
}

function firstVyncuslimAddress(v:any) {
  return allAddresses(v).find(x => x.toLowerCase().endsWith("@vyncuslim.com")) || "";
}

function formatDate(v:string) {
  try {
    return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(v));
  } catch {
    return "";
  }
}

function prefixSubject(s:string,p:string){ return (s||"").startsWith(p)?s:`${p} ${s||""}`; }
function escapeHtml(s:string){ return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c] as string)).replace(/\n/g,"<br/>"); }
