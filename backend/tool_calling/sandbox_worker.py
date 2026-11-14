"""Run one analysis cell with notebook-style output. Started by backend/analysis.py.

Runs as its own process, without the backend's environment variables. Code is
checked before it runs, and an audit hook refuses file, process, and network
access while it runs, to contain mistakes and prompt injection. These are guard
rails, not a security boundary: run this in a locked-down container before
exposing it to other users.
"""

import ast
import base64
import builtins
import contextlib
import faulthandler
import io
import json
import math
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd


MAX_TEXT_CHARS = 20_000
MAX_FIGURES_PER_CELL = 6
FIGURE_DPI = 110
MAX_SERIES_SCALE_RATIO = 50
MAX_DESCRIBED_VALUES = 30

ALLOWED_IMPORTS = {
    "pandas", "numpy", "math", "statistics", "re", "datetime", "collections", "itertools",
    "matplotlib", "seaborn",
}
# Plotting takes about a second to import, so cells that do not plot skip it.
PLOTTING_HINTS = ("plt", "sns", "matplotlib", "seaborn", ".plot", ".hist", ".box", ".kde")
CHART_THEME = {
    "figure.facecolor": "#ffffff",
    "axes.facecolor": "#ffffff",
    "figure.figsize": (9, 5),
    "figure.autolayout": True,
    "axes.edgecolor": "#b8b5ac",
    "axes.labelcolor": "#5a6066",
    "axes.titlecolor": "#2f3437",
    "axes.titlesize": 13,
    "axes.titleweight": "semibold",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "axes.axisbelow": True,
    "grid.color": "#e6e3da",
    "grid.linewidth": 0.6,
    "xtick.color": "#5a6066",
    "ytick.color": "#5a6066",
    "text.color": "#2f3437",
    "lines.linewidth": 2,
    "legend.frameon": False,
    "axes.prop_cycle": "cycler('color', ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', "
                       "'#e87ba4', '#008300', '#6250d6', '#e34948'])",
}
BLOCKED_NAMES = {
    "open", "exec", "eval", "compile", "globals", "locals", "vars", "getattr", "setattr",
    "delattr", "input", "breakpoint", "exit", "quit", "help", "memoryview",
}
# query() and eval() are blocked because their string expressions can reach Python objects.
BLOCKED_ATTRIBUTES = {
    "query", "eval", "io", "os", "sys", "subprocess", "builtins", "importlib", "shutil",
    "socket", "ctypes", "pickle", "pathlib", "open", "system", "popen",
    "to_csv", "to_excel", "to_pickle", "to_parquet", "to_feather", "to_hdf", "to_sql",
    "to_json", "to_html", "to_xml", "to_stata", "to_orc", "to_clipboard", "to_latex",
    "to_markdown", "tofile", "load", "save", "savez", "savez_compressed", "loadtxt",
    "savetxt", "genfromtxt", "fromfile", "memmap", "DataSource", "ctypeslib", "f2py",
    "testing", "distutils", "HDFStore", "ExcelFile", "ExcelWriter", "bltns", "exec",
    "savefig", "imread", "imsave",
}
BLOCKED_AUDIT_EVENTS = (
    "socket.", "subprocess.", "os.system", "os.exec", "os.spawn", "os.posix_spawn",
    "os.startfile", "os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.link",
    "os.symlink", "os.truncate", "os.chmod", "shutil.", "ctypes.dlopen", "webbrowser.",
)
WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT


def install_audit_hook(result_path: Path) -> None:
    """Refuse system access at runtime, however the code managed to reach it."""
    allowed_write = os.path.abspath(result_path)
    # Pandas and NumPy import some modules lazily, so Python's own folders stay readable.
    readable_roots = tuple(
        os.path.join(os.path.abspath(root), "") for root in {sys.prefix, sys.base_prefix}
    )

    def hook(event, args):
        if event.startswith(BLOCKED_AUDIT_EVENTS):
            raise PermissionError(f"'{event}' is not allowed here.")
        if event != "open" or isinstance(args[0], int):
            return
        path = os.path.abspath(os.fsdecode(args[0]))
        flags = args[2] if isinstance(args[2], int) else 0
        if path == allowed_write:
            return
        if flags & WRITE_FLAGS or not path.startswith(readable_roots):
            raise PermissionError("Accessing files is not allowed here.")

    sys.addaudithook(hook)


def _is_blocked_attribute(name: str) -> bool:
    return name.startswith(("_", "read_")) or name in BLOCKED_ATTRIBUTES


