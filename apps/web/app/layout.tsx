import type { Metadata, Viewport } from "next";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "../providers/convex-client-provider";
import { ThemeProvider } from "../providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NavigationProvider } from "@/lib/navigation";
import { AppVersionWatcher } from "@/components/blocks/app-version-watcher";
import { APP_THEME_COLORS } from "@/lib/theme/constants";
import { authMode, type AuthMode } from "@/lib/auth/auth-mode";
import { ConvexAuthServerProvider } from "@/lib/auth/convex-auth-server";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const isVercelAnalyticsEnabled =
  process.env.NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED === "true";

function ConvexAuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <ConvexAuthServerProvider>{children}</ConvexAuthServerProvider>
    </Suspense>
  );
}

// Convex Auth reads the session cookie here, so its pages render dynamically (docs/specs/auth-adapters.md#session).
const SessionProviders: Record<AuthMode, ComponentType<{ children: ReactNode }>> = {
  clerk: ({ children }) => children,
  "local-demo": ({ children }) => children,
  convex: ConvexAuthSessionProvider,
};
const SessionProvider = SessionProviders[authMode];

export const metadata: Metadata = {
  title: "Convoy",
  description: "Convoy is a platform for managing your tasks and projects.",
  icons: {
    icon: [{ url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" }],
    apple: "/apple-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: APP_THEME_COLORS.light,
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: APP_THEME_COLORS.dark,
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <SessionProvider>
            <ConvexClientProvider>
              <NavigationProvider>{children}</NavigationProvider>
            </ConvexClientProvider>
          </SessionProvider>
          <Toaster position="bottom-right" />
          <AppVersionWatcher />
          {isVercelAnalyticsEnabled ? <Analytics /> : null}
          <SpeedInsights />
        </ThemeProvider>
      </body>
    </html>
  );
}
