import ollama
import subprocess
import json

MODEL = "lukey03/qwen3.5-9b-abliterated-vision:latest"

# Define tools
def run_command(command: str) -> str:
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return result.stdout or result.stderr or "Command completed with no output"

def read_file(filepath: str) -> str:
    try:
        with open(filepath, 'r') as f:
            return f.read()
    except Exception as e:
        return str(e)

def write_file(filepath: str, content: str) -> str:
    try:
        with open(filepath, 'w') as f:
            f.write(content)
        return f"Written to {filepath}"
    except Exception as e:
        return str(e)

# Tool registry
tools_map = {
    "run_command": run_command,
    "read_file": read_file,
    "write_file": write_file,
}

# Tool definitions for the model
tools = [
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a shell command and return the output",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to run"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Path to the file"}
                },
                "required": ["filepath"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Path to the file"},
                    "content": {"type": "string", "description": "Content to write"}
                },
                "required": ["filepath", "content"]
            }
        }
    }
]

def run_agent(user_input: str, history: list) -> list:
    history.append({"role": "user", "content": user_input})

    while True:
        # Stream the response
        stream = ollama.chat(
            model=MODEL,
            messages=history,
            tools=tools,
            stream=True
        )

        # Collect streamed response
        full_content = ""
        tool_calls = None
        print("\nAgent: ", end="", flush=True)

        for chunk in stream:
            msg = chunk.message
            if msg.content:
                print(msg.content, end="", flush=True)
                full_content += msg.content
            if msg.tool_calls:
                tool_calls = msg.tool_calls

        print()  # newline after response

        # Add assistant response to history
        history.append({
            "role": "assistant",
            "content": full_content,
            "tool_calls": tool_calls
        })

        # If no tool calls, we're done
        if not tool_calls:
            break

        # Execute each tool call
        for tool_call in tool_calls:
            fn_name = tool_call.function.name
            fn_args = tool_call.function.arguments
            print(f"\n[Tool] {fn_name}({fn_args})")

            result = tools_map[fn_name](**fn_args)
            print(f"[Result] {result}")

            history.append({"role": "tool", "content": result})

    return history


# Main loop with persistent history
print(f"Agent ready using {MODEL}")
print("Type your request (or 'quit' to exit, 'clear' to reset history):\n")

conversation_history = [
    {"role": "system", "content": "You are a helpful assistant that can run commands and manage files. Use your tools to complete tasks."}
]

while True:
    user_input = input("\nYou: ").strip()
    if not user_input:
        continue
    if user_input.lower() in ["exit", "quit"]:
        break
    if user_input.lower() == "clear":
        conversation_history = [conversation_history[0]]  # keep system prompt
        print("History cleared.")
        continue

    conversation_history = run_agent(user_input, conversation_history)