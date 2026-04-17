---
name: slurm
description: Manage Slurm cluster jobs - submit (sbatch), monitor (squeue), cancel (scancel), check nodes (sinfo), and view logs. Cluster-agnostic.
disable-model-invocation: true
argument-hint: "[submit|status|cancel|nodes|logs|cpu|unblock] [args...]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Bash(sbatch *)
  - Bash(squeue *)
  - Bash(scancel *)
  - Bash(scontrol show *)
  - Bash(scontrol hold *)
  - Bash(scontrol release *)
  - Bash(sprio *)
  - Bash(sshare *)
  - Bash(sinfo *)
  - Bash(sacctmgr show *)
  - Bash(cat *)
  - Bash(tail *)
  - Bash(head *)
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(mktemp *)
  - "Bash(rm /tmp/slurm_job_*)"
  - Bash(cp *)
  - Bash(chmod *)
---

# Slurm Job Manager (General)

You manage Slurm cluster jobs. Parse `$ARGUMENTS` to determine which action to perform. This skill contains generic Slurm knowledge only — it has no cluster-specific partitions, accounts, GPU types, or node names baked in. If the project provides a cluster-specific overlay skill with partition configs, prefer those; otherwise gather parameters from the user.

## Action Routing

- **"submit" / "run" / "launch"** or a description of a job to run --> [Submit Job](#submit-job)
- **"status" / "monitor" / "queue" / "jobs"** --> [Monitor Jobs](#monitor-jobs)
- **"cancel" / "kill" / "stop"** --> [Cancel Jobs](#cancel-jobs)
- **"nodes" / "node status" / "resources" / "available"** --> [Node Status](#node-status)
- **"logs" / "output" / "errors" / "tail"** --> [View Logs](#view-logs)
- **"cpu" / "constraint" / "features" / "architecture" / "prefer"** --> [CPU & Feature Constraints](#cpu--feature-constraints)
- **"unblock" / "stuck" / "won't backfill" / "priority=1" / "accruetime unknown"** --> [Unblock Backfill](#unblock-backfill)
- Otherwise --> ask the user to clarify what they want to do

---

## Submit Job

### Step 1: Gather parameters

From the user's request, determine:

| Parameter | Required | Default |
|-----------|----------|---------|
| Partition (`--partition`) | Yes | Ask if not specified |
| Account (`--account`) | Cluster-dependent | Ask if the cluster requires it |
| Time limit (`--time`) | Yes | Ask — Slurm rejects jobs without one on most clusters |
| Number of GPUs (`--gres=gpu:N`) | If GPU job | 1 |
| GPU type/constraint | No | None; use `--constraint=<gpu_feature>` if targeting a specific model |
| CPUs per GPU / per task | No | 4 (GPU) or 1 (CPU) |
| Memory (`--mem-per-gpu` or `--mem`) | No | Ask if unsure |
| Job name | No | Derive from the command |
| Conda env / module / venv activation | No | Ask if the user expects one |
| Working directory | No | Current directory |
| Command to run | Yes | Ask if not specified |
| Extra env exports | No | None |
| Requeue (`--requeue`) | No | Only if the partition is preemptable |

If any required parameter is missing, ask the user. Use `sinfo` / `sacctmgr show assoc user=$USER` to discover what partitions and accounts are available on this cluster if the user is unsure.

### Step 2: Build the sbatch script

Generate this sbatch script, filling in the values from Step 1:

```bash
#!/bin/bash
#SBATCH --job-name=<JOB_NAME>
#SBATCH --output=logs/%j_%x.out
#SBATCH --error=logs/%j_%x.err
#SBATCH --partition=<PARTITION>
#SBATCH --time=<TIME>
#SBATCH --nodes=1
# --- GPU directives (omit if CPU-only) ---
#SBATCH --gres=gpu:<N_GPUS>
#SBATCH --cpus-per-gpu=<CPUS_PER_GPU>
#SBATCH --mem-per-gpu=<MEM_PER_GPU>
# --- CPU-only alternative ---
# #SBATCH --cpus-per-task=<N_CPUS>
# #SBATCH --mem=<MEM>
# --- Optional ---
# #SBATCH --account=<ACCOUNT>
# #SBATCH --constraint=<FEATURE>
# #SBATCH --requeue

# Clear stale AMD GPU visibility vars (harmless on NVIDIA nodes)
unset ROCR_VISIBLE_DEVICES
unset HIP_VISIBLE_DEVICES

# Activate environment (replace with `module load ...` or `source venv/bin/activate` if needed)
source ~/.bashrc && conda activate <CONDA_ENV>
set -x

<EXTRA_EXPORTS_IF_ANY>

cd <WORKING_DIR>

<USER_COMMAND>
```

### Step 3: Confirm and submit

1. Show the complete script to the user.
2. Ask: "Submit this job? (yes/no)".
3. On confirmation:
   - `mkdir -p logs` in the working directory.
   - Write the script to `/tmp/slurm_job_XXXXXX.sh` using `mktemp`.
   - Run `sbatch <tmpfile>`.
   - Parse the job ID from the output.
   - Copy the script to `logs/<job_id>_<job_name>.sbatch` for records.
   - Clean up the temp file.
   - Report: `Submitted <JOB_NAME> -> Job <JOB_ID>`.

---

## Monitor Jobs

- Default: `squeue -u $USER` — all your queued/running jobs.
- Specific job: `squeue -j <JOB_ID>` for a one-line view; `scontrol show job <JOB_ID>` for full detail (state, reason, priority, accrue time, start time estimate, node list).
- By partition: `squeue -p <PARTITION>`.
- Pending only with reason: `squeue -u $USER -t PENDING -o "%.10i %.12j %.8T %.10r %.10Q %b"`.

Format output clearly.

---

## Cancel Jobs

- **Specific job**: `scancel <JOB_ID>`, then `squeue -u $USER` to confirm.
- **All jobs**: show `squeue -u $USER` first, ask "Cancel ALL these jobs?", then `scancel -u $USER`.
- **By name**: `scancel --name=<JOB_NAME>`.
- **By partition**: `scancel -u $USER -p <PARTITION>`.
- **By state**: `scancel -u $USER -t PENDING` (only cancel pending, keep running).

Always confirm by running `squeue -u $USER` after.

---

## Node Status

- Partition summary: `sinfo -o "%P %a %l %D %t %N"` — partition, availability, time limit, node count, state, nodelist.
- Per-node with GPUs/CPUs/memory: `sinfo -N -o "%N %P %G %C %m %t"` — node, partition, generic resources (GPU), CPUs (alloc/idle/other/total), memory, state.
- Idle nodes with GPUs: `sinfo -t idle -o "%N %P %G"`.
- Features (constraint flags) per node: `sinfo -o "%N %f"`.
- Full detail for one node: `scontrol show node <NODE_NAME>`.

When summarizing, highlight which partitions have idle GPUs and the total vs available resources by GPU type (read GPU type from the Gres column or `--constraint` features).

---

## View Logs

- **By job ID**: find `logs/<JOB_ID>*.out` and `logs/<JOB_ID>*.err`.
- **Latest**: `ls -t logs/*.out | head -1`.
- **Default**: show the last 100 lines of stdout via `tail -100`.
- Offer to show stderr (`.err`) if the user is debugging errors.
- Live tail of a running job: `tail -f logs/<JOB_ID>*.out`.

---

## CPU & Feature Constraints

Read and present `${CLAUDE_SKILL_DIR}/cpu-groups.md`. It covers:

- `--constraint` and `--prefer` syntax (`&` for AND, `|` for OR).
- Common CPU ISA feature names (AVX, AVX2, AVX-512, EPYC generations).
- How to discover this cluster's actual feature names (`sinfo -o "%N %f"`).

If the user asks which constraint to use, first check which features exist on this cluster (`sinfo -o "%N %f" | sort -u -k2`), then help them pick based on their needs.

---

## Unblock Backfill

Read and follow `${CLAUDE_SKILL_DIR}/unblock-backfill.md`.

This handles the scenario where a low-priority pending job is stuck at `Priority=1` with `AccrueTime=Unknown` because the user's own higher-priority jobs in the same partition are consuming the single per-user-per-partition backfill/accrue slot. The fix is to temporarily `scontrol hold` the blocker jobs until the starved job starts, then `scontrol release` them.

Before applying the hold, confirm:

1. The starved job shows `Reason=Priority`, `Priority=1`, and `AccrueTime=Unknown` (via `scontrol show job`).
2. The user has pending jobs in the same partition with much higher priority.
3. The cluster actually has the per-user backfill/accrue limit (check `scontrol show config | grep -iE "bf_max_job_user|SchedulerParameters"` and `sacctmgr show qos format=Name,MaxJobsAccruePU`).
4. No alternative partition is available for either job.

Then follow the Procedure section of that file. After holding, wait at least `PriorityCalcPeriod + bf_interval` (typically ~90s) and re-check `scontrol show job <starved_id>` — success is `JobState=RUNNING` or `AccrueTime=<timestamp>`. Always remind the user to `scontrol release` the held jobs once the starved job is running.
