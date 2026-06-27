#!/usr/bin/env python3

from openhands_cli.tui.settings.store import AgentStore
from openhands.sdk.conversation.conversation import Conversation

agent = AgentStore().load(session_id="sdk-poc6")
if not agent:
    raise SystemExit("AgentStore returned no agent")

agent = agent.model_copy(update={"tools": [], "mcp_config": {}})

conversation = Conversation(
    agent=agent,
    workspace="/tmp/sdk-poc-workspace",
    max_iteration_per_run=1,
    visualizer=None,
)

conversation.send_message("Reply only with PONG. Do not call tools.")

print("Before step")
print("Conversation:", conversation.id)
print("Status:", conversation.state.execution_status)
print("Events:", len(conversation.state.events))

def on_event(event):
    conversation.state.events.append(event)
    print("EVENT:", type(event).__name__)

try:
    agent.step(conversation, on_event=on_event)
    print("STEP_OK")
except Exception as e:
    print("STEP_ERROR:", type(e).__name__, str(e))

print("After step")
print("Conversation:", conversation.id)
print("Status:", conversation.state.execution_status)
print("Events:", len(conversation.state.events))

for event in conversation.state.events[-10:]:
    print(type(event).__name__)
