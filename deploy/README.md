# Beta deployment on an OVHcloud VPS

One virtual machine runs the whole catalog with Docker Compose:
- Infrahub 1.12.1, from the unchanged `docker-compose.yml` in the repository root;
- the catalog service (`frontend/api/Dockerfile`);
- Caddy, which serves the built web app (`frontend/web/Dockerfile`), forwards `/api` to the
  catalog service and gets HTTPS certificates from Let's Encrypt.

Only Caddy is reachable from the internet (`deploy/docker-compose.beta.yml`):

| Address | Who can open it |
|---------|-----------------|
| `https://<ip-with-dashes>.sslip.io` | Anyone. No login. |
| `https://infrahub.<ip-with-dashes>.sslip.io` | Maintainers, with Infrahub's login. Anonymous access is turned off. |

## Open problems

The web app is open to anyone, by the user's decision on 2026-10-22. These items from
`frontend/README.md` are only partly addressed:
1. Spam protection on `POST /api/submissions` (spec 005, FR-019). The catalog service accepts at
   most 5 submissions per visitor address and 50 in total in any hour
   (`SUBMISSIONS_PER_ADDRESS_PER_HOUR` and `SUBMISSIONS_PER_HOUR` in `deploy/.env`). There is no
   human verification, and the counts are kept in memory, so a restart clears them.
2. The service account can merge its own proposed changes (spec 005, FR-020). Not addressed. The
   public service only creates proposed changes; the risk applies if its token is exposed.

`deploy/setup-vm.sh` replaces Infrahub's published default passwords, tokens and secret key.

## Values used below

| Value | Default |
|-------|---------|
| Provider | OVHcloud VPS, ordered from <https://us.ovhcloud.com/vps/> |
| Location | Vint Hill, Virginia (US East). Hillsboro, Oregon (US West) also works. |
| Machine | VPS-3: 6 vCores, 12 GB, 100 GB NVMe disk, Debian 12. The local stack uses about 7 GB. VPS-4 has 8 vCores and 24 GB. |
| Task workers | 1 (see "Checks stuck in progress") |

## 1. Order the machine (in the OVHcloud Control Panel)

Order a VPS-3 in Vint Hill with the Debian 12 image. The order includes one IPv4 address that stays
with the machine. OVHcloud emails a link to the password of the `debian` user.

Connect once with that password, then copy your SSH key to the machine and connect with the key from
then on:

```bash
ssh debian@<machine IPv4 address>
ssh-copy-id debian@<machine IPv4 address>
```

A VPS is not a Spot VM, which the provider can stop at any time. Every container starts again on its
own when the machine restarts.

Only Caddy publishes ports (80 and 443, `deploy/docker-compose.beta.yml`). SSH listens on port 22.

## 2. Start the stack (on the machine)

To move an existing deployment with its data, follow "Moving the deployment to another machine"
instead of this step and steps 3 to 5.

```bash
ssh debian@<machine IPv4 address>
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/opsmill-holt/naf-product-catalog.git /opt/catalog
cd /opt/catalog
sudo deploy/setup-vm.sh <your email, for certificate notices>
```

The script installs Docker, writes `deploy/.env` with new Infrahub passwords and tokens, and starts
everything. The file is readable only by root, and Git ignores it. The first start takes several
minutes.

Read the values you need next:

```bash
sudo grep -E 'SITE_HOST|INFRAHUB_INITIAL_ADMIN_(PASSWORD|TOKEN)' deploy/.env
```

## 3. Load the schema (on your computer)

Point `infrahubctl` at the deployed Infrahub. `deploy/infrahubctl.beta.toml` is ignored by Git.

```bash
printf 'server_address = "https://infrahub.<SITE_HOST>"\n' > deploy/infrahubctl.beta.toml
export INFRAHUBCTL_CONFIG=deploy/infrahubctl.beta.toml
export INFRAHUB_API_TOKEN=<INFRAHUB_INITIAL_ADMIN_TOKEN from deploy/.env>
uv run infrahubctl info

uv run infrahubctl branch create load-schema
uv run infrahubctl schema load --branch load-schema schemas/
```

In Infrahub, open a proposed change from `load-schema` to `main` and merge it. No checks run yet,
because the repository is not connected.

## 4. Connect the repository and load the catalog (on your computer)

The repository's queries read the catalog schema, so the schema must be on `main` first.

```bash
uv run infrahubctl object load bootstrap/repository.yml
```

Infrahub imports the five checks, then shows the repository as `error-import`, because the coverage
report's target group (`catalog_reports`) is part of the catalog and is not loaded yet. Check that
the five checks exist (**Proposed changes > Check definitions**), then load the catalog on a branch:

