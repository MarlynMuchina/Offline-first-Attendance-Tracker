// The admin dashboard's "Whole school" view: every class at once.

export const ALL_CLASSES = 'ALL'

// One row per class from the per-student figures: class average (the mean of
// its students' rates, the same way the dashboard averages a class), how many
// students are below the warning line and below the exam line.
export function classBreakdown(perStudent, classes, threshold, examLine) {
  return classes.map((c) => {
    const students = perStudent.filter((p) => p.student.class_id === c.id)
    const withData = students.filter((p) => p.rate !== null)
    const rate = withData.length > 0 ? withData.reduce((sum, p) => sum + p.rate, 0) / withData.length : null
    return {
      id: c.id,
      name: c.name,
      students: students.length,
      rate,
      belowWarning: withData.filter((p) => p.rate < threshold).length,
      belowExam: withData.filter((p) => p.rate < examLine).length,
      absences: students.reduce((sum, p) => sum + p.absent, 0),
    }
  })
}

// Runs `task` for each item, at most `limit` at a time, keeping the order.
export async function mapLimited(items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await task(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
