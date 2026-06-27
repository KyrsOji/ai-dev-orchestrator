Conversation Workspace - Architecture (v0)

Goal
----
Provide a lightweight, purely-frontend Conversation Workspace shell to be used in the Taskboard inspector. This patch implements component shells only (no backend wiring, no behavior changes).

Principles
----------
- Non-invasive: No backend / reviewer / runner changes.
- Progressive: Introduce small, focused components that can be wired later.
- Reusable: Components are isolated and typed loosely (any) so they can be composed.

Components
----------
src/components/
- ConversationWorkspace.tsx - top-level shell used in the inspector. Composes the other child components.
- ConversationHeader.tsx - conversation metadata (title, conversation id, participants placeholder)
- ConversationSessionChain.tsx - compact breadcrumb-style session chain built from task.parentTaskId links
- ConversationTimeline.tsx - scrollable list of ConversationMessage / ConversationSystemEvent
- ConversationMessage.tsx - simple message bubble renderer
- ConversationSystemEvent.tsx - system event renderer (Runner Started, etc.)
- ConversationActionCard.tsx - reusable action card with checkboxes and Approve/Reject buttons (no-op)
- ConversationFollowupCard.tsx - follow-up placeholder card with Approve/Reject/Publish UI (Publish disabled)

Integration point
-----------------
- App.tsx (TaskDetail): the previous messages/composer/session-chain sections were replaced with a single
  ConversationWorkspace invocation:

  <ConversationWorkspace task={local} tasks={tasks} messages={messages} openTask={openTask} />

- The Kanban columns (Pending / Approved / Completed) remain unchanged. Only the inspector (right-side details) was refactored to plug in the workspace shell.

Data model (lightweight)
------------------------
- Conversation (frontend model, not persisted):
  - id: string (conversationId)
  - title: string (task.title)
  - participants: string[] (placeholder)
  - events: ConversationEvent[]

- ConversationEvent (lightweight):
  - timestamp
  - type (reviewer | openhands | system | followup | approval | execution)
  - author
  - content
  - metadata

Diagram (ASCII)
----------------
Kanban Columns (left)      Conversation Workspace (inspector, right)
-------------------        ----------------------------------------
| Pending         |  --->  | ConversationHeader                      |
| Approved        |        | SessionChain (breadcrumb)              |
| Completed       |        | ConversationTimeline (messages)        |
|                 |        |  - ConversationMessage                 |
-------------------        |  - ConversationSystemEvent             |
                           | Context cards (Reviewer summary, etc.) |
                           | ConversationActionCard (recommended)   |
                           | ConversationFollowupCard (placeholder) |
                           ----------------------------------------

Notes / Gaps
------------
- No backend wiring: Approve / Reject / Publish buttons are no-op or disabled. The reviewer and publisher Python modules are not called.
- Composer (message composition) was replaced by the workspace shell. If composer UX is required, ConversationWorkspace should expose a composer sub-component.
- Publish flow remains untested here: followup publish requires runner/publisher and Kafka; intentionally omitted.
- Accessibility, i18n, and style consistency were not addressed in this architectural change.

Next steps (optional)
---------------------
- Wire ConversationWorkspace actions to existing endpoints (POST /taskboard/api/followups/:id/approve etc.)
- Add unit tests for components (Jest/React Testing Library)
- Add storybook stories for rapid iteration