def validate(tree: ast.AST) -> None:
    """Reject code that goes beyond analysing the supplied DataFrame."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            modules = [node.module or ""]
            for alias in node.names:
                if _is_blocked_attribute(alias.name):
                    raise ValueError(f"Importing '{alias.name}' is not allowed here.")
        else:
            modules = []
        for module in modules:
            if module.split(".")[0] not in ALLOWED_IMPORTS:
                raise ValueError(f"Importing '{module}' is not allowed here.")

        if isinstance(node, ast.Name) and (
            node.id in BLOCKED_NAMES or (node.id.startswith("_") and node.id != "_")
        ):
            raise ValueError(f"Using '{node.id}' is not allowed here.")
        if isinstance(node, ast.Attribute) and _is_blocked_attribute(node.attr):
            raise ValueError(f"Using '.{node.attr}' is not allowed here.")
        # to_string() is useful for printing, but its first argument can be a file path.
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "to_string"
            and (node.args or any(keyword.arg == "buf" for keyword in node.keywords))
        ):
            raise ValueError("to_string() may only be called with keyword formatting options.")


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or name.split(".")[0] not in ALLOWED_IMPORTS:
        raise ImportError(f"Importing '{name}' is not allowed here.")
    return builtins.__import__(name, globals, locals, fromlist, level)


def _clip(text: str) -> str:
    if len(text) <= MAX_TEXT_CHARS:
        return text
    return text[:MAX_TEXT_CHARS] + "\n... [output truncated]"


def to_output(value) -> dict:
    """Format a value the way a notebook displays it."""
    if isinstance(value, dict) and value.get("type") == "chart" and isinstance(value.get("chart"), dict):
        return value
    text = _clip(repr(value))
    if isinstance(value, pd.DataFrame):
        html = value._repr_html_()
        if html:
            return {"type": "table", "html": html, "text": text}
    return {"type": "text", "text": text}


def make_chart(data, kind="bar", title="", x_label="", y_label="", x="x", y="y", series=None):
    """Convert up to 100 records into a small, validated chart specification."""
    if kind not in {"bar", "line", "scatter"}:
        raise ValueError("Chart type must be 'bar', 'line', or 'scatter'.")
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
    else:
        records = list(data)
    if not records:
        raise ValueError("A chart needs at least one data point.")
    if len(records) > 100:
        raise ValueError("A chart can contain at most 100 points. Aggregate or limit the data first.")

    points = []
    for row in records:
        if not isinstance(row, dict) or x not in row or y not in row:
            raise ValueError(f"Each chart row must have the '{x}' and '{y}' fields.")
        try:
            numeric_y = float(row[y])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(numeric_y):
            continue
        raw_x = row[x]
        if raw_x is None or pd.isna(raw_x):
            continue
        if isinstance(raw_x, (int, float, np.number)) and math.isfinite(float(raw_x)):
            normalized_x = float(raw_x)
        else:
            normalized_x = str(raw_x)[:100]
        point = {"x": normalized_x, "y": numeric_y}
        if series and row.get(series) is not None:
            point["series"] = str(row[series])[:60]
        points.append(point)
    if not points:
        raise ValueError("No chart rows had a usable numeric y value.")

    spec = {
        "kind": kind,
        "title": str(title)[:160],
        "x_label": str(x_label or x)[:80],
        "y_label": str(y_label or y)[:80],
        "points": points,
    }
    description = json.dumps(spec, ensure_ascii=False)
    return {"type": "chart", "chart": spec, "text": f"Chart created: {description}"}


def load_plotting():
    """Import plotting libraries, which must happen before the audit hook is installed."""
    # Keeps Matplotlib's font cache between cells, because building it takes seconds.
    os.environ["MPLCONFIGDIR"] = os.path.join(tempfile.gettempdir(), "report_analyst_matplotlib")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    plt.rcParams.update(CHART_THEME)
    return plt, sns


def is_plot_object(value) -> bool:
    """Recognize values like Axes, whose text repr only adds noise beside the chart."""
    if isinstance(value, np.ndarray):
        return value.dtype == object and any(is_plot_object(item) for item in value.flat)
    if isinstance(value, (list, tuple)):
        return any(is_plot_object(item) for item in value[:5])
    return type(value).__module__.startswith(("matplotlib.", "seaborn."))


def plotted_series(axes) -> list[tuple[str, list[float], list[str]]]:
    """Read back the bars and labelled lines on an Axes as (label, values, categories)."""
    series = []
    for container in axes.containers:
        patches = getattr(container, "patches", None)
        if not patches:
            continue
        horizontal = getattr(container, "orientation", None) == "horizontal"
        values = [patch.get_width() if horizontal else patch.get_height() for patch in patches]
        ticks = axes.get_yticklabels() if horizontal else axes.get_xticklabels()
        axis_label = axes.get_xlabel() if horizontal else axes.get_ylabel()
        label = container.get_label()
        series.append((
            axis_label if label.startswith("_") else label,
            values,
            [tick.get_text() for tick in ticks],
        ))
    for line in axes.get_lines():
        if not line.get_label().startswith("_"):
            ticks = [tick.get_text() for tick in axes.get_xticklabels()]
            series.append((line.get_label(), list(line.get_ydata()), ticks))
    return series


def check_series_visible(figure) -> None:
    """Refuse a chart where one series is too small to see beside another on its axis."""
    for axes in figure.axes:
        peaks = {}
        for label, values, _ in plotted_series(axes):
            finite = [abs(float(value)) for value in values if np.isfinite(value)]
            if finite and max(finite) > 0:
                peaks[label] = max(finite)
        if len(peaks) < 2:
            continue
        largest, smallest = max(peaks, key=peaks.get), min(peaks, key=peaks.get)
        if peaks[largest] / peaks[smallest] > MAX_SERIES_SCALE_RATIO:
            raise ValueError(
                f"Chart not shown: '{smallest}' (max {peaks[smallest]:.4g}) would be invisible "
                f"beside '{largest}' (max {peaks[largest]:.4g}) on one axis. Plot each measure as "
                "a percentage of its own maximum, or give each its own subplot, then run again."
            )


def describe_plotted_values(figure) -> str:
    """List the plotted numbers, so the model can explain a chart it cannot see."""
    lines = []
    for axes in figure.axes:
        for label, values, categories in plotted_series(axes):
            shown = [f"{float(value):.4g}" for value in values[:MAX_DESCRIBED_VALUES]]
            if len(categories) == len(values):
                shown = [f"{name}={value}" for name, value in zip(categories, shown)]
            lines.append(f"{label}: {', '.join(shown)}")
    return "\n".join(lines)


def figure_to_output(figure) -> dict:
    """Render a figure to a PNG for the page, and describe it in text for the model."""
    check_series_visible(figure)
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", dpi=FIGURE_DPI, bbox_inches="tight")

    labels = []
    for axes in figure.axes:
        parts = [axes.get_title(), axes.get_xlabel(), axes.get_ylabel()]
        labels.append(" / ".join(part for part in parts if part))
    description = "; ".join(label for label in labels if label) or "untitled chart"
    return {
        "type": "image",
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "alt": description[:300],
        "text": f"[Chart shown to the user: {description[:300]}]\n{describe_plotted_values(figure)}",
    }


def run(code: str, df: pd.DataFrame, plt=None, sns=None) -> dict:
    outputs = []
    stdout = io.StringIO()
    figures_shown = 0

    def flush_stdout():
        text = stdout.getvalue()
        if text:
            outputs.append({"type": "text", "text": _clip(text)})
        stdout.seek(0)
        stdout.truncate()

    def show_figures(*args, **kwargs):
        nonlocal figures_shown
        flush_stdout()
        for number in plt.get_fignums():
            figure = plt.figure(number)
            figures_shown += 1
            if figures_shown <= MAX_FIGURES_PER_CELL:
                outputs.append(figure_to_output(figure))
            plt.close(figure)

    def display(*values):
        flush_stdout()
        for value in values:
            if plt and is_plot_object(value):
                show_figures()
            else:
                outputs.append(to_output(value))

    safe_builtins = {
        name: value for name, value in vars(builtins).items()
        if name not in BLOCKED_NAMES and not name.startswith("_")
    }
    safe_builtins["__import__"] = _guarded_import
    safe_builtins["__build_class__"] = builtins.__build_class__
    namespace = {
        "__builtins__": safe_builtins,
        "__name__": "__main__",
        "df": df,
        "pd": pd,
        "np": np,
        "display": display,
        "chart": make_chart,
    }
    if plt:
        # plt.show() places a chart in the output at that point, as it does in a notebook.
        plt.show = show_figures
        namespace.update(plt=plt, sns=sns)

    error = None
    try:
        tree = ast.parse(code)
        validate(tree)

        # As in a notebook, a final bare expression is displayed.
        last_expression = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expression = ast.Expression(tree.body.pop().value)

        with contextlib.redirect_stdout(stdout):
            exec(compile(tree, "<cell>", "exec"), namespace)
            if last_expression is not None:
                value = eval(compile(last_expression, "<cell>", "eval"), namespace)
                if value is not None:
                    display(value)
            if plt:
                show_figures()
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

    flush_stdout()
    if figures_shown > MAX_FIGURES_PER_CELL:
        outputs.append({
            "type": "text",
            "text": f"Showing the first {MAX_FIGURES_PER_CELL} of {figures_shown} charts.",
        })
    return {"outputs": outputs, "error": _clip(error) if error else None}


def main() -> None:
    workdir = Path(sys.argv[1])
    timeout_seconds = int(sys.argv[2])
    # Ends the process even when the code is stuck inside native Pandas or NumPy code.
    faulthandler.dump_traceback_later(timeout_seconds, exit=True)

    # Match the defaults a notebook uses instead of the non-interactive console defaults.
    pd.set_option("display.max_rows", 60)
    pd.set_option("display.min_rows", 10)
    pd.set_option("display.max_columns", 20)
    pd.set_option("display.width", 120)

    df = pd.read_pickle(workdir / "data.pkl")
    code = (workdir / "code.py").read_text(encoding="utf-8")
    result_path = workdir / "result.json"
    plt, sns = load_plotting() if any(hint in code for hint in PLOTTING_HINTS) else (None, None)
    sys.dont_write_bytecode = True
    install_audit_hook(result_path)
    result = run(code, df, plt, sns)
    result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
