# Right panel tabs Implementation Plan

> **For agentic workers:** Implement task-by-task. Skip git commits unless the user asks.

**Goal:** Browser-like tabs in the right panel; 任务计划 lives there and auto-opens on plan_mode/todos.

**Architecture:** `useRightTabs` owns tab list/activeId. `RightPanel` renders strip + bodies. `PanelTabsContext` bridges plan payload from `AgentChat` and `ensurePlanTab` / `openRight`. Placeholder kinds multi-open; plan is singleton-focus.

**Tech Stack:** React 19, existing UI Button, lucide icons, current PlanTodoList.

## Global Constraints

- + menu labels: 任务计划 / 文件 / 终端 / 浏览器 / 地图 (Chinese)
- file|terminal|browser|map: multi-open with ordinal titles
- plan: at most one tab; open focuses existing
- Auto-open right panel + plan tab when plan_mode on or todos arrive
- Remove PlanTodoList from center chat

---

### Task 1: Tab state hook

**Files:**
- Create: `src/hooks/use-right-tabs.ts`

- [ ] Implement `RightTabKind`, `RightTab`, `useRightTabs` with `openTab`, `closeTab`, `focusTab`, `ensurePlanTab`

### Task 2: Right panel UI

**Files:**
- Create: `src/components/layout/right-panel.tsx`
- Create: `src/components/layout/panel-tabs-context.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/chat/ui-copy.ts`
- Modify: `src/components/chat/plan-todo-list.tsx` (panel variant)

- [ ] Tab strip + + menu + bodies; wire into AppShell right aside

### Task 3: Bridge AgentChat

**Files:**
- Modify: `src/components/chat/agent-chat.tsx`

- [ ] Remove center PlanTodoList; publish plan state; call ensurePlanTab + open right on plan/todos
