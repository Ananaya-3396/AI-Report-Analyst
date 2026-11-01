"""LLM adapter used by the API. Provider-specific code stays in this module."""

import json
import logging
import os
import re
from collections.abc import Awaitable, Callable
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from openai import OpenAIError


load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
DEBUG_LLM_IO = os.getenv("DEBUG_LLM_IO", "false").strip().lower() in {
    "1", "true", "yes", "on"
}

logger = logging.getLogger(__name__)


class LLMConfigurationError(Exception):
    """Raised when the LLM provider is not configured."""


class LLMProviderError(Exception):
    """Raised when the configured provider cannot complete a request."""


PROMPTS_DIR = Path(__file__).with_name("prompts")

# What the routing call can answer, and the prompt files each answer loads.
TASK_PROMPTS = {
    "data_overview": ["data_overview"],
    "visualization": ["visualization"],
    "both": ["data_overview", "visualization"],
}
ROUTER_RECENT_MESSAGES = 5
ROUTER_MAX_MESSAGE_CHARS = 300

MAX_TOOL_ROUNDS = 5
MAX_TOOL_OUTPUT_CHARS = 8_000

RUN_PYTHON_TOOL = {
    "type": "function",
    "function": {
        "name": "run_python",
        "description": "Run Python in a notebook-style cell where df is the selected dataset.",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "The Python code to run."},
            },
            "required": ["code"],
        },
    },
}


