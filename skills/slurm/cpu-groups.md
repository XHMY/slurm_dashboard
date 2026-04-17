# CPU & Feature Constraints

Quick reference for targeting specific CPU architectures or GPU types with `--constraint=` and `--prefer=`. This file is cluster-agnostic — actual feature names are defined per-cluster by the Slurm admin. Discover them first, then pick.

## Syntax

- `&` = AND (both required): `--constraint="epyc&el9"`
- `|` = OR (either one): `--constraint="skylake|cascadelake"`
- Quote the value whenever you use `&` or `|`.
- Both `--constraint` and `--prefer` use the same syntax.

## Discover features on your cluster

Feature flags are arbitrary strings set by the cluster admin. Before using a constraint, list what actually exists:

```bash
# Features per node
sinfo -o "%N %f"

# Just the unique feature sets
sinfo -o "%f" | sort -u

# Full detail for one node
scontrol show node <node_name> | grep -i features

# Generic TRES (useful for GPU types registered as TRES)
sacctmgr show tres
```

If a feature you want is missing, ask the cluster admins rather than guessing.

## Common CPU feature names

Most clusters expose some combination of these. Not every cluster uses every flag — confirm with the commands above.

| Feature | Meaning |
|---------|---------|
| `avx` | AVX instruction set (Sandy Bridge and newer Intel, Bulldozer and newer AMD) |
| `avx2` | AVX2 (Haswell+, Excavator+, Zen+) |
| `avx512` | AVX-512 (Skylake-SP+, Ice Lake, Sapphire Rapids, Zen 4+) |
| `sandybridge`, `ivybridge` | Intel Sandy/Ivy Bridge generations |
| `haswell`, `broadwell` | Intel Haswell/Broadwell generations |
| `skylake`, `cascadelake` | Intel Skylake-SP / Cascade Lake generations |
| `icelake`, `sapphire`, `emerald` | Intel Ice Lake / Sapphire Rapids / Emerald Rapids |
| `epyc` | AMD EPYC (any generation) |
| `zen2`, `zen3`, `zen4`, `zen5` | AMD Zen microarchitecture generations |
| `el7`, `el8`, `el9` | RHEL/Rocky/AlmaLinux major version (useful to distinguish OS-level features) |

When available, prefer ISA-level flags (`avx2`, `avx512`) over microarchitecture names — they survive hardware refreshes.

## Common GPU constraint conventions

Admins typically register a feature named after the GPU model. Common flags seen across clusters:

| Flag (typical) | GPU |
|----------------|-----|
| `v100` | Tesla V100 |
| `a100` | A100 |
| `a40` | A40 |
| `l40s` | L40S |
| `h100` | H100 |
| `h200` | H200 |
| `rtx6000`, `rtx8000` | RTX 6000 / 8000 |
| `t4` | Tesla T4 |

Always verify with `sinfo -o "%N %G %f"` — the Gres column shows actual GPU resources, and Features shows what you can put in `--constraint`.

Extra VRAM-size flags like `vram40g`, `vram80g`, `vram140g` are sometimes defined; check your cluster.

## `--prefer` vs `--constraint`

Use `--prefer` for soft requests and `--constraint` as the hard floor. Slurm tries `--prefer` first; if no matching nodes are available, it falls back to `--constraint`.

### Common patterns

Replace `<fast_feature>` / `<baseline_feature>` with names valid on your cluster (see discovery commands above).

**Prefer fastest tier, accept any modern node:**
```
#SBATCH --prefer=<fast_feature>
#SBATCH --constraint=<baseline_feature>
```

**Prefer newest EPYC, accept any EPYC:**
```
#SBATCH --prefer="epyc&<new_generation>"
#SBATCH --constraint=epyc
```

**Prefer fastest tier, fall back to any AVX-512 node:**
```
#SBATCH --prefer="<fast_feature>|epyc&<new_generation>"
#SBATCH --constraint=avx512
```

**Prefer AVX-512, accept any AVX2:**
```
#SBATCH --prefer=avx512
#SBATCH --constraint=avx2
```

### Rules

- `--prefer` and `--constraint` use the same syntax (`&` for AND, `|` for OR).
- `--prefer` is tried first; if no matching nodes are available, Slurm falls back to `--constraint`.
- `--prefer` overrides `--constraint` features when both can be satisfied.
- If `--constraint` is omitted, `--prefer` acts as a soft preference with no hard floor — the job will still run on any node in the partition.

## Targeting a single node

If you need a specific node (e.g., the only one with a particular GPU):

```
#SBATCH --nodelist=<node_name>
```

Or to exclude specific nodes:

```
#SBATCH --exclude=<node1>,<node2>
```

Prefer `--constraint` over hard-coded nodelists when possible — it stays correct as the cluster inventory changes.
