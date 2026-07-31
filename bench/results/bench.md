# cohort-performance benchmark

Scenario: **2026-01-01..2026-03-31 (90d), groupBy=[channel, country], dayIndex<=30, org=acme-games**  
Iterations per variant: **25** (warm cache, first run discarded).

| variant | p50 (ms) | p95 (ms) | rows returned | approx bytes |
|---|---:|---:|---:|---:|
| naive (SELECT rows -> Node aggregate) | 51.3 | 69.1 | 44,640 | 4185.0 KB |
| optimised (rpc_cohort_performance) | 42.4 | 77.1 | 8 | 1.6 KB |

Speedup (p95): **0.9x**  
Rows-over-wire reduction: **5580x**
