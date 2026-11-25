"""在管理员自己的终端为 ReadBox 配置 Android 正式签名。"""
import base64
import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO = "github.com/suyh1/ReadBox"
NAMES = ("ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")


def gh(*args, **kwargs):
    return subprocess.run(["gh", *args, "--repo", REPO], check=True, **kwargs)


def setup():
    if not sys.stdin.isatty():
        raise SystemExit("请在自己的交互式终端中运行。")
    if not shutil.which("gh"):
        raise SystemExit("请先安装 GitHub CLI 并用 gh auth login 登录。")
    # Check repository access before asking for any signing material.
    result = gh("secret", "list", "--app", "actions", "--json", "name", stdout=subprocess.PIPE)
    existing = {item["name"] for item in json.loads(result.stdout)}
    missing = [name for name in NAMES if name not in existing]
    if not missing:
        print("四项配置均已存在。可以重跑发布任务。")
        return
    if not shutil.which("keytool"):
        raise SystemExit("请安装 JDK 并将 keytool 加入 PATH。")
    print("目标仓库为 suyh1/ReadBox，待配置项为 " + "、".join(missing))
    if len(missing) == len(NAMES):
        mode = input("输入 1 使用已有正式密钥，首次创建签名身份可输入 2 新建密钥：").strip()
    else:
        print("已有部分配置，请使用与之配套的正式密钥、别名及口令。")
        mode = "1"
    if mode == "1":
        path = Path(input("正式密钥库文件路径：").strip().strip('"')).expanduser()
        if not path.is_file():
            raise SystemExit("密钥库文件不存在。")
        alias = input("密钥别名：").strip()
        password = getpass.getpass("密钥库口令：")
        key_password = getpass.getpass("密钥口令（与密钥库口令相同请回车）：") or password
    elif mode == "2":
        path = Path.home() / "ReadBox-signing" / "readbox-release.jks"
        if path.exists():
            raise SystemExit(f"已有文件 {path}。请重新运行并选择使用已有密钥。")
        alias = "readbox"
        print(f"密钥库将保存在 {path}，别名为 {alias}。请将口令保存到密码管理器。")
        password = getpass.getpass("设置至少 12 位的口令：")
        if len(password) < 12 or getpass.getpass("再次输入：") != password:
            raise SystemExit("口令长度不足或两次输入不同。")
        key_password = password
    else:
        raise SystemExit("已取消。")

    env = dict(os.environ, READBOX_LOCAL_STORE=password, READBOX_LOCAL_KEY=key_password)
    args = ["-keystore", str(path), "-alias", alias,
            "-storepass:env", "READBOX_LOCAL_STORE", "-keypass:env", "READBOX_LOCAL_KEY"]
    if mode == "2":
        os.umask(0o077)
        path.parent.mkdir(mode=0o700, exist_ok=True)
        subprocess.run(["keytool", "-genkeypair", "-storetype", "JKS", "-keyalg", "RSA",
                        "-keysize", "3072", "-validity", "10000", "-dname", "CN=ReadBox",
                        *args], env=env, check=True)
        print(f"请安全备份 {path}，后续升级需要沿用这个密钥。")
    # Verify the private key and both passwords before uploading.
    subprocess.run(["keytool", "-certreq", *args], env=env, check=True, stdout=subprocess.DEVNULL)
    values = dict(zip(NAMES, (base64.b64encode(path.read_bytes()), password.encode(),
                              alias.encode(), key_password.encode())))
    if len(values[NAMES[0]]) > 48 * 1024:
        raise SystemExit("密钥库编码后超过 GitHub 单个 Secret 的 48 KB 上限。")
    for name in missing:
        gh("secret", "set", name, "--app", "actions", input=values[name])
        print("已配置 " + name, flush=True)
    print("签名配置已完成，可以重跑发布任务。")


if __name__ == "__main__":
    try:
        setup()
    except subprocess.CalledProcessError as err:
        sys.exit(f"{err.cmd[0]} 执行失败（退出码 {err.returncode}），请检查上方提示。")
    except (KeyboardInterrupt, EOFError):
        sys.exit("已取消。")
