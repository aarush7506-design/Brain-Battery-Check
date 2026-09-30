(() => {
  "use strict";

  const API_BASE = "https://brain-battery-check.onrender.com";

  const $ = (id) => document.getElementById(id);
  const form = $("predict-form"), submitBtn = $("submit-btn"), battery = $("battery"), cellsEl = $("cells");
  const states = { idle: $("state-idle"), loading: $("state-loading"), result: $("state-result"), error: $("state-error") };
  const stressInput = $("stress_level");

  for (let i = 0; i < 10; i++) {
    const c = document.createElement("div");
    c.className = "cell";
    c.style.setProperty("--i", i);
    cellsEl.appendChild(c);
  }
  const cells = [...cellsEl.children];

  // stress picker
  document.querySelectorAll(".mood").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mood").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      stressInput.value = btn.dataset.value;
      clearError(stressInput);
    });
  });

  // field errors
  const wrap = (el) => el.closest(".field");
  function setError(el, msg) {
    const w = wrap(el); if (!w) return;
    w.classList.add("field-error");
    w.querySelector(".error-msg").textContent = msg;
  }
  function clearError(el) {
    const w = wrap(el); if (!w) return;
    w.classList.remove("field-error");
    w.querySelector(".error-msg").textContent = "";
  }
  form.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", () => clearError(el));
    el.addEventListener("change", () => clearError(el));
  });

  // payload + validation (mirrors the FastAPI StudentData model)
  const num = (id, int) => {
    const v = $(id).value.trim();
    return v === "" ? NaN : int ? parseInt(v, 10) : parseFloat(v);
  };
  function collect() {
    return {
      age: num("age", true),
      gender: $("gender").value,
      country: $("country").value.trim(),
      academic_level: $("academic_level").value,
      most_used_platform: $("most_used_platform").value,
      purpose_of_use: $("purpose_of_use").value,
      avg_daily_usage_hours: num("avg_daily_usage_hours"),
      daily_unlocks: num("daily_unlocks", true),
      study_hours: num("study_hours"),
      physical_activity_hours: num("physical_activity_hours"),
      sleep_hours_per_night: num("sleep_hours_per_night"),
      stress_level: stressInput.value,
    };
  }
  function validate(p) {
    const errs = [];
    [["age", 10, 100], ["avg_daily_usage_hours", 0, 24], ["daily_unlocks", 0, Infinity],
     ["study_hours", 0, 24], ["physical_activity_hours", 0, 24], ["sleep_hours_per_night", 0, 24]]
      .forEach(([k, min, max]) => {
        const v = p[k];
        if (Number.isNaN(v)) errs.push([$(k), "Fill this in."]);
        else if (v < min || v > max) errs.push([$(k), max === Infinity ? "Must be 0 or more." : `Pick a number from ${min} to ${max}.`]);
      });
    ["gender", "country", "academic_level", "most_used_platform", "purpose_of_use"].forEach((k) => {
      if (!p[k]) errs.push([$(k), "Fill this in."]);
    });
    if (!p.stress_level) errs.push([stressInput, "Tap the mood that fits."]);
    return errs;
  }

  // UI states
  function show(name) {
    Object.entries(states).forEach(([k, el]) => (el.hidden = k !== name));
    battery.classList.toggle("charging", name === "loading");
    if (name !== "result") paint(0);
  }
  function paint(score) {
    const lit = Math.round(score);
    const color = score < 4 ? "#FF5A5F" : score < 7 ? "#FFD23F" : "#B8F05C";
    battery.style.setProperty("--c", color);
    $("score-number").style.setProperty("--c", color);
    cells.forEach((c, i) => {
      c.style.transitionDelay = `${i * 60}ms`;
      c.style.setProperty("--c", color);
      c.classList.toggle("on", i < lit);
    });
  }
  function band(s) {
    if (s < 4) return ["Running on fumes 🪫", "Your habits suggest you're stretched thin. Sleep and less scrolling are the quickest recharges."];
    if (s < 7) return ["Half charged 🔋", "Not bad. You're holding steady, and a few small tweaks could top you up."];
    return ["Fully charged ⚡", "Your routine looks solid. Keep protecting that sleep and downtime."];
  }
  function showResult(score) {
    const s = Math.max(0, Math.min(10, score));
    const [label, copy] = band(s);
    $("score-number").textContent = score.toFixed(2);
    $("score-band").textContent = label;
    $("score-context").textContent = copy;
    show("result");
    requestAnimationFrame(() => paint(s));
  }
  function showError(label, copy) {
    $("error-label").textContent = label;
    $("error-copy").textContent = copy;
    show("error");
  }

  // map server 422 errors onto fields
  function applyServerErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let hit = false;
    detail.forEach((e) => {
      const key = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null;
      const el = key && $(key);
      if (el) { setError(el, e.msg || "That doesn't look right."); hit = true; }
    });
    return hit;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.querySelectorAll(".field").forEach((f) => f.classList.remove("field-error"));
    const payload = collect();
    const errs = validate(payload);
    if (errs.length) {
      errs.forEach(([el, msg]) => setError(el, msg));
      errs[0][0].focus?.();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add("loading");
    show("loading");

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 422) {
        const body = await res.json().catch(() => null);
        const hit = body && applyServerErrors(body.detail);
        return showError("Check your answers", hit ? "The server flagged a few fields. They're marked on the form." : "The server didn't accept those answers. Review the form and try again.");
      }
      if (!res.ok) return showError("Prediction failed", `The server responded with status ${res.status}. Try again in a moment.`);

      const data = await res.json();
      // the API returns "predicted_Mental_Health_Score"; accept lowercase too
      const score = data.predicted_Mental_Health_Score ?? data.predicted_mental_health_score;
      if (typeof score !== "number") return showError("Odd response", "The server replied, but the score was missing.");
      showResult(score);
    } catch {
      showError("Can't reach the server", "The backend may be asleep or offline. Wait a few seconds and try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove("loading");
    }
  });

  $("reset-btn").addEventListener("click", () => show("idle"));
  $("error-retry-btn").addEventListener("click", () => show("idle"));

  show("idle");
})();
