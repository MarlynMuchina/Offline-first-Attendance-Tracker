import { db } from './db'
import { getClassesForCurrentTeacher } from './auth'
import { fromServer } from './network'

/**
 * The teacher's name and classes. Fetched from the server when it can be
 * reached and saved on the device; when it can't (offline), the copy saved
 * last time is used instead, so the register still opens. If the server says
 * the teacher has no classes, that answer stands and the saved copy is not
 * used. Returns { teacherName, classes, savedAt } where savedAt is set only
 * for a saved copy.
 */
export async function loadTeacherClasses(userId) {
  const key = `teacher:${userId}`
  try {
    const fresh = await fromServer(() => getClassesForCurrentTeacher(userId), 15000)
    await db.dashboardCache
      .put({ key, ...fresh, saved_at: new Date().toISOString() })
      .catch((err) => console.warn('Could not save your classes on this device:', err))
    return { ...fresh, savedAt: null }
  } catch (err) {
    if (err?.notAssigned) throw err
    const saved = await db.dashboardCache.get(key).catch(() => null)
    if (saved?.classes?.length) {
      return { teacherName: saved.teacherName, classes: saved.classes, savedAt: saved.saved_at }
    }
    throw err
  }
}
