#!/usr/bin/env python3

import os
import re
import subprocess
import shutil
from pathlib import Path

ENV_FILE = Path("app/src/backend/.env")

DEFAULTS = {
    "DB_HOST": "localhost",
    "DB_PORT": "8024",
    "DB_USER": "root",
    "DB_NAME": "testdb",
    "DB_SSL": "false",
}

def load_env(path=ENV_FILE):
    config = DEFAULTS.copy()

    if os.path.isfile(path):
        with open(path, "r") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                config[key] = value
    else:
        print(f"No {path} found.\nUsing defaults.")

    return config

def str_to_bool(value):
    return str(value).strip().lower() in ("true", "1", "yes", "on")

def build_mysql_command(config):
    mariadb = shutil.which("mariadb")
    if mariadb is None:
        program = "mysql"
    else:
        program = "mariadb"
    cmd = [
        program,
        "-h",
        config["DB_HOST"],
        "-P",
        str(config["DB_PORT"]),
        "-u",
        config["DB_USER"],
    ]

    if config.get("DB_PASSWORD"):
        cmd.append(f'-p{config["DB_PASSWORD"]}')
    else:
        cmd.append("-p")

    if str_to_bool(config["DB_SSL"]):
        cmd.append("--ssl-ca=app/src/backend/certs/ca.pem")
    else:
        cmd.append("--skip-ssl")

    if config.get("DB_NAME"):
        cmd.append(config["DB_NAME"])

    return cmd

def log_config(config):
    print("Loaded DB config:")
    for key, value in config.items():
        if key == "DB_PASSWORD":
            value = "****"
        print(f"  {key}={value}")

def main():
    config = load_env()
    log_config(config)

    cmd = build_mysql_command(config)
    cmd_string = " ".join(cmd)
    masked_string = re.sub(r'(-p\s*)([^\s]+)', r'\1****', cmd_string)
    print("Running:", masked_string)

    subprocess.call(cmd)

if __name__ == "__main__":
    main()
