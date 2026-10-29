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
main_tracks AS (
  SELECT tt.id AS track_id, t.upid
  FROM thread_track tt
  JOIN thread t USING (utid)
  WHERE t.name = 'CrRendererMain'
),
children AS (
  SELECT parent_id, SUM(dur) AS child_dur
  FROM slice
  WHERE parent_id IS NOT NULL
  GROUP BY parent_id
),
main_slices AS (
  SELECT
    s.ts,
    s.dur,
    s.depth,
    mt.upid,
    s.dur - COALESCE(c.child_dur, 0) AS self_dur,
    CASE
      WHEN s.name GLOB '*GC*' THEN 'gc'
      WHEN s.name IN ('UpdateLayoutTree', 'RecalculateStyles', 'ParseAuthorStyleSheet') THEN 'style'
      WHEN s.name IN ('Layout', 'UpdateLayerTree', 'IntersectionObserverController::computeIntersections', 'ResizeObserverController::deliverObservations') THEN 'layout'
      WHEN s.name IN ('PrePaint', 'Paint', 'Layerize', 'PaintImage', 'UpdateLayer', 'Commit', 'ImageDecodeTask', 'Decode Image') THEN 'paint'
      WHEN s.name IN ('FunctionCall', 'EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule', 'v8.run', 'v8.callFunction', 'RunMicrotasks', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'FireIdleCallback', 'HandlePostMessage', 'XHRReadyStateChange', 'V8.Execute') THEN 'script'
      ELSE 'other'
    END AS bucket
  FROM slice s
  JOIN main_tracks mt ON s.track_id = mt.track_id
  LEFT JOIN children c ON c.parent_id = s.id
),
per_window AS (
  SELECT
    w.window_index,
    w.name,
    w.dur AS window_dur,
    SUM(CASE WHEN m.depth = 0 THEN MIN(m.ts + m.dur, w.ts + w.dur) - MAX(m.ts, w.ts) ELSE 0 END) AS busy,
    MAX(CASE WHEN m.depth = 0 THEN m.dur ELSE 0 END) AS longest_task,
    SUM(CASE WHEN m.depth = 0 AND m.dur > 50000000 THEN 1 ELSE 0 END) AS long_tasks,
    SUM(CASE WHEN m.bucket = 'script' AND m.ts >= w.ts THEN m.self_dur ELSE 0 END) AS script,
    SUM(CASE WHEN m.bucket = 'style' AND m.ts >= w.ts THEN m.self_dur ELSE 0 END) AS style,
    SUM(CASE WHEN m.bucket = 'layout' AND m.ts >= w.ts THEN m.self_dur ELSE 0 END) AS layout,
    SUM(CASE WHEN m.bucket = 'paint' AND m.ts >= w.ts THEN m.self_dur ELSE 0 END) AS paint,
    SUM(CASE WHEN m.bucket = 'gc' AND m.ts >= w.ts THEN m.self_dur ELSE 0 END) AS gc
  FROM windows w
  LEFT JOIN main_slices m
    ON m.upid = w.upid AND m.ts < w.ts + w.dur AND m.ts + m.dur > w.ts
  GROUP BY w.id
)
SELECT
  window_index,
  name,
  window_dur / 1e6 AS window_ms,
  busy / 1e6 AS busy_ms,
  (window_dur - busy) / 1e6 AS idle_ms,
  longest_task / 1e6 AS longest_task_ms,
  long_tasks,
  script / 1e6 AS script_ms,
  style / 1e6 AS style_ms,
  layout / 1e6 AS layout_ms,
  paint / 1e6 AS paint_ms,
  gc / 1e6 AS gc_ms,
  (busy - script - style - layout - paint - gc) / 1e6 AS other_ms
FROM per_window
ORDER BY window_index;
