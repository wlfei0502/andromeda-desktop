# Right panel browser-like tabs

Date: 2026-09-23  
Status: approved intent (pending user review of this file)

## Goal

Move **任务计划** out of the center chat column into the **right side panel**, hosted as a tab. The right panel uses a browser-like tab strip: tabs can be opened, focused, and closed. A **+** menu opens additional tab types (placeholders for now, except 任务计划 which shows live todos).

## Behaviors (locked)

1. When `plan_mode` turns on **or** `todos` arrive / update: automatically open the right panel (if closed), ensure a **任务计划** tab exists, and focus it.
2. Closing the 任务计划 tab does **not** turn off `plan_mode`. The next plan/todos event opens or focuses the tab again.
3. Center chat no longer renders `PlanTodoList`.
4. Tab strip supports close (× on hover/active) and empty state (only +) when all tabs are closed.
5. **+** dropdown (Cursor-style): 文件 / 终端 / 浏览器 / 地图 — each opens a **placeholder** tab.
6. **Same kind can multi-open**: titles use ordinals when needed, e.g. `文件`, `文件 2`, `地图 3`.
7. 任务计划 is also openable from + if desired (optional); system auto-open remains the primary path. Prefer: + menu includes 任务计划 as well for manual reopen, focusing existing single plan tab if one already exists **or** allow multi-open for plan too?

**Decision for 任务计划 multiplicity:** Keep **one logical plan surface** — if a 任务计划 tab already exists, auto-open and +「任务计划」**focus** it instead of opening a second. Other kinds (文件/终端/浏览器/地图) **always** open a new instance.

## UI

### Tab bar

- Top of right `aside`: horizontal scrollable tab list + **+** button + existing panel collapse control.
- Active tab: stronger background/border; inactive muted.
- Close: × on the tab; closing active tab activates nearest neighbor (right, else left).

### + menu

- Anchored under +, search optional (skip for v1 — short fixed list).
- Items (Chinese):
  - 任务计划
  - 文件
  - 终端
  - 浏览器
  - 地图
- Click → open/focus tab, close menu.

### Tab body

- `plan`: existing `PlanTodoList` content (adapted to fill panel: no outer chat card chrome required; scrollable).
- `file` | `terminal` | `browser` | `map`: placeholder copy「占位，后续接入内容」.

## Data model

```ts
type RightTabKind = "plan" | "file" | "terminal" | "browser" | "map";

type RightTab = {
  id: string;
  kind: RightTabKind;
  title: string; // display label, may include ordinal
};
```

State (owned by right panel host / AppShell):

- `tabs: RightTab[]`
- `activeId: string | null`

Helpers:

- `openTab(kind)` — for `plan`, focus existing if any; else create. For others, always create with next ordinal title.
- `closeTab(id)`
- `focusTab(id)`
- `ensurePlanTab()` — used by AgentChat bridge when plan_mode/todos fire

## Wiring

- `AppShell` hosts `RightPanel` with tab state.
- Lift or bridge `todos`, `plan_mode`, `waiting` from `AgentChat` upward (callback props or small React context `RightPanelBridge`).
- Prefer **context** `PanelTabsContext` with `ensurePlanTab` + plan content props set from a thin wrapper, **or** lift plan state to `AppShell` — avoid duplicating SSE in two places.

**Recommended:** Keep SSE/todos in `AgentChat`. Expose via context:

```ts
{
  plan: { todos, planMode, waiting };
  ensurePlanTab: () => void; // registered by RightPanel, called by AgentChat
}
```

Simpler alternative: `AppShell` passes `onPlanSurfaceNeeded` ref/callback registration. Context is cleaner for ensurePlanTab.

When AgentChat sets plan_mode true or receives todos.updated → call `ensurePlanTab()` + `forceOpenPanels({ rightOpen: true })`.

## Out of scope

- Real File / Terminal / Browser / Map implementations
- Persisting tabs to localStorage
- Drag-reorder tabs
- Keyboard shortcuts in + menu

## Acceptance

- [ ] Enabling 任务计划 opens right panel and shows plan tab with list/waiting state
- [ ] todos.updated updates the plan tab content
- [ ] Plan list no longer appears in the center chat column
- [ ] + opens 文件/终端/浏览器/地图 as separate multi-instance placeholders
- [ ] Tabs close independently; last tab closed leaves empty strip with +
- [ ] Panel collapse toggle still works
