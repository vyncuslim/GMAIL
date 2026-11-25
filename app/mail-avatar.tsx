"use client";

import { createContext, useContext, useState } from "react";
import { normalizeAddress } from "@/lib/mail-domains";
import { getMailIdentity, type MailIdentitySettings } from "@/lib/mail-identities";

export const MailIdentitySettingsContext = createContext<MailIdentitySettings>({});

export default function MailAvatar({ value, size = 38 }: { value: unknown; size?: number }) {
  const settings = useContext(MailIdentitySettingsContext);
  const identity = getMailIdentity(value, settings);
  const email = identity?.email || normalizeAddress(value)[0] || "";
  const initials = (email.split("@")[0].slice(0, 2) || "M").toUpperCase();
  const [failedSrc, setFailedSrc] = useState("");
  const imageSrc = identity?.imageSrc;

  return <span
    className={`mail-avatar ${identity?.kind || "initials"}`}
    style={{ width: size, height: size }}
    role="img"
    aria-label={identity?.imageAlt || (email ? `${email} avatar` : "Email avatar")}
  >
    {imageSrc && imageSrc !== failedSrc
      ? <img src={imageSrc} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(imageSrc)} />
      : <span aria-hidden="true">{initials}</span>}
  </span>;
}
