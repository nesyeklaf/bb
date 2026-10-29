WITH windows AS (
  SELECT
    s.id,
    s.name,
    s.ts,
    s.dur,
    pt.upid,
    ROW_NUMBER() OVER (ORDER BY s.ts) AS window_index
  FROM slice s
  JOIN process_track pt ON s.track_id = pt.id
  WHERE s.name GLOB 'lab:*'
),
samples AS (
  SELECT
    p.ts,
    p.callsite_id,
    t.upid,
    MIN(
      COALESCE(LEAD(p.ts) OVER (PARTITION BY p.utid ORDER BY p.ts) - p.ts, 0),
      10000000
    ) AS weight
  FROM cpu_profile_stack_sample p
  JOIN thread t USING (utid)
  WHERE t.name = 'CrRendererMain'
),
leaf AS (
  SELECT
    s.ts,
    s.upid,
    s.weight,
    CASE WHEN f.name = '' THEN '(anonymous)' ELSE f.name END AS function_name
  FROM samples s
  JOIN stack_profile_callsite c ON c.id = s.callsite_id
  JOIN stack_profile_frame f ON f.id = c.frame_id
  WHERE f.name <> '(idle)'
),
per_function AS (
  SELECT
    w.window_index,
    w.name,
    l.function_name,
    COUNT(*) AS samples,
    SUM(MIN(l.ts + l.weight, w.ts + w.dur) - MAX(l.ts, w.ts)) AS self_dur
  FROM windows w
  JOIN leaf l
    ON l.upid = w.upid
    AND l.ts < w.ts + w.dur
    AND l.ts + l.weight > w.ts
  GROUP BY w.window_index, l.function_name
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY window_index ORDER BY self_dur DESC) AS rank
  FROM per_function
)
SELECT
  window_index,
  name,
  rank,
  function_name,
  samples,
  self_dur / 1e6 AS self_ms
FROM ranked
WHERE rank <= 15
ORDER BY window_index, rank;
