# -*- coding: utf-8 -*-
'''
@File    :   env.py
@Author  :   一力辉 
'''

import os
import warnings

# ================ 路径 ====================
ROOT_PATH = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_ROOT_PATH = os.path.join(ROOT_PATH, "configs")
CONFIG_TEMPLATE_FILE = os.path.join(CONFIG_ROOT_PATH, "config_template.yaml")
CONFIG_FILE = os.path.join(CONFIG_ROOT_PATH, "config.yaml")
if not os.path.exists(CONFIG_FILE):
    CONFIG_FILE = CONFIG_TEMPLATE_FILE
LOG_PATH = os.path.join(ROOT_PATH, "logs")
OUTPUT_PATH = os.path.join(ROOT_PATH, "outputs")
WEB_PATH = os.path.join(ROOT_PATH, "web")

# Create tmp folder
if not os.path.exists(OUTPUT_PATH):
    os.makedirs(OUTPUT_PATH)
    warnings.warn(f"Create output path: {OUTPUT_PATH}")


def _load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except Exception as exc:
        warnings.warn(f"Failed to load env file {path}: {exc}")


_load_env_file(os.path.join(ROOT_PATH, ".env"))
