# cohort-performance benchmark

Scenario: **2026-01-01..2026-03-31 (90d), groupBy=[channel, country], dayIndex<=30, org=acme-games**  
Iterations per variant: **25** (warm cache, first run discarded).

| variant | p50 (ms) | p95 (ms) | rows returned | approx bytes |
|---|---:|---:|---:|---:|
| naive (SELECT rows -> Node aggregate) | 63.1 | 70.3 | 55,800 | 5231.3 KB |
| optimised (rpc_cohort_performance) | 79.7 | 116.9 | 20 | 3.9 KB |

Speedup (p95): **0.6x**  
Rows-over-wire reduction: **2790x**