```bash
uv run infrahubctl branch create load-catalog
uv run infrahubctl object load --branch load-catalog objects/
```

Infrahub 1.12 refuses to merge a branch while a required repository import has failed or is not
complete. These steps were written on 1.11.8, and this step has not been run on 1.12.1: if the merge
is refused because of the `error-import` status, the message names the repository.

Open a proposed change from `load-catalog` to `main`. Wait for the checks: all must pass, and
`catalog_coverage_check` lists the products with no coverage claim as warnings. Then merge it.

Run **Import latest commit** on the repository again. It now shows as in sync, and the coverage
report definition exists. Delete the `load-schema` and `load-catalog` branches.

## 5. Connect the catalog service (on your computer, then on the machine)

Create the service account on the deployed Infrahub:

```bash
cd frontend/api
INFRAHUB_TIMEOUT=300 INFRAHUB_ADDRESS=https://infrahub.<SITE_HOST> INFRAHUB_ADMIN_TOKEN=<admin token> \
  uv run python bootstrap_service_account.py
```

On the machine, put the printed token in `CATALOG_API_TOKEN` in `/opt/catalog/deploy/.env`, then
restart the service:

```bash
cd /opt/catalog
sudo nano deploy/.env
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env up -d catalog-api
```

The longer timeout is needed: with the default of 60 seconds, the script timed out against the
2 vCPU GCP machine used before. Running it again is safe.

## 6. Share the address

Send the group `https://<SITE_HOST>`. No login is needed.

## Updating

```bash
ssh debian@<machine IPv4 address>
cd /opt/catalog && sudo git pull && sudo deploy/setup-vm.sh <your email>
```

After a change to `checks/`, `queries/` or `.infrahub.yml`, also run **Import latest commit** on
the repository in the deployed Infrahub. Open proposed changes keep the checks of the commit their
branch was created from: rebase them to run the new checks.

### Updating to a new Infrahub version

When a change updates `docker-compose.yml` to a new Infrahub version, the database must be migrated
before the new version starts. Infrahub requires each minor version in turn: 1.11 before 1.12.
Read the release notes of the new version first.

```bash
ssh debian@<machine IPv4 address>
cd /opt/catalog && sudo git pull
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env down
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env run --rm infrahub-server infrahub upgrade
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env run --rm infrahub-server infrahub db showmigrations
sudo deploy/setup-vm.sh <your email>
```

`infrahub upgrade` ends with `Upgrade complete SUCCESS`. In the output of `showmigrations`, every
migration is marked `[X]`, and the database version is the target version. The upgrade lists the
branches that need a rebase, for example `submission-*` branches with open proposed changes: rebase
each one from its proposed change before merging it. Running `infrahub upgrade` on a database that
is already up to date changes nothing.

Before the 1.12.1 upgrade of the beta, the local instance was upgraded from 1.11.8 on 2026-11-12. The
upgrade applied its migrations, and the six catalog checks passed in a proposed change. The upgrade
listed four `submission-*` branches for a rebase.

## Switching on the stack review

The catalog service can run the `stack-review` skill on each submitted stack and show the answer to
the visitor (see `specs/005-catalog-web-app/contracts/api.md`). It is off until an Anthropic API key
is set.

1. In the Anthropic Console, create an API key, ideally in a workspace with a monthly spend limit:
   anyone can submit a stack without a login, and each review is a paid model call (at most 0.50 USD,
   within the submission limits below).
2. On the machine, add it to `deploy/.env` and restart the service:

   ```bash
   cd /opt/catalog
   sudo nano deploy/.env   # ANTHROPIC_API_KEY=sk-ant-...
   sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env up -d catalog-api
   ```

Settings in `deploy/.env`:

- `STACK_ANALYSIS_MODEL`: the model, default `claude-sonnet-5-5`.
- `STACK_ANALYSIS_EFFORT`: how much it thinks, `low`, `medium` or `high`; default `high`.
- `STACK_ANALYSIS_RUNNER`: `direct` (default) sends the skill's instructions in one request to the
  Claude API; `sdk` runs them as a skill through the Claude Agent SDK.

The service writes the review's "Coverage and gaps" section itself; the model writes the rest. A
review is stopped after 150 seconds. Compared on four stacks (2026-11-06), the direct call with
Sonnet 5.5 at high effort kept to the skill's rules for 0.02 to 0.035 USD and under 20 seconds a
review, against about 0.11 USD and 60 seconds through the Agent SDK with Sonnet 5 at medium effort.
At medium effort Sonnet 5.5 missed a workflow that high effort found; Haiku 5.5 cost about 0.003 USD
but called workflows ready without evidence. To change the skill, edit
`frontend/api/skill_home/.claude/skills/stack-review/SKILL.md`, push, and deploy as above.
Remove the key to switch the review off.

