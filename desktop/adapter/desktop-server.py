"""Run Satellite Hunter on an ephemeral local port using the shipped runtime."""

import socket
import sys
import threading

import uvicorn

from app.main import app


def watch_parent(server):
    """The Desktop process owns the only writer for this pipe."""
    try:
        sys.stdin.buffer.read(1)
    finally:
        server.should_exit = True


def main():
    server = uvicorn.Server(uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        proxy_headers=False,
        access_log=False,
        timeout_graceful_shutdown=2,
    ))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind(("127.0.0.1", 0))
        print(f"SATELLITE_BACKEND_PORT={listener.getsockname()[1]}", flush=True)
        threading.Thread(target=watch_parent, args=(server,), daemon=True).start()
        server.run(sockets=[listener])


if __name__ == "__main__":
    main()
