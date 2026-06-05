import SwiftUI
// GAAhex D18 Color Architecture — one family, one role.
enum GAAhex {
  // COBALT — brand spine / structural chrome
  static let cobalt    = Color(hex: "#1C3B68")
  static let bg        = Color(hex: "#1C3B68")
  static let bgSubtle  = Color(hex: "#16314F")
  static let surface   = Color(hex: "#FFFFFF")
  static let surface2  = Color(hex: "#F4F5F7")
  // GOLD — signature / peak moments only
  static let gold      = Color(hex: "#C5A059")
  static let goldLight = Color(hex: "#AC8847")
  static let goldSoft  = Color(hex: "#EFE3C7")
  // AZURE — interactive only
  static let interactive       = Color(hex: "#0EA5E9")
  static let interactiveHover  = Color(hex: "#0284C7")
  static let interactiveActive = Color(hex: "#0369A1")
  static let interactiveSoft   = Color(hex: "#E0F2FE")
  static let link = interactive, selected = interactive, ring = interactive
  // SLATE — neutrals
  static let text1 = Color(hex: "#0B0B0C"), text2 = Color(hex: "#334155"), text3 = Color(hex: "#64748B")
  static let border = Color(hex: "#E2E5EA"), borderStrong = Color(hex: "#CBD2DA"), divider = Color(hex: "#D8DCE0"), neutral = Color(hex: "#94A3B8")
  // SEMANTIC — status only
  static let success = Color(hex: "#16A34A"), warning = Color(hex: "#D97706"), danger = Color(hex: "#DC2626"), info = Color(hex: "#2563EB")
  static let online = Color(hex: "#16A34A"), provisioned = Color(hex: "#0EA5E9"), qualityGood = Color(hex: "#16A34A"), maintenance = Color(hex: "#D97706")
  static let onColor = Color(hex: "#FFFFFF")
}
