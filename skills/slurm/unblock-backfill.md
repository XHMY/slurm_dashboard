# Unblock Backfill for Starved Jobs

When a low-priority pending job stays `PENDING` with `Reason=Priority` forever while you also have higher-priority jobs pending in the same partition, your own higher-priority jobs may be eating the per-user-per-partition backfill/accrue slot. Holding them temporarily lets the starved job claim it.

## When to use this

Symptoms, all present together:

- The starved job is pending with `Reason=Priority` and `Priority=1`.
- `scontrol show job <id>` shows `AccrueTime=Unknown` (it is not being aged).
- You have other pending jobs from the same user with much higher priority in the **same** partition.
- `sinfo` shows nodes matching the starved job's request are idle or underused (so it *could* run if the scheduler would consider it).

## Why it happens

Many clusters configure Slurm with per-user caps that limit how many of your jobs the backfill and accrue systems will consider at once. Two common knobs:

```
SchedulerParameters = ..., bf_max_job_user_part=1, ...
# Backfill evaluates only 1 job per user per partition per cycle.

QOS <name>: MaxJobsAccruePU=1
# Only 1 job per user (in this QOS) accrues age priority at a time.
```

When both are set to 1, Slurm picks your **highest-priority** pending job in the partition to fill both slots. If that high-priority job cannot currently be scheduled (e.g., it wants a busy GPU type), it still occupies the slots — and your lower-priority jobs never even get evaluated.

The priority weighting usually makes GPU jobs beat CPU-only jobs (a large positive TRES weight for `gres/gpu` combined with a negative per-CPU weight), so CPU jobs typically end up as the starved ones.

Check whether your cluster has these limits:

```bash
scontrol show config | grep -iE "SchedulerParameters|PriorityCalc|bf_"
sacctmgr show qos format=Name,MaxJobsAccruePU,MaxJobsPU
```

If neither `bf_max_job_user_part` nor `MaxJobsAccruePU` is set to a small number, the workaround below probably does not apply — look for a different cause (QOS limits, reservations, partition AllowAccounts, node features).

## Procedure

### Step 1. Identify which of your jobs are blocking

```bash
squeue -u $USER -p <PARTITION> -t PENDING \
  -o "%.10i %.8T %.8Q %b %.10r" | sort -k3 -nr
```

The high-priority rows at the top (often GPU jobs, shown via `TresPerNode=gres:gpu:...`) are the blockers. The `Priority=1` rows at the bottom are the starved jobs.

Confirm a starved job has the stuck state:

```bash
scontrol show job <starved_job_id> | grep -E "Priority|AccrueTime|Reason|JobState"
```

Expect: `Priority=1`, `AccrueTime=Unknown`, `Reason=Priority`.

### Step 2. Hold the blocker jobs

```bash
scontrol hold <blocker_id_1> <blocker_id_2> ...
```

Held jobs go to `Priority=0` with `Reason=JobHeldUser` and are skipped by both the main scheduler and backfill. They no longer consume your per-user-per-partition backfill or accrue slot.

### Step 3. Wait one full scheduler cycle and verify

Waiting time is roughly `PriorityCalcPeriod + bf_interval`. Find your cluster's values with:

```bash
scontrol show config | grep -iE "PriorityCalcPeriod|bf_interval"
```

Defaults are typically `PriorityCalcPeriod=5min` and `bf_interval=30s`, but many clusters tune these lower (e.g., 1min / 60s = ~90s total). Wait at least that long, then:

```bash
scontrol show job <starved_job_id> | grep -E "Priority|AccrueTime|Reason|JobState|StartTime"
```

Success looks like:

- `JobState=RUNNING` — backfill fit it into an idle gap, or
- `AccrueTime=<timestamp>` and `StartTime=<estimate>` — accrue slot freed; will run soon.

If still `AccrueTime=Unknown` after two scheduling cycles, re-check which of your jobs are pending in the partition — you may have missed another high-priority blocker.

### Step 4. Release the blockers once the starved job is running

Running jobs are unaffected by releasing their pending siblings.

```bash
scontrol release <blocker_id_1> <blocker_id_2> ...
```

The blockers return to normal pending state. New low-priority jobs submitted to the same partition after this point will re-hit the same problem — re-apply the hold if needed.

## One-shot commands

```bash
# Hold all your pending jobs matching a feature (e.g., a specific GPU type) in a partition.
# Replace <PARTITION> and <FEATURE_REGEX> with your values.
HOLD_IDS=$(squeue -u $USER -p <PARTITION> -t PENDING -h -o "%i %b" \
  | awk '/<FEATURE_REGEX>/ {print $1}')
[ -n "$HOLD_IDS" ] && scontrol hold $HOLD_IDS && echo "Held: $HOLD_IDS"

# ...later, release them
scontrol release $HOLD_IDS
```

## Do not hold these jobs if

- The blocker jobs are close to their `EligibleTime` for running (nodes about to free up) — holding only delays them.
- You have only one starved job and don't care about its wait time.
- You can instead move the starved job to a different partition where you don't have the blockers. Check with:
  ```bash
  sacctmgr show assoc user=$USER format=Account,Partition,QOS
  sinfo -o "%P %l %D %t"
  ```
  Moving the starved job is the cleaner fix when a suitable alternative partition exists.
