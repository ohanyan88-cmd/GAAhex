// GAAhex Studio — rich panes barrel.
//
// The original ~2.8k-line god-component file was split into one file per pane
// (see ./PageManager.tsx, ./LayoutBuilder.tsx, etc.). This file now only:
//   - Re-exports every pane so legacy import paths keep working.
//   - Owns the RICH_PANE_MAP + richPaneFor() router consumed by
//     StudioGenericPane.
//
// Adding a new pane: create ./<PaneName>.tsx, then add it to RICH_PANE_MAP
// below. Nothing else.

import React from 'react'
import { PageManager } from './PageManager'
import { LayoutBuilder } from './LayoutBuilder'
import { ComponentsLibrary } from './ComponentsLibrary'
import { ContentEditor } from './ContentEditor'
import { DataBinding } from './DataBinding'
import { ActionsLogic } from './ActionsLogic'
import { Permissions } from './Permissions'
import { PreviewMode } from './PreviewMode'
import { VersionHistory } from './VersionHistory'
import { Templates } from './Templates'
import { PublishSettings } from './PublishSettings'
import { AppearancePane } from './AppearancePane'
import { FeatureFlagsPane } from './FeatureFlagsPane'

// Re-exports — preserve the old import surface so `from './StudioRichPanes'`
// still resolves for every pane symbol.
export { PageManager } from './PageManager'
export { LayoutBuilder } from './LayoutBuilder'
export { ComponentsLibrary } from './ComponentsLibrary'
export { ContentEditor } from './ContentEditor'
export { DataBinding } from './DataBinding'
export { ActionsLogic } from './ActionsLogic'
export { Permissions } from './Permissions'
export { PreviewMode } from './PreviewMode'
export { VersionHistory } from './VersionHistory'
export { Templates } from './Templates'
export { PublishSettings } from './PublishSettings'
export { AppearancePane } from './AppearancePane'
export { FeatureFlagsPane } from './FeatureFlagsPane'

// Pane components may optionally accept a `token` — Permissions + DataBinding use it for
// backend wiring; the rest ignore the prop. StudioGenericPane passes the bearer for both.
export const RICH_PANE_MAP: Record<string, React.ComponentType<{ token?: string }>> = {
  'Page Registry':          PageManager,
  'Page Builder':           LayoutBuilder,
  'Dynamic Pages':          PageManager,
  'Page Versioning':        VersionHistory,
  'Component Registry':     ComponentsLibrary,
  'Component Builder':      ComponentsLibrary,
  'Component Marketplace':  ComponentsLibrary,
  'Grid System':            LayoutBuilder,
  'Layout Templates':       LayoutBuilder,
  'Layout Library':         Templates,
  'Custom Templates':       Templates,
  'Brand Identity':         AppearancePane,
  'Colors':                 AppearancePane,
  'Design Tokens':          AppearancePane,
  'Theme Inheritance':      AppearancePane,
  'External APIs':          DataBinding,
  REST:                     DataBinding,
  GraphQL:                  DataBinding,
  Triggers:                 ActionsLogic,
  Conditions:               ActionsLogic,
  Actions:                  ActionsLogic,
  'Business Rules':         ActionsLogic,
  Permissions:              Permissions,
  'Component Permissions':  Permissions,
  'Access Mapping':         Permissions,
  Preview:                  PreviewMode,
  Versioning:               VersionHistory,
  'Workflow Versions':      VersionHistory,
  Deployment:               PublishSettings,
  SEO:                      ContentEditor,
  'Meta Tags':              ContentEditor,
  'Feature Flags':          FeatureFlagsPane,
  'Feature Flag':           FeatureFlagsPane,
}

export function richPaneFor(leafLabel: string): React.ComponentType<{ token?: string }> | null {
  return RICH_PANE_MAP[leafLabel] ?? null
}
