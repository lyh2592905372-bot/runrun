import os
import socket
import sys
import threading


PROXY_HOST = os.environ.get("RUNFLOW_HTTP_PROXY_HOST", "127.0.0.1")
PROXY_PORT = int(os.environ.get("RUNFLOW_HTTP_PROXY_PORT", "10808"))


def copy_stdin(sock):
    try:
        while True:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk:
                break
            sock.sendall(chunk)
    finally:
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: http_connect_proxy.py host port [http|socks5]")
    host, port = sys.argv[1], int(sys.argv[2])
    mode = sys.argv[3] if len(sys.argv) == 4 else "http"
    sock = socket.create_connection((PROXY_HOST, PROXY_PORT), timeout=15)
    pending = b""
    if mode == "http":
        request = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode("ascii")
        sock.sendall(request)
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = sock.recv(4096)
            if not chunk:
                raise SystemExit("proxy closed during CONNECT")
            response += chunk
            if len(response) > 65536:
                raise SystemExit("proxy response too large")
        headers, pending = response.split(b"\r\n\r\n", 1)
        if b" 200 " not in headers.split(b"\r\n", 1)[0]:
            raise SystemExit(headers.decode("latin-1", errors="replace"))
    elif mode == "socks5":
        sock.sendall(b"\x05\x01\x00")
        if sock.recv(2) != b"\x05\x00":
            raise SystemExit("SOCKS5 authentication negotiation failed")
        encoded_host = host.encode("idna")
        sock.sendall(b"\x05\x01\x00\x03" + bytes([len(encoded_host)]) + encoded_host + port.to_bytes(2, "big"))
        response = sock.recv(4)
        if len(response) != 4 or response[1] != 0:
            raise SystemExit("SOCKS5 CONNECT failed")
        address_type = response[3]
        if address_type == 1:
            remainder = 4 + 2
        elif address_type == 4:
            remainder = 16 + 2
        elif address_type == 3:
            remainder = 1 + sock.recv(1)[0] + 2
        else:
            raise SystemExit("Unknown SOCKS5 address type")
        while remainder:
            chunk = sock.recv(remainder)
            if not chunk:
                raise SystemExit("SOCKS5 proxy closed during CONNECT")
            remainder -= len(chunk)
    else:
        raise SystemExit("proxy mode must be http or socks5")
    sock.settimeout(None)
    writer = threading.Thread(target=copy_stdin, args=(sock,), daemon=True)
    writer.start()
    if pending:
        os.write(sys.stdout.fileno(), pending)
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        os.write(sys.stdout.fileno(), chunk)


if __name__ == "__main__":
    main()
