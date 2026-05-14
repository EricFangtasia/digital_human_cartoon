import ast
import sys

files = [
    "/opt/python/test_cuda/digital_human_cartoon/digitalHuman/database/db.py",
    "/opt/python/test_cuda/digital_human_cartoon/digitalHuman/database/__init__.py",
    "/opt/python/test_cuda/digital_human_cartoon/digitalHuman/server/api/user/router.py",
    "/opt/python/test_cuda/digital_human_cartoon/digitalHuman/server/api/user/__init__.py",
    "/opt/python/test_cuda/digital_human_cartoon/digitalHuman/server/router.py",
]

ok = True
for f in files:
    try:
        with open(f) as fh:
            ast.parse(fh.read())
        print(f"OK: {f}")
    except SyntaxError as e:
        print(f"SYNTAX ERROR in {f}: {e}")
        ok = False
    except FileNotFoundError:
        print(f"NOT FOUND: {f}")
        ok = False

sys.exit(0 if ok else 1)
