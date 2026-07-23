#!/usr/bin/env python3

# /// script
# dependencies = ["pydantic==2.12.5", "requests>=2.31,<3"]
# ///

"""Download skill tarballs (presigned URLs) into TFY_SKILLS_DIR (default /opt/tfy/skills).

Required env (only when there are skills to download): TFY_HOST, TFY_API_KEY (caller bearer).
Optional env: TFY_AGENT_NAME, AGENT_SKILL_VERSION_FQNS (comma-separated; empty clears downloads).
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tarfile
import tempfile
from io import BytesIO
from pathlib import Path

import requests
from pydantic import BaseModel, ConfigDict, Field, ValidationError

DEFAULT_SKILLS_DIR = "/opt/tfy/skills"
STATE_FILE_NAME = ".tfy-skill-downloader-state.json"
DOWNLOAD_TIMEOUT_SECONDS = 30
PRESIGNED_URL_PATH = "/api/svc/v1/llm-gateway/agent-skill-versions/presigned-urls"
SKILLS_ROOT = Path(os.environ.get("TFY_SKILLS_DIR", DEFAULT_SKILLS_DIR))
STATE_PATH = SKILLS_ROOT / STATE_FILE_NAME


class AgentSkill(BaseModel):
    model_config = ConfigDict(extra="ignore")

    fqn: str
    name: str


class SkillDownloaderState(BaseModel):
    """Persisted next to skills: {\"downloaded_fqns\": [{\"fqn\": \"agent_skill:...\"]}."""

    model_config = ConfigDict(extra="ignore")

    downloaded_fqns: list[AgentSkill] = Field(
        default_factory=list,
        description="Skills successfully downloaded (fqn + name).",
    )


class PresignedUrlsRequestItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fqn: str


class PresignedUrlsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    data: list[PresignedUrlsRequestItem]
    agent_name: str | None = Field(default=None, alias="agentName")


class AgentSkillPresignedRow(AgentSkill):
    model_config = ConfigDict(extra="ignore")

    presigned_url: str


class PresignedUrlsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data: list[AgentSkillPresignedRow]


class ReconcilePartitionResult(BaseModel):
    """Pending downloads, skipped (already satisfied), and FQNs pruned from state."""

    model_config = ConfigDict(extra="forbid")

    pending_fqns: list[str] = Field(
        default_factory=list,
        description="FQNs to download this run.",
    )
    skipped_fqns: list[str] = Field(
        default_factory=list,
        description="FQNs already satisfied (state or on-disk); skipped.",
    )
    removed_fqns: list[str] = Field(
        default_factory=list,
        description="FQNs dropped from desired; removed from state and disk.",
    )


def skills_from_env(raw: str | None) -> list[str]:
    """Empty or missing env means “no desired skills” (prune all downloaded)."""
    if raw is None or not str(raw).strip():
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def load_state() -> SkillDownloaderState:
    if not STATE_PATH.is_file():
        return SkillDownloaderState()
    try:
        return SkillDownloaderState.model_validate_json(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValidationError) as e:
        return SkillDownloaderState()


def save_state(state: SkillDownloaderState) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_name(STATE_PATH.name + ".tmp")
    tmp.write_text(state.model_dump_json(indent=2), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def _mark_downloaded(state: SkillDownloaderState, skill: AgentSkill) -> None:
    if any(x.fqn == skill.fqn for x in state.downloaded_fqns):
        return
    state.downloaded_fqns.append(skill)


def _rmtree(path: Path, ignore_errors: bool = True) -> None:
    try:
        shutil.rmtree(path, ignore_errors=ignore_errors)
    except OSError:
        pass


def _delete_skill_dir(skill: AgentSkill) -> None:
    dir_ = SKILLS_ROOT / skill.name
    if not dir_.is_dir():
        return
    try:
        shutil.rmtree(dir_)
    except OSError as e:
        sys.exit(f"Could not remove skill directory {dir_} ({skill.fqn}): {e}")


def reconcile_and_partition(
    skills_fqns: list[str],  # list of FQNs
    state: SkillDownloaderState,
    have_downloaded_skills: bool,
) -> ReconcilePartitionResult:
    """Drop skills no longer desired (state + dirs), then pending vs skipped; persist state."""
    requested_fqns = set(skills_fqns)
    pending_fqns: list[str] = []
    skipped_fqns: list[str] = []
    removed = [x for x in state.downloaded_fqns if x.fqn not in requested_fqns]
    removed_fqns = [x.fqn for x in removed]
    if removed:
        for x in removed:
            _delete_skill_dir(x)
        state.downloaded_fqns = [x for x in state.downloaded_fqns if x.fqn in requested_fqns]

    if not have_downloaded_skills:
        pending_fqns = list(skills_fqns)
    else:
        already_downloaded = {x.fqn for x in state.downloaded_fqns}
        for skill_fqn in requested_fqns:
            if skill_fqn in already_downloaded:
                skipped_fqns.append(skill_fqn)
            else:
                pending_fqns.append(skill_fqn)

    save_state(state)
    return ReconcilePartitionResult(
        pending_fqns=pending_fqns,
        skipped_fqns=skipped_fqns,
        removed_fqns=removed_fqns,
    )


def request_presigned_rows(
    control_plane_url: str,
    token: str,
    agent_name: str | None,
    fqns: list[str],
) -> list[AgentSkillPresignedRow]:
    url = f"{control_plane_url.rstrip('/')}{PRESIGNED_URL_PATH}"
    req = PresignedUrlsRequest(
        data=[PresignedUrlsRequestItem(fqn=fqn) for fqn in fqns],
        agent_name=agent_name,
    )
    try:
        resp = requests.post(
            url,
            json=req.model_dump(by_alias=True, exclude_none=True),
            headers={"Authorization": f"Bearer {token}"},
            timeout=120,
        )
    except requests.RequestException as e:
        sys.exit(f"POST {url} failed: {e}")
    if resp.status_code >= 400:
        try:
            err = resp.json()
            detail = err.get("message", resp.text)
            if code := err.get("error_code"):
                detail = f"{code}: {detail}"
        except (json.JSONDecodeError, ValueError):
            detail = resp.text
        sys.exit(f"POST {url} failed HTTP {resp.status_code}\n{detail}")
    try:
        payload = resp.json()
    except json.JSONDecodeError as e:
        sys.exit(f"POST {url}: invalid JSON in response: {e}")
    try:
        rows = PresignedUrlsResponse.model_validate(payload).data
    except ValidationError as e:
        sys.exit(f"Invalid API response: {e}")

    returned_fqns = {r.fqn for r in rows}
    if miss := [f for f in fqns if f not in returned_fqns]:
        sys.exit(f"API did not return these FQNs: {miss}")
    return rows


def download_skill(skill_name: str, presigned_url: str, dest: Path) -> None:
    try:
        r = requests.get(presigned_url, timeout=DOWNLOAD_TIMEOUT_SECONDS)
        r.raise_for_status()
        raw = r.content
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        sys.exit(f"Download HTTP {code} for skill {skill_name}")
    except requests.RequestException as e:
        sys.exit(f"Download failed for skill {skill_name}: {e}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".skill-dl-",
        dir=os.fspath(dest.parent),
        ignore_cleanup_errors=True,
    ) as tmp_str:
        tmp_dir = Path(tmp_str)
        try:
            tf = tarfile.open(fileobj=BytesIO(raw), mode="r:*")
        except (tarfile.TarError, OSError, EOFError):
            sys.exit(f"Skill {skill_name}: not a tar archive")
        try:
            with tf:
                tf.extractall(tmp_dir, filter="data")
        except tarfile.TarError as e:
            sys.exit(f"Skill {skill_name}: tar extraction refused or failed ({e})")
        except OSError as e:
            sys.exit(f"Skill {skill_name}: failed to read archive: {e}")

        try:
            if dest.exists():
                shutil.rmtree(dest)
            shutil.move(str(tmp_dir), str(dest))
        except OSError as e:
            _rmtree(dest)
            sys.exit(f"Failed to write downloaded skill {skill_name}: {e}")


def run_download() -> None:
    skills_fqns = skills_from_env(os.environ.get("AGENT_SKILL_VERSION_FQNS"))
    state = load_state()
    have_downloaded_skills = bool(state.downloaded_fqns)

    part = reconcile_and_partition(
        skills_fqns, state, have_downloaded_skills=have_downloaded_skills
    )
    if not part.pending_fqns:
        if part.removed_fqns:
            n = len(part.removed_fqns)
            print(
                f"Removed {n} skill(s) from state and disk."
                + ("" if skills_fqns else " (AGENT_SKILL_VERSION_FQNS empty.)")
            )
        elif not skills_fqns:
            print("AGENT_SKILL_VERSION_FQNS empty; nothing downloaded.")
        else:
            print("Nothing to download; all listed skills already downloaded.")
        return

    # Credentials are only needed when there is actually something to download,
    # so runtimes with no skills configured (e.g. the public server) can init
    # the sandbox without a control plane.
    control_plane_url = os.environ.get("TFY_HOST")
    if not control_plane_url:
        sys.exit("Set TFY_HOST to the control plane base URL.")
    token = os.environ.get("TFY_API_KEY")
    if not token:
        sys.exit("Set TFY_API_KEY.")
    agent_name = os.environ.get("TFY_AGENT_NAME")

    rows = request_presigned_rows(
        control_plane_url, token, agent_name, part.pending_fqns
    )
    for row in rows:
        download_skill(row.name, row.presigned_url, SKILLS_ROOT / row.name)
        _mark_downloaded(state, AgentSkill(fqn=row.fqn, name=row.name))
    save_state(state)

    print(f"Downloaded {len(rows)} skill(s).")


def main() -> None:
    run_download()


if __name__ == "__main__":
    main()