## Changing the submission limits

Set `SUBMISSIONS_PER_ADDRESS_PER_HOUR` and `SUBMISSIONS_PER_HOUR` in `deploy/.env`, then restart
the service:

```bash
cd /opt/catalog
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env up -d catalog-api
```

## Checks stuck "in progress"

On Infrahub 1.11.8, a task worker that has no copy of the repository cannot run its checks: it
looks the repository up as a `CoreRepository` and fails with `NodeNotFoundError`. The deployment
runs one worker with its copy on the `git_data` volume, and **Import latest commit** makes the copy.
If the volume is ever deleted, run **Import latest commit** once, then **Retry** the checks.

On Infrahub 1.12.1, the local instance ran all six checks of a proposed change with two task
workers and no saved copy of the repository (2026-11-12). The deployment still runs one worker; this
has not been changed or tested on the beta.

## Checks that time out

On the 2 vCPU GCP machine used before, with one worker, the checks of a proposed change ran
together and shared the SDK's request rate limit. A check that waits longer than 60 seconds is
stopped (`TaskRunTimeoutError`). On Infrahub 1.11.8, Infrahub kept showing it as "in progress";
Infrahub 1.11.10 fixed checks that stayed in progress after a run failed or timed out. This is not a
finding about the data. Rerun the checks from the proposed change (**Retry**, or the GraphQL mutation
`CoreProposedChangeRunCheck` with `check_type: USER`); on 2026-10-29 the rerun passed each time.

## Moving the deployment to another machine

These steps move the deployment, with its data, from the GCP machine `catalog-beta` to a new
machine. The data is Infrahub's database (including open proposed changes from submissions), its
file storage, its task history and its copy of the repository. The passwords and tokens in
`deploy/.env` move with it, so the admin password, the admin token and the catalog service's token
stay the same.

The site address changes, because it is built from the machine's IP address. Send the group the
new address afterwards.

1. On the old machine, update the repository and export the data. The export stops the stack, so
   the site is down from here on. A Spot VM may have been stopped by Google: start it first.

   ```bash
   gcloud compute instances start catalog-beta
   gcloud compute ssh catalog-beta
   cd /opt/catalog && sudo git pull
   sudo deploy/export-data.sh /tmp/catalog-data.tar
   sudo chown "$USER" /tmp/catalog-data.tar
   ```

2. On your computer, copy the archive from the old machine to the new one, then delete your copy.
   The archive holds the secrets of `deploy/.env`:

   ```bash
   gcloud compute scp catalog-beta:/tmp/catalog-data.tar .
   scp catalog-data.tar debian@<machine IPv4 address>:/tmp/
   rm catalog-data.tar
   ```

3. On the new machine, after step 1 of this README, install Docker without starting the stack,
   import the data, migrate it to the Infrahub version of `docker-compose.yml`, then start the
   stack. When both machines run the same version, the migration changes nothing. When the new
   version is higher, read "Updating to a new Infrahub version" first, including the rebase of
   `submission-*` branches:

   ```bash
   ssh debian@<machine IPv4 address>
   sudo apt-get update && sudo apt-get install -y git
   sudo git clone https://github.com/opsmill-holt/naf-product-catalog.git /opt/catalog
   cd /opt/catalog
   sudo deploy/setup-vm.sh --no-start <your email, for certificate notices>
   sudo deploy/import-data.sh /tmp/catalog-data.tar
   sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml --env-file deploy/.env run --rm infrahub-server infrahub upgrade
   sudo deploy/setup-vm.sh <your email, for certificate notices>
   rm /tmp/catalog-data.tar
   ```

4. Check the new address: the web app lists the catalog, and Infrahub accepts the old admin
   password. In Infrahub, run **Import latest commit** on the repository. Point
   `deploy/infrahubctl.beta.toml` on your computer at the new Infrahub address.

5. When the new machine works, delete the old machine, its disk and its static address:

   ```bash
   gcloud compute instances delete catalog-beta
   gcloud compute addresses delete catalog-beta-ip --region us-central1
   gcloud compute firewall-rules delete catalog-beta-web
   ```

   Until then, the old machine can be started again with
   `gcloud compute instances start catalog-beta` and
   `cd /opt/catalog && sudo deploy/setup-vm.sh <your email>`.

## If the HTTPS certificate is not issued

Caddy logs the reason: `sudo docker compose -f docker-compose.yml -f deploy/docker-compose.beta.yml
--env-file deploy/.env logs web`. Ports 80 and 443 must be open (step 1), and Let's Encrypt limits
how many certificates it issues for one name each week.
