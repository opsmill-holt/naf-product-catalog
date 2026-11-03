"""Create the Infrahub service account that the catalog web service uses.

Run once per Infrahub instance, with an administrator token:

    INFRAHUB_ADDRESS=http://localhost:8100 INFRAHUB_ADMIN_TOKEN=... uv run python bootstrap_service_account.py

It creates or updates the role "Catalog submitter", the group "Catalog web service" and the account
"catalog-web", sets a new random password, and prints a new API token for the account. Put the
token in frontend/api/.env as INFRAHUB_API_TOKEN. Nothing is written to disk.

The role includes global:edit_default_branch because Infrahub 1.11 needs it to open a proposed
change. With it, the account can also merge its own proposed changes (spec FR-020), so the service
must not be reachable from the internet until that is fixed.
"""

import asyncio
import os
import secrets

import httpx
from infrahub_sdk import Config, InfrahubClient

ACCOUNT = "catalog-web"
ROLE = "Catalog submitter"
GROUP = "Catalog web service"

# Decision values used by Infrahub permissions.
DENY, ALLOW_OTHER, ALLOW_ALL = 1, 4, 6

OBJECT_PERMISSIONS = [
    ("Catalog", "*", "view", ALLOW_ALL),
    ("Catalog", "*", "create", ALLOW_OTHER),
    # The stack review (catalog_web/analysis.py) writes its answer to the stack record after creating it.
    ("Catalog", "AutomationStack", "update", ALLOW_OTHER),
    ("Core", "ProposedChange", "create", ALLOW_ALL),
    ("Core", "ProposedChange", "view", ALLOW_ALL),
]
GLOBAL_PERMISSIONS = [("edit_default_branch", ALLOW_ALL)]


async def main() -> None:
    address = os.environ.get("INFRAHUB_ADDRESS", "http://localhost:8100")
    admin = InfrahubClient(config=Config(address=address, api_token=os.environ["INFRAHUB_ADMIN_TOKEN"]))

    permissions = []
    for namespace, name, action, decision in OBJECT_PERMISSIONS:
        permission = await admin.create(
            "CoreObjectPermission", namespace=namespace, name=name, action=action, decision=decision
        )
        await permission.save(allow_upsert=True)
        permissions.append(permission)
    for action, decision in GLOBAL_PERMISSIONS:
        permission = await admin.create("CoreGlobalPermission", action=action, decision=decision)
        await permission.save(allow_upsert=True)
        permissions.append(permission)

    role = await admin.create("CoreAccountRole", name=ROLE, permissions=permissions)
    await role.save(allow_upsert=True)

    password = secrets.token_urlsafe(32)
    account = await admin.create("CoreAccount", name=ACCOUNT, password=password, account_type="User")
    await account.save(allow_upsert=True)

    group = await admin.create("CoreAccountGroup", name=GROUP, roles=[role], members=[account])
    await group.save(allow_upsert=True)

    async with httpx.AsyncClient(base_url=address) as http:
        login = await http.post("/api/auth/login", json={"username": ACCOUNT, "password": password})
        login.raise_for_status()
        response = await http.post(
            "/graphql/main",
            headers={"Authorization": f"Bearer {login.json()['access_token']}"},
            json={"query": 'mutation { InfrahubAccountTokenCreate(data: {name: "catalog-web-service"}) '
                  "{ object { token { value } } } }"},
        )
        response.raise_for_status()
        token = response.json()["data"]["InfrahubAccountTokenCreate"]["object"]["token"]["value"]

    print(f"Account {ACCOUNT} is ready. Put this in frontend/api/.env (it is not shown again):")
    print(f"INFRAHUB_API_TOKEN={token}")


if __name__ == "__main__":
    asyncio.run(main())
