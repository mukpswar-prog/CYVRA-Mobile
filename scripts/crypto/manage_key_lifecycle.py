#!/usr/bin/env python3
"""
CYVRA Mobile 2.0.1 — Automated Cryptographic Key Management Tool.

Provides automated key generation, trust manifest publication, Ed25519 payload signing,
and verification adhering to NIST SP 800-57, NIST SP 800-130, and RFC 8032.

Commands:
    generate-key-pair [--out-dir DIR] [--prefix PREFIX]
    create-manifest   --root-priv KEY_B64 --root-id ID --anchors-json FILE --out FILE
    sign-patch        --patch-json FILE --key-priv KEY_B64 --key-id ID --out FILE
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

def canonicalize(obj):
    """Produces the exact canonical JSON bytes required by CYVRA PatchVerifier / TrustManifestVerifier."""
    def write_element(el):
        if isinstance(el, dict):
            items = []
            for k in sorted(el.keys()):
                items.append(f'"{escape_str(k)}":{write_element(el[k])}')
            return "{" + ",".join(items) + "}"
        elif isinstance(el, list):
            items = [write_element(x) for x in el]
            return "[" + ",".join(items) + "]"
        elif el is None:
            return "null"
        elif isinstance(el, bool):
            return "true" if el else "false"
        elif isinstance(el, (int, float)):
            return str(el)
        elif isinstance(el, str):
            return f'"{escape_str(el)}"'
        else:
            return f'"{escape_str(str(el))}"'

    def escape_str(s):
        out = []
        for ch in s:
            if ch == '"':
                out.append('\\"')
            elif ch == '\\':
                out.append('\\\\')
            elif ch == '\n':
                out.append('\\n')
            elif ch == '\r':
                out.append('\\r')
            elif ch == '\t':
                out.append('\\t')
            elif ord(ch) < 0x20:
                out.append(f"\\u{ord(ch):04x}")
            else:
                out.append(ch)
        return "".join(out)

    return write_element(obj).encode("utf-8")

def generate_key_pair(prefix="CYVRA-KEY"):
    priv = ed25519.Ed25519PrivateKey.generate()
    pub = priv.public_key()
    
    pub_spki = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    priv_pkcs8 = priv.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    
    pub_b64 = base64.b64encode(pub_spki).decode("utf-8")
    priv_b64 = base64.b64encode(priv_pkcs8).decode("utf-8")
    
    return {
        "prefix": prefix,
        "publicKeyBase64": pub_b64,
        "privateKeyBase64": priv_b64,
        "algorithm": "Ed25519",
        "generatedAt": datetime.now(timezone.utc).isoformat()
    }

def sign_bytes(data_bytes, private_key_b64):
    priv_der = base64.b64decode(private_key_b64)
    priv_key = serialization.load_der_private_key(priv_der, password=None)
    sig = priv_key.sign(data_bytes)
    return base64.b64encode(sig).decode("utf-8")

def create_manifest(root_priv_b64, root_key_id, anchors_list, version=1):
    payload = {
        "manifestVersion": version,
        "rootKeyId": root_key_id,
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "anchors": anchors_list
    }
    canonical = canonicalize(payload)
    sig = sign_bytes(canonical, root_priv_b64)
    
    envelope = {
        "payload": payload,
        "signature": sig,
        "alg": "Ed25519",
        "rootKeyId": root_key_id
    }
    return envelope

def sign_patch(payload_dict, private_key_b64, key_id):
    canonical = canonicalize(payload_dict)
    sig = sign_bytes(canonical, private_key_b64)
    envelope = {
        "payload": payload_dict,
        "signature": sig,
        "alg": "Ed25519",
        "key_id": key_id
    }
    return envelope

def main():
    parser = argparse.ArgumentParser(description="CYVRA Key Lifecycle Tool")
    subparsers = parser.add_subparsers(dest="command")

    gen_p = subparsers.add_parser("generate-key-pair")
    gen_p.add_argument("--prefix", default="CYVRA-OP-KEY", help="Key identifier prefix")

    man_p = subparsers.add_parser("create-manifest")
    man_p.add_argument("--root-priv", required=True, help="Base64 PKCS#8 private key of root authority")
    man_p.add_argument("--root-id", default="CYVRA-ROOT-KEY-2026-01", help="Root Key ID")
    man_p.add_argument("--anchors-json", required=True, help="Path to JSON file containing array of anchors")
    man_p.add_argument("--version", type=int, default=1, help="Monotonic manifest version")
    man_p.add_argument("--out", required=True, help="Output manifest JSON file")

    patch_p = subparsers.add_parser("sign-patch")
    patch_p.add_argument("--patch-json", required=True, help="Path to patch payload JSON file")
    patch_p.add_argument("--key-priv", required=True, help="Base64 PKCS#8 operational private key")
    patch_p.add_argument("--key-id", required=True, help="Key ID for signature verification")
    patch_p.add_argument("--out", required=True, help="Output signed patch JSON file")

    args = parser.parse_args()

    if args.command == "generate-key-pair":
        res = generate_key_pair(args.prefix)
        print(json.dumps(res, indent=2))
    elif args.command == "create-manifest":
        with open(args.anchors_json, "r", encoding="utf-8") as f:
            anchors = json.load(f)
        manifest = create_manifest(args.root_priv, args.root_id, anchors, args.version)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"Manifest written to {args.out}")
    elif args.command == "sign-patch":
        with open(args.patch_json, "r", encoding="utf-8") as f:
            payload = json.load(f)
        signed = sign_patch(payload, args.key_priv, args.key_id)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(signed, f, indent=2)
        print(f"Signed patch written to {args.out}")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
