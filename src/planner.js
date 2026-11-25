// Builds a day-by-day study plan with spaced-repetition reviews.
const DAY = 86400000;
const REVIEW_OFFSETS = [1, 3, 7, 14];

const parseDate = s => { const d = new Date(String(s) + 'T00:00:00Z'); if (isNaN(d)) throw Object.assign(new Error(`Invalid date "${s}"`), { status: 400 }); return d; };
const iso = d => d.toISOString().slice(0, 10);

export function buildPlan({ topics, startDate, examDate, minutesPerDay = 60, learnMinutes = 45, reviewMinutes = 15 }) {
  const list = (topics || []).map(t => (typeof t === 'string' ? t : t?.name || '').trim()).filter(Boolean);
  if (!list.length) throw Object.assign(new Error('Add at least one topic.'), { status: 400 });
  const start = parseDate(startDate);
  const exam = parseDate(examDate);
  const totalDays = Math.round((exam - start) / DAY);
  if (totalDays < 1) throw Object.assign(new Error('The exam date must be after the start date.'), { status: 400 });

  // Learn new topics in the first ~70% of the time, keep the rest for reviews and revision.
  const learnDays = Math.max(1, Math.min(totalDays, Math.floor(totalDays * 0.7)));
  const days = Array.from({ length: totalDays }, (_, i) => ({ date: iso(new Date(start.getTime() + i * DAY)), tasks: [] }));

  list.forEach((topic, i) => {
    const learnDay = Math.floor((i * learnDays) / list.length);
    days[learnDay].tasks.push({ type: 'learn', topic, minutes: learnMinutes });
    for (const off of REVIEW_OFFSETS) {
      const d = learnDay + off;
      if (d < totalDays) days[d].tasks.push({ type: 'review', topic, minutes: reviewMinutes });
    }
  });

  // Final day before the exam: quick revision of every topic.
  const last = days[totalDays - 1];
  for (const topic of list) {
    if (!last.tasks.some(t => t.topic === topic)) last.tasks.push({ type: 'revise', topic, minutes: Math.max(5, Math.round(reviewMinutes / 2)) });
  }

  const warnings = [];
  for (const d of days) {
    d.totalMinutes = d.tasks.reduce((a, t) => a + t.minutes, 0);
    d.overloaded = d.totalMinutes > minutesPerDay;
  }
  const overloaded = days.filter(d => d.overloaded).length;
  if (overloaded) warnings.push(`${overloaded} day(s) need more than your ${minutesPerDay} minutes. Consider an earlier start date or fewer topics.`);
  return { startDate: iso(start), examDate: iso(exam), minutesPerDay, days, warnings };
}