def load_prompt(name: str) -> str:
    """Read a prompt file. It is read on every use, so edits apply without a restart."""
    return (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8").strip()


def load_common_prompt(section: str) -> str:
    """Read one [section] of common.txt, which holds the short prompts."""
    parts = re.split(r"^\[(\w+)\]\s*$", load_prompt("common"), flags=re.MULTILINE)
    return dict(zip(parts[1::2], parts[2::2]))[section].strip()


async def _choose_task_prompts(messages: list[dict[str, str]]) -> tuple[list[str], tuple[int, int] | None]:
    """Ask the model which task prompts this request needs, and report the tokens used."""
    recent = messages[-ROUTER_RECENT_MESSAGES:]
    conversation = "\n".join(
        f"{message['role']}: {message['content'][:ROUTER_MAX_MESSAGE_CHARS]}" for message in recent
    )
    router_messages = [
        SystemMessage(content=load_common_prompt("task_router")),
        HumanMessage(content=conversation),
    ]
    try:
        model = ChatOpenAI(
            model=OPENAI_MODEL,
            api_key=OPENAI_API_KEY,
            timeout=20,
            max_retries=1,
            max_tokens=10,
            temperature=0,
        )
        _log_llm_request("task routing", router_messages)
        result = await model.ainvoke(router_messages)
        counts = _log_llm_response("task routing", result)
        answer = str(result.content).strip().strip(".").lower()
    except Exception:
        # Routing only trims the prompt, so a failure should not block the answer.
        logger.exception("Task routing failed; using all task prompts.")
        return TASK_PROMPTS["both"], None

    logger.info("Task routing chose %r", answer)
    return TASK_PROMPTS.get(answer, TASK_PROMPTS["both"]), counts


def _log_llm_request(purpose: str, messages: list) -> None:
    """Optionally print the exact messages sent to the model, without secrets."""
    if not DEBUG_LLM_IO:
        return

    request_messages = []
    for message in messages:
        item = {"role": message.type, "content": message.content}
        if getattr(message, "tool_calls", None):
            item["tool_calls"] = message.tool_calls
        request_messages.append(item)

    logger.info(
        "LLM request purpose=%s model=%s messages=%s",
        purpose,
        OPENAI_MODEL,
        json.dumps(request_messages, ensure_ascii=False, default=str),
    )


def _log_llm_response(purpose: str, result) -> tuple[int, int] | None:
    """Log returned text/tool calls and API-reported token counts."""
    usage = getattr(result, "usage_metadata", None)
    if not usage:
        usage = (getattr(result, "response_metadata", None) or {}).get("token_usage")

    counts = None
    if usage:
        input_tokens = int(usage.get("input_tokens", usage.get("prompt_tokens", 0)) or 0)
        output_tokens = int(usage.get("output_tokens", usage.get("completion_tokens", 0)) or 0)
        total_tokens = int(usage.get("total_tokens", input_tokens + output_tokens) or 0)
        counts = (input_tokens, output_tokens)
        logger.info(
            "LLM usage purpose=%s model=%s input_tokens=%d output_tokens=%d total_tokens=%d",
            purpose,
            OPENAI_MODEL,
            input_tokens,
            output_tokens,
            total_tokens,
        )
    else:
        logger.info("LLM usage purpose=%s model=%s token counts not provided", purpose, OPENAI_MODEL)

    if DEBUG_LLM_IO:
        response = {
            "content": result.content,
            "tool_calls": getattr(result, "tool_calls", []),
        }
        logger.info(
            "LLM response purpose=%s model=%s result=%s",
            purpose,
            OPENAI_MODEL,
            json.dumps(response, ensure_ascii=False, default=str),
        )
    return counts


def _cell_to_tool_output(cell: dict) -> str:
    """Summarize an executed cell as text the model can read and explain."""
    parts = [output["text"] for output in cell["outputs"]]
    if cell.get("notice"):
        parts.append(f"Notice: {cell['notice']}")
    if cell["error"]:
        parts.append(f"The cell failed with {cell['error']}")
    return "\n".join(parts)[:MAX_TOOL_OUTPUT_CHARS] or "The cell ran and displayed no output."


async def generate_reply(
    messages: list[dict[str, str]],
    selected_dataset: str | None = None,
    dataset_schema: dict | None = None,
    run_code: Callable[[str], Awaitable[dict]] | None = None,
) -> tuple[str, list[dict]]:
    """Generate a reply and return it with the notebook cells run to produce it."""
    if not OPENAI_API_KEY or OPENAI_API_KEY.lower() in {"your_openai_api_key", "change_me"}:
        raise LLMConfigurationError(
            "OpenAI is not configured. Add your API key to OPENAI_API_KEY in .env, then restart the backend."
        )

    if not OPENAI_MODEL:
        raise LLMConfigurationError("OPENAI_MODEL must not be empty.")

    token_totals = [0, 0]
    calls_with_usage = 0
    if run_code:
        task_prompts, counts = await _choose_task_prompts(messages)
        if counts:
            token_totals[0] += counts[0]
            token_totals[1] += counts[1]
            calls_with_usage += 1
        instructions = "\n\n".join(load_prompt(name) for name in ["analysis", *task_prompts])
    else:
        instructions = load_common_prompt("no_dataset")

    system_prompt = f"{load_common_prompt('system')}\n\n{instructions}"
    if selected_dataset:
        system_prompt += "\n" + load_common_prompt("selected_dataset").format(dataset=selected_dataset)

    chat_messages = [SystemMessage(content=system_prompt)]
    if dataset_schema:
        chat_messages.append(SystemMessage(
            content=load_common_prompt("dataset_schema").format(
                schema=json.dumps(dataset_schema, ensure_ascii=False, default=str)
            )
        ))
    chat_messages.extend(
        HumanMessage(content=message["content"])
        if message["role"] == "user"
        else AIMessage(content=message["content"])
        for message in messages
    )

    cells = []
    try:
        model = ChatOpenAI(
            model=OPENAI_MODEL,
            api_key=OPENAI_API_KEY,
            timeout=45,
            max_retries=1,
        )
        model_with_tools = model.bind_tools([RUN_PYTHON_TOOL]) if run_code else model
        for round_number in range(MAX_TOOL_ROUNDS):
            purpose = f"chat round {round_number + 1}"
            _log_llm_request(purpose, chat_messages)
            result = await model_with_tools.ainvoke(chat_messages)
            counts = _log_llm_response(purpose, result)
            if counts:
                token_totals[0] += counts[0]
                token_totals[1] += counts[1]
                calls_with_usage += 1
            if not result.tool_calls:
                break
            chat_messages.append(result)
            for tool_call in result.tool_calls:
                cell = await run_code(tool_call["args"].get("code", ""))
                cells.append(cell)
                if DEBUG_LLM_IO:
                    logger.info(
                        "Analysis tool result code=%s output=%s",
                        tool_call["args"].get("code", ""),
                        json.dumps(_cell_to_tool_output(cell), ensure_ascii=False),
                    )
                chat_messages.append(ToolMessage(
                    content=_cell_to_tool_output(cell),
                    tool_call_id=tool_call["id"],
                ))
        else:
            # Out of rounds: answer from the outputs gathered so far.
            _log_llm_request("chat final response", chat_messages)
            result = await model.ainvoke(chat_messages)
            counts = _log_llm_response("chat final response", result)
            if counts:
                token_totals[0] += counts[0]
                token_totals[1] += counts[1]
                calls_with_usage += 1
    except (KeyError, ValueError):
        raise
    except OpenAIError as exc:
        raise LLMProviderError(
            "The OpenAI request failed. Check the API key, model name, account access, and connection, then try again."
        ) from exc
    except Exception as exc:
        # Avoid returning provider internals, which may contain request details.
        raise LLMProviderError(
            "The LLM request could not be completed. Check the backend logs and try again."
        ) from exc

    if not isinstance(result.content, str) or not result.content.strip():
        raise LLMProviderError("OpenAI returned an empty response. Please try again.")

    if calls_with_usage:
        logger.info(
            "LLM usage purpose=chat turn_total model=%s calls=%d input_tokens=%d output_tokens=%d total_tokens=%d",
            OPENAI_MODEL,
            calls_with_usage,
            token_totals[0],
            token_totals[1],
            sum(token_totals),
        )

    # Failed attempts the model went on to fix are not worth showing.
    visible_cells = [
        cell for index, cell in enumerate(cells)
        if not cell["error"] or index == len(cells) - 1
    ]
    return result.content.strip(), visible_cells


async def generate_dataset_overview(profile: dict) -> str:
    """Explain deterministic Pandas profiling results without inventing findings."""
    if not OPENAI_API_KEY or OPENAI_API_KEY.lower() in {"your_openai_api_key", "change_me"}:
        raise LLMConfigurationError(
            "OpenAI is not configured. Add your API key to OPENAI_API_KEY in .env, then restart the backend."
        )

    if not OPENAI_MODEL:
        raise LLMConfigurationError("OPENAI_MODEL must not be empty.")

    messages = [
        SystemMessage(content=load_common_prompt("profile_overview")),
        HumanMessage(content=json.dumps(profile, ensure_ascii=False, default=str)),
    ]

    try:
        model = ChatOpenAI(
            model=OPENAI_MODEL,
            api_key=OPENAI_API_KEY,
            timeout=45,
            max_retries=1,
            max_tokens=700,
        )
        _log_llm_request("dataset overview", messages)
        result = await model.ainvoke(messages)
        _log_llm_response("dataset overview", result)
    except OpenAIError as exc:
        raise LLMProviderError(
            "The OpenAI request failed. Check the API key, model name, account access, and connection, then try again."
        ) from exc
    except Exception as exc:
        raise LLMProviderError(
            "The LLM request could not be completed. Check the backend logs and try again."
        ) from exc

    if not isinstance(result.content, str) or not result.content.strip():
        raise LLMProviderError("OpenAI returned an empty response. Please try again.")
    return result.content.strip()
