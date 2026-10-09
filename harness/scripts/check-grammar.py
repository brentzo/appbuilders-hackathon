"""Checks that a JSON Schema compiles as a structured-output grammar the way mlx-vlm 0.7.6 compiles it.

Loads no model. Run it with the Python that has mlx-vlm (and so llguidance) installed:
  npm run --silent model:check -- --print-schema | python3 scripts/check-grammar.py
"""

import sys

import llguidance as llg

schema = sys.stdin.read()
try:
    # Same settings as mlx_vlm/structured.py: build_json_schema_logits_processor.
    grammar = llg.JsonCompiler(separators=(", ", ": "), whitespace_pattern="").compile(schema)
except ValueError as error:
    print(f"FAILED to compile: {error}")
    sys.exit(1)
is_error, messages = llg.LLMatcher.validate_grammar_with_warnings(grammar)
if is_error:
    print("FAILED to validate:", *messages, sep="\n")
    sys.exit(1)
print(f"OK: compiles with llguidance {llg.__version__ if hasattr(llg, '__version__') else ''}".strip())
for message in messages:
    print("warning:", message)
