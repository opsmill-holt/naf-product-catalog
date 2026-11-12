# Beta deployment on GCP

One Compute Engine virtual machine runs the whole catalog with Docker Compose:
- Infrahub 1.11.8, from the unchanged `docker-compose.yml` in the repository root;
- the catalog service (`frontend/api/Dockerfile`);
- Caddy, which serves the built web app (`frontend/web/Dockerfile`), forwards `/api` to the
  catalog service and gets HTTPS certificates from Let's Encrypt.

Only Caddy is reachable from the internet (`deploy/docker-compose.gcp.yml`):

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
| Project | `naf-product-catalog` |
| Region and zone | `us-central1`, `us-central1-a` |
| Machine | `e2-highmem-2` (2 vCPU, 16 GB) as a Spot VM. The local stack uses about 7 GB. |
| Task workers | 1 (see "Checks stuck in progress") |
| Disk | 50 GB, Debian 12 |

## 1. Create the machine (on your computer)

Install the Google Cloud CLI and sign in once:

```bash
brew install --cask google-cloud-sdk
gcloud auth login
gcloud config set project naf-product-catalog
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

Create the static address, the firewall rule for HTTP and HTTPS, and the machine:

```bash
gcloud services enable compute.googleapis.com
gcloud compute addresses create catalog-beta-ip --region us-central1
gcloud compute firewall-rules create catalog-beta-web \
  --allow tcp:80,tcp:443,udp:443 --target-tags catalog-beta-web
gcloud compute instances create catalog-beta \
  --machine-type e2-highmem-2 \
  --provisioning-model SPOT --instance-termination-action STOP \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 50GB --boot-disk-type pd-balanced \
  --address catalog-beta-ip --tags catalog-beta-web
```

SSH uses the `default-allow-ssh` rule of the default network.

A Spot VM costs less, but Google can stop it at any time. The disk, the data and the static
address are kept, and every container starts again on its own when the machine starts. Google does
not start the machine again by itself. To start it:

```bash
gcloud compute instances start catalog-beta
```

To check whether it is running: `gcloud compute instances describe catalog-beta --format='value(status)'`.

## 2. Start the stack (on the machine)

```bash
gcloud compute ssh catalog-beta
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
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.gcp.yml --env-file deploy/.env up -d catalog-api
```

The longer timeout is needed: with the default of 60 seconds, the script timed out against the
2 vCPU machine. Running it again is safe.

## 6. Share the address

Send the group `https://<SITE_HOST>`. No login is needed.

## Updating

```bash
gcloud compute ssh catalog-beta
cd /opt/catalog && sudo git pull && sudo deploy/setup-vm.sh <your email>
```

After a change to `checks/`, `queries/` or `.infrahub.yml`, also run **Import latest commit** on
the repository in the deployed Infrahub. Open proposed changes keep the checks of the commit their
branch was created from: rebase them to run the new checks.

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
   sudo docker compose -f docker-compose.yml -f deploy/docker-compose.gcp.yml --env-file deploy/.env up -d catalog-api
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
sudo docker compose -f docker-compose.yml -f deploy/docker-compose.gcp.yml --env-file deploy/.env up -d catalog-api
```

## Checks stuck "in progress"

On Infrahub 1.11.8, a task worker that has no copy of the repository cannot run its checks: it
looks the repository up as a `CoreRepository` and fails with `NodeNotFoundError`. The deployment
runs one worker with its copy on the `git_data` volume, and **Import latest commit** makes the copy.
If the volume is ever deleted, run **Import latest commit** once, then **Retry** the checks.

## Checks that time out

On the 2 vCPU machine with one worker, the checks of a proposed change run together and share the
SDK's request rate limit. A check that waits longer than 60 seconds is stopped
(`TaskRunTimeoutError`), and Infrahub keeps showing it as "in progress". This is not a finding about
the data. Rerun the checks from the proposed change (**Retry**, or the GraphQL mutation
`CoreProposedChangeRunCheck` with `check_type: USER`); on 2026-10-29 the rerun passed each time.

## If the HTTPS certificate is not issued

Caddy logs the reason: `sudo docker compose -f docker-compose.yml -f deploy/docker-compose.gcp.yml
--env-file deploy/.env logs web`. Ports 80 and 443 must be open (step 1), and Let's Encrypt limits
how many certificates it issues for one name each week.
