"""
Verify TLS trust: can Windows/Python trust CN=DISHA-C2 cert?
Then try to create an Oracle-compatible cwallet.sso via Python.
"""
import ssl, socket, struct, os, sys

HOST = "73.149.135.125"
PORT = 8152

# --- 1. Test TLS using system default (Windows CertStore) ---
print("=== Test 1: TLS via Windows Certificate Store (default) ===")
try:
    ctx = ssl.create_default_context()  # uses Windows cert store
    with socket.create_connection((HOST, PORT), timeout=8) as raw:
        with ctx.wrap_socket(raw, server_hostname=HOST) as s:
            print("  TLS OK — cert trusted via Windows cert store!")
            cert = s.getpeercert()
            print(f"  Subject: {cert.get('subject')}")
except ssl.SSLCertVerificationError as e:
    print(f"  CERT NOT TRUSTED: {e}")
except Exception as e:
    print(f"  Error: {e}")

# --- 2. Test TLS skipping verification ---
print("\n=== Test 2: TLS skipping cert verification ===")
try:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((HOST, PORT), timeout=8) as raw:
        with ctx.wrap_socket(raw) as s:
            print("  TLS connected (no verification)")
except Exception as e:
    print(f"  Error: {e}")

# --- 3. Test TLS with our PEM cert explicitly ---
cert_pem = os.path.join(os.path.dirname(__file__), "../certs/DISHA-C2.pem")
print(f"\n=== Test 3: TLS with explicit PEM cert ({cert_pem}) ===")
try:
    ctx = ssl.create_default_context(cafile=cert_pem)
    with socket.create_connection((HOST, PORT), timeout=8) as raw:
        with ctx.wrap_socket(raw, server_hostname=HOST) as s:
            print("  TLS OK — cert trusted via explicit PEM!")
except ssl.SSLCertVerificationError as e:
    print(f"  CERT NOT TRUSTED: {e}")
except Exception as e:
    print(f"  Error: {e}")

# --- 4. Create Oracle wallet via Python cryptography ---
print("\n=== Step 4: Create Oracle wallet (ewallet.p12 + cwallet.sso attempt) ===")
try:
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, NoEncryption
    from cryptography.hazmat.primitives.serialization.pkcs12 import serialize_key_and_certificates
    import base64

    with open(cert_pem, "rb") as f:
        ca_cert = x509.load_pem_x509_certificate(f.read())

    # Build a PKCS12 truststore — no private key, just the trusted CA cert
    # Oracle requires the cert to be wrapped in a PKCS12 "trusted cert bag"
    from cryptography.hazmat.primitives.serialization import pkcs12 as p12mod

    # Create ewallet.p12 with no password (empty password) — Oracle may accept this
    # We're creating a truststore (CA-only PKCS12)
    wallet_dir = "C:\\oracle\\wallet"

    # Use raw PKCS12 construction via cryptography library
    # Format: CA cert in trusted cert bag, no private key, no password
    raw_p12 = pkcs12.serialize_key_and_certificates(
        name=b"DISHA-C2",
        key=None,
        cert=None,
        cas=[ca_cert],
        encryption_algorithm=NoEncryption()
    )

    with open(os.path.join(wallet_dir, "ewallet.p12"), "wb") as f:
        f.write(raw_p12)
    print(f"  ewallet.p12 written ({len(raw_p12)} bytes, no password)")

    # Try creating cwallet.sso — Oracle's obfuscated auto-login wallet
    # The SSO wallet wraps the PKCS12 with a proprietary header
    # Oracle's magic: header is b'\x00\x00\x00\x02' + length (4 bytes) + pkcs12_data
    # This is a simplification — actual format may differ
    sso_header = struct.pack(">I", 2) + struct.pack(">I", len(raw_p12))
    cwallet_data = sso_header + raw_p12
    with open(os.path.join(wallet_dir, "cwallet.sso"), "wb") as f:
        f.write(cwallet_data)
    print(f"  cwallet.sso written ({len(cwallet_data)} bytes)")

except ImportError:
    print("  cryptography library not installed. Installing...")
    os.system(f"{sys.executable} -m pip install cryptography")
    print("  Run this script again after install.")
except Exception as e:
    print(f"  Error: {e}")
    import traceback; traceback.print_exc()
