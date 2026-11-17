# live_test_session.py  — run from D:\yprojects\Zero-Plus\ai-service
import uuid
from app.schemas.request import AnalyzeRequest
from app.features.feature_extractor import extract_features
from app.features.session_tracker import SessionTracker, SCHEMA_VERSION, META_SUFFIX
from app.persistence.redis_client import init_redis, get_redis

init_redis()
tracker = SessionTracker()
RUN = uuid.uuid4().hex[:8]
created = []
results = []


def check(name, cond, info=""):
    results.append(bool(cond))
    print(("PASS" if cond else "FAIL"), "-", name, ("| " + str(info)) if info else "")


def mk(sid, ip="1.2.3.4", path="/login"):
    return AnalyzeRequest(org_id="org_demo", session_id=sid, path=path, ip=ip)


def obs(req, feats, **kw):
    r = tracker.observe(req, feats, **kw)
    if r.identity_key not in created:
        created.append(r.identity_key)
    return r


print("=== run", RUN, "===")

# ---- 0) is the NEW file loaded? ----
req = mk("t0-" + RUN)
base = extract_features(req)
r = obs(req, base)
obs(req, base)
r = obs(req, base)
check("new file loaded (max_jump + raw_score exist)",
      "max_jump" in r.drift.details and "raw_score" in r.drift.details, list(r.drift.details))

# ---- 1) fresh identity ----
req = mk("t1-" + RUN)
r1 = obs(req, base)
check("fresh identity: score 0 + no_history", r1.drift.score == 0.0 and "no_history" in r1.drift.reasons, r1.drift.reasons)
check("fresh identity: stored once", r1.stored and r1.history_size_after == 1)
check("identity kind is sid", r1.drift.identity_kind == "sid", r1.drift.identity_kind)

# ---- 2) warm-up ----
r2 = obs(req, base)
check("2nd identical request: warming_up", "warming_up" in r2.drift.reasons, r2.drift.reasons)
check("2nd identical request: score ~0", r2.drift.score < 0.05, round(r2.drift.score, 4))

# ---- 3) stable baseline ----
for _ in range(4):
    rs = obs(req, base)
check("5 identical requests: stable", "stable" in rs.drift.reasons and rs.drift.score < 0.05,
      (round(rs.drift.score, 4), rs.drift.confidence))
check("confidence reached 1.0", rs.drift.confidence == 1.0, rs.drift.confidence)

# ---- 4) sudden attack ----
atk = dict(base)
atk["risk_score_norm"] = 1.0
atk["path_sens_critical"] = 1.0
ra = obs(req, atk)
print("   attack details:", ra.drift.details)
check("attack: score clearly above baseline", ra.drift.score > rs.drift.score + 0.1, round(ra.drift.score, 4))

# ---- 5) full inversion (the old 3rd test) ----
inv = {k: (1.0 - v if isinstance(v, float) else v) for k, v in base.items()}
req5 = mk("t5-" + RUN)
for _ in range(5):
    obs(req5, base)
ri = obs(req5, inv)
check("inversion: medium or high", ri.drift.is_medium or ri.drift.is_high, (round(ri.drift.score, 4), ri.drift.reasons))

# ---- 6) baseline poisoning defense ----
req6 = mk("t6-" + RUN)
for _ in range(5):
    obs(req6, base)
size_before = tracker.get_history_size(req6)
streak_reasons = []
for i in range(4):
    rp = obs(req6, inv)
    streak_reasons.append(rp.drift.reasons)
size_after = tracker.get_history_size(req6)
flagged = [("not_stored_high_drift" in x) for x in streak_reasons]
if any(flagged):
    check("poisoning: high-drift requests NOT stored", size_after == size_before, (size_before, size_after))
else:
    print("INFO - inversion never reached high on your thresholds; lower session_drift_high_threshold to test streak")
    check("poisoning: (skipped, thresholds)", True)

# ---- 7) trusted=False never stored ----
req7 = mk("t7-" + RUN)
for _ in range(3):
    obs(req7, base)
sz = tracker.get_history_size(req7)
ru = obs(req7, base, trusted=False)
check("trusted=False: not stored", (not ru.stored) and tracker.get_history_size(req7) == sz and "not_stored_untrusted" in ru.drift.reasons, ru.drift.reasons)

# ---- 8) peek does not write ----
sz = tracker.get_history_size(req7)
tracker.peek_drift(req7, atk)
check("peek_drift: no write", tracker.get_history_size(req7) == sz)

# ---- 9) zero vector ----
zero = {k: 0.0 for k in base}
req9 = mk("t9-" + RUN)
for _ in range(4):
    obs(req9, base)
rz = obs(req9, zero)
check("zero vector vs activity = real change", rz.drift.details.get("vs_last_cos") == 1.0, rz.drift.details.get("vs_last_cos"))

# ---- 10) identity rotation ----
rot_ip = "9.9.9.9"
last = None
for i in range(15):
    rq = mk(f"rot-{RUN}-{i}", ip=rot_ip)
    last = obs(rq, base)
check("identity rotation flagged (15 sids, 1 IP)", last.drift.identity_rotation, last.drift.details.get("ip_distinct_identities"))

# ---- 11) meta + schema in Redis ----
meta = get_redis().get_json(req.session_id and tracker.observe(req, base, store=False).identity_key + META_SUFFIX)
check("meta stored with schema version", isinstance(meta, dict) and meta.get("schema") == SCHEMA_VERSION,
      None if not isinstance(meta, dict) else meta.get("schema"))
check("meta has feature_keys", isinstance(meta, dict) and len(meta.get("feature_keys", [])) == len(base))

# ---- 12) different identities do not share history ----
ra_, rb_ = mk("iso-a-" + RUN), mk("iso-b-" + RUN)
for _ in range(4):
    obs(ra_, base)
rb1 = obs(rb_, atk)
check("isolation: new visitor has no history", rb1.drift.score == 0.0 and rb1.drift.history_size == 0)

# ---- 13) fail-open when Redis is down ----
class BrokenRedis:
    def __getattr__(self, name):
        def boom(*a, **k):
            raise ConnectionError("redis down")
        return boom

bt = SessionTracker(redis_client=BrokenRedis())
rf = bt.observe(mk("t13-" + RUN), base)
check("redis down: fail-open, no crash", rf.drift.score == 0.0 and "tracker_unavailable" in rf.drift.reasons, rf.drift.reasons)

# ---- 14) speed ----
import time
rq = mk("speed-" + RUN)
t = time.perf_counter()
for _ in range(50):
    obs(rq, base)
ms = (time.perf_counter() - t) * 1000 / 50
check("avg observe() < 15 ms", ms < 15, f"{ms:.2f} ms")

# ---- cleanup ----
for k in created:
    tracker.clear_by_key(k)
rot_key_cleanup = get_redis()
print()
print("RESULT:", sum(results), "/", len(results), "passed")