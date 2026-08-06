import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PejuAfrica Control Plane",
  description: "Super admin mission control for PejuAfrica",
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icon.jpeg" }],
    apple: "/apple-touch-icon.png",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
