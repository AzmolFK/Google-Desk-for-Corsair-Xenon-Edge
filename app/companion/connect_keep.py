"""Run interactively by the owner. Never print or log account tokens."""
from getpass import getpass
from pathlib import Path
import socket
import sys
from secure_store import SecureStore


def main():
    check = socket.socket()
    try:
        check.bind(("127.0.0.1", 8765))
    except OSError:
        print("Close Google Desk before connecting Keep. Port 8765 is still in use.")
        return
    finally:
        check.close()
    print("Experimental Google Keep connection (unofficial gkeepapi).")
    print("This is separate from Gmail/Calendar OAuth. A master token has broad account access.")
    print("Only continue with a token you obtained for your own account. Never paste tokens into chat.")
    print("Close the Google Desk companion before continuing.")
    print("Documentation: https://gkeepapi.readthedocs.io/en/latest/#authenticating")
    if input("Type CONNECT to continue, or press Enter to cancel: ").strip() != "CONNECT":
        return
    import gkeepapi
    email = input("Google account email: ").strip()
    token = getpass("Existing Google Keep master token (hidden): ").strip()
    if not email or not token:
        print("Cancelled. Nothing was saved.")
        return
    try:
        client = gkeepapi.Keep()
        client.authenticate(email, token)
    except Exception:
        print("Keep rejected the connection. Nothing was saved. Check the library's authentication documentation.")
        return
    store = SecureStore(Path(__file__).resolve().parent.parent / "data" / "desk.bin")
    state = store.load()
    state.update(keep_email=email, keep_token=token)
    store.save(state)
    print("Keep connection saved using Windows DPAPI. Restart Google Desk, then select Keep in Notes.")


if __name__ == "__main__":
    main()
