import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Vyncuslim Mail",
    short_name: "Vyncuslim Mail",
    description: "Your private domain mailbox, with new-mail notifications.",
    lang: "en",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8fc",
    theme_color: "#f6f8fc",
    icons: [
      { src: "/icons/mail-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/mail-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/mail-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
