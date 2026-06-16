"""
patch_permissions.py — Adds require_authenticated to backend/core/permissions.py

Usage:
    python patch_permissions.py
"""

path = "backend/core/permissions.py"

with open(path, "r") as f:
    content = f.read()

ADDITION = '''

# -- Authenticated-only dependency (no permission check) ----------------------

def require_authenticated(request: Request) -> dict:
    """
    FastAPI dependency -- requires a valid JWT token, but does not check
    role or permissions. Use for endpoints any logged-in employee can access.

    Returns the decoded token payload (contains 'sub' = employee ID).
    """
    from backend.core.security import verify_token

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth.split(" ", 1)[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token: missing subject")

    return payload
'''

if "def require_authenticated" not in content:
    content = content.rstrip() + "\n" + ADDITION
    with open(path, "w") as f:
        f.write(content)
    print("Added require_authenticated to permissions.py")
else:
    print("Already exists -- no change made")