#!/usr/bin/python3
"""Initialize a private trust root and install the pinned Linux c2patool binary."""

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request


VERSION = "0.29.0"
ASSET = f"v{VERSION}-x86_64-unknown-linux-gnu.tar.gz"
ARCHIVE_SHA256 = "af5494722fc8c3f239980f36ceb3acf496d1481850d356a4bb34777b33b08043"
ROOT = Path(__file__).resolve().parents[3]


def checked(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def install_c2pa(work, destination):
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        raise ValueError("Install c2patool 0.29.0 separately on this host.")
    archive = work / ASSET
    url = f"https://github.com/contentauth/c2patool/releases/download/v{VERSION}/{ASSET}"
    with urllib.request.urlopen(url, timeout=45) as response, open(archive, "wb") as output:
        shutil.copyfileobj(response, output, length=65536)
    with open(archive, "rb") as package:
        if hashlib.file_digest(package, "sha256").hexdigest() != ARCHIVE_SHA256:
            raise ValueError("The c2patool package checksum does not match its published release.")
    with tarfile.open(archive, "r:gz") as package, open(work / "c2patool", "wb") as output:
        member = package.getmember("c2patool/c2patool")
        if not member.isfile():
            raise ValueError("Invalid c2patool release archive.")
        with package.extractfile(member) as binary:
            shutil.copyfileobj(binary, output)
    (work / "c2patool").chmod(0o700)
    (work / "c2patool").replace(destination)


def make_identity(work, destination):
    checked(["openssl", "req", "-new", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
             "-noenc", "-keyout", work / "root.key", "-out", work / "root.pem", "-days", "1825",
             "-subj", "/CN=Sabaq Studio local preview root",
             "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
             "-addext", "keyUsage=critical,keyCertSign,cRLSign"])
    checked(["openssl", "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
             "-noenc", "-keyout", work / "signer.key", "-out", work / "signer.csr",
             "-subj", "/CN=Sabaq Studio local preview signer"])
    extensions = work / "signer.ext"
    extensions.write_text(
        "basicConstraints=critical,CA:FALSE\n"
        "keyUsage=critical,digitalSignature\n"
        "extendedKeyUsage=critical,emailProtection,1.3.6.1.4.1.62558.2.1\n"
        "subjectKeyIdentifier=hash\n"
        "authorityKeyIdentifier=keyid,issuer\n",
        encoding="utf-8",
    )
    checked(["openssl", "x509", "-req", "-in", work / "signer.csr", "-CA", work / "root.pem",
             "-CAkey", work / "root.key", "-CAcreateserial", "-out", work / "signer.pem",
             "-days", "365", "-sha256", "-extfile", extensions])
    checked(["openssl", "verify", "-CAfile", work / "root.pem", work / "signer.pem"])
    (work / "chain.pem").write_bytes((work / "signer.pem").read_bytes() + (work / "root.pem").read_bytes())
    manifest = {
        "alg": "es256",
        "private_key": str(destination / "signer.key"),
        "sign_cert": str(destination / "chain.pem"),
        "claim_generator_info": [{"name": "Sabaq Studio"}],
    }
    (work / "signing.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for name in ("root.pem", "signer.key", "chain.pem", "signing.json"):
        (work / name).replace(destination / name)


def setup(destination):
    destination.mkdir(exist_ok=True, parents=True, mode=0o700)
    if destination.is_symlink() or destination.stat().st_mode & 0o077:
        raise ValueError("Use a private signing directory with permissions 0700.")
    files = ("root.pem", "signer.key", "chain.pem", "signing.json")
    existing = sum((destination / name).exists() for name in files)
    if existing not in (0, len(files)):
        raise ValueError("The signing directory contains a partial identity. Use a new private directory.")
    with tempfile.TemporaryDirectory(dir=destination) as work:
        if not (destination / "c2patool").exists():
            install_c2pa(Path(work), destination / "c2patool")
        if not existing:
            make_identity(Path(work), destination)
    print(f"Private signing files ready in {destination}")


if __name__ == "__main__":
    if len(sys.argv) > 2:
        sys.exit("Usage: setup-local-video-release.py [PRIVATE_DIRECTORY]")
    os.umask(0o077)
    setup(Path(sys.argv[1]).absolute() if len(sys.argv) == 2 else ROOT / ".data" / "video-release")
