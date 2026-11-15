export const APP_THEME_COLORS = {
  light: "#ffffff",
  dark: "#131313",
} as const;

/** Clerk sign-in and sign-up colors, mirroring the app tokens in `app/globals.css`. */
export const CLERK_THEME_VARIABLES = {
  light: {
    colorBackground: "#ffffff",
    colorForeground: "#0a0a0a",
    colorMuted: "#f5f5f5",
    colorMutedForeground: "#737373",
    colorPrimary: "#171717",
    colorPrimaryForeground: "#fafafa",
    colorInput: "#ffffff",
    colorInputForeground: "#0a0a0a",
    colorBorder: "#e5e5e5",
    colorRing: "#737373",
    colorNeutral: "#0a0a0a",
    colorDanger: "#df2225",
    colorSuccess: "#008236",
    colorWarning: "#bb4d00",
  },
  dark: {
    colorBackground: "#181818",
    colorForeground: "#e8e8e8",
    colorMuted: "#222222",
    colorMutedForeground: "#8f8f8f",
    colorPrimary: "#cecece",
    colorPrimaryForeground: "#171717",
    colorInput: "#222222",
    colorInputForeground: "#e8e8e8",
    colorBorder: "rgba(255, 255, 255, 0.12)",
    colorRing: "#737373",
    colorNeutral: "#ffffff",
    colorDanger: "#ff6467",
    colorSuccess: "#05df72",
    colorWarning: "#ffb900",
  },
} as const;
