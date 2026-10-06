import "./globals.css";

export const metadata = {
  title: "Vyncuslim Mail",
  description: "Private Resend webmail for @vyncuslim.com",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
