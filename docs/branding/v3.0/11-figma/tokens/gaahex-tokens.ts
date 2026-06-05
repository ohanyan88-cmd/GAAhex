// GAAhex D18 Color Architecture — one family, one role.
export const gaahexTokens = {
  cobalt: { cobalt: "#1C3B68", bg: "#1C3B68", bgSubtle: "#16314F", surface: "#FFFFFF", surface2: "#F4F5F7" },
  gold:   { gold: "#C5A059", goldLight: "#AC8847", goldSoft: "#EFE3C7" },
  azure:  { interactive: "#0EA5E9", interactiveHover: "#0284C7", interactiveActive: "#0369A1", interactiveSoft: "#E0F2FE", link: "#0EA5E9", selected: "#0EA5E9", ring: "#0EA5E9" },
  slate:  { text1: "#0B0B0C", text2: "#334155", text3: "#64748B", border: "#E2E5EA", borderStrong: "#CBD2DA", divider: "#D8DCE0", neutral: "#94A3B8" },
  semantic: { success: "#16A34A", warning: "#D97706", danger: "#DC2626", info: "#2563EB", online: "#16A34A", provisioned: "#0EA5E9", qualityGood: "#16A34A", maintenance: "#D97706", onColor: "#FFFFFF" },
  font: { family: "Sora", word: 500 },
  // @deprecated pre-D18 aliases
  legacy: { cobalt: "#1C3B68", cobaltLift: "#4E7FC4", gold: "#C5A059", ink: "#0B0B0C", cloud: "#F4F5F7", border: "#E2E5EA", silver: "#D8DCE0" },
} as const;
